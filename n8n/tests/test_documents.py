"""
Тесты документного API: upload, /graph, /paragraphs, /files/history.

Используют общий session-scoped upload из conftest.
"""
from __future__ import annotations

import re

import pytest
import requests

from conftest import HTTP_TIMEOUT, UploadedDoc


@pytest.mark.smoke
def test_upload_returns_job_and_document_ids(uploaded_document: UploadedDoc) -> None:
    assert uploaded_document.job_id, "пустой job_id"
    assert uploaded_document.document_id, "пустой document_id"
    assert uploaded_document.total_requirements >= 0


@pytest.mark.parametrize(
    "label,path_template",
    [
        ("by-job", "/webhook/graph?job_id={job_id}"),
        ("by-doc", "/webhook/graph/by-document?document_id={document_id}"),
    ],
)
def test_graph_has_nodes_edges_stats(
    base_url: str,
    auth_headers: dict[str, str],
    uploaded_document: UploadedDoc,
    label: str,
    path_template: str,
) -> None:
    url = base_url + path_template.format(
        job_id=uploaded_document.job_id,
        document_id=uploaded_document.document_id,
    )
    r = requests.get(url, headers=auth_headers, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"[{label}] {r.status_code}: {r.text[:400]}"
    body = r.json()
    for key in ("nodes", "edges", "stats"):
        assert key in body, f"[{label}] нет поля {key!r} в ответе"
    assert isinstance(body["nodes"], list)
    assert isinstance(body["edges"], list)
    assert "paragraphs" in body["stats"], "stats.paragraphs отсутствует"


@pytest.mark.parametrize(
    "label,path_template",
    [
        ("by-job", "/webhook/paragraphs?job_id={job_id}"),
        ("by-doc", "/webhook/paragraphs/by-document?document_id={document_id}"),
    ],
)
def test_paragraphs_contain_marker(
    base_url: str,
    auth_headers: dict[str, str],
    uploaded_document: UploadedDoc,
    label: str,
    path_template: str,
) -> None:
    url = base_url + path_template.format(
        job_id=uploaded_document.job_id,
        document_id=uploaded_document.document_id,
    )
    r = requests.get(url, headers=auth_headers, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"[{label}] {r.status_code}: {r.text[:400]}"
    paragraphs = r.json()
    assert isinstance(paragraphs, list) and paragraphs, (
        f"[{label}] paragraphs пустой/не список: {paragraphs!r}"
    )
    marker_re = re.compile(re.escape(uploaded_document.marker), re.IGNORECASE)
    matched = [p for p in paragraphs if marker_re.search(p.get("paragraph_text", ""))]
    assert matched, (
        f"[{label}] маркер {uploaded_document.marker!r} не найден ни в одном из "
        f"{len(paragraphs)} абзацев"
    )


def test_files_history_contains_our_upload(
    base_url: str,
    auth_headers: dict[str, str],
    uploaded_document: UploadedDoc,
) -> None:
    r = requests.get(
        f"{base_url}/webhook/files/history",
        headers=auth_headers,
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code == 200, r.text[:400]
    files = r.json()
    assert isinstance(files, list), f"ожидался список, получили {type(files).__name__}"
    ids = {f.get("document_id") for f in files}
    assert uploaded_document.document_id in ids, (
        f"document_id={uploaded_document.document_id} не найден среди {len(files)} документов"
    )
    names = [f.get("filename", "") for f in files]
    assert any("e2e_doc" in n for n in names), (
        f"e2e_doc.md не найден в истории файлов (всего {len(files)})"
    )
