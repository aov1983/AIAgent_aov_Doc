from typing import List, Dict, Any, Optional

class DocumentChatEngine:
    def __init__(self, rag_client=None, llm_client=None):
        self.rag = rag_client
        self.llm = llm_client
        self.history: List[Dict[str, str]] = []

    def ask(self, query: str, doc_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Задает вопрос по документу, используя RAG для поиска контекста.
        """
        # 1. Поиск контекста в RAG
        context_chunks = []
        if self.rag:
            context_chunks = self.rag.search(query, doc_id=doc_id, limit=3)
        
        context_text = "\n".join([c.get('text', '') for c in context_chunks]) if context_chunks else "Контекст не найден."

        # 2. Формирование промпта
        prompt = f"Используя следующий контекст из документа, ответь на вопрос пользователя.\nКонтекст:\n{context_text}\n\nВопрос: {query}"
        
        # 3. Генерация ответа
        answer = "Это демо-ответ. Подключите реальную LLM для генерации." 
        if self.llm:
            answer = self.llm.generate(prompt)

        self.history.append({"role": "user", "content": query})
        self.history.append({"role": "assistant", "content": answer})

        return {
            "answer": answer,
            "sources": context_chunks,
            "history": self.history
        }
