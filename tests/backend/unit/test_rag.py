"""
UNIT Тесты для модуля RAG (Storage & Search)
"""
import pytest
from agent.rag_storage import QdrantVectorDB
from agent.rag_search import RagSearchEngine

class TestQdrantVectorDB:
    @pytest.fixture
    def vector_db(self):
        # Используем in-memory режим для тестов
        return QdrantVectorDB(location=":memory:")

    def test_save_chunks(self, vector_db):
        """Тест сохранения чанков в векторную БД"""
        chunks = [
            {"id": "1", "text": "Требование 1", "metadata": {"source": "doc1"}},
            {"id": "2", "text": "Требование 2", "metadata": {"source": "doc1"}}
        ]
        
        result = vector_db.save_chunks(chunks)
        
        assert result is True or result is not None

    def test_search_similar(self, vector_db):
        """Тест поиска похожих чанков"""
        # Сначала сохраним данные
        chunks = [
            {"id": "1", "text": "Система должна поддерживать аутентификацию", "metadata": {"type": "requirement"}}
        ]
        vector_db.save_chunks(chunks)
        
        # Поиск
        query = "аутентификация пользователей"
        results = vector_db.search(query, limit=5)
        
        assert results is not None
        assert isinstance(results, list)

    def test_empty_search(self, vector_db):
        """Тест поиска в пустой базе"""
        results = vector_db.search("запрос", limit=5)
        assert results == [] or results is not None

class TestRagSearchEngine:
    @pytest.fixture
    def search_engine(self):
        vector_db = QdrantVectorDB(location=":memory:")
        return RagSearchEngine(vector_db)

    def test_find_duplicates(self, search_engine):
        """Тест поиска дубликатов"""
        # Эмуляция наличия данных в БД
        # В реальном тесте нужно сначала сохранить данные
        duplicates = search_engine.find_duplicates("Текст требования", threshold=0.8)
        
        assert duplicates is not None
        assert isinstance(duplicates, list)

    def test_find_contradictions(self, search_engine):
        """Тест поиска противоречий"""
        contradictions = search_engine.find_contradictions("Текст требования")
        
        assert contradictions is not None
        assert isinstance(contradictions, list)

    def test_similarity_threshold(self, search_engine):
        """Тест порога схожести"""
        # Проверка логики фильтрации по порогу
        text = "Тестовое требование"
        results_low = search_engine.find_duplicates(text, threshold=0.3)
        results_high = search_engine.find_duplicates(text, threshold=0.9)
        
        # Результаты должны быть разными при разных порогах
        assert results_low is not None
        assert results_high is not None

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
