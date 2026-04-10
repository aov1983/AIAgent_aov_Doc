# Руководство по развертыванию AI Agent Architect

## 1. Требования
- Python 3.9+
- Node.js 18+ (для мобильного приложения)
- Docker (для Qdrant)

## 2. Установка Backend
```bash
pip install -r requirements.txt
cp .env.example .env
# Отредактируйте .env, указав API ключи
```

## 3. Запуск Qdrant
```bash
docker run -d -p 6333:6333 --name qdrant qdrant/qdrant
```

## 4. Запуск API
```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

## 5. Мобильное приложение
```bash
cd mobile
npm install
npx expo start
```

## 6. Проверка
Откройте http://localhost:8000/docs для Swagger UI.
