# AI Агент для Анализа Требований

[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Streamlit](https://img.shields.io/badge/streamlit-1.28.0-FF4B4B?logo=streamlit)](https://streamlit.io)
[![React Native](https://img.shields.io/badge/React_Native-0.72-61DAFB?logo=react)](https://reactnative.dev)
[![Qdrant](https://img.shields.io/badge/Qdrant-Vector_DB-7B3F98?logo=qdrant)](https://qdrant.tech)

## 📖 Описание
Специализированный ИИ-агент для автоматизации анализа неформализованных документов, декомпозиции их на атомарные единицы знаний и сохранения в базу знаний (RAG/Graph). Предназначен для архитекторов, аналитиков и DevOps-инженеров.

## ✨ Ключевые возможности
- **Парсинг документов**: Поддержка MS Word (.docx), текста (.txt), PDF, изображений (OCR).
- **Атомарная декомпозиция**: Разбиение на главы, разделы, абзацы и смысловые атомы (Факт, Риск, Рекомендация).
- **Классификация исполнителей**: Автоматическое определение ролей (Архитектор, Разработчик, Тестировщик, DevOps, Аналитик).
- **RAG (Retrieval-Augmented Generation)**: Поиск похожих требований, выявление дубликатов и противоречий в базе знаний.
- **Мульти-модельность**: Подключение к 4 AI моделям через API (OpenAI GPT-4, Anthropic Claude 3, Google Gemini, Local Llama 3).
- **Веб-интерфейс**: Material Design GUI на Streamlit.
- **Мобильные приложения**: React Native приложения для iOS и Android.
- **REST API**: Полный набор эндпоинтов для интеграции.

## 🚀 Быстрый старт

### 1. Клонирование репозитория
```bash
git clone https://github.com/aov1983/AIAgent_aov_Doc.git
cd AIAgent_aov_Doc
```

### 2. Установка зависимостей (Backend)
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate  # Windows

pip install -r requirements.txt
```

### 3. Настройка окружения
```bash
cp .env.example .env
# Отредактируйте .env, указав свои API ключи и настройки Qdrant
```

### 4. Запуск векторной базы данных (Qdrant)
```bash
docker run -d -p 6333:6333 --name qdrant qdrant/qdrant
```

### 5. Запуск Backend API
```bash
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```
API доступно по адресу: http://localhost:8000
Документация Swagger: http://localhost:8000/docs

### 6. Запуск Веб-интерфейса (GUI)
В новом терминале:
```bash
source venv/bin/activate
streamlit run gui/app.py
```
Интерфейс доступен по адресу: http://localhost:8501

### 7. Запуск Мобильного приложения
```bash
cd mobile
npm install
npx expo start
```
- Отсканируйте QR-код приложением Expo Go (iOS/Android).
- Или нажмите `a` для запуска на Android эмуляторе, `i` для iOS симулятора.

## 🏗 Архитектура
Проект использует микросервисную архитектуру с разделением ответственности:
- **Backend**: Python (FastAPI) + AI Agents.
- **Database**: Qdrant (векторное хранилище).
- **Frontend Web**: React (SPA) + Streamlit (прототип).
- **Mobile**: React Native (Expo).

Подробная схема доступна в [docs/C4_MODEL.md](docs/C4_MODEL.md).

## 🧪 Тестирование
Проект покрыт UNIT и Integration тестами.

### Запуск Backend тестов
```bash
pytest tests/unit/ -v          # Юнит тесты
pytest tests/integration/ -v   # Интеграционные тесты
pytest tests/ --cov=agent      # С покрытием кода
```

### Запуск Mobile тестов
```bash
cd mobile
npm test
```

## 📂 Структура проекта
```
AIAgent_aov_Doc/
├── agent/                 # Ядро агента (логика, модели, парсеры)
├── api/                   # REST API (FastAPI)
├── gui/                   # Веб-интерфейс (Streamlit)
├── mobile/                # Мобильное приложение (React Native)
├── tests/                 # Тесты (unit, integration)
├── docs/                  # Документация и архитектурные схемы
├── requirements.txt       # Зависимости Python
├── .env.example           # Шаблон конфигурации
└── README.md              # Этот файл
```

## 🔐 Безопасность
- Работа только во внутреннем контуре (NFR-01).
- Ролевой доступ (Архитектор, Администратор, Аналитик).
- Хранение секретов в переменных окружения.

## 📄 Лицензия
MIT License.

```python
from agent import RequirementsAgent

# Инициализация агента
agent = RequirementsAgent(api_key="your-api-key")

# Загрузка и анализ документа
result = agent.process_document("requirements.docx")

# Получение отчета
print(result.report)
```

## Структура проекта

```
├── agent/
│   ├── __init__.py
│   ├── core.py           # Основная логика агента
│   ├── models.py         # Интеграция с AI моделями
│   ├── parser.py         # Парсинг документов
│   ├── decomposer.py     # Декомпозиция требований
│   ├── classifier.py     # Классификация исполнителей
│   └── rag_client.py     # Взаимодействие с RAG
├── tests/
│   └── test_agent.py
├── requirements.txt
└── README.md
```

## Требования к доступу
- Роль: Архитектор, Администратор, Аналитик DevOps РП
- Внутренний контур компании
- Поддержка русского и английского языков
