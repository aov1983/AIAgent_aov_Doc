FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/.cache/huggingface \
    SENTENCE_TRANSFORMERS_HOME=/app/.cache/sentence_transformers \
    EMBEDDINGS_MODEL=paraphrase-multilingual-MiniLM-L12-v2 \
    EMBEDDINGS_DIM=384

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

# Прогреваем модель на этапе сборки, чтобы при старте контейнера не качать ~470 МБ.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')"

COPY main.py .

EXPOSE 8100

HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=20s \
    CMD curl -fsS http://127.0.0.1:8100/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]
