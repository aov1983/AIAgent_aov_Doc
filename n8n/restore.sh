#!/usr/bin/env bash
# Восстановление состояния n8n-стека из бэкапа (см. ./backup.sh, ./BACKUP.md).
#
#   ./restore.sh <backup-dir>|latest [--yes] [--no-safety-backup] [--allow-downgrade]
#       полное восстановление: down -v → pg_restore → Qdrant recover → поднять рантайм.
#       ДЕСТРУКТИВНО (сносит текущие тома). Требует подтверждения 'yes' (или --yes).
#       --allow-downgrade — снять version-guard и разрешить накат бэкапа n8n-версии ≠ compose.
#       Безопасно ТОЛЬКО для проверенного downgrade 2.22.2→2.21.2 (схема 2.22 несёт лишь
#       7 аддитивных «будущих» миграций; 2.21.2 их игнорирует и не падает — проверено smoke'ом).
#
#   ./restore.sh <backup-dir>|latest --verify
#       безопасная проверка восстановимости: разворачивает дамп во временную БД и snapshot
#       в коллекцию-двойник, сверяет counts, прибирает за собой. Прод НЕ трогает.
#
# <backup-dir> — имя папки внутри n8n/backups/ или абсолютный путь; 'latest' = самый свежий.
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-docs-postgres}"
QDRANT_CONTAINER="${QDRANT_CONTAINER:-docs-qdrant}"
N8N_CONTAINER="${N8N_CONTAINER:-docs-n8n}"
QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
N8N_URL="${N8N_URL:-http://localhost:5678}"
COLLECTION="${QDRANT_COLLECTION_NAME:-docs_chunks}"
PG_USER="${PG_USER:-n8n}"
PG_DB="${PG_DB:-n8n}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUPS_ROOT="$SCRIPT_DIR/backups"
# По умолчанию работаем с боевым compose.yaml. Переопределяется COMPOSE_FILE — например,
# для проверки наката на изолированном тестовом стеке (compose.test.yaml, project test-n8n):
#   PG_CONTAINER=test-postgres QDRANT_CONTAINER=test-qdrant N8N_CONTAINER=test-n8n \
#     COMPOSE_FILE=compose.test.yaml ./restore.sh latest --yes --no-safety-backup
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/compose.yaml}"
COMPOSE=(docker compose -f "$COMPOSE_FILE")

die() { echo "ERROR: $*" >&2; exit 1; }
running() { [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" == "true" ]]; }

wait_healthy() { # $1=container $2=iters(×2s)
  local c="$1" n="${2:-60}"
  for _ in $(seq 1 "$n"); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" == "healthy" ]] && return 0
    sleep 2
  done
  return 1
}

# Восстановить snapshot в коллекцию $1 из локального файла $2.
# Основной путь — recover через file-location (надёжно для крупных снапшотов; снапшот сам
# разворачивает коллекцию). Fallback — multipart upload.
qdrant_recover() {
  local coll="$1" file="$2" resp
  docker exec "$QDRANT_CONTAINER" mkdir -p /qdrant/snapshots >/dev/null 2>&1 || true
  docker cp "$file" "$QDRANT_CONTAINER:/qdrant/snapshots/$coll.snapshot"
  resp="$(curl -s -X PUT "$QDRANT_URL/collections/$coll/snapshots/recover" \
    -H 'Content-Type: application/json' \
    -d "{\"location\":\"file:///qdrant/snapshots/$coll.snapshot\",\"priority\":\"snapshot\"}")"
  if [[ "$(jq -r '.result // empty' <<<"$resp" 2>/dev/null)" == "true" ]]; then return 0; fi
  echo "[restore] recover не удался ($resp) — fallback на multipart upload" >&2
  resp="$(curl -s -X PUT "$QDRANT_URL/collections/$coll/snapshots/upload?priority=snapshot" -F "snapshot=@$file")"
  [[ "$(jq -r '.result // empty' <<<"$resp" 2>/dev/null)" == "true" ]] || die "Qdrant restore не удался: $resp"
}

# Точное число уникальных точек коллекции $1, устойчивое к «прогреву» после recover.
# Сразу после snapshot recover один и тот же point-id физически лежит в нескольких сегментах
# (старая удалённая версия + новая), и даже exact count завышен, пока оптимизатор их не сольёт
# (~секунды). .result.points_count из collections/<c> завышен ещё сильнее и до истинного значения
# вообще не сходится. Поэтому поллим exact count, пока два замера подряд не совпадут (или таймаут).
qdrant_exact_count() {
  local coll="$1" prev="" cur=""
  for _ in $(seq 1 20); do
    cur="$(curl -sf -X POST "$QDRANT_URL/collections/$coll/points/count" \
      -H 'Content-Type: application/json' -d '{"exact":true}' | jq -r '.result.count' 2>/dev/null || echo '?')"
    [[ "$cur" != "?" && "$cur" == "$prev" ]] && { echo "$cur"; return 0; }
    prev="$cur"; sleep 2
  done
  echo "$cur"
}

# ── parse args ───────────────────────────────────────────────────────────────
TARGET=""; ASSUME_YES=0; SAFETY=1; VERIFY=0; ALLOW_DOWNGRADE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1; shift ;;
    --no-safety-backup) SAFETY=0; shift ;;
    --allow-downgrade) ALLOW_DOWNGRADE=1; shift ;;
    --verify) VERIFY=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    -*) die "unknown arg: $1" ;;
    *) TARGET="$1"; shift ;;
  esac
done
[[ -n "$TARGET" ]] || die "укажите каталог бэкапа или 'latest'"
command -v jq >/dev/null || die "нужен jq"

# resolve target dir
if [[ "$TARGET" == "latest" ]]; then
  TARGET="$(ls -1d "$BACKUPS_ROOT"/*/ 2>/dev/null | sort | tail -1)"
  [[ -n "$TARGET" ]] || die "в $BACKUPS_ROOT нет бэкапов"
elif [[ ! -d "$TARGET" && -d "$BACKUPS_ROOT/$TARGET" ]]; then
  TARGET="$BACKUPS_ROOT/$TARGET"
fi
TARGET="${TARGET%/}"
[[ -d "$TARGET" ]] || die "каталог не найден: $TARGET"

PG_DUMP="$TARGET/postgres-n8n.dump"
QD_SNAP="$TARGET/qdrant-$COLLECTION.snapshot"
MANIFEST="$TARGET/manifest.json"
[[ -f "$PG_DUMP" ]] || die "нет файла: $PG_DUMP"
[[ -f "$QD_SNAP" ]] || die "нет файла: $QD_SNAP"
echo "[restore] источник: $TARGET"
# Примечание: running-проверки контейнеров перенесены в VERIFY-ветку. FULL-restore
# самодостаточен (down -v → up -d postgres qdrant) и работает на свежей системе,
# где контейнеров ещё нет — этим путём пользуется bootstrap.sh для авто-наката.

# ── checksum verify (если есть манифест) ─────────────────────────────────────
if [[ -f "$MANIFEST" ]]; then
  want_pg="$(jq -r '.checksums.postgres' "$MANIFEST")"
  want_qd="$(jq -r '.checksums.qdrant' "$MANIFEST")"
  got_pg="$(shasum -a 256 "$PG_DUMP" | awk '{print $1}')"
  got_qd="$(shasum -a 256 "$QD_SNAP" | awk '{print $1}')"
  [[ "$want_pg" == "null" || "$want_pg" == "$got_pg" ]] || die "checksum postgres-дампа не совпал (повреждён?)"
  [[ "$want_qd" == "null" || "$want_qd" == "$got_qd" ]] || die "checksum qdrant-snapshot не совпал (повреждён?)"
  echo "[restore] checksums OK"
fi

# ═══════════════════════ VERIFY MODE (недеструктивно) ════════════════════════
if [[ "$VERIFY" == "1" ]]; then
  echo "[verify] проверка восстановимости — прод (БД $PG_DB, коллекция $COLLECTION) НЕ трогаем"
  # verify работает с ЖИВЫМ прод-стеком (временная БД/коллекция рядом) — контейнеры обязаны быть подняты.
  running "$PG_CONTAINER" || die "контейнер $PG_CONTAINER не запущен (нужен для --verify)"
  running "$QDRANT_CONTAINER" || die "контейнер $QDRANT_CONTAINER не запущен (нужен для --verify)"
  VDB="n8n_verify_$$"
  VCOLL="${COLLECTION}_verify_$$"

  # Гарантированная уборка временной БД/коллекции даже при падении на полпути.
  cleanup_verify() {
    docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "DROP DATABASE IF EXISTS $VDB;" >/dev/null 2>&1 || true
    curl -sX DELETE "$QDRANT_URL/collections/$VCOLL" >/dev/null 2>&1 || true
    docker exec "$PG_CONTAINER" rm -f /tmp/verify.dump >/dev/null 2>&1 || true
    # qdrant_recover копирует снапшот в том qdrant (/qdrant/snapshots/<coll>.snapshot) — без этой
    # уборки каждый verify оставлял бы там ~67 МБ-файл-двойник.
    docker exec "$QDRANT_CONTAINER" rm -f "/qdrant/snapshots/$VCOLL.snapshot" >/dev/null 2>&1 || true
  }
  trap cleanup_verify EXIT

  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "DROP DATABASE IF EXISTS $VDB;" >/dev/null
  docker exec "$PG_CONTAINER" createdb -U "$PG_USER" "$VDB"
  docker cp "$PG_DUMP" "$PG_CONTAINER:/tmp/verify.dump"
  # без --single-transaction: в свежей БД возможны безобидные NOTICE — нам важны counts
  docker exec "$PG_CONTAINER" pg_restore -U "$PG_USER" --no-owner --no-acl -d "$VDB" /tmp/verify.dump >/dev/null 2>&1 || true
  vwf="$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$VDB" -t -A -c 'SELECT count(*) FROM workflow_entity;' 2>/dev/null | tr -d '[:space:]')"
  vdt="$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$VDB" -t -A -c 'SELECT count(*) FROM data_table;' 2>/dev/null | tr -d '[:space:]')"
  docker exec "$PG_CONTAINER" rm -f /tmp/verify.dump
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "DROP DATABASE IF EXISTS $VDB;" >/dev/null
  echo "[verify] Postgres → workflow_entity=$vwf data_table=$vdt"

  qdrant_recover "$VCOLL" "$QD_SNAP"
  # стабилизированный exact count (не .result.points_count, который после recover завышен и до
  # истинного значения не сходится). qdrant_exact_count поллит, пока счётчик не устаканится.
  vpts="$(qdrant_exact_count "$VCOLL")"
  curl -sX DELETE "$QDRANT_URL/collections/$VCOLL" >/dev/null
  echo "[verify] Qdrant → points=$vpts"

  if [[ -f "$MANIFEST" ]]; then
    mwf="$(jq -r '.counts.workflow_entity' "$MANIFEST")"
    mpts="$(jq -r '.counts.qdrant_points' "$MANIFEST")"
    echo "[verify] манифест → workflow_entity=$mwf qdrant_points=$mpts"
    [[ "$vwf" == "$mwf" ]] && echo "[verify] ✓ workflow_entity сходится" || echo "[verify] ⚠ workflow_entity расходится ($vwf ≠ $mwf)"
    [[ "$vpts" == "$mpts" ]] && echo "[verify] ✓ qdrant_points сходится" || echo "[verify] ⚠ qdrant_points расходится ($vpts ≠ $mpts)"
  fi
  echo "[verify] ✓ дамп и snapshot восстановимы"
  exit 0
fi

# ═══════════════════════ FULL RESTORE (деструктивно) ═════════════════════════
# Guard версий: restore надёжен только на той же версии n8n (иначе TypeORM-миграции).
if [[ -f "$MANIFEST" ]]; then
  want_n8n="$(jq -r '.images.n8n' "$MANIFEST")"
  # head -1: один и тот же образ n8nio/n8n стоит у нескольких сервисов (n8n, n8n-import,
  # n8n-import-credentials) — без него cur_n8n становится многострочным и сравнение всегда ложно.
  cur_n8n="$(grep -E '^\s*image:\s*n8nio/n8n' "$COMPOSE_FILE" | head -1 | awk '{print $2}')"
  if [[ "$want_n8n" != "unknown" && -n "$cur_n8n" && "$want_n8n" != "$cur_n8n" ]]; then
    if [[ "$ALLOW_DOWNGRADE" == "1" ]]; then
      echo "[restore] ⚠ версия n8n в бэкапе ($want_n8n) ≠ в $COMPOSE_FILE ($cur_n8n) — --allow-downgrade задан, продолжаю"
    else
      die "версия n8n в бэкапе ($want_n8n) ≠ в $COMPOSE_FILE ($cur_n8n) — риск миграций, прерываю (см. --allow-downgrade)"
    fi
  fi
  want_qd="$(jq -r '.images.qdrant' "$MANIFEST")"
  # На свежей системе qdrant ещё не запущен → cur_qd=unknown; не поднимаем ложную тревогу.
  cur_qd="$(curl -sf "$QDRANT_URL/" | jq -r '.version' 2>/dev/null || echo unknown)"
  if [[ "$want_qd" != "unknown" && "$cur_qd" != "unknown" && "$want_qd" != "$cur_qd" ]]; then
    echo "[restore] ⚠ версия Qdrant в бэкапе ($want_qd) ≠ текущая ($cur_qd) — snapshot может не подняться"
  fi
fi

echo
echo "⚠  ПОЛНОЕ ВОССТАНОВЛЕНИЕ сотрёт текущее состояние: docker compose down -v"
echo "   (postgres_data + qdrant_data + n8n_data) и накатит бэкап из:"
echo "   $TARGET"
if [[ "$ASSUME_YES" != "1" ]]; then
  printf "   Продолжить? введите 'yes': "
  read -r ans
  [[ "$ans" == "yes" ]] || die "отменено пользователем"
fi

# Safety-backup текущего состояния (на случай отката).
if [[ "$SAFETY" == "1" ]]; then
  echo "[restore] safety-backup текущего состояния…"
  "$SCRIPT_DIR/backup.sh" --label "pre-restore" || echo "[restore] ⚠ safety-backup не удался — продолжаю"
fi

echo "[restore] docker compose down -v…"
"${COMPOSE[@]}" down -v

echo "[restore] поднимаю postgres + qdrant…"
"${COMPOSE[@]}" up -d postgres qdrant
wait_healthy "$PG_CONTAINER" 60 || die "postgres не стал healthy"
wait_healthy "$QDRANT_CONTAINER" 30 || die "qdrant не стал healthy"

echo "[restore] pg_restore (атомарно, без истории прогонов)…"
docker cp "$PG_DUMP" "$PG_CONTAINER:/tmp/restore.dump"
docker exec "$PG_CONTAINER" pg_restore \
  --clean --if-exists --no-owner --no-acl --single-transaction \
  -U "$PG_USER" -d "$PG_DB" /tmp/restore.dump
docker exec "$PG_CONTAINER" rm -f /tmp/restore.dump

echo "[restore] Qdrant recover коллекции ${COLLECTION}…"
qdrant_recover "$COLLECTION" "$QD_SNAP"

# Поднимаем ТОЛЬКО рантайм. НЕ запускаем n8n-import/n8n-activate: import:workflow перезаписал
# бы восстановленные из БД (авторитетные, с live-патчами) воркфлоу старыми версиями из файлов
# workflows/*.json и деактивировал бы их. credentials восстановлены из дампа (тот же ключ шифрования).
echo "[restore] поднимаю рантайм (embeddings, docling, n8n) без import/activate…"
"${COMPOSE[@]}" up -d postgres qdrant embeddings docling n8n
wait_healthy "$N8N_CONTAINER" 60 || die "n8n не стал healthy"

# Data Tables из бэкапа могут быть СТАРЕЕ текущего кода: бэкап не знает о колонках, добавленных
# позже в data_tables_bootstrap.mjs (напр. config.api_key/base_url/docling_url). syncColumns в нём
# аддитивен — только ДОБАВЛЯЕТ недостающие колонки, ничего не сносит, значения и строки не трогает
# (config-сиды — insert-if-absent). Поэтому безопасен после restore и лечит «после восстановления
# нет новых колонок». БЕЗ этого шага схема остаётся на уровне бэкапа и dataTable-ноды/UI их не видят.
echo "[restore] синхронизирую схему Data Tables под текущий код (аддитивно)…"
"${COMPOSE[@]}" run --rm --no-deps n8n-data-table-init \
  || echo "[restore] ⚠ data-table-init не отработал — проверьте колонки таблиц вручную"

# publish:workflow публикует версию ИЗ восстановленной БД (не из файлов) — без published-версии
# executeWorkflow для sub-workflow'ов (wf_auth и пр.) падает "not active and cannot be executed".
# Затем restart, чтобы n8n зарегистрировал webhook'и (как в bootstrap.sh).
echo "[restore] publish workflow'ов из БД + restart для регистрации webhook'ов…"
while IFS= read -r id; do
  [[ -z "$id" ]] && continue
  docker exec "$N8N_CONTAINER" n8n publish:workflow --id="$id" >/dev/null 2>&1 || true
done < <(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -A -c "SELECT id FROM workflow_entity;" 2>/dev/null)
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "UPDATE workflow_entity SET active=true;" >/dev/null
docker restart "$N8N_CONTAINER" >/dev/null

for _ in $(seq 1 60); do curl -sf "$N8N_URL/healthz" >/dev/null 2>&1 && break; sleep 2; done
echo -n "[restore] жду регистрации webhook'ов "
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$N8N_URL/webhook/auth/login" -H 'Content-Type: application/json' -d '{}' || true)"
  [[ "$code" != "404" && -n "$code" ]] && { echo " — готово"; break; }
  echo -n .; sleep 2
done

# ── smoke + сверка ───────────────────────────────────────────────────────────
echo; echo "── smoke ──"
NO_AUTH="$(curl -s -o /dev/null -w '%{http_code}' "$N8N_URL/webhook/files/history")"
OK="$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer architect' "$N8N_URL/webhook/files/history")"
LOGIN="$(curl -s -X POST "$N8N_URL/webhook/auth/login" -H 'Content-Type: application/json' -d '{"username":"architect","password":"admin"}' -o /dev/null -w '%{http_code}')"
echo "GET /webhook/files/history (no auth)   → $NO_AUTH (ожидаем 401)"
echo "GET /webhook/files/history (architect) → $OK (ожидаем 200)"
echo "POST /webhook/auth/login (architect)   → $LOGIN (ожидаем 200)"

PTS="$(qdrant_exact_count "$COLLECTION")"
if [[ -f "$MANIFEST" ]]; then
  echo "[restore] Qdrant points=$PTS (в манифесте: $(jq -r '.counts.qdrant_points' "$MANIFEST"))"
else
  echo "[restore] Qdrant points=$PTS"
fi

if [[ "$NO_AUTH" == "401" && "$OK" == "200" && "$LOGIN" == "200" ]]; then
  echo; echo "✓ восстановление завершено, pipeline жив"
else
  echo
  echo "✗ smoke не прошёл. Ремонт: если webhook'и дают 404 —"
  echo "  docker compose -f $SCRIPT_DIR/compose.yaml up n8n-activate   (НЕ n8n-import!)"
  echo "  Логи: docker logs $N8N_CONTAINER" >&2
  exit 1
fi
