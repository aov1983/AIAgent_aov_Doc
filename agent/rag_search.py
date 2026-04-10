"""
Модуль поиска по базе знаний (RAG Search).
Использует векторный поиск для нахождения релевантных контекстов.
"""
import logging
from typing import List, Dict, Any, Tuple
from .rag_storage import VectorDBAdapter, Chunk, rag_db

logger = logging.getLogger(__name__)

class RAGSearcher:
    """Класс для выполнения семантического поиска по векторной базе."""
    
    def __init__(self, db: VectorDBAdapter = None):
        self.db = db or rag_db

    def search(
        self, 
        query: str, 
        top_k: int = 5, 
        threshold: float = 0.5,
        filters: Dict[str, Any] = None
    ) -> List[Dict[str, Any]]:
        """
        Выполняет поиск похожих чанков по запросу.
        
        Args:
            query: Текст запроса пользователя.
            top_k: Количество возвращаемых результатов.
            threshold: Порог схожести (0.0 - 1.0). Результаты ниже не возвращаются.
            filters: Фильтры по метаданным (например, {"role": "Architect"}).
            
        Returns:
            Список найденных чанков с оценкой схожести.
        """
        # Генерируем эмбеддинг для запроса
        query_embedding = self.db._generate_embedding(query)
        
        results = []
        
        # В реальной реализации здесь был бы ANN поиск (HNSW, IVF)
        # Для демо перебираем все чанки и считаем косинусное сходство
        for chunk_id, chunk_data in self.db._storage.items():
            # Применение фильтров
            if filters:
                match = True
                for key, value in filters.items():
                    if chunk_data['metadata'].get(key) != value:
                        match = False
                        break
                if not match:
                    continue
            
            # Расчет схожести (косинусное сходство)
            stored_embedding = chunk_data['embedding']
            similarity = self._cosine_similarity(query_embedding, stored_embedding)
            
            if similarity >= threshold:
                result_item = {
                    "chunk_id": chunk_data['id'],
                    "content": chunk_data['content'],
                    "metadata": chunk_data['metadata'],
                    "similarity_score": round(similarity, 4),
                    "document_id": chunk_data['metadata'].get('document_id')
                }
                results.append(result_item)
        
        # Сортировка по убыванию схожести
        results.sort(key=lambda x: x['similarity_score'], reverse=True)
        
        return results[:top_k]

    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """Вычисляет косинусное сходство между двумя векторами."""
        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = sum(a * a for a in vec1) ** 0.5
        norm2 = sum(b * b for b in vec2) ** 0.5
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
            
        return dot_product / (norm1 * norm2)

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
