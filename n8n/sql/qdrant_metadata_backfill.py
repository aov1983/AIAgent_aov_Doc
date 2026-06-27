"""
Одноразовый backfill: добавляет поле `metadata` (вложенный объект-зеркало плоских
полей) в payload каждой точки коллекции Qdrant `docs_chunks`.

Нужен, чтобы существующие чанки стали читаемыми нативной нодой
@n8n/n8n-nodes-langchain.vectorStoreQdrant — она запрашивает только
`payload.content` и `payload.metadata` (см. libs/langchain-qdrant). Плоские поля
(document_id, paragraph_id, chapter_title, ...) сохраняются как есть — их
продолжают использовать [upload] Enrich Graph и HTTP-нода [upload] Qdrant Search
Similar.

Запуск (после `docker compose up -d`):
  python3 n8n/sql/qdrant_metadata_backfill.py

ENV:
  QDRANT_URL              http://localhost:6333
  QDRANT_COLLECTION_NAME  docs_chunks
  BATCH_SIZE              256

Идемпотентен: если у точки уже есть `payload.metadata` (object), её пропускаем.
"""
from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request
import json
from typing import Any


QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333").rstrip("/")
COLLECTION = os.getenv("QDRANT_COLLECTION_NAME", "docs_chunks")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "256"))


def _http(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{QDRANT_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode() or "{}")


def scroll_all() -> list[dict[str, Any]]:
    """Все точки коллекции одним списком (без векторов, c полным payload)."""
    out: list[dict[str, Any]] = []
    offset: Any = None
    while True:
        body: dict[str, Any] = {
            "limit": BATCH_SIZE,
            "with_payload": True,
            "with_vector": False,
        }
        if offset is not None:
            body["offset"] = offset
        page = _http("POST", f"/collections/{COLLECTION}/points/scroll", body)
        result = page.get("result") or {}
        for p in result.get("points") or []:
            out.append(p)
        offset = result.get("next_page_offset")
        if not offset:
            break
    return out


def needs_backfill(point: dict[str, Any]) -> bool:
    pl = point.get("payload") or {}
    meta = pl.get("metadata")
    # Уже есть валидная metadata-обёртка (object, не строка/число) — пропускаем.
    return not (isinstance(meta, dict) and meta)


def backfill(point: dict[str, Any]) -> None:
    """Добавить payload.metadata = {все плоские поля кроме content}."""
    pl = dict(point.get("payload") or {})
    pl.pop("content", None)
    pl.pop("metadata", None)
    body = {"payload": {"metadata": pl}, "points": [point["id"]]}
    _http("POST", f"/collections/{COLLECTION}/points/payload?wait=true", body)


def main() -> int:
    try:
        # Sanity-check: коллекция должна существовать.
        info = _http("GET", f"/collections/{COLLECTION}")
        status = (info.get("result") or {}).get("status")
        print(f"[backfill] collection={COLLECTION} status={status}")
    except urllib.error.HTTPError as e:
        print(f"[backfill] cannot reach {QDRANT_URL}/collections/{COLLECTION}: {e}", file=sys.stderr)
        return 2

    points = scroll_all()
    print(f"[backfill] всего точек: {len(points)}")
    todo = [p for p in points if needs_backfill(p)]
    print(f"[backfill] требуется обновить: {len(todo)}")
    for i, p in enumerate(todo, 1):
        backfill(p)
        if i % 50 == 0 or i == len(todo):
            print(f"[backfill] {i}/{len(todo)}")
    print("[backfill] done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
