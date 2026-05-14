"""
AI Agent for Requirements Analysis

Агент для автоматизации анализа неформализованных документов,
декомпозиции на атомарные единицы знаний и сохранения в базу знаний (RAG/Graph).
"""

from .core import RequirementsAgent, ProcessingResult, ALLOWED_ROLES
from .models import ModelProvider, ModelConfig, get_model_client, BaseModelClient
from .parser import DocumentParser, ParsedDocument, DocumentElement
from .decomposer import Decomposer, DecomposedDocument, AtomicRequirement, Chapter, Section
from .classifier import ExecutorClassifier
from .rag_client import RAGClient, MockRAGClient
from .rag_storage import QdrantVectorDB, Chunk, qdrant_db
from .rag_search import RAGSearcher, rag_searcher
from .graph_builder import KnowledgeGraphBuilder, GraphNode, GraphEdge
from .chat_engine import DocumentChatEngine

__version__ = "1.0.0"
__all__ = [
    # Core
    "RequirementsAgent",
    "ProcessingResult",
    "ALLOWED_ROLES",
    
    # Models
    "ModelProvider",
    "ModelConfig",
    "get_model_client",
    "BaseModelClient",
    
    # Parser
    "DocumentParser",
    "ParsedDocument",
    "DocumentElement",
    
    # Decomposer
    "Decomposer",
    "DecomposedDocument",
    "AtomicRequirement",
    "Chapter",
    "Section",
    
    # Classifier
    "ExecutorClassifier",
    
    # RAG
    "RAGClient",
    "MockRAGClient",
    "QdrantVectorDB",
    "Chunk",
    "qdrant_db",
    "RAGSearcher",
    "rag_searcher",
    
    # Graph
    "KnowledgeGraphBuilder",
    "GraphNode",
    "GraphEdge",
    
    # Chat
    "DocumentChatEngine",
]
