import pytest
from agent.rag_storage_chunked import ChunkedRAGStorage

def test_save_chunks():
    rag = ChunkedRAGStorage()
    chunks = [{"text": "Chunk 1"}, {"text": "Chunk 2"}]
    count = rag.save_chunks("doc1", chunks, {})
    assert count == 2

def test_search():
    rag = ChunkedRAGStorage()
    res = rag.search_similar_chunks("query")
    assert isinstance(res, list)
