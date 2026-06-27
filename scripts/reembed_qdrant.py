"""Переэмбеддинг чанков в Qdrant без переразбора документа.

Зачем: в коллекции могут лежать чанки с «битыми» векторами — например, если в
момент их сохранения модель эмбеддингов не загрузилась и сработал fallback на
хэш-векторы (`rag_storage._generate_embedding`). Внешне точки выглядят корректно
(payload и размерность 384), но семантический поиск по ним даёт случайные скоры.

Скрипт читает payload (поле `content`) каждой точки, прогоняет через текущую
модель эмбеддингов и перезаписывает вектор той же точки — ID и payload не меняются.

Использование:
    python scripts/reembed_qdrant.py                          # все точки в коллекции
    python scripts/reembed_qdrant.py --document-id <id>       # только один документ
    python scripts/reembed_qdrant.py --batch 64               # размер батча апдейтов
    python scripts/reembed_qdrant.py --dry-run                # ничего не пишет, только проверка
"""
from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from qdrant_client.models import (  # noqa: E402
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
)

from agent.rag_storage import qdrant_db  # noqa: E402


def iter_points(document_id: str | None, page_size: int = 256):
    """Итеративная выгрузка точек коллекции с payload (без векторов)."""
    qdrant_filter = None
    if document_id:
        qdrant_filter = Filter(
            must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))]
        )

    next_page = None
    while True:
        points, next_page = qdrant_db.client.scroll(
            collection_name=qdrant_db.collection_name,
            scroll_filter=qdrant_filter,
            limit=page_size,
            with_payload=True,
            with_vectors=False,
            offset=next_page,
        )
        if not points:
            return
        for p in points:
            yield p
        if next_page is None:
            return


def verify_one(document_id: str | None) -> None:
    """Сравнить self-match score чанка ДО и ПОСЛЕ переэмбеддинга (для одного примера)."""
    for p in iter_points(document_id, page_size=1):
        content = (p.payload or {}).get("content") or ""
        if not content.strip():
            continue
        r = qdrant_db.search(query=content, top_k=1, threshold=0.0)
        score = r[0]["similarity_score"] if r else None
        print(f"  sample chunk id={p.id} score-on-self={score}")
        return


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--document-id", help="Ограничить переэмбеддинг одним документом")
    parser.add_argument("--batch", type=int, default=64, help="Размер батча upsert (def: 64)")
    parser.add_argument("--dry-run", action="store_true", help="Не писать, только посчитать")
    args = parser.parse_args()

    if not qdrant_db.client:
        print("Qdrant client недоступен — нечего обновлять.")
        return 1

    # прогрев модели и сообщение какой именно она
    _ = qdrant_db.model
    print(f"Коллекция: {qdrant_db.collection_name}")
    print(f"Модель эмбеддингов: {type(qdrant_db._model).__name__ if qdrant_db._model else 'FALLBACK'}")

    print("\nПеред переэмбеддингом:")
    verify_one(args.document_id)

    batch: list[PointStruct] = []
    total = 0
    skipped = 0

    for p in iter_points(args.document_id):
        payload = p.payload or {}
        content = payload.get("content") or ""
        if not content.strip():
            skipped += 1
            continue

        new_vector = qdrant_db._generate_embedding(content)
        # ID в Qdrant — UUID-строка; возвращаем как есть
        point_id = p.id if isinstance(p.id, (int, str)) else str(uuid.UUID(int=p.id))

        batch.append(
            PointStruct(
                id=point_id,
                vector=new_vector,
                payload=payload,
            )
        )

        if len(batch) >= args.batch:
            if not args.dry_run:
                qdrant_db.client.upsert(
                    collection_name=qdrant_db.collection_name, points=batch
                )
            total += len(batch)
            print(f"  ... {total} точек обновлено")
            batch = []

    if batch:
        if not args.dry_run:
            qdrant_db.client.upsert(
                collection_name=qdrant_db.collection_name, points=batch
            )
        total += len(batch)

    print(f"\nГотово. Обновлено: {total}, пропущено (пустой content): {skipped}")
    if args.dry_run:
        print("(dry-run — изменения не записаны)")
        return 0

    print("\nПосле переэмбеддинга:")
    verify_one(args.document_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
