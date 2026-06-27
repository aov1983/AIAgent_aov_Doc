"""
Тонкая HTTP-обёртка над sentence-transformers, которую n8n зовёт через HTTP Request.

Зачем существует:
  В n8n есть нативные Embeddings-ноды (Ollama / OpenAI), но они дают другую модель,
  чем уже залитые в Qdrant вектора. Этот сервис фиксирует одну модель
  (paraphrase-multilingual-MiniLM-L12-v2, 384 dim, мультиязычная) и держит её
  совместимой с коллекцией docs_chunks.

Запуск:
  В составе n8n/compose.yaml (сервис `embeddings`) — поднимается автоматически.
  Локально для отладки:
    uvicorn n8n.embeddings_service.main:app --host 0.0.0.0 --port 8100

API:
  GET  /health                                → { "status": "ok", "model": "...", "dim": 384 }
  POST /embed   { "texts": ["...", "..."] }   → { "vectors": [[...], [...]] }
  POST /similar { "a": [...], "b": [...] }    → { "score": 0.87 }
  POST /v1/embeddings                          → OpenAI-совместимый формат для нативных
                                                 нод n8n (embeddingsOpenAi). См. ниже.
"""
import base64
import logging
import math
import os
import struct
from typing import List, Union

from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL_NAME = os.getenv("EMBEDDINGS_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")
DIMENSION = int(os.getenv("EMBEDDINGS_DIM", "384"))

logger = logging.getLogger("docs-embeddings")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="docs-embeddings", version="1.1.0")

logger.info("Загрузка модели %s…", MODEL_NAME)
_model = SentenceTransformer(MODEL_NAME)
logger.info("Модель загружена. dim=%s", DIMENSION)


class EmbedRequest(BaseModel):
    texts: List[str]


class EmbedResponse(BaseModel):
    vectors: List[List[float]]


class SimilarityRequest(BaseModel):
    a: List[float]
    b: List[float]


class SimilarityResponse(BaseModel):
    score: float


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL_NAME, "dim": DIMENSION}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    if not req.texts:
        return EmbedResponse(vectors=[])
    arr = _model.encode(req.texts, convert_to_numpy=True)
    return EmbedResponse(vectors=arr.tolist())


@app.post("/similar", response_model=SimilarityResponse)
def similar(req: SimilarityRequest) -> SimilarityResponse:
    if len(req.a) != len(req.b) or not req.a:
        return SimilarityResponse(score=0.0)
    dot = sum(x * y for x, y in zip(req.a, req.b))
    na = math.sqrt(sum(x * x for x in req.a))
    nb = math.sqrt(sum(y * y for y in req.b))
    return SimilarityResponse(score=0.0 if na == 0 or nb == 0 else float(dot / (na * nb)))


# --- OpenAI-совместимый эндпоинт ---------------------------------------------
# Native n8n-нода `@n8n/n8n-nodes-langchain.embeddingsOpenAi` (через openAiApi
# credential с baseURL=http://embeddings:8100/v1) ходит сюда вместо OpenAI.
# Параметр `model` игнорируем — модель зафиксирована в сервисе.
class OpenAIEmbeddingsRequest(BaseModel):
    input: Union[str, List[str]]
    model: str | None = None
    encoding_format: str | None = None  # ignored — отдаём всегда float-массивы
    dimensions: int | None = None       # ignored — модель фикс. (384)
    user: str | None = None             # ignored


@app.post("/v1/embeddings")
def openai_embeddings(req: OpenAIEmbeddingsRequest) -> dict:
    texts = [req.input] if isinstance(req.input, str) else list(req.input)
    arr = _model.encode(texts, convert_to_numpy=True) if texts else []
    # LangChain.js OpenAI-клиент (@langchain/openai) по умолчанию шлёт
    # encoding_format='base64' ради экономии трафика — массив float'ов вернёт
    # 96-мерный вектор вместо 384 после "декодирования", Qdrant потом 400.
    # OpenAI-спецификация: 'float' → list[float], 'base64' → base64(le float32).
    use_base64 = (req.encoding_format or "").lower() == "base64"
    data = []
    for i, v in enumerate(arr):
        vec = v.tolist()
        if use_base64:
            packed = struct.pack(f"<{len(vec)}f", *vec)
            embedding = base64.b64encode(packed).decode("ascii")
        else:
            embedding = vec
        data.append({"object": "embedding", "index": i, "embedding": embedding})
    total = sum(len(t.split()) for t in texts)
    return {
        "object": "list",
        "data": data,
        "model": req.model or MODEL_NAME,
        "usage": {"prompt_tokens": total, "total_tokens": total},
    }
