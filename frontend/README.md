# Frontend — AI Architect Agent (React SPA)

Веб-интерфейс: загрузка документов, реестр требований, граф знаний, чат (RAG),
проекты и архитектура. React + TypeScript + Vite + MUI.

> **Бэкенд — это n8n, а не FastAPI.** Фронт ходит на webhook'и n8n (`/webhook/*`).
> Старого Python API на `:8000` в актуальной сборке нет.

## Как запустить локально

Есть два режима: **Docker** (рекомендуется, прод-подобно, поднимается вместе со всем
стеком n8n) и **dev-режим Vite** (hot-reload, для разработки UI).

### Вариант A — Docker (рекомендуется)

Фронт уже описан сервисом `frontend` в [`../n8n/compose.yaml`](../n8n/compose.yaml):
multi-stage сборка (Vite → статика), раздаётся nginx, который проксирует `/webhook*`
на сервис `n8n` в той же docker-сети (поэтому нет CORS и порт 5678 не зашит в браузерный бандл).

Поднять **весь стек** (postgres + qdrant + docling + embeddings + n8n + frontend):

```bash
cd n8n
./bootstrap.sh            # первичная инициализация (внутри — docker compose up -d)
```

Пересобрать/поднять **только фронт-контейнер**, без n8n и остальных сервисов
(флаг `--no-deps` гасит `depends_on` — без него compose поднимет весь стек):

```bash
cd n8n
docker compose up -d --build --no-deps frontend
```

Открыть в браузере: **http://localhost:8080**

> Без поднятого `n8n` nginx-прокси `/webhook` отдаёт 502 — статика и UI откроются,
> но API не ответит. Либо переключите бэкенд в UI на удалённый стенд (абсолютный URL
> минует локальный прокси), либо вшейте адрес в сборку:
> `docker compose build --build-arg VITE_API_URL=https://<host>/webhook frontend`.

Базовый URL бэкенда вшивается в бандл на этапе сборки (`ARG VITE_API_URL`, дефолт `/webhook`).
Если n8n живёт на другом хосте — пересоберите с абсолютным адресом:

```bash
cd n8n
docker compose build --build-arg VITE_API_URL=https://n8n.example.com/webhook frontend
```

### Вариант B — dev-режим (Vite, hot-reload)

Для разработки интерфейса. Нужен запущенный n8n на `:5678` (локально или удалённый стенд).

```bash
cd frontend
npm install
cp .env.example .env      # при необходимости поправьте VITE_API_URL
npm run dev               # http://localhost:5173
```

По умолчанию фронт обращается к `http://localhost:5678/webhook`
(переопределяется переменной `VITE_API_URL` в `.env`).

## Переключение бэкенда на лету

Адрес n8n можно менять прямо в UI без пересборки — выбор хранится в `localStorage`
(см. [`src/config/backend.ts`](src/config/backend.ts)). Доступны пресеты:

- **Локальный** — `VITE_API_URL` или `http://localhost:5678/webhook`;
- **n8n-test.develonica.group** — удалённый тестовый стенд;
- **произвольный** — любой адрес вида `https://host/webhook`.

> На удалённом стенде префикс `/webhook-test` срабатывает только при открытом в редакторе
> воркфлоу («Listen for test event»); для постоянной работы укажите `/webhook`.

## Сборка статики вручную

```bash
npm run build            # tsc && vite build  →  dist/
```

Образ в `Dockerfile` собирает через `npx vite build` напрямую (esbuild вырезает типы
без проверки), потому что `tsc --noEmit` сейчас красный по репозиторию — это известное
состояние, на рабочий бандл не влияет.

## Структура

```
frontend/
├── src/
│   ├── api/          # REST-клиент (axios) + request-интерсептор base URL
│   ├── components/   # переиспользуемые UI-компоненты (граф, диаграммы, прогресс)
│   ├── config/       # backend.ts — выбор бэкенда и пресеты
│   ├── hooks/        # AuthContext и пр.
│   ├── pages/        # Login, FileUpload, FileHistory, Requirements(+Registry),
│   │                 #   Search, Chat, Projects, ProjectDetail
│   ├── types/        # TypeScript-интерфейсы
│   ├── utils/        # экспорт DOCX и вспомогательное
│   ├── App.tsx       # роутинг
│   └── main.tsx      # точка входа + тема MUI
├── Dockerfile        # multi-stage: Vite build → nginx
├── nginx.conf        # SPA-роутинг + прокси /webhook* на n8n
└── vite.config.ts
```

## Стек технологий

- **React 18** + **TypeScript** + **Vite**
- **Material-UI (MUI)** + **@mui/x-data-grid** — UI и таблицы
- **React Router** — клиентская маршрутизация
- **Axios** — HTTP-клиент (base URL переключается на лету)
- **Cytoscape** (`react-cytoscapejs`) — интерактивный граф знаний
- **Mermaid** — C4-диаграммы архитектуры
- **docx** + **file-saver** — экспорт реестра требований в DOCX
- **react-markdown** (+ remark-gfm, rehype-highlight) — рендер отчётов
