"""
Модуль для работы с векторной базой знаний (Квадрант).
Отвечает за чанкинг документов и сохранение эмбеддингов.
"""
import hashlib
import json
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict
import logging

# Имитация подключения к векторной БД (в реальности здесь будет клиент Quadran/FAISS/Milvus)
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

class VectorDBAdapter:
    """Адаптер для взаимодействия с векторной БД 'Квадрант'."""
    
    def __init__(self, collection_name: str = "architect_knowledge", dimension: int = 384, use_lightweight: bool = True):
        self.collection_name = collection_name
        self.dimension = dimension
        self.model = None
        self._storage = {} # In-memory storage for demo (replace with real DB client)
        
        # Используем легковесный режим по умолчанию для экономии памяти
        if use_lightweight:
            logger.info("Используется легковесный режим эмбеддингов (без загрузки большой модели).")
            return
            
        if HAS_TRANSFORMERS:
            try:
                # Используем модель, поддерживающую русский и английский
                self.model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
                logger.info("Модель эмбеддингов загружена успешно.")
            except Exception as e:
                logger.warning(f"Не удалось загрузить модель эмбеддингов: {e}. Будет использована заглушка.")
        else:
            logger.warning("sentence-transformers не установлен. Эмбеддинги будут фейковыми.")

    def _generate_embedding(self, text: str) -> List[float]:
        """Генерирует векторное представление текста."""
        if self.model:
            return self.model.encode(text).tolist()
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
                if split_point > chunk_size * 0.5: # Если нашли разделитель в первой половине чанка
                    chunk = chunk[:split_point]
                    end = start + split_point
            
            chunks.append(chunk.strip())
            start = end - overlap
            if start <= 0: break # Защита от зацикливания
            
        return chunks

    def save_chunks(self, document_id: str, text: str, metadata: Dict[str, Any]) -> List[Chunk]:
        """Разбивает документ на чанки, создает эмбеддинги и сохраняет в БД."""
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
            
            # Сохранение в "БД"
            self._storage[chunk_id] = asdict(chunk_obj)
            saved_chunks.append(chunk_obj)
            
        logger.info(f"Сохранено {len(saved_chunks)} чанков для документа {document_id}")
        return saved_chunks

    def upsert(self, chunks: List[Chunk]):
        """Массовая вставка или обновление чанков."""
        for chunk in chunks:
            if not chunk.embedding:
                chunk.embedding = self._generate_embedding(chunk.content)
            self._storage[chunk.id] = asdict(chunk)

# Глобальный экземпляр (Singleton pattern for simplicity)
rag_db = VectorDBAdapter()
