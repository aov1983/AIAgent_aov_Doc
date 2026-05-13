from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

router = APIRouter(prefix="/chat", tags=["Document Chat"])

class ChatRequest(BaseModel):
    message: str
    doc_id: Optional[str] = None

class ChatResponse(BaseModel):
    answer: str
    sources: List[Dict[str, Any]]
    confidence: float

@router.post("/ask", response_model=ChatResponse)
async def ask_document_question(request: ChatRequest):
    """
    Позволяет пользователю задавать вопросы по содержимому загруженного документа.
    Использует RAG для поиска релевантных фрагментов.
    """
    # Здесь должна быть интеграция с DocumentChatEngine
    return ChatResponse(
        answer=f"Ответ ИИ на вопрос: '{request.message}' (Требуется подключение RAG/LLM)",
        sources=[{"text": "Пример найденного фрагмента...", "score": 0.95}],
        confidence=0.95
    )
