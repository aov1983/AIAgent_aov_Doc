# Архитектура решения (Solution & Infrastructure)

## 1. Общее описание системы

Система **AI Architect Agent** представляет собой специализированный сервис для автоматизированного анализа неформализованных документов с требованиями, их декомпозиции на атомарные единицы знаний и интеграции с базой знаний (RAG) на основе векторной базы данных Qdrant.

### Ключевые принципы
- **Модульность**: Разделение ответственности между парсингом, декомпозицией, классификацией и RAG.
- **Безопасность**: Работа только во внутреннем контуре, поддержка локальных LLM.
- **Масштабируемость**: Stateless архитектура основного сервиса, отдельное состояние в Qdrant.
- **Гибкость**: Подключение к 4+ AI моделям через единый интерфейс.

---

## 2. Модель C4 (Context, Container, Component, Code)

### Уровень 1: Контекст (System Context)

```mermaid
C4Context
  title System Context Diagram: AI Architect Agent

  Person(architect, "Архитектор", "Загружает документы требований, получает анализ и отчеты")
  Person(analyst, "Аналитик / DevOps", "Использует агент для поиска дубликатов и рисков")
  Person(admin, "Администратор", "Управляет доступом, моделями и конфигурацией")

  System_Boundary(b1, "AI Agent System") {
    System(agent, "AI Architect Agent", "Python/FastAPI", "Анализ документов, декомпозиция, RAG поиск")
    
    System_Ext(openai, "OpenAI API", "External", "GPT-4 Turbo (опционально)")
    System_Ext(anthropic, "Anthropic API", "External", "Claude 3.5 Sonnet (опционально)")
    System_Ext(google, "Google AI", "External", "Gemini Pro (опционально)")
    System_Ext(local_llm, "Local LLM Server", "Internal", "Llama 3 / Mistral (On-prem)")
  }

  SystemDb(qdrant, "Qdrant Vector DB", "Rust", "Хранение эмбеддингов и метаданных")
  SystemDb(storage, "File Storage", "Local/S3", "Исходные документы")

  Rel(architect, agent, "Загружает DOCX/TXT/PDF", "HTTPS")
  Rel(analyst, agent, "Запрашивает анализ/поиск", "HTTPS")
  Rel(admin, agent, "Конфигурирует систему", "HTTPS")

  Rel(agent, openai, "Запросы к LLM", "HTTPS API")
  Rel(agent, anthropic, "Запросы к LLM", "HTTPS API")
  Rel(agent, google, "Запросы к LLM", "HTTPS API")
  Rel(agent, local_llm, "Запросы к LLM (Secure)", "HTTP/gRPC")
  
  Rel(agent, qdrant, "Векторный поиск/сохранение", "gRPC/REST :6333")
  Rel(agent, storage, "Чтение/запись файлов", "FileSystem/S3")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

**Описание контекста:**
- **Пользователи**: Архитекторы, Аналитики, DevOps, Администраторы (роли FR-01).
- **Система**: Единый сервис `AI Architect Agent`.
- **Внешние зависимости**: 
  - AI провайдеры (внешние или внутренние).
  - Qdrant (векторная БД).
  - Файловое хранилище.

---

### Уровень 2: Контейнеры (Container Diagram)

```mermaid
C4Container
  title Container Diagram: AI Architect Agent

  Person(user, "Пользователь", "Архитектор/Аналитик")

  Container_Boundary(app, "AI Agent Application") {
    Container(api, "API Gateway & Orchestrator", "Python/FastAPI", "Прием запросов, роутинг, оркестрация пайплайнов")
    Container(parser, "Document Parser", "Python/python-docx/pdfplumber", "Извлечение текста, таблиц, изображений из DOCX/PDF")
    Container(decomposer, "Decomposition Engine", "Python/LLM Client", "Разбивка на главы, разделы, атомы (FR-03)")
    Container(classifier, "Role Classifier", "Python/Keyword Matcher", "Классификация исполнителей (FR-04)")
    Container(rag_manager, "RAG Manager", "Python/Qdrant Client", "Векторизация, поиск дубликатов/противоречий")
    Container(reporter, "Report Generator", "Python/Markdown", "Формирование итоговых отчетов (FR-07)")
  }

  ContainerDb(qdrant, "Qdrant DB", "Rust/Docker", "Векторное хранилище чанков и метаданных")
  ContainerDb(files, "File Storage", "Local FS/S3", "Сырые файлы документов")

  Rel(user, api, "POST /analyze, GET /search", "HTTPS")
  Rel(api, parser, "Вызывает парсинг", "In-process")
  Rel(parser, decomposer, "Передает текст", "In-process")
  Rel(decomposer, classifier, "Передает атомы", "In-process")
  Rel(classifier, rag_manager, "Запрос на поиск похожих", "In-process")
  Rel(rag_manager, qdrant, "Search/Upsert Vectors", "gRPC :6333")
  Rel(parser, files, "Сохраняет оригинал", "IO")
  Rel(rag_manager, reporter, "Данные для отчета", "In-process")

  UpdateRelStyle(user, api, $textColor="blue", $lineColor="blue")
  UpdateRelStyle(rag_manager, qdrant, $textColor="green", $lineColor="green")
```

**Описание контейнеров:**
1.  **API Gateway & Orchestrator**: Точка входа, валидация токенов, проверка ролей.
2.  **Document Parser**: Модуль извлечения контента (текст, таблицы, картинки).
3.  **Decomposition Engine**: Логика разбивки на иерархию (Глава -> Раздел -> Абзац -> Атом).
4.  **Role Classifier**: Определение исполнителей по ключевым словам.
5.  **RAG Manager**: Работа с эмбеддингами и Qdrant.
6.  **Report Generator**: Сборка финального Markdown отчета.

---

### Уровень 3: Компоненты (Component Diagram - RAG Manager)

```mermaid
C4Component
  title Component Diagram: RAG Manager

  Container_Boundary(rag_container, "RAG Manager") {
    Component(embedding_svc, "Embedding Service", "Python/SentenceTransformer", "Генерация векторов для чанков")
    Component(search_engine, "Search Engine", "Python/Qdrant Client", "Поиск дубликатов и противоречий")
    Component(chunker, "Chunking Strategy", "Python", "Разбивка текста на перекрывающиеся чанки")
    Component(metadata_extractor, "Metadata Extractor", "Python", "Извлечение рисков, критичности, трассировки")
  }

  ComponentDb(qdrant_core, "Qdrant Core", "Rust", "Хранение векторов и payload")

  Rel(embedding_svc, search_engine, "Предоставляет векторы", "In-memory")
  Rel(chunker, embedding_svc, "Передает чанки", "In-process")
  Rel(search_engine, qdrant_core, "Query Points", "gRPC")
  Rel(metadata_extractor, search_engine, "Обогащает результат", "In-process")
```

---

## 3. Инфраструктура (Infrastructure)

### Схема развертывания (Deployment View)

```mermaid
C4Deployment
  title Deployment Diagram: AI Architect Agent

  Deployment_Node(cloud, "Cloud / On-Prem Server", "Linux VM / K8s Cluster") {
    Deployment_Node(docker, "Docker Host", "Docker Engine") {
      Container_Boundary(agent_pod, "Agent Pod") {
        Container(agent_app, "AI Agent App", "Python Docker Image", "Port 8000")
      }
      
      Container_Boundary(qdrant_pod, "Qdrant Pod") {
        Container(qdrant_app, "Qdrant Server", "qdrant/qdrant:latest", "Port 6333 (REST), 6334 (gRPC)")
        Volume(qdrant_data, "Qdrant Data Volume", "Persistent Storage", "/qdrant/storage")
      }
    }
    
    Deployment_Node(storage_node, "Storage Node") {
      Container(minio, "MinIO / S3", "Object Storage", "Port 9000")
    }
  }

  Rel(agent_app, qdrant_app, "gRPC/REST", "Internal Network")
  Rel(agent_app, minio, "S3 API", "Internal Network")
```

### Технологический стек

| Компонент | Технология | Версия | Примечание |
|-----------|------------|--------|------------|
| **Язык** | Python | 3.9+ | Основной язык разработки |
| **Web Framework** | FastAPI | 0.100+ | Асинхронный API сервер |
| **Vector DB** | Qdrant | 1.5+ | Высокая производительность, фильтрация по payload |
| **Embeddings** | SentenceTransformers | 2.2+ | Локальная генерация векторов (model: all-MiniLM-L6-v2) |
| **LLM Clients** | langchain / openai / anthropic | Latest | Унифицированный интерфейс к моделям |
| **Parser** | python-docx, pdfplumber | Latest | Обработка офисных форматов |
| **Orchestration** | Docker Compose / K8s | - | Развертывание |
| **Storage** | MinIO / Local FS | - | Хранение исходников |

### Требования к ресурсам

**Минимальная конфигурация (Dev/Test):**
- CPU: 4 vCPU
- RAM: 8 GB (4 GB для App, 4 GB для Qdrant)
- Disk: 20 GB SSD
- Network: Внутренний контур

**Продакшн конфигурация (Prod):**
- CPU: 8-16 vCPU
- RAM: 16-32 GB (для загрузки больших моделей или кэша)
- Disk: 100+ GB NVMe (для быстрого поиска векторов)
- HA: Репликация Qdrant (Cluster mode), Load Balancer перед Agent.

---

## 4. Потоки данных (Data Flow)

### Сценарий: Загрузка и анализ документа

1.  **Upload**: Пользователь отправляет `requirements.docx` через API (`POST /analyze`).
2.  **Auth**: Middleware проверяет роль пользователя (Architect/Admin/DevOps).
3.  **Parse**: `DocumentParser` извлекает текст, таблицы, заголовки. Сохраняет файл в Storage.
4.  **Decompose**: `DecompositionEngine` разбивает текст на иерархию (Главы -> Разделы -> Абзацы).
5.  **Atomize**: Для каждого абзаца создаются атомы (Факт, Риск, Рекомендация).
6.  **Classify**: `RoleClassifier` назначает исполнителей (Analyst, Architect, etc.).
7.  **Embed**: `EmbeddingService` генерирует векторы для каждого атома.
8.  **Search RAG**: 
    - Поиск похожих векторов в Qdrant (>50% схожесть).
    - Выявление дубликатов и противоречий.
9.  **LLM Enrichment**: Контекст (атомы + найденные похожие) отправляется в LLM для финального анализа.
10. **Store**: Результаты сохраняются в Qdrant с метаданными (трассировка, риски).
11. **Report**: Генерируется Markdown отчет и возвращается пользователю.

---

## 5. Безопасность (Security)

- **Сетевая изоляция**: Все компоненты работают во внутреннем контуре (NFR-01). Нет прямого доступа из Internet.
- **Ролевая модель**: Строгая проверка ролей перед любым действием (FR-01).
- **Шифрование**: 
  - TLS для всех внутренних HTTP/gRPC соединений.
  - Шифрование данных в покое (Qdrant volume encryption).
- **Secrets Management**: API ключи хранятся в `.env` или Kubernetes Secrets, не попадают в код.
- **Audit Logs**: Логирование всех действий пользователей (кто, когда, какой документ загрузил).

---

## 6. Масштабирование и отказоустойчивость

- **Stateless App**: Контейнер приложения можно масштабировать горизонтально (K8s HPA).
- **Qdrant Cluster**: Поддержка кластерного режима Qdrant для репликации данных и шардирования.
- **Retry Logic**: Автоматические повторные попытки при ошибках сети или таймаутах LLM.
- **Fallback**: При недоступности внешних API (OpenAI) переключение на локальную модель (Llama 3).
