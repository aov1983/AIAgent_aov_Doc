"""
Роутер чата по документам. Использует DocumentChatEngine,
который инициализируется в api/main.py и пробрасывается сюда
через chat_state.engine. Аутентификация навешивается в main.py
на уровне include_router(dependencies=[Depends(get_current_user)]).
"""
from typing import List, Optional, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/chat", tags=["Document Chat"])


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    document_id: Optional[str] = None
    history: List[ChatMessage] = []


class ChatSource(BaseModel):
    chunk_id: str
    content: str
    similarity_score: float
    document_id: Optional[str] = ""
    source_document: Optional[str] = ""


class ChatResponse(BaseModel):
    answer: str
    sources: List[ChatSource]


class _ChatState:
    engine: Any = None


chat_state = _ChatState()


@router.post("/ask", response_model=ChatResponse)
async def ask_document_question(request: ChatRequest):
    """Задать вопрос по документу. Если document_id передан — поиск
    ограничивается чанками этого документа, иначе по всей базе."""
    if chat_state.engine is None:
        raise HTTPException(status_code=503, detail="Chat engine not initialized")

    try:
        result = chat_state.engine.ask(
            query=request.message,
            document_id=request.document_id,
            history=[m.model_dump() for m in request.history],
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return ChatResponse(
        answer=result.get("answer", ""),
        sources=[ChatSource(**s) for s in result.get("sources", [])],
    )
