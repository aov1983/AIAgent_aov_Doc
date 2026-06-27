# Миграция AIAgent_docs_Doc → n8n

Каталог содержит **скелеты workflow'ов** для переноса pipeline `agent/core.py:RequirementsAgent` на n8n.
Это стартовая точка — все Code-ноды содержат рабочую логику, портированную из Python, но требуют доводки
под конкретную инсталляцию n8n (credentials, env, размеры батчей).

## Структура

```
n8n/
├── README.md                            ← этот файл
├── workflows/
│   └── wf_process_document.json         ← главный orchestrator (Webhook → Decompose → Classify → RAG → Graph)
├── sql/
│   ├── schema.sql                       ← Postgres-схема (legacy, оставлена для отката; уже не монтируется)
│   ├── 00_create_docs_db.sh             ← init-скрипт под `docs` DB (legacy)
│   └── data_tables_bootstrap.mjs        ← создаёт 4 Data Tables и сидит demo-юзеров (см. compose.yaml::n8n-data-table-init)
└── embeddings_service/
    ├── main.py                          ← FastAPI-обёртка над sentence-transformers
    ├── requirements.txt                 ← fastapi + uvicorn + sentence-transformers
    └── Dockerfile                       ← модель paraphrase-multilingual-MiniLM-L12-v2 прогрета на build
                                          (сервис `embeddings` в compose.yaml, порт 8100)
```

## Зависимости перед запуском

| Сервис | Назначение | Дефолт |
|---|---|---|
| n8n | runtime + Data Tables (`users`, `uploads`, `jobs`, `graphs`) | `http://localhost:5678` |
| Postgres | системные таблицы n8n (метаданные/executions) | `postgres://n8n:n8n@localhost:5432/n8n` |
| Qdrant | вектора | `http://localhost:6333` |
| Embeddings service | `/embed` (legacy) + `/v1/embeddings` (OpenAI-совместимый, для native `embeddingsOpenAi`) | `http://localhost:8100` |
| LLM (Ollama / OpenAI / Claude) | декомпозиция и чат | через n8n Credentials |

## Credentials в n8n (нужно завести руками)

- `Qdrant API` → имя `docs-qdrant` (на это имя ссылается `wf_api_chat` после миграции read-path на native-ноды; n8n при `import:workflow` подвязывает credentials по имени+типу). **URL должен начинаться с `http://` или `https://`**, не `qdrant://`.
  - Локально: `http://localhost:6333`
  - В Docker-сети n8n: `http://qdrant:6333` (имя сервиса)
  - Облако Qdrant: `https://<cluster-id>.qdrant.io:6333` + API Key.
  - Если видите `Unsupported protocol qdrant:` — в поле URL стоит `qdrant://...`, нужно заменить на `http(s)://`.
  - Коллекция: `docs_chunks` (создать заранее: `PUT /collections/docs_chunks` с размерностью вектора, совпадающей с `embeddings_service/main.py`).
- `OpenAI API` → имя `docs-embeddings-openai`. **Это не настоящий OpenAI** — это шлюз на локальный `embeddings_service`. Используется нативной нодой `embeddingsOpenAi` в `wf_api_chat`:
  - Base URL: `http://embeddings:8100/v1` (или `http://localhost:8100/v1` локально). Сервис отвечает на `POST /v1/embeddings` OpenAI-совместимым JSON, модель параметра игнорирует (зафиксирована в `embeddings_service/main.py`).
  - API key: любой непустой плейсхолдер (например `sk-local-embeddings`) — сервис ключ не проверяет.
- `Postgres` → как в таблице выше.
- LLM-credential (`Ollama` / `OpenAI` (настоящий) / `Anthropic`) — в зависимости от `ACTIVE_MODEL`.
- `Header Auth` → бэндвейк для роли (см. §5 плана миграции).

## Env-переменные n8n (для HTTP-нод к Qdrant и эмбеддингам)

Эти переменные используются нодами `[upload] Embed Chunks` / `[upload] Qdrant Search Similar` в `wf_api_documents` через `$env.*` — задаются в окружении контейнера n8n (`docker run -e ...` или `.env` рядом с `docker-compose.yml`):

```
QDRANT_URL=http://qdrant:6333           # ОБЯЗАТЕЛЬНО http:// или https://
QDRANT_COLLECTION_NAME=docs_chunks
QDRANT_API_KEY=                          # пусто для локального, заполнить для Cloud
EMBEDDINGS_URL=http://embeddings:8100/embed
LLAMA3_BASE_URL=http://ollama:11434/v1
LLAMA3_MODEL_NAME=qwen3:8b
```

После правки env-перезапустить контейнер n8n — workflow подхватят новые значения без переимпорта.

## RAG-pipeline: гибрид HTTP + native (статус миграции)

- **Read-path** (`wf_api_chat`): native LangChain-ноды.
  - `[chat] Embeddings (bge mini)` + `[chat] Qdrant Search (native)` — `@n8n/n8n-nodes-langchain.embeddingsOpenAi` (1.2) + `@n8n/n8n-nodes-langchain.vectorStoreQdrant` (1.3, `mode: load`). Те же две ноды дублированы для ветки `[ragSearch]`.
  - Embeddings-нода читает credential `docs-embeddings-openai` → ходит в наш `embeddings_service` через `/v1/embeddings`.
  - Vector-store нода читает credential `docs-qdrant` и работает с коллекцией `docs_chunks`, ключи payload: `content` для текста, `metadata` для остальных полей.
- **Write-path** (`wf_api_documents`): пока HTTP. Нода `[upload] Build Everything` пишет payload **в двух формах одновременно**: плоско (`document_id`, `paragraph_id`, …) и под `metadata: {…}`. Плоские поля нужны `[upload] Enrich Graph` и `[upload] Qdrant Search Similar`, вложенные — native read-нодам.
- **Health-check** (`wf_rag_health`): `GET /webhook/rag/health` (без авторизации — probe). Проверяет **обе** стороны RAG в одном ответе: (1) прямой `GET {QDRANT_URL}/collections/docs_chunks` — Qdrant жив и в коллекции есть точки (`points_count`); (2) сквозной путь embeddings → Qdrant search через `wf_rag` с фиксированным тестовым запросом. Итог в поле `status`: `ok` (доступен + есть данные + поиск вернул хиты) / `degraded` (доступен, но пусто или поиск без хитов) / `down` (Qdrant недоступен). HTTP-нода и `executeWorkflow` стоят с `onError: continueRegularOutput`, чтобы при упавшем Qdrant вернуть `down`, а не 500.
- **Backfill для уже залитой коллекции** — `python3 n8n/sql/qdrant_metadata_backfill.py`. Скрипт идемпотентен: scroll всех точек → для тех, у кого `payload.metadata` отсутствует/пустое, выставляет `metadata` зеркалом плоских полей через `POST /collections/<c>/points/payload?wait=true`. Запускать **после** `compose up -d` и перед первым обращением к `wf_api_chat` (иначе native нода вернёт чанки с пустой `metadata`).
- **Известные регрессии read-path**:
  - `chunk_id` в ответах chat/ragSearch теперь = `metadata.paragraph_id` (нативный `vectorStoreQdrant` не возвращает Qdrant point id, см. `loadOperation.ts`). Если фронт где-то полагался на формат прежнего UUID-чанка — поправить там.
- **Грабли, которые набили (для будущего себя)**:
  1. `@langchain/openai` шлёт `encoding_format: 'base64'` по умолчанию — наш `embeddings_service` ОБЯЗАН отвечать base64-encoded float32, иначе LC расшифровывает массив float'ов как base64 и dim сжимается 384→96, после чего Qdrant отдаёт 400.
  2. На `vectorStoreQdrant` load-mode нужен `alwaysOutputData: true` — иначе пустые хиты обрывают chain, и webhook возвращает 200 с пустым body вместо JSON.
  3. После ручного создания credentials в UI n8n присваивает им свои UUID-ID (`credentials_entity.id`). Workflow JSON в репо содержит placeholder-ID — `docker exec docs-postgres psql -U n8n -d n8n -c "SELECT id, name, type FROM credentials_entity"`, затем в `wf_api_chat.json` подменить ID на реальные (или переименовать credential в DB).

## Импорт

```
n8n CLI:  n8n import:workflow --input=n8n/workflows
UI:       Settings → Import workflow → выбрать JSON
```

После импорта в каждом workflow проверить:
1. **Credentials** (placeholder'ы помечены `__CREDENTIAL_ID__`).
2. **Webhook path** — пути не должны конфликтовать с другими workflow.
3. **Sub-workflow IDs** в `Execute Workflow` нодах — после первого импорта n8n присвоит свои id, нужно перепривязать.

## Frontend (SPA)

Веб-интерфейс — отдельный сервис `frontend` в `compose.yaml` (Vite + React, каталог `../frontend`):
nginx раздаёт собранную статику и проксирует `/webhook*` на сервис `n8n` в той же docker-сети.
Поднимается вместе со всем стеком (`./bootstrap.sh` → `docker compose up -d`) и открывается на
**http://localhost:8080**. Запуск через Docker, dev-режим (`npm run dev`) и переключение бэкенда —
см. [`../frontend/README.md`](../frontend/README.md).

## Контракт совместимости с фронтом

Форма ответа `wf_process_document` и `wf_get_graph` должна совпадать с FastAPI-эндпоинтами
`/api/upload` и `/api/graph/...` бит-в-бит (см. `CLAUDE.md`):

```
graph: { nodes: [...], edges: [...], stats: { total_nodes, total_edges, paragraphs, chunks, intersections, external_docs } }
paragraphs: [{ chapter_index, chapter_title, section_index, section_title, paragraph_index, paragraph_text, facts, risks, criticality, recommendations, executors, similar_requirements, comments }]
```

## Критичные инварианты (легко сломать)

1. **`AtomicRequirement.tracing.paragraph_index`** обязан выставляться декомпозером — без него jsCode-нода `[upload] Build Everything` в `wf_api_documents` тихо ломается (paragraph-узлы и similar_to-рёбра не строятся).
2. **MD5 от первых 50 символов** для `par_*` id — должен совпадать с `agent/graph_builder.py:_generate_id`, иначе графы старых документов разойдутся.
3. **Строка чанка в Qdrant** — `"{fact}. Риск: {risk}. Рекомендация: {recommendation}."` — точная пунктуация важна для antisamomatch-фильтра.
4. **Порог `score_threshold: 0.55`** в ноде `[upload] Qdrant Search Similar` (`wf_api_documents`) синхронизирован с `_build_graph` — менять только в обоих местах сразу.

## Раздел «Архитектура проекта» (`wf_api_architecture`)

LLM выводит архитектуру **целевой системы** из требований документов проекта: текстовое описание
(стек, ключевые решения) + две диаграммы **C4 (Context + Container)** в нотации Mermaid. Результат
кешируется; на фронте — 4-я вкладка в `ProjectDetailPage` (компонент `MermaidDiagram`, mermaid
грузится динамически).

- **Эндпоинты** (`wf_api_architecture.json`, генератор `build_wf_api_architecture.mjs`):
  - `GET /projects/architecture?project_id=…` — отдать сохранённое (`{status:'none'}`, если не генерировалось);
  - `POST /projects/architecture/generate {project_id}` — собрать RAG-контекст по документам проекта,
    вызвать LLM, сохранить, вернуть результат.
- **LLM-провайдер — ТОТ ЖЕ, что при обработке документов**: нода `[gen] Generate Architecture` читает
  строку config-таблицы (ключ `llm_extraction`) нодой `[gen] Get LLM Config` (dataTable, без self-HTTP) и ветвится ollama/claude/develonica/
  lmstudio с `_withRetry`/`stripJson` — копия механизма `[upload] Merge Chunks`. LLM возвращает **строгий
  JSON** (элементы C4), а Mermaid-DSL собирается **детерминированно** в ноде (надёжнее сырого mermaid от LLM).
- **RAG по набору документов — прямой Qdrant-поиск с фильтром** (внутри `[gen] Generate Architecture`):
  эмбеддинг арх-запроса (`embeddings:8100/v1/embeddings`, bge mini) → `qdrant:6333/.../points/search`
  с `filter.should` по `metadata.document_id` документов проекта. Так сделано НЕ через `wf_rag`, потому
  что коллекция `docs_chunks` общая на тысячи точек — без фильтра в самом Qdrant топ-K тонет в чужих
  чанках (замер: 1/40 релевантных против 40/40 с фильтром). `wf_rag` всё же расширен полем
  `includeDocumentIds: string[]` (пост-фильтр hits) и `topK` 50→100 — как обобщение, но архитектурой не используется.
- **Хранилище** — Data-Table `project_architecture` (1 строка на проект): `project_id, status,
  generated_at, provider, model, sources_count, summary_md, c4_context, c4_container, raw_json`.
  Создаётся скриптом `create_project_architecture_table.mjs` (INSERT в реестр `data_table`/`data_table_column`
  + физическая `data_table_user_<id>`). **После создания таблицы n8n нужно перезапустить** — модуль
  Data-Tables кеширует реестр.
- **Деплой** (на простаивающем стенде — деплой не убивает текущую обработку, но рестарт для таблицы убивает):
  ```
  node create_project_architecture_table.mjs          # один раз; затем рестарт n8n
  docker restart docs-n8n
  N8N_URL=http://localhost:5678 N8N_OWNER_EMAIL=… N8N_OWNER_PASSWORD=… \
    node deploy_workflow_live.mjs workflows/wf_rag.json
  N8N_URL=… N8N_OWNER_EMAIL=… N8N_OWNER_PASSWORD=… \
    node deploy_workflow_live.mjs workflows/wf_api_architecture.json
  ```
