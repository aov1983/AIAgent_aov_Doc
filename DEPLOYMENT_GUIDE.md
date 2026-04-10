# 📘 Руководство по развертыванию (Deployment Guide)

## 1. Обзор архитектуры

Система состоит из следующих компонентов:
- **Backend API** (FastAPI, Python 3.9+)
- **Vector Database** (Qdrant)
- **Web Client** (React SPA, опционально)
- **Mobile Clients** (React Native, iOS/Android)

## 2. Развертывание Backend

### 2.1. Подготовка окружения

```bash
# Установка системных зависимостей (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y python3.9 python3.9-venv docker.io

# Клонирование репозитория
git clone https://github.com/aov1983/AIAgent_aov_Doc.git
cd AIAgent_aov_Doc
```

### 2.2. Настройка Python окружения

```bash
python3.9 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 2.3. Конфигурация (.env)

Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
nano .env
```

**Обязательные параметры:**
```ini
# Роли
ALLOWED_ROLES=Архитектор,Администратор,Аналитик

# AI Модели
ACTIVE_MODEL=openai
OPENAI_API_KEY=sk-your-key-here
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Qdrant
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_COLLECTION=architect_knowledge

# Приложение
APP_SECRET_KEY=your-secret-key-change-in-prod
DEBUG=false
```

### 2.4. Запуск Qdrant

**Вариант A: Docker (Рекомендуется)**
```bash
docker run -d \
  --name qdrant \
  -p 6333:6333 \
  -p 6334:6334 \
  -v $(pwd)/qdrant_storage:/qdrant/storage \
  qdrant/qdrant
```

**Вариант B: Docker Compose**
```bash
docker-compose up -d qdrant
```

**Вариант C: Локальный режим (для тестов)**
Приложение автоматически переключится в режим in-memory, если Qdrant недоступен.

### 2.5. Запуск API сервера

**Разработка:**
```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

**Production (с Gunicorn):**
```bash
pip install gunicorn
gunicorn api.main:app \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --timeout 120
```

### 2.6. Проверка работоспособности

```bash
# Проверка здоровья API
curl http://localhost:8000/health

# Проверка Swagger UI
# Откройте в браузере: http://localhost:8000/docs
```

## 3. Развертывание Мобильного приложения

### 3.1. Требования
- Node.js 18+
- npm или yarn
- Expo CLI
- Эмулятор iOS/Android или физическое устройство с Expo Go

### 3.2. Установка зависимостей

```bash
cd mobile
npm install
```

### 3.3. Конфигурация API

Отредактируйте `mobile/services/api.ts`, указав адрес вашего backend:

```typescript
const API_BASE_URL = 'http://YOUR_SERVER_IP:8000';
// Для локальной разработки с эмулятором Android используйте: 10.0.2.2
// Для iOS используйте: localhost
```

### 3.4. Запуск в режиме разработки

```bash
npx expo start
```

- Отсканируйте QR-код приложением **Expo Go** (iOS/Android).
- Нажмите `a` для запуска на Android эмуляторе.
- Нажмите `i` для запуска на iOS симуляторе.

### 3.5. Сборка Production версий

**Android APK:**
```bash
eas build --platform android --profile preview
```

**iOS IPA (требуется Apple Developer аккаунт):**
```bash
eas build --platform ios --profile production
```

## 4. Запуск тестов

### 4.1. Backend тесты

```bash
source venv/bin/activate

# Unit тесты
pytest tests/unit/ -v --cov=agent --cov-report=html

# Integration тесты (требуется запущенный Qdrant)
pytest tests/integration/ -v

# Отчет о покрытии откроется в папке htmlcov/
```

### 4.2. Mobile тесты

```bash
cd mobile
npm test -- --coverage
```

## 5. Production чеклист

- [ ] Измените `APP_SECRET_KEY` на случайную строку
- [ ] Установите `DEBUG=false`
- [ ] Настройте HTTPS (Nginx/Traefik)
- [ ] Настройте бэкапы Qdrant (`/qdrant/storage`)
- [ ] Ограничьте доступ к API по IP/VPN (NFR-01)
- [ ] Настройте логирование (ELK Stack или аналоги)
- [ ] Проведите нагрузочное тестирование

## 6. Troubleshooting

### Ошибка подключения к Qdrant
```bash
# Проверьте статус контейнера
docker ps | grep qdrant

# Проверьте логи
docker logs qdrant

# Убедитесь, что порт 6333 открыт
netstat -tlnp | grep 6333
```

### Ошибка импорта модулей
```bash
# Переустановите зависимости
pip install -r requirements.txt --force-reinstall
```

### Мобильное приложение не видит API
- Убедитесь, что сервер слушает `0.0.0.0`, а не `127.0.0.1`.
- Проверьте firewall правила.
- Для эмулятора Android используйте IP `10.0.2.2` вместо `localhost`.

---

## 7. Контакты и поддержка

Репозиторий: https://github.com/aov1983/AIAgent_aov_Doc
Документация: `/docs`
