"""
Модуль поиска по базе знаний (RAG Search) с использованием Qdrant.
Использует векторный поиск для нахождения релевантных контекстов.
"""
import logging
from typing import List, Dict, Any, Tuple
from .rag_storage import QdrantVectorDB, Chunk, qdrant_db

logger = logging.getLogger(__name__)

class RAGSearcher:
    """Класс для выполнения семантического поиска по векторной базе Qdrant."""
    
    def __init__(self, db: QdrantVectorDB = None):
        self.db = db or qdrant_db

    def search(
        self, 
        query: str, 
        top_k: int = 5, 
        threshold: float = 0.5,
        filters: Dict[str, Any] = None
    ) -> List[Dict[str, Any]]:
        """
        Выполняет поиск похожих чанков по запросу через Qdrant.
        
        Args:
            query: Текст запроса пользователя.
            top_k: Количество возвращаемых результатов.
            threshold: Порог схожести (0.0 - 1.0). Результаты ниже не возвращаются.
            filters: Фильтры по метаданным (например, {"role": "Architect"}).
            
        Returns:
            Список найденных чанков с оценкой схожести.
        """
        # Используем встроенный метод search из QdrantVectorDB
        results = self.db.search(
            query=query,
            top_k=top_k,
            threshold=threshold,
            filters=filters
        )
        
        logger.info(f"Найдено {len(results)} результатов для запроса: {query[:50]}...")
        return results

    def find_duplicates(self, text: str, threshold: float = 0.85) -> List[Dict[str, Any]]:
        """Поиск дубликатов или почти дубликатов текста."""
        logger.info(f"Поиск дубликатов для текста длиной {len(text)} символов...")
        return self.search(query=text, top_k=5, threshold=threshold)

    def find_contradictions(self, requirement_text: str, risk_level: str = None) -> List[Dict[str, Any]]:
        """
        Эвристический поиск потенциальных противоречий.
        Ищет документы с высоким риском или противоположными утверждениями.
        """
        # Формируем поисковый запрос с акцентом на риски и ограничения
        search_query = f"{requirement_text} ограничение риск проблема нельзя запрещено"
        
        candidates = self.search(query=search_query, top_k=10, threshold=0.4)
        
        contradictions = []
        for item in candidates:
            # Простая эвристика: если в найденном чанке есть слова отрицания или высокие риски
            meta = item.get('metadata', {})
            content = item.get('content', '').lower()
            
            is_risky = meta.get('risk_level') == 'High' or 'высокий риск' in content
            has_negation = any(word in content for word in ['нельзя', 'запрещено', 'ошибка', 'конфликт', 'противоречие'])
            
            if is_risky or has_negation:
                item['contradiction_reason'] = "Высокий риск или явное отрицание в найденном требовании"
                contradictions.append(item)
                
        return contradictions

# Глобальный экземпляр
rag_searcher = RAGSearcher()
