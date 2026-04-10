"""
Модуль для работы с векторной базой знаний Qdrant.
Отвечает за чанкинг документов и сохранение эмбеддингов в Qdrant.
"""
import hashlib
import json
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict
import logging
import uuid

# Интеграция с Qdrant
try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        Distance, VectorParams, PointStruct, Filter, FieldCondition, 
        MatchValue, Range, SearchParams
    )
    HAS_QDRANT = True
except ImportError:
    HAS_QDRANT = False
    logger = logging.getLogger(__name__)
    logger.warning("qdrant-client не установлен. Будет использована заглушка.")

try:
    from sentence_transformers import SentenceTransformer
    HAS_TRANSFORMERS = True
except ImportError:
    HAS_TRANSFORMERS = False

logger = logging.getLogger(__name__)

@dataclass
class Chunk:
    """Атомарный кусок документа для векторизации."""
    id: str
    content: str
    metadata: Dict[str, Any]
    embedding: Optional[List[float]] = None

class QdrantVectorDB:
    """Адаптер для взаимодействия с векторной БД Qdrant."""
    
    def __init__(
        self, 
        collection_name: str = "architect_knowledge", 
        dimension: int = 384,
        qdrant_url: Optional[str] = None,
        qdrant_api_key: Optional[str] = None,
        use_local: bool = True
    ):
        """
        Инициализация подключения к Qdrant.
        
        Args:
            collection_name: Имя коллекции в Qdrant
            dimension: Размерность векторов
            qdrant_url: URL сервера Qdrant (для remote режима)
            qdrant_api_key: API ключ для Qdrant Cloud
            use_local: Использовать локальное хранилище (SQLite)
        """
        self.collection_name = collection_name
        self.dimension = dimension
        self._model = None  # Ленивая инициализация
        self.client = None
        
        # Инициализация клиента Qdrant (без загрузки модели)
        if HAS_QDRANT:
            try:
                if use_local:
                    # Локальный режим (SQLite)
                    self.client = QdrantClient(path="./qdrant_storage")
                    logger.info(f"Qdrant инициализирован в локальном режиме: ./qdrant_storage")
                else:
                    # Remote режим
                    if not qdrant_url:
                        raise ValueError("Для remote режима необходимо указать qdrant_url")
                    self.client = QdrantClient(
                        url=qdrant_url,
                        api_key=qdrant_api_key,
                        timeout=60
                    )
                    logger.info(f"Qdrant инициализирован в remote режиме: {qdrant_url}")
                
                # Создание коллекции если не существует
                self._ensure_collection()
                
            except Exception as e:
                logger.error(f"Ошибка инициализации Qdrant: {e}. Будет использована заглушка.")
                self.client = None
        else:
            logger.warning("qdrant-client не установлен. Будет использована in-memory заглушка.")
            self._storage = {}  # In-memory storage для демо

    def _ensure_collection(self):
        """Создание коллекции в Qdrant если она не существует."""
        if not self.client:
            return
            
        try:
            collections = self.client.get_collections().collections
            exists = any(col.name == self.collection_name for col in collections)
            
            if not exists:
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(
                        size=self.dimension,
                        distance=Distance.COSINE
                    ),
                    optimizers_config=None  # Использовать настройки по умолчанию
                )
                logger.info(f"Коллекция '{self.collection_name}' создана в Qdrant")
                
                # Создание индексов для мета-полей
                self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name="document_id",
                    field_schema="keyword"
                )
                self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name="risk_level",
                    field_schema="keyword"
                )
                self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name="executors",
                    field_schema="keyword"
                )
        except Exception as e:
            logger.error(f"Ошибка при создании коллекции: {e}")

    @property
    def model(self):
        """Ленивая инициализация модели эмбеддингов."""
        if self._model is None and HAS_TRANSFORMERS:
            try:
                # Модель поддерживающая русский и английский
                logger.info("Загрузка модели эмбеддингов...")
                self._model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
                logger.info("Модель эмбеддингов загружена успешно.")
            except Exception as e:
                logger.warning(f"Не удалось загрузить модель эмбеддингов: {e}. Будет использована заглушка.")
                self._model = False  # Помечаем что попытка была
        elif self._model is None:
            logger.warning("sentence-transformers не установлен. Эмбеддинги будут фейковыми.")
            self._model = False
        return self._model if self._model else None

    def _generate_embedding(self, text: str) -> List[float]:
        """Генерирует векторное представление текста."""
        model_instance = self.model  # Получаем модель через property
        if model_instance:
            try:
                embedding = model_instance.encode(text, convert_to_numpy=True)
                return embedding.tolist()
            except Exception as e:
                logger.warning(f"Ошибка генерации эмбеддинга: {e}. Используем fallback.")
        # Fallback: простой хэш-вектор для демонстрации без модели
        return [float(hash(text + str(i)) % 1000) / 1000 for i in range(self.dimension)]

    def _generate_chunk_id(self, content: str, metadata: Dict) -> str:
        """Генерирует уникальный ID для чанка."""
        unique_str = f"{content}{json.dumps(metadata, sort_keys=True)}"
        return hashlib.sha256(unique_str.encode()).hexdigest()

    def split_document(self, text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
        """Разбивает текст на перекрывающиеся чанки."""
        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end]
            
            # Попытка разбить по предложению или абзацу, чтобы не резать слова
            if end < len(text):
                last_space = chunk.rfind(' ')
                last_newline = chunk.rfind('\n')
                split_point = max(last_space, last_newline)
                if split_point > chunk_size * 0.5:
                    chunk = chunk[:split_point]
                    end = start + split_point
            
            chunks.append(chunk.strip())
            start = end - overlap
            if start <= 0:
                break
            
        return chunks

    def save_chunks(self, document_id: str, text: str, metadata: Dict[str, Any]) -> List[Chunk]:
        """Разбивает документ на чанки, создает эмбеддинги и сохраняет в Qdrant."""
        raw_chunks = self.split_document(text)
        saved_chunks = []

        for i, content in enumerate(raw_chunks):
            if not content.strip():
                continue
                
            chunk_meta = {
                "document_id": document_id,
                "chunk_index": i,
                "total_chunks": len(raw_chunks),
                **metadata
            }
            
            chunk_id = self._generate_chunk_id(content, chunk_meta)
            embedding = self._generate_embedding(content)
            
            chunk_obj = Chunk(
                id=chunk_id,
                content=content,
                metadata=chunk_meta,
                embedding=embedding
            )
            
            # Сохранение в Qdrant
            if self.client and HAS_QDRANT:
                try:
                    point = PointStruct(
                        id=uuid.UUID(hex=chunk_id[:32]).int,  # Qdrant требует integer ID
                        vector=embedding,
                        payload={
                            "content": content,
                            **chunk_meta
                        }
                    )
                    self.client.upsert(
                        collection_name=self.collection_name,
                        points=[point]
                    )
                except Exception as e:
                    logger.error(f"Ошибка сохранения чанка в Qdrant: {e}")
                    # Fallback to in-memory
                    saved_chunks.append(chunk_obj)
                    continue
            else:
                # In-memory fallback
                self._storage[chunk_id] = asdict(chunk_obj)
            
            saved_chunks.append(chunk_obj)
            
        logger.info(f"Сохранено {len(saved_chunks)} чанков для документа {document_id}")
        return saved_chunks

    def upsert(self, chunks: List[Chunk]):
        """Массовая вставка или обновление чанков в Qdrant."""
        if not self.client or not HAS_QDRANT:
            # Fallback to in-memory
            for chunk in chunks:
                if not chunk.embedding:
                    chunk.embedding = self._generate_embedding(chunk.content)
                self._storage[chunk.id] = asdict(chunk)
            return
            
        points = []
        for chunk in chunks:
            if not chunk.embedding:
                chunk.embedding = self._generate_embedding(chunk.content)
            
            point = PointStruct(
                id=uuid.UUID(hex=chunk.id[:32]).int,
                vector=chunk.embedding,
                payload={
                    "content": chunk.content,
                    **chunk.metadata
                }
            )
            points.append(point)
        
        if points:
            self.client.upsert(
                collection_name=self.collection_name,
                points=points
            )
            logger.info(f"Загружено {len(points)} чанков в Qdrant")

    def search(
        self,
        query: str,
        top_k: int = 5,
        threshold: float = 0.5,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """Поиск похожих чанков в Qdrant."""
        query_embedding = self._generate_embedding(query)
        
        if self.client and HAS_QDRANT:
            # Построение фильтра для Qdrant
            qdrant_filter = None
            if filters:
                conditions = []
                for key, value in filters.items():
                    conditions.append(
                        FieldCondition(
                            key=key,
                            match=MatchValue(value=value)
                        )
                    )
                if conditions:
                    qdrant_filter = Filter(must=conditions)
            
            # Поиск в Qdrant
            try:
                results = self.client.search(
                    collection_name=self.collection_name,
                    query_vector=query_embedding,
                    query_filter=qdrant_filter,
                    limit=top_k,
                    score_threshold=threshold,
                    search_params=SearchParams(hnsw_ef=128, exact=False)
                )
                
                formatted_results = []
                for result in results:
                    formatted_results.append({
                        "chunk_id": str(result.id),
                        "content": result.payload.get("content", ""),
                        "metadata": {k: v for k, v in result.payload.items() if k != "content"},
                        "similarity_score": round(result.score, 4),
                        "document_id": result.payload.get("document_id", "unknown")
                    })
                return formatted_results
            except Exception as e:
                logger.error(f"Ошибка поиска в Qdrant: {e}")
                # Fallback to in-memory search
                return self._in_memory_search(query_embedding, top_k, threshold, filters)
        else:
            # In-memory fallback
            return self._in_memory_search(query_embedding, top_k, threshold, filters)

    def _in_memory_search(
        self,
        query_embedding: List[float],
        top_k: int,
        threshold: float,
        filters: Optional[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Поиск в in-memory хранилище (fallback)."""
        results = []
        
        for chunk_id, chunk_data in getattr(self, '_storage', {}).items():
            # Применение фильтров
            if filters:
                match = True
                for key, value in filters.items():
                    if chunk_data['metadata'].get(key) != value:
                        match = False
                        break
                if not match:
                    continue
            
            # Расчет косинусного сходства
            stored_embedding = chunk_data['embedding']
            similarity = self._cosine_similarity(query_embedding, stored_embedding)
            
            if similarity >= threshold:
                results.append({
                    "chunk_id": chunk_data['id'],
                    "content": chunk_data['content'],
                    "metadata": chunk_data['metadata'],
                    "similarity_score": round(similarity, 4),
                    "document_id": chunk_data['metadata'].get('document_id')
                })
        
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

    def delete_collection(self):
        """Удаление коллекции (для тестов)."""
        if self.client and HAS_QDRANT:
            self.client.delete_collection(collection_name=self.collection_name)
            logger.info(f"Коллекция '{self.collection_name}' удалена")

# Глобальный экземпляр (Singleton)
qdrant_db = QdrantVectorDB()
