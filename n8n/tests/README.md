# n8n e2e tests (pytest)

End-to-end проверки n8n-пайплайна на pytest. Полная замена `e2e.sh` —
тот же набор сценариев, но с авто-skip опциональных зависимостей,
параметризацией и нормальным JUnit-выводом для CI.

## Установка

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r n8n/tests/requirements.txt
```

(или используйте корневой `.venv` проекта — зависимости минимальны: `pytest`, `requests`.)

## Запуск

Стек должен быть поднят — см. `n8n/bootstrap.sh`.

```bash
# всё:
pytest n8n/tests/

# только smoke (auth + upload), без графов/чата:
pytest n8n/tests/ -m smoke

# исключить тесты с внешними зависимостями (RAG, чат):
pytest n8n/tests/ -m "not requires_embeddings and not requires_ollama"

# конкретный файл:
pytest n8n/tests/test_documents.py -v
```

## Переменные окружения

| Переменная        | Дефолт                              | Назначение                                 |
|-------------------|-------------------------------------|--------------------------------------------|
| `N8N_BASE_URL`    | `http://localhost:5678`             | базовый URL n8n                            |
| `TEST_USERNAME`   | `architect`                         | логин для `/auth/login`                    |
| `TEST_PASSWORD`   | `admin`                             | пароль                                     |
| `EMBEDDINGS_URL`  | `http://localhost:8100/embed`       | embeddings_service для RAG-тестов          |
| `OLLAMA_URL`      | `http://localhost:11434/api/tags`   | health-check Ollama для чат-теста          |
| `DOCLING_URL`     | `http://localhost:5001/v1/convert/file` | docling-serve для .docx/.pdf → md      |
| `DOCLING_HEALTH_URL` | `http://localhost:5001/health`   | health-check docling                       |
| `HTTP_TIMEOUT`    | `30`                                | таймаут одного HTTP-вызова (секунды)       |
| `DOCLING_TIMEOUT` | `180`                               | таймаут Docling-конверсии (секунды)        |

## Структура

```
n8n/tests/
├── conftest.py        ← сессионный токен + общий upload, auto-skip по сервисам
├── pytest.ini         ← маркеры (smoke, requires_embeddings, requires_ollama)
├── requirements.txt   ← pytest + requests
├── test_auth.py       ← логин (валидный/невалидный), 401 без токена
├── test_documents.py  ← upload, /graph, /paragraphs, /files/history
├── test_rag.py        ← /rag/search (skip если нет embeddings)
├── test_chat.py       ← /chat/ask (skip если нет embeddings/Ollama)
├── test_docling.py    ← docling-serve напрямую: .docx → md (skip если нет docling)
└── test_cross_document.py
                       ← examples/CashHub.docx + PayGate.docx через Docling →
                         /upload → проверка связности через /rag/search и /graph
```

Документ для прогона генерируется один раз (session-scoped fixture
`uploaded_document`) с уникальным маркером во временной директории —
все тесты переиспользуют один upload, не плодя записей в БД и Qdrant.

## Связь с `e2e.sh`

Покрытие 1-в-1:

| e2e.sh шаг           | pytest                                                                |
|----------------------|-----------------------------------------------------------------------|
| 1. Auth              | `test_auth.py`                                                        |
| 2. Upload            | `test_documents.py::test_upload_returns_job_and_document_ids`         |
| 3+6. /files/history  | `test_documents.py::test_files_history_contains_our_upload`           |
| 4. /graph            | `test_documents.py::test_graph_has_nodes_edges_stats` (×2 параметра)  |
| 5. /paragraphs       | `test_documents.py::test_paragraphs_contain_marker` (×2 параметра)    |
| 7. /rag/search       | `test_rag.py::test_rag_search_finds_uploaded_document`                |
| 8. /chat/ask         | `test_chat.py::test_chat_ask_grounds_answer_in_document`              |

`e2e.sh` оставлен на месте — можно использовать как быстрый sanity-check
без Python, но основной тест-runner теперь pytest.

## Cross-document тесты (CashHub ↔ PayGate)

`test_cross_document.py` грузит оба ТЗ из `examples/` через Docling и проверяет,
что pipeline видит связь между документами:

- оба получают разные `document_id` и попадают в `/files/history`;
- `/graph/by-document` отдаёт корректный граф для каждого;
- `/rag/search?query=PayGate v2 ...` находит чанки PayGate.docx (т.е. RAG
  работает cross-document, а не только в пределах последнего upload'а);
- `/rag/search?query=возврат средств ...` находит чанки в обоих документах
  (общая тема разделов 2.3 и в CashHub, и в PayGate).

Запуск только cross-document:
```bash
pytest n8n/tests/test_cross_document.py -v
```

## Docling

Подключается через compose (`n8n/compose.yaml` → сервис `docling`,
`ghcr.io/docling-project/docling-serve:latest`, порт 5001). При первом
запуске образ ~3-5 ГБ и греется до минуты — тесты с маркером
`requires_docling` автоматически скипаются, если `DOCLING_HEALTH_URL`
не отвечает.

Интеграция Docling в `wf_api_documents` upload-ветку (чтобы /upload
сам конвертил .docx/.pdf, а не требовал предварительной обработки на
стороне клиента) — отдельный TODO, см. comments в `compose.yaml`.
