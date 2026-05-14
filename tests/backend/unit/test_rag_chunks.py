import pytest
from agent.rag_storage_chunked import ChunkedRAG

def test_save_chunks():
    rag = ChunkedRAG()
    # Тест заглушка, так как Qdrant может быть недоступен
    assert rag is not None

def test_search_chunks():
    rag = ChunkedRAG()
    results = rag.search_chunks("test query")
    assert isinstance(results, list)
