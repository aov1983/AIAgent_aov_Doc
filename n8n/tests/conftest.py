"""
Общие fixtures для e2e-тестов n8n-pipeline.

Заменяет `e2e.sh` на pytest:
- session-scoped токен и upload (документ заливается один раз на прогон)
- auto-skip для тестов, помеченных `requires_embeddings` / `requires_ollama`,
  если соответствующие сервисы недоступны
- ENV-переменные совместимы с e2e.sh:
    N8N_BASE_URL, TEST_USERNAME, TEST_PASSWORD, EMBEDDINGS_URL, OLLAMA_URL
"""
from __future__ import annotations

import os
import random
import time
from dataclasses import dataclass
from pathlib import Path

import pytest
import requests


# ── конфигурация из env ────────────────────────────────────────────────────────
BASE_URL = os.getenv("N8N_BASE_URL", "http://localhost:5678").rstrip("/")
USERNAME = os.getenv("TEST_USERNAME", "architect")
PASSWORD = os.getenv("TEST_PASSWORD", "admin")
EMBEDDINGS_URL = os.getenv("EMBEDDINGS_URL", "http://localhost:8100/embed")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/tags")
DOCLING_URL = os.getenv("DOCLING_URL", "http://localhost:5001/v1/convert/file")
DOCLING_HEALTH_URL = os.getenv("DOCLING_HEALTH_URL", "http://localhost:5001/health")
QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333").rstrip("/")
QDRANT_COLLECTION_NAME = os.getenv("QDRANT_COLLECTION_NAME", "docs_chunks")

HTTP_TIMEOUT = float(os.getenv("HTTP_TIMEOUT", "180"))
DOCLING_TIMEOUT = float(os.getenv("DOCLING_TIMEOUT", "180"))
QDRANT_INDEX_TIMEOUT = float(os.getenv("QDRANT_INDEX_TIMEOUT", "30"))

EXAMPLES_DIR = Path(__file__).resolve().parents[2] / "examples"


# ── модели для шаринга состояния между тестами ────────────────────────────────
@dataclass
class UploadedDoc:
    job_id: str
    document_id: str
    title: str
    marker: str
    total_requirements: int
    filename: str


# ── низкоуровневые helpers ────────────────────────────────────────────────────
def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _wait_qdrant_indexed(document_id: str, timeout: float = QDRANT_INDEX_TIMEOUT) -> int:
    # /upload возвращается до того, как embeddings успевают долететь до Qdrant
    # (n8n продолжает [upload] Embed Chunks → Upsert уже после Respond). Без
    # ожидания первый же RAG/chat-тест после upload видит пустую коллекцию.
    url = f"{QDRANT_URL}/collections/{QDRANT_COLLECTION_NAME}/points/count"
    # Native vectorStoreQdrant пишет payload как {content, metadata: {document_id, ...}},
    # старые HTTP-upsert точки — плоско. Чтобы фикстура работала в обоих случаях, OR через should.
    body = {
        "exact": True,
        "filter": {
            "should": [
                {"key": "document_id", "match": {"value": document_id}},
                {"key": "metadata.document_id", "match": {"value": document_id}},
            ]
        },
    }
    deadline = time.time() + timeout
    last = 0
    while time.time() < deadline:
        try:
            r = requests.post(url, json=body, timeout=5)
            if r.status_code == 200:
                last = int(r.json().get("result", {}).get("count", 0) or 0)
                if last > 0:
                    return last
        except requests.RequestException:
            pass
        time.sleep(0.5)
    raise AssertionError(
        f"Qdrant не проиндексировал ни одного чанка для document_id={document_id} за {timeout}s"
    )


@pytest.fixture(scope="session")
def base_url() -> str:
    return BASE_URL


@pytest.fixture(scope="session")
def n8n_alive(base_url: str) -> None:
    """Проверяем, что n8n вообще поднят. Если нет — фейлим весь прогон явно."""
    try:
        r = requests.get(f"{base_url}/healthz", timeout=5)
        r.raise_for_status()
    except requests.RequestException as exc:
        pytest.fail(
            f"n8n недоступен на {base_url} ({exc}). "
            f"Запустите `n8n/bootstrap.sh` или задайте N8N_BASE_URL."
        )


@pytest.fixture(scope="session")
def token(n8n_alive, base_url: str) -> str:
    """Логинимся один раз на сессию."""
    r = requests.post(
        f"{base_url}/webhook/auth/login",
        json={"username": USERNAME, "password": PASSWORD},
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    access = body.get("access_token") or ""
    assert access, f"login без access_token: {body!r}"
    return access


@pytest.fixture(scope="session")
def auth_headers(token: str) -> dict[str, str]:
    return _auth_headers(token)


@pytest.fixture(scope="session")
def sample_doc(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, str, str]:
    """Готовит тестовый .md с уникальным маркером в тексте."""
    run_id = f"{int(time.time())}_{random.randint(0, 99_999)}"
    title = f"E2E Тест {run_id}"
    marker = f"резервное копирование PostgreSQL {run_id}"
    content = (
        f"# {title}\n\n"
        f"## Требования к резервному копированию\n\n"
        f"Система обязана выполнять ежедневное {marker} в защищённое хранилище S3.\n"
        f"Срок хранения резервных копий — 90 дней, после чего они автоматически удаляются.\n\n"
        f"Восстановление из резервной копии должно занимать не более 30 минут на 100 ГБ данных.\n\n"
        f"## Требования к мониторингу\n\n"
        f"Мониторинг должен покрывать CPU, RAM, диск и сетевой трафик каждого сервиса.\n"
        f"При превышении 80% использования CPU должно отправляться уведомление в Slack.\n"
    )
    path = tmp_path_factory.mktemp("e2e_docs") / "e2e_doc.md"
    path.write_text(content, encoding="utf-8")
    return path, title, marker


@pytest.fixture(scope="session")
def uploaded_document(
    base_url: str,
    auth_headers: dict[str, str],
    sample_doc: tuple[Path, str, str],
) -> UploadedDoc:
    """
    Загружает документ один раз на сессию и возвращает идентификаторы.
    Если upload падает — все зависимые тесты автоматически отвалятся как errors.
    """
    path, title, marker = sample_doc
    with path.open("rb") as f:
        files = {"file": (path.name, f, "text/markdown")}
        r = requests.post(
            f"{base_url}/webhook/upload",
            headers=auth_headers,
            files=files,
            timeout=HTTP_TIMEOUT,
        )
    assert r.status_code == 200, f"upload failed: {r.status_code} {r.text[:400]}"
    body = r.json()
    job_id = body.get("job_id") or ""
    document_id = body.get("document_id") or ""
    assert job_id and document_id, f"upload вернул пустые id: {body!r}"
    _wait_qdrant_indexed(document_id)
    return UploadedDoc(
        job_id=job_id,
        document_id=document_id,
        title=title,
        marker=marker,
        total_requirements=int(body.get("total_requirements") or 0),
        filename=path.name,
    )


# ── авто-skip для опциональных зависимостей ───────────────────────────────────
def _service_alive(method: str, url: str, **kw) -> bool:
    try:
        r = requests.request(method, url, timeout=2, **kw)
        return r.status_code < 500
    except requests.RequestException:
        return False


@pytest.fixture(scope="session")
def embeddings_available() -> bool:
    return _service_alive(
        "POST", EMBEDDINGS_URL, json={"texts": ["ping"]}
    )


@pytest.fixture(scope="session")
def ollama_available() -> bool:
    return _service_alive("GET", OLLAMA_URL)


@pytest.fixture(scope="session")
def docling_available() -> bool:
    return _service_alive("GET", DOCLING_HEALTH_URL)


# ── Docling helper ────────────────────────────────────────────────────────────
def docling_convert_to_markdown(file_path: Path) -> str:
    """
    POST file → DOCLING_URL, возвращает markdown-представление.
    Используется и тестами Docling-сервиса, и cross-document fixture'ой,
    которая заранее конвертит .docx → .md перед отправкой в /upload.
    """
    with file_path.open("rb") as f:
        files = {"files": (file_path.name, f)}
        # docling-serve поддерживает оба варианта: form-fields с массивом форматов
        # и JSON-body. Здесь — form-fields, чтобы вместе с multipart-файлом работало.
        data = {"to_formats": "md", "do_ocr": "false", "do_table_structure": "true"}
        r = requests.post(DOCLING_URL, files=files, data=data, timeout=DOCLING_TIMEOUT)
    r.raise_for_status()
    body = r.json()
    doc = body.get("document") or {}
    md = doc.get("md_content") or doc.get("markdown") or ""
    if not md:
        raise RuntimeError(f"Docling вернул пустой md_content: keys={list(body)}")
    return md


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """
    Помеченные `requires_*` тесты автоматически скипаются, если соответствующий
    сервис не отвечает. Проверка делается один раз на сборку.
    """
    has_emb = any("requires_embeddings" in i.keywords for i in items)
    has_oll = any("requires_ollama" in i.keywords for i in items)
    has_doc = any("requires_docling" in i.keywords for i in items)

    emb_ok = _service_alive("POST", EMBEDDINGS_URL, json={"texts": ["ping"]}) if has_emb else True
    oll_ok = _service_alive("GET", OLLAMA_URL) if has_oll else True
    doc_ok = _service_alive("GET", DOCLING_HEALTH_URL) if has_doc else True

    skip_emb = pytest.mark.skip(reason=f"embeddings_service не отвечает на {EMBEDDINGS_URL}")
    skip_oll = pytest.mark.skip(reason=f"Ollama не отвечает на {OLLAMA_URL}")
    skip_doc = pytest.mark.skip(reason=f"docling-serve не отвечает на {DOCLING_HEALTH_URL}")

    for item in items:
        if "requires_embeddings" in item.keywords and not emb_ok:
            item.add_marker(skip_emb)
        if "requires_ollama" in item.keywords and not oll_ok:
            item.add_marker(skip_oll)
        if "requires_docling" in item.keywords and not doc_ok:
            item.add_marker(skip_doc)


# ── Cross-document fixtures (CashHub + PayGate из examples/) ──────────────────
EXAMPLE_DOCX_FILES = ("PayGate.docx", "CashHub.docx")


@pytest.fixture(scope="session")
def example_docx_paths() -> list[Path]:
    """Полные пути к .docx из examples/. Фейлит, если файл пропал."""
    paths = [EXAMPLES_DIR / name for name in EXAMPLE_DOCX_FILES]
    missing = [p for p in paths if not p.exists()]
    if missing:
        pytest.fail(f"не найдены файлы примеров: {missing}")
    return paths


@pytest.fixture(scope="session")
def uploaded_example_pair(
    base_url: str,
    auth_headers: dict[str, str],
    example_docx_paths: list[Path],
    docling_available: bool,
    tmp_path_factory: pytest.TempPathFactory,
) -> list[UploadedDoc]:
    """
    Конвертит CashHub.docx / PayGate.docx через Docling → markdown → /upload.
    Возвращает [PayGate, CashHub] (порядок важен: PayGate грузим первым,
    чтобы при заливке CashHub его чанки уже лежали в Qdrant — иначе
    cross-document поиск не найдёт связь).
    """
    if not docling_available:
        pytest.skip(f"docling-serve не отвечает на {DOCLING_HEALTH_URL}")

    md_dir = tmp_path_factory.mktemp("docling_md")
    results: list[UploadedDoc] = []
    for src in example_docx_paths:
        md = docling_convert_to_markdown(src)
        assert len(md) > 200, f"Docling выдал слишком короткий md для {src.name}: {len(md)} chars"
        md_path = md_dir / (src.stem + ".md")
        md_path.write_text(md, encoding="utf-8")

        with md_path.open("rb") as f:
            r = requests.post(
                f"{base_url}/webhook/upload",
                headers=auth_headers,
                files={"file": (md_path.name, f, "text/markdown")},
                timeout=HTTP_TIMEOUT * 4,  # LLM-декомпозиция на полном docx долгая
            )
        assert r.status_code == 200, f"upload {src.name}: {r.status_code} {r.text[:400]}"
        body = r.json()
        doc_id = body.get("document_id") or ""
        if doc_id:
            _wait_qdrant_indexed(doc_id, timeout=QDRANT_INDEX_TIMEOUT * 2)
        results.append(
            UploadedDoc(
                job_id=body.get("job_id") or "",
                document_id=doc_id,
                title=src.stem,
                marker=src.stem,  # имя проекта (CashHub/PayGate) служит маркером
                total_requirements=int(body.get("total_requirements") or 0),
                filename=md_path.name,
            )
        )
    return results
