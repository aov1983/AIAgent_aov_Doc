#!/usr/bin/env bash
# Идемпотентный bootstrap n8n-стека.
#
# Делает:
#  0. АВТО-RESTORE. Если стек поднимается с нуля (нет тома docs-n8n_postgres_data,
#     т.е. данных ещё нет) И в n8n/backups/ есть бэкап — наливает состояние из
#     последнего бэкапа (делегирует в restore.sh) ВМЕСТО чистого импорта из
#     файлов. Так свежесозданный стек получает реальные документы/графы/вектора,
#     а не пустые Data Tables. Отключается переменной BOOTSTRAP_RESTORE=off.
#     На системе с уже существующим томом данных этот путь пропускается (данные
#     не затираются) — для восстановления из бэкапа вручную: ./restore.sh latest.
#  1. Генерирует credentials/docs-postgres-cred.json при первом запуске
#     (одноразово, шифруется ключом N8N_ENCRYPTION_KEY из compose.yaml).
#  2. Поднимает compose (postgres + qdrant + qdrant-init + n8n-import-credentials
#     + n8n-import + n8n).
#  2a. (host) Поднимает headless `ollama serve` (0.0.0.0, NUM_PARALLEL=2) и
#      прогревает модель qwen3:8b с тем же num_ctx, что в pipeline — чтобы первый
#      чанк не платил за холодную загрузку модели и аллокацию KV.
#  3. После старта n8n: публикует и активирует все workflow'ы, перезапускает n8n,
#     чтобы зарегистрировались webhooks.
#  4. Smoke-тест на /webhook/files/history.
#
# Безопасен для повторного запуска. После `docker compose down -v` достаточно
# запустить этот скрипт — pipeline оживёт без ручных шагов (а при наличии бэкапа
# ещё и с восстановленными данными, см. шаг 0).

set -euo pipefail

cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"

ENCRYPTION_KEY="$(grep -E '^\s+N8N_ENCRYPTION_KEY:' compose.yaml | head -1 | awk '{print $2}')"
if [[ -z "$ENCRYPTION_KEY" ]]; then
  echo "ERROR: не нашёл N8N_ENCRYPTION_KEY в compose.yaml" >&2
  exit 1
fi

WORKFLOW_IDS=(
  # API-роутеры: каждый файл содержит несколько webhook-триггеров одного домена
  wf-api-documents   # /upload, /graph, /graph/by-document, /paragraphs, /paragraphs/by-document, /files/history
  wf-api-login       # /auth/login
  wf-api-chat        # /chat/ask, /rag/search
  wf-api-projects    # /projects (GET/POST), /projects/update, /projects/delete, /projects/assign
  # Sub-workflow'ы (executeWorkflow по id) — общие утилиты для всех роутеров
  wf-auth
  wf-rag
)

# Имя docker-compose проекта (префикс имён томов docs-n8n_*). Берём из `name:` в compose.yaml.
COMPOSE_PROJECT="$(grep -E '^name:' compose.yaml | head -1 | awk '{print $2}')"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-docs-n8n}"
BACKUPS_ROOT="$SCRIPT_DIR/backups"

# ── Ollama: headless-сервер с параллельностью + прогрев модели ───────────────
# Pipeline (нода [upload] Merge Chunks) зовёт Ollama ИЗ контейнера через
# host.docker.internal:11434 — поэтому сервер ОБЯЗАН слушать 0.0.0.0. GUI
# Ollama.app для этого не годится (слушает не на всех интерфейсах / без нашей
# параллельности), а вторая loopback-копия контейнеру вообще недоступна — на этом
# в прошлом терялось пол-дня диагностики. Здесь поднимаем ЕДИНСТВЕННЫЙ headless
# `ollama serve` (CLI-бинарь, на macOS это симлинк из Ollama.app) с:
#   OLLAMA_HOST=0.0.0.0          — доступ из docker-контейнера
#   OLLAMA_NUM_PARALLEL=2        — 2 чанка считаются параллельно (под CONC=2 в ноде)
#   OLLAMA_MAX_LOADED_MODELS=1   — одна модель, без вытеснения
# Затем прогрев: один запрос с num_ctx pipeline'а (12288) грузит модель в VRAM
# сразу с 2 слотами KV и держит её (keep_alive), чтобы первый реальный чанк был
# горячим. Блок host-специфичный (macOS) и деградирует мягко — bootstrap не
# должен падать, если Ollama недоступна. Вызывается в обоих путях (обычный
# bootstrap и авто-restore), т.к. restore.sh LLM не трогает.
warm_ollama() {
  local OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3:8b}"
  local OLLAMA_NUM_CTX="${OLLAMA_NUM_CTX:-12288}"
  local OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}"
  local OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-2}"
  local OLLAMA_API="http://127.0.0.1:11434"

  if ! command -v ollama >/dev/null 2>&1; then
    echo "[bootstrap] WARN: ollama не найден в PATH — LLM-шаги pipeline работать не будут" >&2
    return 0
  fi
  # Уже наш headless с нужным NUM_PARALLEL? — не трогаем (не сбрасываем горячую модель).
  local listener_pid
  listener_pid="$(lsof -nP -iTCP:11434 -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  if [[ -n "$listener_pid" ]] && ps eww "$listener_pid" 2>/dev/null | tr ' ' '\n' | grep -qx "OLLAMA_NUM_PARALLEL=$OLLAMA_NUM_PARALLEL"; then
    echo "[bootstrap] ollama serve уже на :11434 с NUM_PARALLEL=$OLLAMA_NUM_PARALLEL — оставляю"
  else
    echo "[bootstrap] (пере)запускаю headless ollama serve (0.0.0.0, NUM_PARALLEL=$OLLAMA_NUM_PARALLEL)…"
    pkill -f 'Ollama.app'  2>/dev/null || true   # GUI App + его serve
    pkill -f 'ollama serve' 2>/dev/null || true  # любой другой serve (напр. реальный Homebrew)
    sleep 2
    OLLAMA_HOST=0.0.0.0 OLLAMA_NUM_PARALLEL="$OLLAMA_NUM_PARALLEL" OLLAMA_MAX_LOADED_MODELS=1 \
      nohup ollama serve >/tmp/ollama_serve.log 2>&1 &
    disown
    echo -n "[bootstrap] жду ollama "
    for _ in $(seq 1 30); do
      if curl -sf "$OLLAMA_API/api/version" >/dev/null 2>&1; then echo " — готов"; break; fi
      echo -n .; sleep 1
    done
  fi

  if ! curl -sf "$OLLAMA_API/api/version" >/dev/null 2>&1; then
    echo "[bootstrap] WARN: ollama serve не поднялся — пропускаю прогрев" >&2
    return 0
  fi
  if curl -sf "$OLLAMA_API/api/tags" 2>/dev/null | grep -q "\"$OLLAMA_MODEL\""; then :; else
    echo "[bootstrap] тяну модель $OLLAMA_MODEL (первый раз — долго)…"
    ollama pull "$OLLAMA_MODEL" || echo "[bootstrap] WARN: ollama pull $OLLAMA_MODEL не удался" >&2
  fi
  echo -n "[bootstrap] прогрев $OLLAMA_MODEL (num_ctx=$OLLAMA_NUM_CTX, ${OLLAMA_NUM_PARALLEL} слота, keep_alive=$OLLAMA_KEEP_ALIVE) "
  local warm
  warm="$(curl -s --max-time 240 "$OLLAMA_API/api/generate" -H 'Content-Type: application/json' \
    -d "{\"model\":\"$OLLAMA_MODEL\",\"prompt\":\"ok\",\"stream\":false,\"keep_alive\":\"$OLLAMA_KEEP_ALIVE\",\"options\":{\"num_predict\":1,\"num_ctx\":$OLLAMA_NUM_CTX}}" \
    -o /dev/null -w '%{http_code}' || echo 000)"
  echo "→ HTTP $warm"
}

# Свежая ли установка: нет тома с данными Postgres → данных ещё нет.
# Намеренно проверяем ТОМ, а не контейнеры: `docker compose down` (без -v) убирает
# контейнеры, но данные в томе остаются — затирать их бэкапом нельзя.
is_fresh_install() {
  ! docker volume inspect "${COMPOSE_PROJECT}_postgres_data" >/dev/null 2>&1
}

# Путь к самому свежему валидному бэкапу (есть и pg-дамп, и qdrant-snapshot), либо пусто.
find_latest_backup() {
  local d
  while IFS= read -r d; do
    [[ -z "$d" ]] && continue
    d="${d%/}"
    if [[ -f "$d/postgres-n8n.dump" ]] && compgen -G "$d/qdrant-*.snapshot" >/dev/null; then
      echo "$d"; return 0
    fi
  done < <(ls -1d "$BACKUPS_ROOT"/*/ 2>/dev/null | sort -r)
  return 0
}

# ── 0. Авто-restore из бэкапа на свежей установке ─────────────────────────────
# Если данных ещё нет (свежий том) и есть бэкап — наливаем состояние из него
# вместо чистого импорта из файлов. restore.sh самодостаточен (поднимает стек
# сам) и НЕ запускает n8n-import → live-патченные воркфлоу не откатываются.
if [[ "${BOOTSTRAP_RESTORE:-auto}" != "off" ]]; then
  BACKUP_DIR="$(find_latest_backup)"
  if is_fresh_install && [[ -n "$BACKUP_DIR" ]]; then
    echo "[bootstrap] свежая установка (нет тома ${COMPOSE_PROJECT}_postgres_data) + найден бэкап:"
    echo "[bootstrap]   $BACKUP_DIR"
    echo "[bootstrap] → наливаю состояние из бэкапа (restore.sh), чистый импорт из файлов пропускаю"
    echo "[bootstrap]   (отключить авто-restore: BOOTSTRAP_RESTORE=off ./bootstrap.sh)"
    #warm_ollama   # прогреваем LLM пока/до restore — restore.sh её не трогает
    exec "$SCRIPT_DIR/restore.sh" "$BACKUP_DIR" --yes --no-safety-backup
  elif [[ -n "$BACKUP_DIR" ]]; then
    echo "[bootstrap] бэкап найден ($BACKUP_DIR), но том данных уже существует —"
    echo "[bootstrap] авто-restore пропущен (данные не затираю). Вручную: ./restore.sh latest"
  fi
fi

# ── 1. Сгенерировать недостающие credentials/*.json ───────────────────────────
# n8n шифрует credentials через CryptoJS.AES.encrypt(plain, passphrase) — это
# OpenSSL-совместимый формат ("Salted__" + MD5 KDF + AES-256-CBC + base64).
# openssl даёт ровно ту же строку, без скачивания docker-образа.
#
# id'шники зашиты в workflow JSON'ах (см. wf_api_chat.json → "credentials":
# {qdrantApi.id, openAiApi.id}); менять их без правки workflow нельзя.
mkdir -p credentials

gen_cred() {
  local file="$1" id="$2" name="$3" type="$4" plain="$5"
  if [[ -f "$file" ]]; then return 0; fi
  echo "[bootstrap] генерирую $file (одноразово)…"
  local enc
  enc="$(printf '%s' "$plain" | openssl enc -e -aes-256-cbc -md md5 -salt -pass pass:"$ENCRYPTION_KEY" -base64 -A 2>/dev/null)"
  if [[ -z "$enc" ]]; then
    echo "ERROR: openssl не вернул шифротекст для $file" >&2
    exit 1
  fi
  printf '[{"id":"%s","name":"%s","type":"%s","data":"%s"}]\n' "$id" "$name" "$type" "$enc" > "$file"
  echo "[bootstrap]   ok ($(wc -c < "$file") байт)"
}

# Postgres (legacy: остался от схемы до миграции на Data Tables, никто из
# активных workflow на него не ссылается, но import не падает — пусть лежит).
gen_cred credentials/docs-postgres-cred.json docs-postgres-cred docs-postgres postgres \
  '{"host":"postgres","port":5432,"database":"docs","user":"n8n","password":"n8n","ssl":"disable","allowUnauthorizedCerts":false}'

# OpenAI-совместимый эндпоинт для native embeddingsOpenAi-ноды → наш embeddings_service.
# id зашит в wf_api_chat.json (узлы [chat]/[ragSearch] Embeddings (bge mini)).
gen_cred credentials/docs-openai-cred.json EuaeajNRwhJNoJGB 'OpenAI account' openAiApi \
  '{"apiKey":"sk-local-embeddings","url":"http://embeddings:8100/v1"}'

# Qdrant для native vectorStoreQdrant. id зашит в wf_api_chat.json.
gen_cred credentials/docs-qdrant-cred.json 9qoVpWOyuVlu1NJu 'Qdrant account' qdrantApi \
  '{"qdrantUrl":"http://qdrant:6333","apiKey":""}'

# ── 2. compose up ─────────────────────────────────────────────────────────────
echo "[bootstrap] docker compose up -d …"
docker compose up -d

# ── 2a. Ollama: headless-сервер с параллельностью + прогрев модели ───────────
# (логика в функции warm_ollama выше — общая с путём авто-restore)
#warm_ollama

# ── 3. Дождаться готовности n8n ──────────────────────────────────────────────
echo -n "[bootstrap] жду n8n /healthz "
for _ in $(seq 1 60); do
  if curl -sf http://localhost:5678/healthz >/dev/null 2>&1; then
    echo " — готов"
    break
  fi
  echo -n .
  sleep 2
done
if ! curl -sf http://localhost:5678/healthz >/dev/null 2>&1; then
  echo
  echo "ERROR: n8n не ответил за 120 сек" >&2
  exit 1
fi

# ── 3a. Дождаться, пока n8n-import дольёт workflow'ы в БД ────────────────────
# docs-n8n-import — одноразовый контейнер, стартует параллельно с n8n. publish:workflow
# на отсутствующий id падает молча и executeWorkflow потом не находит published-версию
# (вся auth-цепочка валится: документы возвращают пустоту со статусом 200 вместо 401).
echo -n "[bootstrap] жду импорт workflow'ов "
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Status}}' docs-n8n-import 2>/dev/null || echo missing)"
  exit_code="$(docker inspect -f '{{.State.ExitCode}}' docs-n8n-import 2>/dev/null || echo 1)"
  if [[ "$status" == "exited" && "$exit_code" == "0" ]]; then
    echo " — готово"
    break
  fi
  echo -n .
  sleep 2
done
if [[ "$(docker inspect -f '{{.State.Status}}' docs-n8n-import 2>/dev/null)" != "exited" ]]; then
  echo
  echo "ERROR: docs-n8n-import не завершился за 120 сек" >&2
  exit 1
fi

# ── 4. Publish + activate workflows ──────────────────────────────────────────
# Без published-версии executeWorkflow (source=database) бросает "Workflow is not
# active and cannot be executed" — даже если workflow помечен как active. Поэтому
# любой сбой publish'а здесь делает pipeline нерабочим, и `|| true` тут недопустим.
echo "[bootstrap] publish + activate workflows…"
for id in "${WORKFLOW_IDS[@]}"; do
  if ! docker exec docs-n8n n8n publish:workflow --id="$id" >/dev/null 2>&1; then
    echo "ERROR: publish:workflow --id=$id упал" >&2
    exit 1
  fi
done
docker exec docs-postgres psql -U n8n -d n8n -c "UPDATE workflow_entity SET active=true;" >/dev/null

# ── 5. Restart n8n, чтобы зарегистрировались webhooks ────────────────────────
echo "[bootstrap] restart n8n…"
docker restart docs-n8n >/dev/null
# Сначала ждём /healthz (HTTP-сервер поднялся), потом ждём регистрации webhook'ов:
# n8n активирует workflow'ы асинхронно ПОСЛЕ старта сервера, поэтому /healthz=200
# ещё не означает, что webhook'и работают. Опрашиваем /webhook/auth/login —
# когда он перестаёт давать 404, остальные тоже почти всегда уже зарегистрированы.
for _ in $(seq 1 60); do
  if curl -sf http://localhost:5678/healthz >/dev/null 2>&1; then break; fi
  sleep 2
done
echo -n "[bootstrap] жду регистрации webhook'ов "
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:5678/webhook/auth/login -H 'Content-Type: application/json' -d '{}' || true)"
  if [[ "$code" != "404" && -n "$code" ]]; then
    echo " — готово"
    break
  fi
  echo -n .
  sleep 2
done

# ── 6. Smoke-тест ────────────────────────────────────────────────────────────
echo
echo "── smoke ──"
NO_AUTH="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5678/webhook/files/history)"
echo "GET /webhook/files/history (no auth)     → $NO_AUTH (ожидаем 401)"
OK="$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer architect' http://localhost:5678/webhook/files/history)"
echo "GET /webhook/files/history (architect)   → $OK (ожидаем 200)"
LOGIN="$(curl -s -X POST http://localhost:5678/webhook/auth/login -H 'Content-Type: application/json' -d '{"username":"architect","password":"admin"}' -o /dev/null -w '%{http_code}')"
echo "POST /webhook/auth/login (architect) → $LOGIN (ожидаем 200)"

if [[ "$NO_AUTH" == "401" && "$OK" == "200" && "$LOGIN" == "200" ]]; then
  echo
  echo "✓ pipeline жив"
else
  echo
  echo "✗ что-то не так — смотрите docker logs docs-n8n" >&2
  exit 1
fi
