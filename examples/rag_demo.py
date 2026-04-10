# Пример использования новых модулей RAG

"""
Демонстрация работы с новыми модулями:
- rag_storage: чанкинг и сохранение в векторную БД
- rag_search: семантический поиск, поиск дубликатов и противоречий
"""

from agent.core import RequirementsAgent
from agent.rag_storage import rag_db
from agent.rag_search import rag_searcher

def main():
    print("=" * 60)
    print("ДЕМОНСТРАЦИЯ РАБОТЫ RAG МОДУЛЕЙ")
    print("=" * 60)
    
    # 1. Создание агента
    print("\n1. Инициализация агента...")
    agent = RequirementsAgent()
    print("   ✓ Агент создан")
    
    # 2. Прямая работа с хранилищем (чанкинг)
    print("\n2. Тестирование чанкинга документов...")
    doc_text = """
    Система должна поддерживать аутентификацию пользователей через OAuth2.
    Это требование критически важно для безопасности.
    Риск: При неправильной реализации возможна утечка данных.
    Рекомендация: Использовать проверенные библиотеки для OAuth2.
    
    Система должна логировать все действия пользователей.
    Логирование должно включать время, IP адрес и тип операции.
    Риск: Отсутствие логов затруднит расследование инцидентов.
    Критичность: Высокая.
    
    Система должна поддерживать резервное копирование данных ежедневно.
    Резервные копии должны храниться минимум 30 дней.
    Риск: Потеря данных при сбое оборудования.
    """
    
    chunks = rag_db.save_chunks(
        document_id="demo_doc_001",
        text=doc_text,
        metadata={"author": "Architect", "project": "Demo"}
    )
    print(f"   ✓ Создано {len(chunks)} чанков")
    for i, chunk in enumerate(chunks):
        print(f"      Чанк {i+1}: {len(chunk.content)} символов")
    
    # 3. Семантический поиск
    print("\n3. Тестирование семантического поиска...")
    query = "аутентификация пользователей безопасность"
    results = rag_searcher.search(query=query, top_k=3, threshold=0.3)
    print(f"   ✓ Найдено {len(results)} результатов по запросу: '{query}'")
    for res in results:
        print(f"      - Схожесть: {res['similarity_score']:.2f}")
        print(f"        Текст: {res['content'][:80]}...")
    
    # 4. Поиск дубликатов
    print("\n4. Тестирование поиска дубликатов...")
    test_requirement = "Система должна поддерживать аутентификацию пользователей через OAuth2"
    duplicates = rag_searcher.find_duplicates(test_requirement, threshold=0.7)
    if duplicates:
        print(f"   ⚠ Найдено {len(duplicates)} потенциальных дубликатов:")
        for dup in duplicates:
            print(f"      - ID: {dup['chunk_id'][:16]}... (схожесть: {dup['similarity_score']:.2f})")
    else:
        print("   ✓ Дубликатов не найдено")
    
    # 5. Поиск противоречий
    print("\n5. Тестирование поиска противоречий...")
    contradictions = rag_searcher.find_contradictions(
        "Отключить логирование для повышения производительности"
    )
    if contradictions:
        print(f"   ⚠ Найдено {len(contradictions)} потенциальных противоречий:")
        for contr in contradictions:
            print(f"      - {contr.get('contradiction_reason', 'Конфликт')}")
    else:
        print("   ✓ Противоречий не найдено")
    
    # 6. Полный цикл обработки документа через агента
    print("\n6. Полный цикл обработки документа...")
    result = agent.process_content(
        content="""
        Глава 1. Требования к безопасности
        
        Система должна поддерживать многофакторную аутентификацию (MFA).
        Это требование обязательно для всех пользователей с правами администратора.
        Риск: Компрометация учетных записей при использовании только пароля.
        Критичность: Высокая.
        Исполнитель: Архитектор, DevOps инженер.
        
        Система должна хранить пароли в хешированном виде с использованием bcrypt.
        Минимальная длина пароля - 12 символов.
        Риск: Утечка базы данных с паролями.
        Критичность: Высокая.
        """,
        title="Требования к безопасности",
        user_role='Архитектор',
        save_to_rag=True
    )
    
    print(f"   ✓ Документ обработан")
    print(f"      - Заголовок: {result.title}")
    print(f"      - Найдено требований: {result.total_requirements}")
    print(f"      - Сохранено в RAG: {result.saved_to_rag}")
    print(f"      - Время обработки: {result.processing_time:.2f} сек")
    
    if result.warnings:
        print(f"   ⚠ Предупреждения: {result.warnings}")
    
    # 7. Повторный поиск после сохранения
    print("\n7. Поиск сохранённых требований...")
    search_results = rag_searcher.search("многофакторная аутентификация MFA", top_k=5)
    print(f"   ✓ Найдено {len(search_results)} релевантных требований")
    for res in search_results[:2]:
        print(f"      - Схожесть: {res['similarity_score']:.2f}")
        print(f"        Метаданные: {res['metadata'].get('risk_level', 'N/A')}")
    
    print("\n" + "=" * 60)
    print("ДЕМОНСТРАЦИЯ ЗАВЕРШЕНА")
    print("=" * 60)

if __name__ == "__main__":
    main()
