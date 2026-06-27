-- Postgres схема для n8n-версии AIAgent_docs_Doc.
-- Заменяет:
--   * api/main.py:USERS_DB           → таблица users
--   * api/main.py:JOBS dict          → таблица jobs
--   * uploads/graphs/*.json          → таблица graphs
--   * uploads/<uuid>_<filename>      → таблица uploads (бинари в S3, тут только метаданные)

CREATE TABLE IF NOT EXISTS users (
    username   TEXT PRIMARY KEY,
    password   TEXT NOT NULL,          -- demo, в проде заменить на bcrypt-хеш
    role       TEXT NOT NULL,          -- 'Архитектор' | 'Аналитик' | 'Администратор' | 'DevOps РП'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO users (username, password, role) VALUES
    ('architect', 'admin', 'Архитектор'),
    ('analyst',   'admin', 'Аналитик'),
    ('admin',     'admin', 'Администратор'),
    ('devops',    'admin', 'DevOps РП')
ON CONFLICT (username) DO NOTHING;

CREATE TABLE IF NOT EXISTS uploads (
    id          UUID PRIMARY KEY,
    filename    TEXT NOT NULL,
    storage_key TEXT NOT NULL,         -- ключ в S3/MinIO
    uploaded_by TEXT REFERENCES users(username),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status      TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS jobs (
    job_id              UUID PRIMARY KEY,
    document_id         TEXT NOT NULL,
    title               TEXT,
    report              TEXT,
    total_requirements  INT  DEFAULT 0,
    errors              JSONB DEFAULT '[]'::jsonb,
    warnings            JSONB DEFAULT '[]'::jsonb,
    payload             JSONB NOT NULL,   -- {graph, paragraphs, metadata}
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_document_id ON jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at  ON jobs(created_at DESC);

-- graphs: переживает рестарт, ключ по document_id (как uploads/graphs/{document_id}.json).
CREATE TABLE IF NOT EXISTS graphs (
    document_id         TEXT PRIMARY KEY,
    title               TEXT,
    filename            TEXT,
    total_requirements  INT DEFAULT 0,
    graph               JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[],"stats":{}}'::jsonb,
    paragraphs          JSONB NOT NULL DEFAULT '[]'::jsonb,
    saved_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_graphs_saved_at ON graphs(saved_at DESC);
