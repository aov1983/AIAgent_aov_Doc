"""
Тесты для эндпоинтов извлечённых требований:
  GET /webhook/requirements?job_id=
  GET /webhook/requirements/by-document?document_id=

Опираемся на session-scoped uploaded_document из conftest.
"""
from __future__ import annotations

import pytest
import requests

from conftest import HTTP_TIMEOUT, UploadedDoc


REQUIRED_FIELDS = ("type", "title", "statement", "fact", "risk", "criticality")
ALLOWED_TYPES = {"ФТ", "НФТ", "unknown"}
ALLOWED_CRIT = {"Высокий", "Средний", "Низкий", "unknown"}


@pytest.mark.parametrize(
    "label,path_template",
    [
        ("by-job", "/webhook/requirements?job_id={job_id}"),
        ("by-doc", "/webhook/requirements/by-document?document_id={document_id}"),
    ],
)
def test_requirements_endpoint_returns_list(
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
    assert isinstance(body, list), f"[{label}] ожидался список, получили {type(body).__name__}"


@pytest.mark.parametrize(
    "label,path_template",
    [
        ("by-job", "/webhook/requirements?job_id={job_id}"),
        ("by-doc", "/webhook/requirements/by-document?document_id={document_id}"),
    ],
)
@pytest.mark.requires_ollama
def test_requirements_have_valid_schema(
    base_url: str,
    auth_headers: dict[str, str],
    uploaded_document: UploadedDoc,
    label: str,
    path_template: str,
) -> None:
    """
    Если Ollama доступна, второй LLM-вызов должен вернуть хотя бы одно требование
    по тестовому документу (там есть явные ФТ - резервное копирование, мониторинг).
    Проверяем форму элементов.
    """
    url = base_url + path_template.format(
        job_id=uploaded_document.job_id,
        document_id=uploaded_document.document_id,
    )
    r = requests.get(url, headers=auth_headers, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"[{label}] {r.status_code}: {r.text[:400]}"
    items = r.json()
    assert items, (
        f"[{label}] LLM не извлёк ни одного требования из тестового документа "
        f"(в conftest.sample_doc есть явные ФТ/НФТ)"
    )
    for i, item in enumerate(items):
        for field in REQUIRED_FIELDS:
            assert field in item, f"[{label}] элемент {i}: нет поля {field!r} ({item!r})"
        assert item["type"] in ALLOWED_TYPES, (
            f"[{label}] элемент {i}: type={item['type']!r} не из {ALLOWED_TYPES}"
        )
        assert item["criticality"] in ALLOWED_CRIT, (
            f"[{label}] элемент {i}: criticality={item['criticality']!r} не из {ALLOWED_CRIT}"
        )
        for str_field in ("title", "statement", "fact", "risk"):
            assert isinstance(item[str_field], str), (
                f"[{label}] элемент {i}: {str_field} должен быть строкой, "
                f"получили {type(item[str_field]).__name__}"
            )


@pytest.mark.requires_ollama
def test_requirements_consistent_between_endpoints(
    base_url: str,
    auth_headers: dict[str, str],
    uploaded_document: UploadedDoc,
) -> None:
    """/requirements и /requirements/by-document должны вернуть одинаковый набор."""
    by_job = requests.get(
        f"{base_url}/webhook/requirements",
        params={"job_id": uploaded_document.job_id},
        headers=auth_headers,
        timeout=HTTP_TIMEOUT,
    )
    by_doc = requests.get(
        f"{base_url}/webhook/requirements/by-document",
        params={"document_id": uploaded_document.document_id},
        headers=auth_headers,
        timeout=HTTP_TIMEOUT,
    )
    assert by_job.status_code == 200 and by_doc.status_code == 200
    j, d = by_job.json(), by_doc.json()
    assert len(j) == len(d), (
        f"разное число элементов: by-job={len(j)} vs by-doc={len(d)}"
    )
    # Сравниваем по statement+title - этого достаточно для проверки
    # что под капотом читается тот же payload_json.
    key = lambda r: (r.get("statement", ""), r.get("title", ""))
    assert sorted(j, key=key) == sorted(d, key=key), (
        "наборы требований различаются между by-job и by-document"
    )


def test_requirements_unknown_job_returns_404(
    base_url: str,
    auth_headers: dict[str, str],
) -> None:
    r = requests.get(
        f"{base_url}/webhook/requirements",
        params={"job_id": "nonexistent-job-id-deadbeef"},
        headers=auth_headers,
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code == 404, f"ожидали 404, получили {r.status_code}: {r.text[:200]}"
    body = r.json()
    assert body.get("detail"), f"в 404-ответе нет поля detail: {body!r}"


def test_requirements_unknown_document_returns_404(
    base_url: str,
    auth_headers: dict[str, str],
) -> None:
    r = requests.get(
        f"{base_url}/webhook/requirements/by-document",
        params={"document_id": "00000000-0000-0000-0000-000000000000"},
        headers=auth_headers,
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code == 404, f"ожидали 404, получили {r.status_code}: {r.text[:200]}"


def test_requirements_without_auth_is_rejected(base_url: str) -> None:
    r = requests.get(
        f"{base_url}/webhook/requirements",
        params={"job_id": "any"},
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code in (401, 403), (
        f"без токена ожидали 401/403, получили {r.status_code}: {r.text[:200]}"
    )
