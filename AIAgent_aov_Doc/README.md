# 🤖 AI Agent Architect (AIAgent_aov_Doc)

Система автоматического анализа требований, декомпозиции документов и построения графа знаний с использованием RAG и Qdrant.

## 🚀 Быстрый старт

### Backend
```bash
pip install -r requirements.txt
docker run -d -p 6333:6333 qdrant/qdrant
streamlit run gui/app.py
```

### Mobile (iOS/Android)
```bash
cd mobile
npm install
npx expo start
```

## 📦 Основные возможности
- **Парсинг**: DOCX, TXT, PDF с извлечением таблиц и изображений.
- **Декомпозиция**: Разбивка на Главы -> Разделы -> Абзацы -> Атомарные чанки.
- **RAG & Qdrant**: Поиск дубликатов и противоречий в базе знаний.
- **Граф знаний**: Визуализация связей между требованиями.
- **Мультиплатформенность**: Web GUI (Streamlit) и Mobile App (React Native).

## 📂 Структура проекта
- `agent/`: Ядро системы (парсер, декомпозер, граф, RAG).
- `gui/`: Веб-интерфейс.
- `mobile/`: Мобильное приложение.
- `tests/`: Unit и Integration тесты.
- `docs/`: Архитектурная документация.
