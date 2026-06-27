#!/usr/bin/env bash
# End-to-end smoke-тест n8n-пайплайна.
#
# Прогоняет цепочку: login → upload → /graph (job+doc) →
# /paragraphs (job+doc) → /files/history → /rag/search → /chat/ask.
#
# Зависимости: curl, jq. Стек должен быть поднят (см. n8n/bootstrap.sh).
# Для шагов RAG/Chat нужны embeddings_service (8100) и Ollama (11434) — если их
# нет, эти шаги пропускаются с пометкой SKIP, остальной отчёт остаётся валидным.
#
# Запуск:
#   ./n8n/tests/e2e.sh
# Не идёт через bootstrap по умолчанию, чтобы не блокировать локальную разработку
# при каждом compose up; вызывать руками.

set -euo pipefail

BASE="${N8N_BASE_URL:-http://localhost:5678}"
USERNAME="${TEST_USERNAME:-architect}"
PASSWORD="${TEST_PASSWORD:-admin}"
EMBEDDINGS_URL="${EMBEDDINGS_URL:-http://localhost:8100/embed}"
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434/api/tags}"

# Цвета + счётчики.
GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; NC=$'\033[0m'
PASS=0; FAIL=0; SKIP=0
ok()   { PASS=$((PASS + 1)); printf "  ${GREEN}✓${NC} %s\n" "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf "  ${RED}✗${NC} %s${2:+\n     ${RED}└─${NC} $2}\n" "$1" "${2:-}"; }
skip() { SKIP=$((SKIP + 1)); printf "  ${YELLOW}∘${NC} %s ${YELLOW}(skip: %s)${NC}\n" "$1" "$2"; }
step() { printf "\n${BOLD}── %s ──${NC}\n" "$1"; }

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: нужен '$1' в PATH" >&2; exit 1; }
}
require curl
require jq

# Удобный wrapper: запрашиваем URL, складываем тело в файл, отдаём http-код.
# Использование:  code=$(http_get_auth /webhook/files/history /tmp/out.json)
http_get_auth() {
  local path="$1" outfile="$2"
  curl -s -o "$outfile" -w '%{http_code}' \
    -H "Authorization: Bearer ${TOKEN:-}" \
    "${BASE}${path}"
}
http_get_noauth() {
  local path="$1" outfile="$2"
  curl -s -o "$outfile" -w '%{http_code}' "${BASE}${path}"
}
http_post_json() {
  local path="$1" body="$2" outfile="$3"
  curl -s -o "$outfile" -w '%{http_code}' \
    -H "Authorization: Bearer ${TOKEN:-}" \
    -H 'Content-Type: application/json' \
    -d "$body" \
    "${BASE}${path}"
}

# ── 0. Подготовка тестового документа ───────────────────────────────────────
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
DOC_PATH="$TMP_DIR/e2e_doc.md"
RUN_ID="$(date +%s)_$RANDOM"
DOC_TITLE="E2E Тест ${RUN_ID}"
# Заметные маркеры в содержимом нужны, чтобы потом проверить RAG/Chat-ответы.
MARKER="резервное копирование PostgreSQL ${RUN_ID}"
cat >"$DOC_PATH" <<EOF
# ${DOC_TITLE}

## Требования к резервному копированию

Система обязана выполнять ежедневное ${MARKER} в защищённое хранилище S3.
Срок хранения резервных копий — 90 дней, после чего они автоматически удаляются.

Восстановление из резервной копии должно занимать не более 30 минут на 100 ГБ данных.

## Требования к мониторингу

Мониторинг должен покрывать CPU, RAM, диск и сетевой трафик каждого сервиса.
При превышении 80% использования CPU должно отправляться уведомление в Slack.
EOF

# ── 1. Auth ─────────────────────────────────────────────────────────────────
step "1. Authentication"

# 1a. Невалидный логин → 401.
out="$TMP_DIR/login_bad.json"
code=$(curl -s -o "$out" -w '%{http_code}' \
  -X POST "${BASE}/webhook/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"nobody","password":"wrong"}')
[[ "$code" == "401" ]] && ok "POST /auth/login (bad creds) → 401" \
  || bad "POST /auth/login (bad creds) → $code (ожидался 401)" "$(head -c 200 "$out")"

# 1b. Валидный логин → 200 + token.
out="$TMP_DIR/login.json"
code=$(curl -s -o "$out" -w '%{http_code}' \
  -X POST "${BASE}/webhook/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")
if [[ "$code" == "200" ]]; then
  TOKEN=$(jq -r '.access_token // empty' "$out")
  ROLE=$(jq -r '.role // empty' "$out")
  [[ -n "$TOKEN" ]] && ok "POST /auth/login (${USERNAME}) → 200, role=${ROLE}, token=${TOKEN:0:10}…" \
    || { bad "login: пустой access_token" "$(cat "$out")"; exit 1; }
else
  bad "POST /auth/login → $code" "$(cat "$out")"; exit 1
fi

# 1c. /files/history без auth → 401.
out="$TMP_DIR/docs_noauth.json"
code=$(http_get_noauth /webhook/files/history "$out")
[[ "$code" == "401" ]] && ok "GET /files/history (no auth) → 401" \
  || bad "GET /files/history (no auth) → $code (ожидался 401)" "$(head -c 200 "$out")"

# ── 2. Upload ───────────────────────────────────────────────────────────────
step "2. POST /upload"
out="$TMP_DIR/upload.json"
code=$(curl -s -o "$out" -w '%{http_code}' \
  -X POST "${BASE}/webhook/upload" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "file=@${DOC_PATH};type=text/markdown")
if [[ "$code" == "200" ]]; then
  JOB_ID=$(jq -r '.job_id // empty' "$out")
  DOC_ID=$(jq -r '.document_id // empty' "$out")
  TOTAL=$(jq -r '.total_requirements // 0' "$out")
  if [[ -n "$JOB_ID" && -n "$DOC_ID" ]]; then
    ok "upload → job_id=${JOB_ID:0:8}…, document_id=${DOC_ID:0:8}…, total_requirements=${TOTAL}"
  else
    bad "upload: пустые job_id/document_id" "$(cat "$out")"; exit 1
  fi
else
  bad "POST /upload → $code" "$(head -c 400 "$out")"; exit 1
fi

# ── 3. /files/history — наш upload должен быть в списке ────────────────────
step "3. GET /files/history (document_id)"
out="$TMP_DIR/documents.json"
code=$(http_get_auth /webhook/files/history "$out")
if [[ "$code" == "200" ]] && jq -e --arg id "$DOC_ID" '.[] | select(.document_id == $id)' "$out" >/dev/null; then
  count=$(jq 'length' "$out")
  ok "GET /files/history → 200, ${count} док., наш document_id найден"
else
  bad "GET /files/history → $code, наш document_id не найден" "$(head -c 400 "$out")"
fi

# ── 4. /graph (по job_id) и /graph/by-document ──────────────────────────────
step "4. GET /graph"
for variant in "by-job:${BASE}/webhook/graph?job_id=${JOB_ID}" \
               "by-doc:${BASE}/webhook/graph/by-document?document_id=${DOC_ID}"; do
  label="${variant%%:*}"; url="${variant#*:}"
  out="$TMP_DIR/graph_${label}.json"
  code=$(curl -s -o "$out" -w '%{http_code}' -H "Authorization: Bearer ${TOKEN}" "$url")
  if [[ "$code" == "200" ]] && jq -e '.nodes and .edges and .stats' "$out" >/dev/null; then
    n=$(jq '.nodes | length' "$out")
    e=$(jq '.edges | length' "$out")
    p=$(jq '.stats.paragraphs // 0' "$out")
    ok "graph (${label}) → nodes=${n}, edges=${e}, stats.paragraphs=${p}"
  else
    bad "graph (${label}) → $code или нет nodes/edges/stats" "$(head -c 400 "$out")"
  fi
done

# ── 5. /paragraphs (по job_id) и /paragraphs/by-document ────────────────────
step "5. GET /paragraphs"
for variant in "by-job:${BASE}/webhook/paragraphs?job_id=${JOB_ID}" \
               "by-doc:${BASE}/webhook/paragraphs/by-document?document_id=${DOC_ID}"; do
  label="${variant%%:*}"; url="${variant#*:}"
  out="$TMP_DIR/paragraphs_${label}.json"
  code=$(curl -s -o "$out" -w '%{http_code}' -H "Authorization: Bearer ${TOKEN}" "$url")
  if [[ "$code" == "200" ]] && jq -e 'type == "array" and length > 0' "$out" >/dev/null; then
    rows=$(jq 'length' "$out")
    has_marker=$(jq --arg m "$MARKER" '[.[] | select(.paragraph_text | test($m; "i"))] | length' "$out")
    if [[ "$has_marker" -ge 1 ]]; then
      ok "paragraphs (${label}) → ${rows} строк, маркер в тексте найден"
    else
      bad "paragraphs (${label}) → ${rows} строк, но маркер не найден в paragraph_text"
    fi
  else
    bad "paragraphs (${label}) → $code или пустой массив" "$(head -c 400 "$out")"
  fi
done

# ── 6. /files/history ───────────────────────────────────────────────────────
step "6. GET /files/history"
out="$TMP_DIR/files.json"
code=$(http_get_auth /webhook/files/history "$out")
if [[ "$code" == "200" ]] && jq -e '[.[] | select(.filename | test("e2e_doc"))] | length > 0' "$out" >/dev/null; then
  ok "files/history → e2e_doc.md в истории"
else
  bad "files/history → $code или нашего файла нет" "$(head -c 400 "$out")"
fi

# ── 8. /rag/search (нужен embeddings_service) ───────────────────────────────
step "8. GET /rag/search"
if ! curl -sf -o /dev/null -m 2 -X POST "$EMBEDDINGS_URL" \
       -H 'Content-Type: application/json' -d '{"texts":["ping"]}'; then
  skip "GET /rag/search" "embeddings_service не отвечает на ${EMBEDDINGS_URL}"
else
  # Даём индексу секунду осесть после upload (Qdrant .upsert wait=true,
  # но search всё равно может опередить consistency на больших дозах).
  sleep 1
  out="$TMP_DIR/rag.json"
  q="резервное копирование PostgreSQL"
  code=$(http_get_auth "/webhook/rag/search?query=$(printf %s "$q" | jq -sRr @uri)&threshold=0.3" "$out")
  if [[ "$code" == "200" ]] && jq -e 'type == "array" and length > 0' "$out" >/dev/null; then
    rows=$(jq 'length' "$out")
    top_score=$(jq '[.[].similarity_score] | max' "$out")
    has_our=$(jq --arg id "$DOC_ID" '[.[] | select(.metadata.document_id == $id)] | length' "$out")
    if [[ "$has_our" -ge 1 ]]; then
      ok "rag/search '${q}' → ${rows} матчей, top=${top_score}, наш документ присутствует"
    else
      bad "rag/search → ${rows} матчей, top=${top_score}, но нашего document_id среди них нет"
    fi
  else
    bad "rag/search → $code или пустой массив" "$(head -c 400 "$out")"
  fi
fi

# ── 9. /chat/ask (нужны embeddings_service + Ollama) ────────────────────────
step "9. POST /chat/ask"
if ! curl -sf -o /dev/null -m 2 -X POST "$EMBEDDINGS_URL" \
       -H 'Content-Type: application/json' -d '{"texts":["ping"]}'; then
  skip "POST /chat/ask" "embeddings_service не отвечает"
elif ! curl -sf -o /dev/null -m 2 "$OLLAMA_URL"; then
  skip "POST /chat/ask" "Ollama не отвечает на ${OLLAMA_URL}"
else
  out="$TMP_DIR/chat.json"
  q="Сколько дней должны храниться резервные копии и как часто их делать?"
  body=$(jq -nc --arg m "$q" --arg d "$DOC_ID" '{message:$m, history:[], document_id:$d}')
  code=$(http_post_json /webhook/chat/ask "$body" "$out")
  if [[ "$code" == "200" ]]; then
    answer=$(jq -r '.answer // ""' "$out")
    src_count=$(jq '.sources | length' "$out")
    if [[ -n "$answer" && "$answer" != "(пустой ответ)" ]]; then
      # Сверяем что LLM хоть как-то задействовал контекст: упомянул цифры из документа.
      matched=0
      echo "$answer" | grep -qE '90|девяносто' && matched=$((matched + 1))
      echo "$answer" | grep -qiE 'ежедневн|кажд' && matched=$((matched + 1))
      if [[ "$matched" -ge 1 ]]; then
        ok "chat/ask → ${src_count} sources, ответ содержит факты из документа (matched=${matched}/2)"
      else
        bad "chat/ask → ${src_count} sources, но ответ не упоминает 90 дней / ежедневно: $(echo "$answer" | head -c 200)"
      fi
    else
      bad "chat/ask → пустой ответ" "$(head -c 400 "$out")"
    fi
  else
    bad "chat/ask → $code" "$(head -c 400 "$out")"
  fi
fi

# ── Итог ────────────────────────────────────────────────────────────────────
echo
printf "${BOLD}Итог:${NC} ${GREEN}%d passed${NC}, ${RED}%d failed${NC}, ${YELLOW}%d skipped${NC}\n" \
  "$PASS" "$FAIL" "$SKIP"
[[ "$FAIL" -eq 0 ]] || exit 1
