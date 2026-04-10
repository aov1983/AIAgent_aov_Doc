# Инструкция по установке и запуску ИИ Агента для анализа требований

## 1. Требования к окружению

### Системные требования
- Python 3.9 или выше
- Git
- Docker (опционально, для запуска Qdrant в контейнере)
- Минимум 4GB RAM (8GB рекомендуется для работы с ML моделями)

### Внешние зависимости
- **Qdrant Vector Database**: Векторная база данных для хранения эмбеддингов
- **AI Модели**: Доступ к API одной из поддерживаемых моделей (OpenAI GPT-4, Anthropic Claude 3, Google Gemini Pro, или локальная Llama 3)

---

## 2. Установка проекта

### Шаг 1: Клонирование репозитория

```bash
git clone https://github.com/aov1983/AIAgent_aov_Doc.git
cd AIAgent_aov_Doc
```

### Шаг 2: Создание виртуального окружения

```bash
# Для Linux/Mac
python -m venv venv
source venv/bin/activate

# Для Windows
python -m venv venv
venv\Scripts\activate
```

### Шаг 3: Установка зависимостей

```bash
pip install -r requirements.txt
```

**Примечание**: Файл `requirements.txt` содержит все необходимые пакеты:
- `qdrant-client` - клиент для работы с Qdrant
- `sentence-transformers` - для генерации эмбеддингов
- `openai`, `anthropic`, `google-generativeai` - клиенты для AI моделей
- `python-docx`, `Pillow` - для парсинга документов
- `pytest` - для запуска тестов

---

## 3. Настройка базы данных Qdrant

### Вариант A: Запуск Qdrant через Docker (Рекомендуется)

```bash
docker run -d -p 6333:6333 -p 6334:6334 \
  --name qdrant \
  -v $(pwd)/qdrant_storage:/qdrant/storage \
  qdrant/qdrant
```

После запуска Qdrant будет доступен по адресу: `http://localhost:6333`

### Вариант B: Использование локального режима (SQLite)

Если Docker недоступен, агент может работать в локальном режиме с использованием SQLite для хранения метаданных и in-memory для векторов (только для тестирования).

### Вариант C: Подключение к удаленному Qdrant

Используйте облачный сервис Qdrant Cloud или разверните на своем сервере.

---

## 4. Конфигурация проекта

Создайте файл `.env` в корне проекта со следующими параметрами:

```ini
# ===========================================
# КОНФИГУРАЦИЯ ИИ АГЕНТА
# ===========================================

# --- Ролевой доступ ---
# Допустимые роли: ARCHITECT, ADMIN, DEVOPS_ANALYST
ALLOWED_ROLES=ARCHITECT,ADMIN,DEVOPS_ANALYST

# --- Выбор AI модели ---
# Доступные варианты: openai_gpt4, anthropic_claude3, google_gemini, llama3_local
ACTIVE_MODEL=openai_gpt4

# --- Настройки OpenAI GPT-4 ---
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_BASE_URL=https://api.openai.com/v1

# --- Настройки Anthropic Claude 3 ---
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_MODEL=claude-3-opus-20240229
ANTHROPIC_BASE_URL=https://api.anthropic.com

# --- Настройки Google Gemini Pro ---
GOOGLE_API_KEY=your_google_api_key_here
GOOGLE_MODEL=gemini-pro
GOOGLE_BASE_URL=https://generativelanguage.googleapis.com

# --- Настройки локальной Llama 3 (если используется) ---
LLAMA3_MODEL_PATH=/path/to/llama3/model
LLAMA3_DEVICE=cuda  # или cpu

# --- Настройки Qdrant Vector DB ---
# Режим подключения: local, remote, memory
QDRANT_MODE=remote

# Для remote режима:
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_HTTPS=false
QDRANT_API_KEY=  # Оставьте пустым если не требуется

# Для local режима (путь к хранилищу):
QDRANT_LOCAL_PATH=./qdrant_storage

# Название коллекции в Qdrant
QDRANT_COLLECTION_NAME=architect_requirements

# Размерность вектора (должна совпадать с моделью эмбеддингов)
VECTOR_SIZE=384

# --- Настройки модели эмбеддингов ---
# Используемая модель SentenceTransformers
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
EMBEDDING_DEVICE=cpu  # или cuda

# --- Пороговые значения для RAG поиска ---
# Минимальный порог схожести для дубликатов (0.0 - 1.0)
DUPLICATE_THRESHOLD=0.75

# Минимальный порог схожести для похожих требований
SIMILAR_THRESHOLD=0.50

# Максимальное количество результатов поиска
MAX_SEARCH_RESULTS=10

# --- Настройки парсинга документов ---
# Поддерживаемые форматы: docx, txt, md, pdf (требуется дополнительно)
SUPPORTED_FORMATS=docx,txt,md,pdf

# Максимальный размер чанка (в символах)
CHUNK_SIZE=500

# Перекрытие между чанками (в символах)
CHUNK_OVERLAP=50

# --- Логирование ---
LOG_LEVEL=INFO
LOG_FILE=logs/agent.log

# --- Язык интерфейса ---
# Поддерживаемые: ru, en
DEFAULT_LANGUAGE=ru
```

### Пример минимальной конфигурации (.env.minimal)

Для быстрого старта создайте файл `.env.minimal`:

```ini
# Минимальная конфигурация для теста
ALLOWED_ROLES=ARCHITECT
ACTIVE_MODEL=openai_gpt4
OPENAI_API_KEY=sk-your-key-here
QDRANT_MODE=memory
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
DEFAULT_LANGUAGE=ru
```

---

## 5. Запуск проекта

### Шаг 1: Активация виртуального окружения

```bash
source venv/bin/activate  # Linux/Mac
# или
venv\Scripts\activate     # Windows
```

### Шаг 2: Проверка установки

```bash
python -c "from agent.core import ArchitectAgent; print('✅ Агент успешно импортирован')"
```

### Шаг 3: Запуск демонстрационного примера

```bash
python examples/usage_example.py
```

### Шаг 4: Запуск полного демо с RAG

```bash
python examples/rag_demo.py
```

### Шаг 5: Запуск тестов

```bash
pytest tests/ -v
```

---

## 6. Использование агента в коде

### Базовый пример использования

```python
from agent.core import ArchitectAgent
from agent.models import UserRole

# Инициализация агента
agent = ArchitectAgent(user_role=UserRole.ARCHITECT)

# Загрузка и обработка документа
document_path = "requirements.docx"
result = agent.process_document(
    file_path=document_path,
    save_to_rag=True,
    search_similar=True
)

# Вывод отчета
print(result.report_markdown)

# Поиск похожих требований
similar = agent.search_similar(
    query="Требования к безопасности системы",
    threshold=0.5
)
print(f"Найдено похожих требований: {len(similar)}")
```

### Пример с кастомной конфигурацией

```python
from agent.core import ArchitectAgent, AgentConfig
from agent.models import UserRole

config = AgentConfig(
    active_model="anthropic_claude3",
    qdrant_mode="remote",
    qdrant_host="qdrant.mycompany.internal",
    duplicate_threshold=0.8,
    default_language="ru"
)

agent = ArchitectAgent(
    user_role=UserRole.ARCHITECT,
    config=config
)
```

---

## 7. Интеграция с AI моделями

### OpenAI GPT-4

1. Получите API ключ на https://platform.openai.com/api-keys
2. Установите ключ в `.env`: `OPENAI_API_KEY=sk-...`
3. Убедитесь, что `ACTIVE_MODEL=openai_gpt4`

### Anthropic Claude 3

1. Получите API ключ на https://console.anthropic.com/
2. Установите ключ в `.env`: `ANTHROPIC_API_KEY=sk-ant-...`
3. Установите `ACTIVE_MODEL=anthropic_claude3`

### Google Gemini Pro

1. Получите API ключ на https://makersuite.google.com/app/apikey
2. Установите ключ в `.env`: `GOOGLE_API_KEY=...`
3. Установите `ACTIVE_MODEL=google_gemini`

### Локальная Llama 3

1. Скачайте модель с HuggingFace
2. Укажите путь в `.env`: `LLAMA3_MODEL_PATH=/path/to/model`
3. Установите `ACTIVE_MODEL=llama3_local`
4. Требуется дополнительная установка: `pip install transformers accelerate`

---

## 8. Структура проекта

```
AIAgent_aov_Doc/
├── agent/                      # Основной код агента
│   ├── __init__.py
│   ├── core.py                 # Главный класс ArchitectAgent
│   ├── models.py               # Модели данных и перечисления
│   ├── parser.py               # Парсинг документов
│   ├── decomposer.py           # Атомарная декомпозиция
│   ├── classifier.py           # Классификация исполнителей
│   ├── rag_client.py           # Клиент для взаимодействия с RAG
│   ├── rag_search.py           # Поиск в RAG (дубликаты, противоречия)
│   └── rag_storage.py          # Хранение в Qdrant
├── examples/                   # Примеры использования
│   ├── usage_example.py        # Базовый пример
│   └── rag_demo.py             # Демо с RAG
├── tests/                      # Тесты
│   └── test_agent.py
├── requirements.txt            # Зависимости Python
├── .env                        # Файл конфигурации (создается вручную)
├── .env.example                # Пример конфигурации
└── README.md                   # Документация
```

---

## 9. Отчет о результатах

Агент формирует отчет в формате Markdown со следующей структурой:

```markdown
# 1. [Название Главы]
## 1.1. [Название Раздела]
**Абзац**: [Краткий тезис абзаца]
* **Факт/Наблюдение:** [Ключевое утверждение из текста.]
* **Риск:** [Описание потенциальной проблемы]
* **Критичность:** [Высокий/Средний/Низкий]
* **Рекомендация:** [Предлагаемое действие]
* **Тип исполнителя:** [Аналитик/Архитектор/Разработчик/...]
* **Найденные похожие требования:** [Список ID из RAG с оценкой схожести]
* **Использованные архитектурные решения:** [Ссылки на решения]
* **Комментарий при обработке:** [Дубликаты, противоречия]
```

---

## 10. Решение проблем

### Ошибка подключения к Qdrant

```bash
# Проверьте, запущен ли Qdrant
curl http://localhost:6333

# Если не отвечает, запустите через Docker
docker start qdrant
```

### Ошибка аутентификации AI модели

Проверьте правильность API ключей в `.env` файле и наличие доступа к интернету.

### Ошибка при парсинге документов

Убедитесь, что документ не поврежден и содержит текст в читаемом формате. Для PDF может потребоваться установка дополнительных библиотек: `pip install pdfplumber`.

### Медленная работа эмбеддингов

- Используйте GPU: установите `EMBEDDING_DEVICE=cuda`
- Уменьшите размер чанков: `CHUNK_SIZE=256`
- Используйте более легкую модель эмбеддингов

---

## 11. Безопасность

- Все данные обрабатываются во внутреннем контуре (при использовании локальных моделей)
- API ключи хранятся только в `.env` файле (не коммитьте его в git!)
- Ролевой доступ строго контролируется
- Логирование всех операций для аудита

---

## 12. Контакты и поддержка

- Репозиторий: https://github.com/aov1983/AIAgent_aov_Doc
- Issues: https://github.com/aov1983/AIAgent_aov_Doc/issues
- Pull Requests: https://github.com/aov1983/AIAgent_aov_Doc/pulls
