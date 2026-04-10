"""
FastAPI Backend for AI Architect Agent.
Serves as REST API interface for React Frontend.
"""
import os
import shutil
import uuid
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
import uvicorn

# Import Core Agent Logic
import sys
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from agent.core import ArchitectAgent
from agent.config import Config

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
agent = ArchitectAgent()

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
        
        # Start Analysis (Synchronous for now, should be async task in prod)
        result = agent.process_document(file_path, user_role=current_user["role"])
        
        job_id = str(uuid.uuid4())
        return AnalysisResponse(
            job_id=job_id,
            status="completed",
            message="Document analyzed successfully",
            report_url=f"/api/reports/{job_id}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/reports/{job_id}")
async def get_report(job_id: str, current_user: dict = Depends(get_current_user)):
    """Get analysis report by job ID"""
    # Mock implementation - in real app fetch from DB/File system
    return {
        "job_id": job_id,
        "content": "# Report Content\nAnalysis completed...",
        "chunks": []
    }

@app.get("/api/rag/search")
async def search_rag(
    query: str,
    threshold: float = 0.5,
    current_user: dict = Depends(get_current_user)
):
    """Search for similar requirements in RAG"""
    try:
        results = agent.search_similar(query, threshold=threshold)
        return [
            {
                "chunk_id": r.get("id", "unknown"),
                "content": r.get("content", ""),
                "similarity_score": r.get("score", 0.0),
                "source_document": r.get("source", "unknown"),
                "metadata": r.get("metadata", {})
            }
            for r in results
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/files/history")
async def get_file_history(current_user: dict = Depends(get_current_user)):
    """Get list of processed files"""
    return [
        {"id": "1", "filename": "requirements_v1.docx", "date": "2023-10-25", "status": "completed"},
        {"id": "2", "filename": "architecture_draft.pdf", "date": "2023-10-24", "status": "completed"},
    ]

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
