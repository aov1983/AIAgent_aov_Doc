"""
Тесты для AI агента анализа требований.
"""

import pytest
from agent import RequirementsAgent, ModelConfig, ModelProvider
from agent.parser import DocumentParser
from agent.classifier import ExecutorClassifier
from agent.rag_client import MockRAGClient


class TestDocumentParser:
    """Тесты для парсера документов."""
    
    def test_parse_txt_content(self):
        """Тест парсинга текстового контента."""
        parser = DocumentParser()
        
        content = """# Заголовок главы

## Раздел 1

Это первый абзац текста.

Это второй абзац текста.

## Раздел 2

Третий абзац в другом разделе.
"""
        
        doc = parser.parse_content(content, "Тестовый документ")
        
        assert doc.title == "Тестовый документ"
        assert len(doc.elements) > 0
        
        # Проверка наличия заголовков
        headings = [e for e in doc.elements if e.element_type == 'heading']
        assert len(headings) >= 1
    
    def test_parse_empty_content(self):
        """Тест парсинга пустого контента."""
        parser = DocumentParser()
        
        doc = parser.parse_content("", "Пустой документ")
        
        assert doc.title == "Пустой документ"


class TestExecutorClassifier:
    """Тесты для классификатора исполнителей."""
    
    def test_classify_analyst_keywords(self):
        """Тест классификации требований аналитика."""
        classifier = ExecutorClassifier()
        
        text = "Необходимо провести анализ бизнес-процессов и собрать требования от пользователей."
        executors = classifier.classify_single(text)
        
        assert 'Аналитик' in executors
    
    def test_classify_architect_keywords(self):
        """Тест классификации требований архитектора."""
        classifier = ExecutorClassifier()
        
        text = "Спроектировать микросервисную архитектуру с использованием API Gateway."
        executors = classifier.classify_single(text)
        
        assert 'Архитектор' in executors
    
    def test_classify_developer_keywords(self):
        """Тест классификации требований разработчика."""
        classifier = ExecutorClassifier()
        
        text = "Реализовать функцию с unit тестами и code review."
        executors = classifier.classify_single(text)
        
        assert 'Разработчик' in executors
    
    def test_classify_tester_keywords(self):
        """Тест классификации требований тестировщика."""
        classifier = ExecutorClassifier()
        
        text = "Провести тестирование и составить test cases для regression testing."
        executors = classifier.classify_single(text)
        
        assert 'Тестировщик' in executors
    
    def test_classify_devops_keywords(self):
        """Тест классификации требований DevOps."""
        classifier = ExecutorClassifier()
        
        text = "Настроить CI/CD pipeline в kubernetes с мониторингом через prometheus."
        executors = classifier.classify_single(text)
        
        assert 'DevOps' in executors


class TestRAGClient:
    """Тесты для RAG клиента."""
    
    def test_save_and_search(self):
        """Тест сохранения и поиска в RAG."""
        from agent.rag_client import RAGClient
        
        client = RAGClient()
        
        # Сохранение требования
        req_data = {
            'fact': 'Система должна поддерживать авторизацию пользователей',
            'risk': 'Риск несанкционированного доступа',
            'criticality': 'Высокий',
            'recommendation': 'Реализовать OAuth 2.0'
        }
        
        req_id = client.save_requirement(req_data)
        assert req_id is not None
        
        # Поиск похожего требования
        results = client.search_similar('авторизация пользователей', threshold=0.3)
        assert len(results) > 0
    
    def test_mock_rag(self):
        """Тест mock RAG клиента."""
        client = MockRAGClient()
        
        results = client.search_similar('тестовый запрос')
        assert len(results) > 0


class TestRequirementsAgent:
    """Тесты для основного агента."""
    
    def test_check_access_allowed_roles(self):
        """Тест проверки доступа для разрешённых ролей."""
        agent = RequirementsAgent(use_mock_rag=True)
        
        allowed_roles = ['Архитектор', 'Администратор', 'Аналитик DevOps РП']
        
        for role in allowed_roles:
            assert agent.check_access(role) is True
    
    def test_check_access_denied_role(self):
        """Тест проверки доступа для запрещённой роли."""
        agent = RequirementsAgent(use_mock_rag=True)
        
        assert agent.check_access('Пользователь') is False
        assert agent.check_access('Гость') is False
    
    def test_process_content_basic(self):
        """Тест базовой обработки контента."""
        agent = RequirementsAgent(use_mock_rag=True)
        
        content = """# Требования к системе

## Функциональные требования

Система должна поддерживать авторизацию пользователей через OAuth 2.0.

## Нефункциональные требования

Система должна обеспечивать время отклика не более 200мс.
"""
        
        result = agent.process_content(
            content=content,
            title="Тестовые требования",
            user_role='Архитектор',
            save_to_rag=True
        )
        
        assert result.document_id is not None
        assert result.title == "Тестовые требования"
        assert result.total_requirements >= 0
        assert 'Ошибка' not in result.report
    
    def test_process_content_unauthorized(self):
        """Тест обработки контента без авторизации."""
        agent = RequirementsAgent(use_mock_rag=True)
        
        content = "# Тестовый документ\n\nТекст документа."
        
        result = agent.process_content(
            content=content,
            title="Тест",
            user_role='Неавторизованный',
            save_to_rag=False
        )
        
        assert 'Ошибка доступа' in result.report or len(result.errors) > 0
    
    def test_rag_statistics(self):
        """Тест получения статистики RAG."""
        agent = RequirementsAgent(use_mock_rag=True)
        
        stats = agent.get_rag_statistics()
        assert isinstance(stats, dict)


class TestIntegration:
    """Интеграционные тесты."""
    
    def test_full_pipeline(self):
        """Тест полного цикла обработки документа."""
        # Инициализация агента
        agent = RequirementsAgent(use_mock_rag=True)
        
        # Создание тестового контента
        content = """# Архитектура системы

## Общие положения

Система представляет собой микросервисную архитектуру.

## Требования безопасности

Все данные должны быть зашифрованы при передаче.

## Требования к производительности

Время отклика не должно превышать 500мс.
"""
        
        # Обработка
        result = agent.process_content(
            content=content,
            title="Архитектурные требования",
            user_role='Архитектор',
            save_to_rag=True
        )
        
        # Проверка результатов
        assert result.document_id is not None
        assert result.saved_to_rag is True
        assert result.total_requirements > 0
        
        # Проверка отчёта
        assert '# 1.' in result.report  # Наличие глав
        assert '**Факт/Наблюдение:**' in result.report
        assert '**Риск:**' in result.report
        assert '**Критичность:**' in result.report
        assert '**Рекомендация:**' in result.report
        assert '**Тип исполнителя:**' in result.report


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
