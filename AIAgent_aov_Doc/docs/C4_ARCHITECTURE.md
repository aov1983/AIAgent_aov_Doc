# Архитектура C4

## Контекст
Пользователи (Архитекторы) взаимодействуют с системой AI Agent.
Система использует внешние LLM (OpenAI, Anthropic) и векторную БД Qdrant.

## Контейнеры
1. **Web/Mobile Client**: React/React Native интерфейс.
2. **API Server**: FastAPI backend.
3. **Qdrant**: Векторное хранилище.

## Компоненты API
- `AuthModule`: Авторизация.
- `Parser`: Парсинг документов.
- `GraphBuilder`: Построение графа знаний.
- `RAGEngine`: Поиск и сохранение чанков.
