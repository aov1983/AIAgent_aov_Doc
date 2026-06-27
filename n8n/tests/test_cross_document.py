"""
Cross-document тесты на связность.

CashHub.docx и PayGate.docx — два связанных ТЗ из examples/:
CashHub в разделе 2.2 явно интегрируется с PayGate v2. После заливки
обоих документов pipeline должен:
  1. Назначить им разные document_id и сохранить оба в /files/history.
  2. По /rag/search "PayGate v2" вернуть чанки PayGate.docx (cross-doc поиск).
  3. По /rag/search на общую тему ("возврат средств") вернуть чанки из ОБОИХ.
  4. Граф каждого документа иметь nodes/edges/stats без ошибок.

Тест требует Docling (для .docx → md) и embeddings_service (для RAG).
"""
from __future__ import annotations

import time

import pytest
import requests

from conftest import HTTP_TIMEOUT, UploadedDoc


@pytest.mark.requires_docling
@pytest.mark.slow
def test_pair_uploaded_with_distinct_ids(uploaded_example_pair: list[UploadedDoc]) -> None:
    paygate, cashhub = uploaded_example_pair
    assert paygate.document_id and cashhub.document_id
    assert paygate.document_id != cashhub.document_id, "оба документа получили один document_id"
    assert paygate.job_id != cashhub.job_id
    assert paygate.total_requirements > 0, "PayGate: pipeline не извлёк требований"
    assert cashhub.total_requirements > 0, "CashHub: pipeline не извлёк требований"


@pytest.mark.requires_docling
@pytest.mark.slow
def test_files_history_contains_both(
    base_url: str,
    auth_headers: dict[str, str],
    uploaded_example_pair: list[UploadedDoc],
) -> None:
    r = requests.get(f"{base_url}/webhook/files/history", headers=auth_headers, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200
    ids = {d.get("document_id") for d in r.json()}
    for doc in uploaded_example_pair:
        assert doc.document_id in ids, f"{doc.title} не найден в /files/history"


@pytest.mark.requires_docling
@pytest.mark.slow
@pytest.mark.parametrize("idx,title", [(0, "PayGate"), (1, "CashHub")])
def test_graph_for_each_document(
    base_url: str,
    auth_headers: dict[str, str],
    uploaded_example_pair: list[UploadedDoc],
    idx: int,
    title: str,
) -> None:
    doc = uploaded_example_pair[idx]
    r = requests.get(
        f"{base_url}/webhook/graph/by-document",
        headers=auth_headers,
        params={"document_id": doc.document_id},
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code == 200, f"{title}: {r.status_code} {r.text[:400]}"
    body = r.json()
    assert {"nodes", "edges", "stats"} <= set(body), f"{title}: missing keys in graph"
    assert body["stats"].get("paragraphs", 0) > 0, f"{title}: stats.paragraphs = 0"


@pytest.mark.requires_docling
@pytest.mark.requires_embeddings
@pytest.mark.slow
def test_rag_search_paygate_finds_paygate_document(
    base_url: str,
    auth_headers: dict[str, str],
    uploaded_example_pair: list[UploadedDoc],
) -> None:
    """
    CashHub.docx ссылается на 'PayGate v2'. Запрос '/rag/search?query=PayGate v2'
    должен находить чанки из PayGate.docx (а не только из CashHub) — это и есть
    cross-document связность через RAG.
    """
    paygate, cashhub = uploaded_example_pair
    time.sleep(2)  # даём Qdrant дозреть после двух upload'ов

    r = requests.get(
        f"{base_url}/webhook/rag/search",
        headers=auth_headers,
        params={"query": "PayGate v2 авторизация платежей JWT", "threshold": 0.3, "limit": 20},
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code == 200, r.text[:400]
    matches = r.json()
    assert isinstance(matches, list) and matches, f"rag/search пустой: {matches!r}"

    doc_ids_in_results = {(m.get("metadata") or {}).get("document_id") for m in matches}
    assert paygate.document_id in doc_ids_in_results, (
        f"PayGate document_id={paygate.document_id} не найден среди {len(matches)} матчей. "
        f"Найдены документы: {doc_ids_in_results}"
    )


@pytest.mark.requires_docling
@pytest.mark.requires_embeddings
@pytest.mark.slow
def test_rag_search_common_topic_returns_both_documents(
    base_url: str,
    auth_headers: dict[str, str],
    uploaded_example_pair: list[UploadedDoc],
) -> None:
    """
    'Возврат средств' — общая тема: и CashHub (раздел 2.3),
    и PayGate (раздел 2.3) её описывают. RAG должен вернуть чанки из обоих.
    """
    paygate, cashhub = uploaded_example_pair
    time.sleep(1)

    r = requests.get(
        f"{base_url}/webhook/rag/search",
        headers=auth_headers,
        params={"query": "возврат средств бухгалтер подтверждение суммы", "threshold": 0.25, "limit": 30},
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code == 200, r.text[:400]
    matches = r.json()
    assert isinstance(matches, list) and matches

    doc_ids = {(m.get("metadata") or {}).get("document_id") for m in matches}
    assert paygate.document_id in doc_ids, "PayGate не среди результатов 'возврат средств'"
    assert cashhub.document_id in doc_ids, "CashHub не среди результатов 'возврат средств'"
