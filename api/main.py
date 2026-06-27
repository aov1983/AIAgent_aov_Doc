"""
FastAPI Backend for AI Architect Agent.
Serves as REST API interface for React Frontend.
"""
import os
import json
import shutil
import uuid
import logging
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
import uvicorn

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logging.getLogger("llm.exchange").setLevel(logging.INFO)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Import Core Agent Logic
import sys
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from agent.core import RequirementsAgent
from agent.chat_engine import DocumentChatEngine
from agent.models import ModelConfig, ModelProvider
from api.chat_api import router as chat_router, chat_state


def _build_model_configs() -> list[ModelConfig]:
    """Собирает список ModelConfig из переменных окружения.

    Поддерживаемые ACTIVE_MODEL: openai_gpt4 | anthropic_claude3 | google_gemini | llama3
    Для Ollama используйте ACTIVE_MODEL=llama3 + LLAMA3_BASE_URL/LLAMA3_MODEL_NAME.
    """
    active = os.getenv("ACTIVE_MODEL", "openai_gpt4").lower()
    provider_map = {
        "openai_gpt4": ModelProvider.OPENAI_GPT4,
        "anthropic_claude3": ModelProvider.ANTHROPIC_CLAUDE3,
        "google_gemini": ModelProvider.GOOGLE_GEMINI,
        "llama3": ModelProvider.LLAMA3,
    }
    provider = provider_map.get(active, ModelProvider.OPENAI_GPT4)

    if provider == ModelProvider.LLAMA3:
        return [ModelConfig(
            provider=provider,
            api_key=os.getenv("LLAMA3_API_KEY", "ollama"),
            base_url=os.getenv("LLAMA3_BASE_URL", "http://localhost:11434/v1"),
            model_name=os.getenv("LLAMA3_MODEL_NAME", "qwen3:8b"),
        )]
    if provider == ModelProvider.OPENAI_GPT4:
        return [ModelConfig(
            provider=provider,
            api_key=os.getenv("OPENAI_API_KEY", ""),
            base_url=os.getenv("OPENAI_BASE_URL") or None,
            model_name=os.getenv("OPENAI_MODEL") or None,
        )]
    if provider == ModelProvider.ANTHROPIC_CLAUDE3:
        return [ModelConfig(
            provider=provider,
            api_key=os.getenv("ANTHROPIC_API_KEY", ""),
            model_name=os.getenv("ANTHROPIC_MODEL") or None,
        )]
    return [ModelConfig(
        provider=provider,
        api_key=os.getenv("GOOGLE_API_KEY", ""),
        model_name=os.getenv("GOOGLE_MODEL") or None,
    )]

# In-memory результаты обработки документов (для возврата графа/абзацев по job_id).
# В проде заменить на БД/Redis.
JOBS: dict[str, dict] = {}

# Файловое хранилище графов знаний по document_id (живёт между рестартами API).
GRAPHS_DIR = os.path.join("uploads", "graphs")


def _persist_graph(
    document_id: str,
    title: str,
    filename: str,
    graph: dict,
    paragraphs: list,
    total_requirements: int,
) -> None:
    """Сохраняет граф документа в uploads/graphs/{document_id}.json."""
    if not document_id or document_id == "unknown":
        return
    os.makedirs(GRAPHS_DIR, exist_ok=True)
    payload = {
        "document_id": document_id,
        "title": title,
        "filename": filename,
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "total_requirements": total_requirements,
        "graph": graph or {"nodes": [], "edges": [], "stats": {}},
        "paragraphs": paragraphs or [],
    }
    path = os.path.join(GRAPHS_DIR, f"{document_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _load_graph(document_id: str) -> Optional[dict]:
    path = os.path.join(GRAPHS_DIR, f"{document_id}.json")
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

app = FastAPI(title="AI Architect Agent API", version="1.0.0")

# CORS Configuration (Allow React Frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"], # Dev & Prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

# In-memory user store for demo (Replace with DB in production)
USERS_DB = {
    "architect": {"password": "admin", "role": "Архитектор"},
    "analyst": {"password": "admin", "role": "Аналитик"},
    "admin": {"password": "admin", "role": "Администратор"},
    "devops": {"password": "admin", "role": "DevOps РП"},
}

# Initialize Agent
USE_MOCK_RAG = os.getenv("USE_MOCK_RAG", "true").lower() in ("1", "true", "yes")
agent = RequirementsAgent(
    model_configs=_build_model_configs(),
    use_mock_rag=USE_MOCK_RAG,
)

# Чат по документам поверх того же LLM и Qdrant.
chat_state.engine = DocumentChatEngine(llm_client=agent.primary_model)

# --- Schemas ---
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    username: str

class LoginRequest(BaseModel):
    username: str
    password: str

class AnalysisResponse(BaseModel):
    job_id: str
    status: str
    message: str
    report_url: Optional[str] = None
    document_id: Optional[str] = None

class RagSearchResult(BaseModel):
    chunk_id: str
    content: str
    similarity_score: float
    source_document: str
    metadata: dict

# --- Dependencies ---
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    # Simple token validation (In prod use JWT)
    # For demo: token is username
    if token not in USERS_DB:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    return {"username": token, "role": USERS_DB[token]["role"]}

# --- Endpoints ---

@app.post("/api/auth/login", response_model=Token)
async def login(request: LoginRequest):
    user = USERS_DB.get(request.username)
    if not user or user["password"] != request.password:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # In production, generate JWT here. For demo, return username as token.
    return Token(access_token=request.username, role=user["role"], username=request.username)

@app.post("/api/upload", response_model=AnalysisResponse)
async def upload_document(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """Upload document and start analysis"""
    allowed_roles = ["Архитектор", "Администратор", "Аналитик", "DevOps РП"]
    if current_user["role"] not in allowed_roles:
        raise HTTPException(status_code=403, detail="Role not allowed")

    save_dir = "uploads"
    os.makedirs(save_dir, exist_ok=True)
    
    file_path = os.path.join(save_dir, f"{uuid.uuid4()}_{file.filename}")
    
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Маппинг роли API → роль агента (ALLOWED_ROLES в agent/core.py)
        role_map = {
            "Архитектор": "Архитектор",
            "Администратор": "Администратор",
            "Аналитик": "Аналитик DevOps РП",
            "DevOps РП": "Аналитик DevOps РП",
        }
        agent_role = role_map.get(current_user["role"], "Архитектор")
        # Start Analysis (Synchronous for now, should be async task in prod)
        result = agent.process_document(file_path, user_role=agent_role)

        job_id = str(uuid.uuid4())
        JOBS[job_id] = {
            "document_id": result.document_id,
            "title": result.title,
            "report": result.report,
            "graph": result.graph,
            "paragraphs": result.paragraphs,
            "total_requirements": result.total_requirements,
            "errors": result.errors,
            "warnings": result.warnings,
        }

        if not result.errors:
            try:
                _persist_graph(
                    document_id=result.document_id,
                    title=result.title,
                    filename=file.filename or "unknown",
                    graph=result.graph,
                    paragraphs=result.paragraphs,
                    total_requirements=result.total_requirements,
                )
            except Exception as exc:
                logging.warning("Не удалось сохранить граф документа %s: %s", result.document_id, exc)

        return AnalysisResponse(
            job_id=job_id,
            status="completed" if not result.errors else "failed",
            message=result.report[:500] if result.report else "Document analyzed successfully",
            report_url=f"/api/reports/{job_id}",
            document_id=result.document_id,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/reports/{job_id}")
async def get_report(job_id: str, current_user: dict = Depends(get_current_user)):
    """Get analysis report by job ID."""
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job_id,
        "title": job["title"],
        "content": job["report"],
        "total_requirements": job["total_requirements"],
        "warnings": job["warnings"],
        "errors": job["errors"],
    }


@app.get("/api/graph/{job_id}")
async def get_graph(job_id: str, current_user: dict = Depends(get_current_user)):
    """Собственный граф знаний, построенный из декомпозированного документа (не Qdrant)."""
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.get("graph") or {"nodes": [], "edges": [], "stats": {}}


@app.get("/api/paragraphs/{job_id}")
async def get_paragraphs(job_id: str, current_user: dict = Depends(get_current_user)):
    """Таблица результата LLM с метаданными по каждому абзацу."""
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.get("paragraphs") or []


@app.get("/api/documents")
async def list_documents(current_user: dict = Depends(get_current_user)):
    """Список документов с сохранённым графом знаний (uploads/graphs/*.json)."""
    if not os.path.isdir(GRAPHS_DIR):
        return []
    items = []
    for name in os.listdir(GRAPHS_DIR):
        if not name.endswith(".json"):
            continue
        path = os.path.join(GRAPHS_DIR, name)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        stats = (data.get("graph") or {}).get("stats") or {}
        items.append({
            "document_id": data.get("document_id") or name[:-5],
            "title": data.get("title") or "",
            "filename": data.get("filename") or "",
            "saved_at": data.get("saved_at") or "",
            "total_requirements": data.get("total_requirements", 0),
            "stats": {
                "total_nodes": stats.get("total_nodes", 0),
                "total_edges": stats.get("total_edges", 0),
                "paragraphs": stats.get("paragraphs", 0),
                "chunks": stats.get("chunks", 0),
            },
        })
    items.sort(key=lambda x: x["saved_at"], reverse=True)
    return items


@app.get("/api/graph/by-document/{document_id}")
async def get_graph_by_document(document_id: str, current_user: dict = Depends(get_current_user)):
    """Граф знаний, сохранённый на диск для указанного document_id."""
    data = _load_graph(document_id)
    if not data:
        raise HTTPException(status_code=404, detail="Graph for document not found")
    return data.get("graph") or {"nodes": [], "edges": [], "stats": {}}


@app.get("/api/paragraphs/by-document/{document_id}")
async def get_paragraphs_by_document(document_id: str, current_user: dict = Depends(get_current_user)):
    """Таблица абзацев документа, сохранённая на диск."""
    data = _load_graph(document_id)
    if not data:
        raise HTTPException(status_code=404, detail="Document not found")
    return data.get("paragraphs") or []

@app.get("/api/rag/search")
async def search_rag(
    query: str,
    threshold: float = 0.5,
    exclude_document_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Search for similar requirements in RAG"""
    try:
        results = agent.search_in_rag(query, limit=10)
        return [
            {
                "chunk_id": r.get("id", "unknown"),
                "content": r.get("content", ""),
                "similarity_score": r.get("similarity_score", 0.0),
                "source_document": r.get("metadata", {}).get("chapter_title")
                                   or r.get("metadata", {}).get("document_id", "unknown"),
                "metadata": r.get("metadata", {})
            }
            for r in results
            if r.get("similarity_score", 0.0) >= threshold
            and (
                not exclude_document_id
                or r.get("metadata", {}).get("document_id") != exclude_document_id
            )
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/files/history")
async def get_file_history(current_user: dict = Depends(get_current_user)):
    """Get list of processed files from uploads/ directory."""
    from datetime import datetime
    uploads_dir = "uploads"
    if not os.path.isdir(uploads_dir):
        return []

    items = []
    for name in os.listdir(uploads_dir):
        path = os.path.join(uploads_dir, name)
        if not os.path.isfile(path) or name.startswith("."):
            continue

        # Имена сохраняются как "<uuid>_<original_filename>" (см. /api/upload).
        # Отрезаем UUID-префикс для отображения.
        display_name = name.split("_", 1)[1] if "_" in name else name
        file_id = name.split("_", 1)[0] if "_" in name else name

        mtime = datetime.fromtimestamp(os.path.getmtime(path))
        items.append({
            "id": file_id,
            "filename": display_name,
            "date": mtime.strftime("%Y-%m-%d"),
            "status": "completed",
        })

    items.sort(key=lambda x: x["date"], reverse=True)
    return items

app.include_router(chat_router, dependencies=[Depends(get_current_user)])


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
