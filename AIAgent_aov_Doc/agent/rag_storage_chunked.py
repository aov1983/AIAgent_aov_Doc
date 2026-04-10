from typing import List, Dict, Any

class ChunkedRAG:
    def save_chunks(self, doc_id: str, chunks: List[str]):
        print(f"Saving {len(chunks)} chunks for {doc_id} to Qdrant")
    
    def search_chunks(self, query: str, threshold: float = 0.5):
        print(f"Searching chunks for: {query}")
        return []
