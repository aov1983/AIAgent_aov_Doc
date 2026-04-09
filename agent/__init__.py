"""
AI Agent for Requirements Analysis

Агент для автоматизации анализа неформализованных документов,
декомпозиции на атомарные единицы знаний и сохранения в базу знаний (RAG/Graph).
"""

from .core import RequirementsAgent
from .models import ModelProvider, ModelConfig
from .parser import DocumentParser
from .decomposer import Decomposer
from .classifier import ExecutorClassifier
from .rag_client import RAGClient

__version__ = "1.0.0"
__all__ = [
    "RequirementsAgent",
    "ModelProvider",
    "ModelConfig",
    "DocumentParser",
    "Decomposer",
    "ExecutorClassifier",
    "RAGClient",
]
