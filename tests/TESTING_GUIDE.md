# Руководство по тестированию проекта AI Architect Agent

## 📋 Обзор

Проект покрыт комплексными тестами:
- **UNIT тесты** для backend модулей (Parser, Decomposer, Classifier, RAG)
- **Integration тесты** для API endpoints
- **UNIT тесты** для мобильных компонентов (React Native)

## 🗂 Структура тестов

```
tests/
├── backend/
│   ├── unit/                  # UNIT тесты
│   │   ├── test_parser.py     # Тесты парсера документов
│   │   ├── test_decomposer.py # Тесты декомпозиции
│   │   ├── test_classifier.py # Тесты классификатора ролей
│   │   └── test_rag.py        # Тесты RAG (Storage & Search)
│   └── integration/
│       └── test_api.py        # Integration тесты API
mobile/
└── __tests__/
    └── App.test.tsx           # Тесты мобильных экранов
```

## 🚀 Запуск тестов

### Backend (Python)

#### Установка зависимостей для тестирования
```bash
pip install pytest pytest-cov pytest-asyncio httpx
```

#### Запуск всех UNIT тестов
```bash
pytest tests/backend/unit/ -v
```

#### Запуск конкретных тестов
```bash
# Тесты парсера
pytest tests/backend/unit/test_parser.py -v

# Тесты декомпозиции
pytest tests/backend/unit/test_decomposer.py -v

# Тесты классификатора
pytest tests/backend/unit/test_classifier.py -v

# Тесты RAG
pytest tests/backend/unit/test_rag.py -v
```

#### Запуск Integration тестов
```bash
# Требует запущенного сервера или использует TestClient
pytest tests/backend/integration/test_api.py -v
```

#### Запуск с покрытием кода (Coverage)
```bash
pytest tests/backend/ --cov=agent --cov-report=html
# Отчет откроется в: htmlcov/index.html
```

#### Запуск с детализацией
```bash
# Показать предупреждения
pytest tests/backend/ -v -W default

# Остановиться на первой ошибке
pytest tests/backend/ -x

# Показать локальные переменные при ошибке
pytest tests/backend/ -l
```

### Mobile (React Native)

#### Установка зависимостей
```bash
cd mobile
npm install
# или
yarn install
```

#### Установка dev зависимостей для тестов
```bash
npm install --save-dev @testing-library/react-native jest react-test-renderer
```

#### Запуск тестов
```bash
# Запуск всех тестов
npm test

# Запуск с watch режимом
npm test -- --watch

# Запуск конкретного файла
npm test -- App.test.tsx

# Запуск с покрытием
npm test -- --coverage
```

#### Snapshot тесты
```bash
# Обновить snapshot файлы если изменился UI
npm test -- --updateSnapshot
```

## 📊 Покрытие тестами

### Backend модули
| Модуль | Файл тестов | Статус | Описание |
|--------|-------------|--------|----------|
| Parser | `test_parser.py` | ✅ | Парсинг TXT, DOCX, метаданные |
| Decomposer | `test_decomposer.py` | ✅ | Декомпозиция на главы/разделы/абзацы |
| Classifier | `test_classifier.py` | ✅ | Классификация по ролям исполнителей |
| RAG Storage | `test_rag.py` | ✅ | Сохранение и поиск в Qdrant |
| RAG Search | `test_rag.py` | ✅ | Поиск дубликатов и противоречий |
| API | `test_api.py` | ✅ | Auth, Documents, Analysis, RAG endpoints |

### Mobile компоненты
| Компонент | Тесты | Статус | Описание |
|-----------|-------|--------|----------|
| LoginScreen | ✅ | Рендер, валидация, навигация |
| DocumentUploadScreen | ✅ | Рендер, загрузка файлов |
| ResultsScreen | ✅ | Отображение результатов, схожесть |

## 🔧 Конфигурация pytest

Файл `pytest.ini` (создать в корне):
```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = 
    -v
    --strict-markers
    --tb=short
    --cov=agent
    --cov-report=term-missing
markers =
    slow: marks tests as slow (deselect with '-m "not slow"')
    integration: marks tests as integration tests
```

## 🎯 Примеры сценариев тестирования

### 1. Тестирование нового парсера
```python
def test_parse_new_format(parser):
    """Добавьте новый тест для поддержки формата"""
    result = parser.parse("document.newformat")
    assert result is not None
    assert 'content' in result
```

### 2. Тестирование интеграции с новой моделью
```python
def test_new_model_integration():
    """Тест подключения новой AI модели"""
    response = client.post("/api/models/new-model", json={...})
    assert response.status_code == 200
```

### 3. Тестирование мобильного UI
```typescript
it('shows loading state during upload', () => {
  const { getByTestId } = render(<DocumentUploadScreen />);
  expect(getByTestId('loading-spinner')).toBeTruthy();
});
```

## 🐛 Отладка тестов

### Вывод отладочной информации
```bash
pytest tests/ -s  # Показать print statements
pytest tests/ --log-cli-level=DEBUG  # Показать логи
```

### Запуск с pdb (Python debugger)
```bash
pytest tests/ --pdb  # Остановиться на ошибке для отладки
```

### Отладка мобильных тестов
```bash
npm test -- --verbose
npm test -- --debug
```

## 📈 CI/CD Интеграция

### GitHub Actions пример (`.github/workflows/tests.yml`)
```yaml
name: Tests

on: [push, pull_request]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: 3.9
      - name: Install dependencies
        run: pip install -r requirements.txt
      - name: Run tests
        run: pytest tests/backend/ --cov=agent --cov-report=xml
      - name: Upload coverage
        uses: codecov/codecov-action@v2

  mobile-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      - name: Install dependencies
        run: cd mobile && npm install
      - name: Run tests
        run: cd mobile && npm test -- --coverage
```

## ✅ Критерии качества

- **Покрытие кода**: > 80% для критических модулей
- **UNIT тесты**: Все функции покрыты изолированными тестами
- **Integration тесты**: Все API endpoints протестированы
- **Мобильные тесты**: Все экраны покрыты snapshot и функциональными тестами
- **CI/CD**: Тесты запускаются автоматически при каждом PR

## 📚 Дополнительные ресурсы

- [Документация pytest](https://docs.pytest.org/)
- [Testing Library React Native](https://callstack.github.io/react-native-testing-library/)
- [FastAPI Testing](https://fastapi.tiangolo.com/tutorial/testing/)

---

**Запуск всех тестов проекта одной командой:**
```bash
# Backend
pytest tests/backend/ -v --cov=agent

# Mobile
cd mobile && npm test

# Или создать Makefile target
make test-all
```
