#!/usr/bin/env bash
# Логический бэкап состояния n8n-стека:
#   - Postgres (БД n8n: workflow'ы, credentials, owner/webhook, Data Tables — включая
#     сами docx в job_files.file_b64), БЕЗ истории прогонов (execution_*/insights_*).
#   - Qdrant snapshot коллекции docs_chunks (вектора).
# Восстановление: ./restore.sh. Подробности и ограничения: ./BACKUP.md.
#
#   ./backup.sh [--label NAME]
#
# Артефакт: n8n/backups/<YYYYMMDD-HHMMSS>[_NAME]/{postgres-n8n.dump, qdrant-docs_chunks.snapshot, manifest.json}
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-docs-postgres}"
QDRANT_CONTAINER="${QDRANT_CONTAINER:-docs-qdrant}"
N8N_CONTAINER="${N8N_CONTAINER:-docs-n8n}"
QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
COLLECTION="${QDRANT_COLLECTION_NAME:-docs_chunks}"
PG_USER="${PG_USER:-n8n}"
PG_DB="${PG_DB:-n8n}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUPS_ROOT="$SCRIPT_DIR/backups"

# Таблицы истории прогонов — ИСКЛЮЧАЕМ их ДАННЫЕ (схему сохраняем, иначе n8n при старте
# не найдёт ожидаемые таблицы). Исключаем ВСЕ 8, иначе остаются битые FK между ними.
EXCLUDE_TABLES=(
  execution_entity execution_data execution_metadata
  execution_annotations execution_annotation_tags
  insights_raw insights_by_period insights_metadata
)

die() { echo "ERROR: $*" >&2; exit 1; }
running() { [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" == "true" ]]; }

LABEL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="${2:-}"; shift 2 ;;
    --label=*) LABEL="${1#*=}"; shift ;;
    -h|--help) echo "usage: backup.sh [--label NAME]"; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

running "$PG_CONTAINER" || die "контейнер $PG_CONTAINER не запущен"
running "$QDRANT_CONTAINER" || die "контейнер $QDRANT_CONTAINER не запущен"
command -v jq >/dev/null || die "нужен jq"

TS="$(date +%Y%m%d-%H%M%S)"
DIRNAME="$TS"; [[ -n "$LABEL" ]] && DIRNAME="${TS}_${LABEL}"
DEST="$BACKUPS_ROOT/$DIRNAME"
mkdir -p "$DEST"
echo "[backup] → $DEST"

# ── 1. Postgres (custom-format, без execution_*/insights_*) ──────────────────
echo "[backup] pg_dump БД $PG_DB (без истории прогонов)…"
EXCL_ARGS=()
for t in "${EXCLUDE_TABLES[@]}"; do EXCL_ARGS+=(--exclude-table-data="public.$t"); done
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc "${EXCL_ARGS[@]}" -f /tmp/n8n.dump
docker cp "$PG_CONTAINER:/tmp/n8n.dump" "$DEST/postgres-n8n.dump"
docker exec "$PG_CONTAINER" rm -f /tmp/n8n.dump

# ── 2. Qdrant snapshot (создаём через API и выносим наружу — он лежит в томе, ───
#       который restore сносит) ────────────────────────────────────────────────
echo "[backup] Qdrant snapshot коллекции ${COLLECTION}…"
SNAP_NAME="$(curl -sfX POST "$QDRANT_URL/collections/$COLLECTION/snapshots" | jq -r '.result.name')"
[[ -n "$SNAP_NAME" && "$SNAP_NAME" != "null" ]] || die "не удалось создать Qdrant snapshot"
curl -sf "$QDRANT_URL/collections/$COLLECTION/snapshots/$SNAP_NAME" -o "$DEST/qdrant-$COLLECTION.snapshot" \
  || die "не удалось скачать snapshot $SNAP_NAME"
# не копим снапшоты в томе qdrant
curl -sfX DELETE "$QDRANT_URL/collections/$COLLECTION/snapshots/$SNAP_NAME" >/dev/null 2>&1 || true

# ── 3. Манифест (версии, checksums, counts для сверки при restore) ────────────
echo "[backup] манифест…"
psql_scalar() { docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -A -c "$1" 2>/dev/null | tr -d '[:space:]'; }

GIT_COMMIT="$(git -C "$SCRIPT_DIR/.." rev-parse HEAD 2>/dev/null || echo unknown)"
N8N_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$N8N_CONTAINER" 2>/dev/null || echo unknown)"
PG_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$PG_CONTAINER" 2>/dev/null || echo unknown)"
QDRANT_VERSION="$(curl -sf "$QDRANT_URL/" | jq -r '.version' 2>/dev/null || echo unknown)"
# exact count, а не collections/<c>.result.points_count: последний — приблизительная сумма
# по сегментам (включая ещё не вычищенные tombstone'ы и точки, продублированные между
# сегментами), её значение зависит от того, успел ли отработать оптимизатор. exact count даёт
# детерминированное число уникальных точек — иначе сверка с restore --verify даёт ложный ⚠.
POINTS="$(curl -sf -X POST "$QDRANT_URL/collections/$COLLECTION/points/count" -H 'Content-Type: application/json' -d '{"exact":true}' | jq -r '.result.count' 2>/dev/null || echo null)"

# Counts по Data Tables: логическое имя (из реестра data_table) → строки физической data_table_user_<id>.
DT_JSON="{}"
while IFS='|' read -r name pid; do
  [[ -z "$name" ]] && continue
  # Имя физической таблицы — mixed-case, n8n создаёт его в кавычках → обращаемся тоже в кавычках,
  # иначе Postgres свернёт в lowercase ("relation does not exist"). || cnt=0 — на случай отсутствия.
  cnt="$(psql_scalar "SELECT count(*) FROM \"data_table_user_$pid\";")" || cnt=0
  DT_JSON="$(jq -c --arg n "$name" --argjson c "${cnt:-0}" '. + {($n): $c}' <<<"$DT_JSON")"
done < <(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -A -F'|' -c "SELECT name, id FROM data_table;" 2>/dev/null)

WF_COUNT="$(psql_scalar "SELECT count(*) FROM workflow_entity;")"
DT_COUNT="$(psql_scalar "SELECT count(*) FROM data_table;")"
WH_COUNT="$(psql_scalar "SELECT count(*) FROM webhook_entity;")"

PG_SHA="$(shasum -a 256 "$DEST/postgres-n8n.dump" | awk '{print $1}')"
QD_SHA="$(shasum -a 256 "$DEST/qdrant-$COLLECTION.snapshot" | awk '{print $1}')"

jq -n \
  --arg ts "$TS" --arg git "$GIT_COMMIT" \
  --arg n8n "$N8N_IMAGE" --arg pg "$PG_IMAGE" --arg qd "$QDRANT_VERSION" \
  --arg coll "$COLLECTION" \
  --arg pg_sha "$PG_SHA" --arg qd_sha "$QD_SHA" \
  --arg pg_file "postgres-n8n.dump" --arg qd_file "qdrant-$COLLECTION.snapshot" \
  --argjson wf "${WF_COUNT:-0}" --argjson dt "${DT_COUNT:-0}" --argjson wh "${WH_COUNT:-0}" \
  --argjson points "${POINTS:-null}" --argjson dts "$DT_JSON" \
  '{
    timestamp: $ts,
    git_commit: $git,
    images: { n8n: $n8n, postgres: $pg, qdrant: $qd },
    qdrant_collection: $coll,
    files: { postgres: $pg_file, qdrant: $qd_file },
    checksums: { postgres: $pg_sha, qdrant: $qd_sha },
    counts: { workflow_entity: $wf, data_table: $dt, webhook_entity: $wh, qdrant_points: $points, data_tables: $dts }
  }' > "$DEST/manifest.json"

echo "[backup] готово:"
du -h "$DEST"/* | sed 's/^/  /'
echo "[backup] counts: workflow_entity=$WF_COUNT data_table=$DT_COUNT webhook_entity=$WH_COUNT qdrant_points=$POINTS"
echo "[backup] restore:  ./restore.sh $DIRNAME   (проверка без сноса прода: ./restore.sh $DIRNAME --verify)"
