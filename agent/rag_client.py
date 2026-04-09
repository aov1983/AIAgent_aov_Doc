"""
Модуль взаимодействия с RAG (Retrieval-Augmented Generation).

Реализует FR-05 и FR-06:
- Поиск похожих требований и решений
- Сохранение атомарных требований в RAG
- Выявление дубликатов и противоречий
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import hashlib
import json


@dataclass
class RAGDocument:
    """Документ в RAG."""
    id: str
    content: str
    metadata: Dict[str, Any]
    embedding: Optional[List[float]] = None


class RAGClient:
    """Клиент для взаимодействия с RAG системой."""
    
    def __init__(self, storage_path: str = "./rag_storage"):
        self.storage_path = storage_path
        self._documents: Dict[str, RAGDocument] = {}
        self._index: Dict[str, List[str]] = {}  # Индекс для поиска
        
        # В реальной реализации здесь было бы подключение к векторной БД
        # Например: ChromaDB, Pinecone, Weaviate, или Elasticsearch
    
    def _generate_id(self, content: str) -> str:
        """Генерация уникального ID для документа."""
        return hashlib.sha256(content.encode()).hexdigest()[:16]
    
    def _compute_similarity(self, text1: str, text2: str) -> float:
        """
        Вычисление схожести между двумя текстами.
        
        В реальной реализации здесь использовались бы векторные эмбеддинги
        и косинусное сходство. Для демонстрации используем упрощённый подход.
        """
        # Упрощённая реализация на основе пересечения слов
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = words1 & words2
        union = words1 | words2
        
        return len(intersection) / len(union) if union else 0.0
    
    def search_similar(
        self, 
        query: str, 
        limit: int = 10,
        threshold: float = 0.5
    ) -> List[Dict[str, Any]]:
        """
        Поиск похожих требований в базе знаний.
        
        Args:
            query: Текст запроса
            limit: Максимальное количество результатов
            threshold: Порог схожести (по умолчанию 0.5 = 50%)
            
        Returns:
            List[Dict]: Список похожих требований с метаданными
        """
        results = []
        
        for doc_id, doc in self._documents.items():
            similarity = self._compute_similarity(query, doc.content)
            
            if similarity >= threshold:
                results.append({
                    'id': doc_id,
                    'content': doc.content,
                    'similarity_score': similarity,
                    'metadata': doc.metadata,
                    'is_contradiction': self._check_contradiction(query, doc.content),
                    'architectural_solution': doc.metadata.get('architectural_solution', '')
                })
        
        # Сортировка по убыванию схожести
        results.sort(key=lambda x: x['similarity_score'], reverse=True)
        
        return results[:limit]
    
    def _check_contradiction(self, text1: str, text2: str) -> bool:
        """
        Проверка на противоречие между двумя текстами.
        
        В реальной реализации здесь использовалась бы AI модель
        для семантического анализа противоречий.
        """
        contradiction_markers = [
            ('должен', 'не должен'),
            ('обязательно', 'запрещено'),
            ('требуется', 'не требуется'),
            ('можно', 'нельзя'),
            ('разрешено', 'запрещено'),
        ]
        
        text1_lower = text1.lower()
        text2_lower = text2.lower()
        
        for marker1, marker2 in contradiction_markers:
            if (marker1 in text1_lower and marker2 in text2_lower) or \
               (marker2 in text1_lower and marker1 in text2_lower):
                return True
        
        return False
    
    def save_requirement(
        self,
        requirement_data: Dict[str, Any],
        document_id: Optional[str] = None
    ) -> str:
        """
        Сохранение атомарного требования в RAG.
        
        Args:
            requirement_data: Данные требования
            document_id: Опциональный ID документа
            
        Returns:
            str: ID сохранённого требования
        """
        content = f"{requirement_data.get('fact', '')} {requirement_data.get('risk', '')} {requirement_data.get('recommendation', '')}"
        
        req_id = self._generate_id(content)
        
        if document_id:
            req_id = f"{document_id}_{req_id}"
        
        self._documents[req_id] = RAGDocument(
            id=req_id,
            content=content,
            metadata={
                'fact': requirement_data.get('fact', ''),
                'risk': requirement_data.get('risk', ''),
                'criticality': requirement_data.get('criticality', ''),
                'recommendation': requirement_data.get('recommendation', ''),
                'executors': requirement_data.get('executors', []),
                'tracing': requirement_data.get('tracing', {}),
                'architectural_solution': requirement_data.get('architectural_solution', ''),
            }
        )
        
        # Обновление индекса для поиска
        self._update_index(req_id, content)
        
        return req_id
    
    def _update_index(self, doc_id: str, content: str):
        """Обновление поискового индекса."""
        words = content.lower().split()
        for word in words:
            if word not in self._index:
                self._index[word] = []
            if doc_id not in self._index[word]:
                self._index[word].append(doc_id)
    
    def save_document(
        self,
        title: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Сохранение документа в хранилище.
        
        Args:
            title: Заголовок документа
            content: Содержимое документа
            metadata: Метаданные документа
            
        Returns:
            str: ID сохранённого документа
        """
        doc_id = self._generate_id(f"{title}_{content}")
        
        self._documents[doc_id] = RAGDocument(
            id=doc_id,
            content=content,
            metadata={
                'title': title,
                'type': 'document',
                **(metadata or {})
            }
        )
        
        return doc_id
    
    def get_document(self, doc_id: str) -> Optional[RAGDocument]:
        """Получение документа по ID."""
        return self._documents.get(doc_id)
    
    def delete_document(self, doc_id: str) -> bool:
        """Удаление документа по ID."""
        if doc_id in self._documents:
            del self._documents[doc_id]
            # Очистка индекса
            for word in list(self._index.keys()):
                if doc_id in self._index[word]:
                    self._index[word].remove(doc_id)
                if not self._index[word]:
                    del self._index[word]
            return True
        return False
    
    def get_statistics(self) -> Dict[str, Any]:
        """Получение статистики по базе знаний."""
        return {
            'total_documents': len(self._documents),
            'total_indexed_words': len(self._index),
        }
    
    def find_duplicates(self, content: str, threshold: float = 0.9) -> List[str]:
        """
        Поиск дубликатов контента.
        
        Args:
            content: Контент для проверки
            threshold: Порог схожести для дубликатов (по умолчанию 0.9 = 90%)
            
        Returns:
            List[str]: Список ID найденных дубликатов
        """
        similar = self.search_similar(content, threshold=threshold)
        return [item['id'] for item in similar if item['similarity_score'] >= threshold]
    
    def batch_save_requirements(
        self,
        requirements: List[Dict[str, Any]],
        document_id: str
    ) -> List[str]:
        """
        Массовое сохранение требований в RAG.
        
        Args:
            requirements: Список требований
            document_id: ID родительского документа
            
        Returns:
            List[str]: Список ID сохранённых требований
        """
        saved_ids = []
        for req in requirements:
            req_id = self.save_requirement(req, document_id)
            saved_ids.append(req_id)
        return saved_ids


class MockRAGClient(RAGClient):
    """
    Mock-клиент для тестирования без реального хранилища.
    
    Используется для демонстрации и тестирования функционала.
    """
    
    def __init__(self):
        super().__init__()
        self._saved_count = 0
        self._search_count = 0
    
    def save_requirement(self, requirement_data: Dict[str, Any], document_id: Optional[str] = None) -> str:
        req_id = f"req_{self._saved_count}"
        self._saved_count += 1
        return super().save_requirement(requirement_data, req_id)
    
    def search_similar(self, query: str, limit: int = 10, threshold: float = 0.5) -> List[Dict[str, Any]]:
        self._search_count += 1
        # Возвращаем mock-результаты для демонстрации
        return [
            {
                'id': f'mock_req_{i}',
                'content': f'Пример требования {i}',
                'similarity_score': 0.7 - i * 0.1,
                'metadata': {'source': 'mock'},
                'is_contradiction': False,
                'architectural_solution': ''
            }
            for i in range(min(limit, 3))
        ]
