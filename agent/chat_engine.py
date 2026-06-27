"""
Чат по содержимому загруженных документов.

Ищем релевантные чанки через rag_searcher (Qdrant), формируем
RAG-промпт и обращаемся к выбранной LLM (тот же BaseModelClient,
что используется агентом для декомпозиции).
"""
from typing import List, Dict, Any, Optional

from .models import BaseModelClient
from .rag_search import RAGSearcher, rag_searcher


SYSTEM_PROMPT = (
    "Ты — ассистент, отвечающий на вопросы по корпоративным документам. "
    "Используй ТОЛЬКО факты из приведённого контекста. "
    "Если ответа в контексте нет — честно скажи об этом. "
    "Отвечай кратко и по-русски."
)


class DocumentChatEngine:
    def __init__(
        self,
        llm_client: BaseModelClient,
        searcher: Optional[RAGSearcher] = None,
        top_k: int = 5,
        threshold: float = 0.3,
    ):
        self.llm = llm_client
        self.searcher = searcher or rag_searcher
        self.top_k = top_k
        self.threshold = threshold

    def ask(
        self,
        query: str,
        document_id: Optional[str] = None,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        filters = {"document_id": document_id} if document_id else None
        context_chunks = self.searcher.search(
            query=query,
            top_k=self.top_k,
            threshold=self.threshold,
            filters=filters,
        )

        context_text = self._format_context(context_chunks)
        history_text = self._format_history(history or [])

        prompt = (
            f"{history_text}\n\n" if history_text else ""
        ) + (
            "Контекст из документов:\n"
            f"{context_text or '(контекст пуст)'}\n\n"
            f"Вопрос: {query}\n"
            "Ответ:"
        )

        answer = self.llm.generate(prompt, system_prompt=SYSTEM_PROMPT)

        return {
            "answer": (answer or "").strip(),
            "sources": [
                {
                    "chunk_id": c.get("chunk_id", ""),
                    "content": c.get("content", ""),
                    "similarity_score": c.get("similarity_score", 0.0),
                    "document_id": c.get("document_id")
                    or c.get("metadata", {}).get("document_id", ""),
                    "source_document": c.get("metadata", {}).get("chapter_title")
                    or c.get("metadata", {}).get("document_id", "unknown"),
                }
                for c in context_chunks
            ],
        }

    @staticmethod
    def _format_context(chunks: List[Dict[str, Any]]) -> str:
        lines = []
        for i, c in enumerate(chunks, 1):
            score = c.get("similarity_score", 0.0)
            content = (c.get("content") or "").strip()
            lines.append(f"[{i}] (score={score:.2f}) {content}")
        return "\n".join(lines)

    @staticmethod
    def _format_history(history: List[Dict[str, str]]) -> str:
        if not history:
            return ""
        lines = ["История диалога:"]
        for msg in history[-6:]:
            role = "Пользователь" if msg.get("role") == "user" else "Ассистент"
            lines.append(f"{role}: {msg.get('content', '')}")
        return "\n".join(lines)
