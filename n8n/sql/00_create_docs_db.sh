#!/bin/bash
# Запускается образом postgres при первом старте контейнера (см. docker-entrypoint-initdb.d).
# Создаёт прикладную БД docs; схему накатывает следующий файл 10_schema.sql, но ему нужно
# выполниться в БД docs, а не в n8n — поэтому используем psql -d docs через ON_ERROR_STOP=1.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<-EOSQL
    SELECT 'CREATE DATABASE docs'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'docs')\gexec
EOSQL

# Применяем schema.sql в БД docs (файл смонтирован отдельно, не в initdb.d).
psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname docs -f /sql/schema.sql
