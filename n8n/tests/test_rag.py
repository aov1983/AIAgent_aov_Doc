"""
Тесты wf_rag_* через GET /rag/search. Требуют живой embeddings_service.

Покрывает шаг 8 из e2e.sh.
"""
from __future__ import annotations

import time

import pytest
import requests

from conftest import HTTP_TIMEOUT, UploadedDoc


@pytest.mark.requires_embeddings
def test_rag_search_finds_uploaded_document(
    base_url: str,
    auth_headers: dict[str, str],
    uploaded_document: UploadedDoc,
) -> None:
    # Даём Qdrant консистентности осесть после upload — в e2e.sh так же.
    time.sleep(1)

    # marker содержит run_id и присутствует в исходном тексте чанка — гарантирует,
    # что свежий документ выделим среди шума от предыдущих сессий (Qdrant-коллекция
    # переживает прогоны тестов до `docker compose down -v`).
    r = requests.get(
        f"{base_url}/webhook/rag/search",
        headers=auth_headers,
        params={"query": uploaded_document.marker, "threshold": 0.3},
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code == 200, r.text[:400]
    matches = r.json()
    assert isinstance(matches, list) and matches, (
        f"rag/search не вернул совпадений: {matches!r}"
    )

    our = [m for m in matches if (m.get("metadata") or {}).get("document_id") == uploaded_document.document_id]
    assert our, (
        f"среди {len(matches)} совпадений нет нашего document_id={uploaded_document.document_id}"
    )

    scores = [m.get("similarity_score", 0.0) for m in matches]
    assert max(scores) >= 0.3, f"top similarity_score={max(scores)} < threshold 0.3"
