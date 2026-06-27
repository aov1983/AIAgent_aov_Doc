"""Пересчёт поля `similar_requirements` в uploads/graphs/{document_id}.json
по текущему состоянию Qdrant — без переразбора документа.

Зачем: первый загруженный документ всегда сохраняется с пустыми похожими
требованиями, т.к. _enrich_with_rag_search срабатывает ДО _save_to_rag, а
коллекция Qdrant на тот момент ещё не содержит ни его чанков, ни тем более
чанков последующих документов. Этот скрипт чинит JSON постфактум.

Использование:
    python scripts/refresh_rag_matches.py                   # все документы из uploads/graphs/
    python scripts/refresh_rag_matches.py <document_id>     # один документ
    python scripts/refresh_rag_matches.py --threshold 0.3   # свой порог
    python scripts/refresh_rag_matches.py --top-k 5         # больше матчей на абзац
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# .env должен загрузиться ДО импорта rag_storage — иначе singleton qdrant_db
# проинициализируется на дефолтной коллекции "architect_knowledge".
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from agent.rag_storage import qdrant_db  # noqa: E402

GRAPHS_DIR = ROOT / "uploads" / "graphs"


def refresh_document(document_id: str, threshold: float, top_k: int, max_per_row: int) -> int:
    """Обновляет similar_requirements в JSON документа.

    Возвращает количество абзацев, для которых нашлись матчи.
    """
    path = GRAPHS_DIR / f"{document_id}.json"
    if not path.is_file():
        print(f"  [skip] {document_id}: файл не найден ({path})")
        return 0

    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data.get("paragraphs") or []
    if not rows:
        print(f"  [skip] {document_id}: paragraphs пуст")
        return 0

    updated_rows = 0
    for row in rows:
        query = (row.get("paragraph_text") or "").strip()
        if not query:
            facts = row.get("facts") or []
            query = " ".join(facts).strip()
        if not query:
            continue

        raw = qdrant_db.search(query=query, top_k=top_k, threshold=threshold)
        # client-side filter: убираем матчи самого себя
        filtered = [r for r in raw if r.get("document_id") != document_id][:max_per_row]
        if not filtered:
            row["similar_requirements"] = []
            continue

        row["similar_requirements"] = [
            {
                "id": r.get("chunk_id"),
                "score": r.get("similarity_score"),
                "content": (r.get("content") or "")[:200],
                "document_id": r.get("document_id"),
                "source_document": (r.get("metadata") or {}).get("chapter_title")
                or (r.get("metadata") or {}).get("document_id")
                or "unknown",
            }
            for r in filtered
        ]
        updated_rows += 1

    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  [ok]   {document_id}: обновлено {updated_rows}/{len(rows)} абзацев")
    return updated_rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document_id", nargs="?", help="ID документа (по умолчанию — все)")
    parser.add_argument("--threshold", type=float, default=0.3, help="Порог similar_to (def: 0.3)")
    parser.add_argument("--top-k", type=int, default=10, help="Сколько кандидатов брать из Qdrant (def: 10)")
    parser.add_argument("--max-per-row", type=int, default=3, help="Сколько матчей сохранять на абзац (def: 3)")
    args = parser.parse_args()

    if args.document_id:
        targets = [args.document_id]
    else:
        targets = [p.stem for p in GRAPHS_DIR.glob("*.json")]

    if not targets:
        print("Нет JSON-файлов в uploads/graphs/")
        return 1

    print(f"Документов к обработке: {len(targets)} | threshold={args.threshold} top_k={args.top_k}")
    total = 0
    for doc_id in targets:
        total += refresh_document(doc_id, args.threshold, args.top_k, args.max_per_row)
    print(f"Готово. Всего обновлено абзацев: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
