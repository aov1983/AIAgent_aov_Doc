#!/usr/bin/env python3
"""
Пример использования AI агента для анализа требований.

Этот скрипт демонстрирует основные возможности агента:
1. Обработка текстового контента
2. Декомпозиция на атомарные требования
3. Классификация исполнителей
4. Поиск в RAG
5. Формирование отчёта
"""

from agent import RequirementsAgent, ModelConfig, ModelProvider


def main():
    """Основная функция демонстрации."""
    
    print("=" * 60)
    print("AI Агент для Анализа Требований - Демонстрация")
    print("=" * 60)
    
    # Инициализация агента с mock RAG (для демонстрации без API ключей)
    print("\n[1] Инициализация агента...")
    agent = RequirementsAgent(use_mock_rag=True)
    print("✓ Агент инициализирован")
    
    # Пример контента для анализа
    sample_content = """# Требования к системе управления заказами

## 1. Общие положения

Система предназначена для автоматизации процессов обработки заказов клиентов.
Основными пользователями системы являются менеджеры по продажам и клиенты.

## 2. Функциональные требования

### 2.1 Управление заказами

Система должна позволять создавать новые заказы через веб-интерфейс.
Каждый заказ должен иметь уникальный идентификатор и статус.
Менеджер должен иметь возможность изменять статус заказа.

### 2.2 Интеграция с платежной системой

Система должна интегрироваться с внешней платежной системой через API.
Все платежи должны проходить проверку на мошенничество.
Данные о платежах должны сохраняться в защищённом хранилище.

## 3. Нефункциональные требования

### 3.1 Производительность

Время отклика системы не должно превышать 200 миллисекунд для 95% запросов.
Система должна поддерживать до 1000 одновременных пользователей.

### 3.2 Безопасность

Все данные должны передаваться по защищённому протоколу HTTPS.
Пароли пользователей должны храниться в хешированном виде.
Система должна вести журнал всех действий пользователей.

### 3.3 Масштабируемость

Архитектура системы должна позволять горизонтальное масштабирование.
Необходимо использовать микросервисный подход к проектированию.

## 4. Требования к развёртыванию

Система должна развёртываться в контейнерах Docker.
Необходимо настроить CI/CD pipeline для автоматического деплоя.
Мониторинг системы должен осуществляться через Prometheus и Grafana.
"""
    
    print("\n[2] Обработка документа...")
    print("-" * 40)
    
    # Обработка контента
    result = agent.process_content(
        content=sample_content,
        title="Требования к системе управления заказами",
        user_role='Архитектор',
        save_to_rag=True
    )
    
    print(f"✓ Документ обработан")
    print(f"  - ID документа: {result.document_id}")
    print(f"  - Всего требований: {result.total_requirements}")
    print(f"  - Сохранено в RAG: {result.saved_to_rag}")
    print(f"  - Время обработки: {result.processing_time:.2f} сек")
    
    if result.warnings:
        print(f"  - Предупреждения: {len(result.warnings)}")
    
    # Статистика RAG
    print("\n[3] Статистика базы знаний RAG...")
    stats = agent.get_rag_statistics()
    print(f"  - Всего документов: {stats.get('total_documents', 0)}")
    
    # Поиск в RAG
    print("\n[4] Поиск похожих требований...")
    search_results = agent.search_in_rag("авторизация пользователей", limit=3)
    print(f"  - Найдено результатов: {len(search_results)}")
    
    # Вывод отчёта (первые 2000 символов)
    print("\n[5] Отчёт (фрагмент)...")
    print("-" * 40)
    report_preview = result.report[:2000]
    print(report_preview)
    if len(result.report) > 2000:
        print("\n... (отчёт обрезан, полный размер: {} символов)".format(len(result.report)))
    
    print("\n" + "=" * 60)
    print("Демонстрация завершена успешно!")
    print("=" * 60)
    
    return result


def show_usage_examples():
    """Показать примеры использования."""
    
    examples = """
Примеры использования:

1. Базовая обработка текста:
   ```python
   from agent import RequirementsAgent
   
   agent = RequirementsAgent(use_mock_rag=True)
   result = agent.process_content(
       content="# Мои требования\\n\\nТекст требований...",
       title="Мой документ",
       user_role='Архитектор'
   )
   print(result.report)
   ```

2. Обработка файла:
   ```python
   result = agent.process_document(
       file_path="requirements.docx",
       user_role='Архитектор',
       save_to_rag=True
   )
   ```

3. Настройка AI моделей:
   ```python
   from agent import ModelConfig, ModelProvider
   
   configs = [
       ModelConfig(provider=ModelProvider.OPENAI_GPT4, api_key="sk-..."),
       ModelConfig(provider=ModelProvider.ANTHROPIC_CLAUDE3, api_key="..."),
       ModelConfig(provider=ModelProvider.LLAMA3, api_key="", base_url="http://internal-llm:8000"),
   ]
   agent = RequirementsAgent(model_configs=configs)
   ```

4. Проверка доступа:
   ```python
   allowed_roles = ['Архитектор', 'Администратор', 'Аналитик DevOps РП']
   
   if not agent.check_access(user_role):
       raise PermissionError("Доступ запрещён")
   ```

5. Поиск в RAG:
   ```python
   results = agent.search_in_rag("микросервисная архитектура", limit=10)
   for req in results:
       print(f"{req['id']}: {req['similarity_score']:.0%} схожесть")
   ```
"""
    print(examples)


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == '--examples':
        show_usage_examples()
    else:
        main()
