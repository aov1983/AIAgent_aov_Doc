// Генератор workflows/wf_api_architecture.json — REST-роутер «Архитектуры проекта».
//
// Фича: на основе RAG-контекста документов проекта LLM ВЫВОДИТ архитектуру целевой системы
// (стек, ключевые решения) + две C4-диаграммы (Context + Container) в нотации Mermaid.
// Результат кешируется в Data-Table project_architecture; кнопка «Обновить» перегенерирует.
//
// Два эндпоинта:
//   GET  /projects/architecture?project_id=…   — отдать сохранённое (или {status:'none'})
//   POST /projects/architecture/generate {project_id} — собрать контекст, вызвать LLM, сохранить
//
// Прецеденты (см. CLAUDE.md / память):
//  • Каркас эндпоинта Webhook→Auth(wf-auth)→If Auth OK(→0 бизнес / →1 Respond 401)→…→Respond и
//    хелперы dt*/code/respond — один-в-один из build_wf_api_projects.mjs.
//  • LLM-провайдер — ТОТ ЖЕ, что при обработке документов: читаем строку config(llm_extraction)
//    нодой [gen] Get LLM Config (dataTable, без self-HTTP),
//    ветвление ollama/claude/develonica/lmstudio + _withRetry/stripJson скопированы из
//    wf_api_documents.json → [upload] Merge Chunks (узел callLLM).
//  • RAG по НАБОРУ документов проекта — через includeDocumentIds (расширение wf_rag.json).
//  • Большой JS нод пишем как настоящие функции и сериализуем .toString() (funcBody) — чтобы не
//    экранировать \n/кавычки/бэктики руками в JSON (источник ошибок в рукописном workflow JSON).
//
// Запуск:  node build_wf_api_architecture.mjs   →  пишет workflows/wf_api_architecture.json
// Деплой:  N8N_URL=… N8N_OWNER_EMAIL=… N8N_OWNER_PASSWORD=… node deploy_workflow_live.mjs workflows/wf_api_architecture.json
// Хранилище: Data-Table project_architecture должна существовать (см. create_project_architecture_table.mjs).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Тело функции как код Code-ноды: всё между первой { и последней }. Функции БЕЗ аргументов,
// поэтому первая { — это открытие тела. Внутри можно свободно писать шаблонные строки и regex.
const funcBody = (fn) => {
  const s = fn.toString();
  return s.slice(s.indexOf('{') + 1, s.lastIndexOf('}')).trim();
};

// ── Шаблоны-хелперы нод (портированы из build_wf_api_projects.mjs) ─────────────
const webhook = (prefix, method, path, webhookId) => ({
  parameters: {
    httpMethod: method,
    path,
    responseMode: 'responseNode',
    options: { allowedOrigins: '*' },
  },
  id: `${prefix}-webhook`,
  name: `${prefix} Webhook`,
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2,
  position: [0, 0],
  webhookId,
});

const auth = (prefix) => ({
  parameters: {
    workflowId: { __rl: true, value: 'wf-auth', mode: 'id' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {},
      matchingColumns: [],
      schema: [],
      attemptToConvertTypes: false,
      convertFieldsToString: true,
    },
    options: {},
  },
  id: `${prefix}-auth`,
  name: `${prefix} Auth`,
  type: 'n8n-nodes-base.executeWorkflow',
  typeVersion: 1.2,
  position: [0, 0],
});

const ifAuth = (prefix) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: 'ok',
          leftValue: '={{ $json._http_code }}',
          rightValue: 200,
          operator: { type: 'number', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
  id: `${prefix}-if`,
  name: `${prefix} If Auth OK`,
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [0, 0],
});

const respond = (prefix) => ({
  parameters: {
    respondWith: 'text',
    responseBody: '={{ JSON.stringify($json._body !== undefined ? $json._body : null) }}',
    options: {
      responseCode: '={{ $json._http_code }}',
      responseHeaders: {
        entries: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
      },
    },
  },
  id: `${prefix}-respond`,
  name: `${prefix} Respond`,
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  position: [0, 0],
});

const code = (prefix, suffix, jsCode) => ({
  parameters: { jsCode },
  id: `${prefix}-${suffix}`.replace(/\s+/g, '-'),
  name: `${prefix} ${suffix}`,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [0, 0],
  alwaysOutputData: true,
});

const dtGet = (prefix, suffix, table, conditions = [], extra = {}) => ({
  parameters: {
    operation: 'get',
    dataTableId: { __rl: true, mode: 'name', value: table },
    matchType: 'allConditions',
    filters: { conditions },
    returnAll: true,
    ...extra,
  },
  id: `${prefix}-${suffix}`.replace(/\s+/g, '-'),
  name: `${prefix} ${suffix}`,
  type: 'n8n-nodes-base.dataTable',
  typeVersion: 1,
  position: [0, 0],
  alwaysOutputData: true,
});

const dtUpsert = (prefix, suffix, table, matchKey, filterValueExpr, valueMap) => ({
  parameters: {
    operation: 'upsert',
    dataTableId: { __rl: true, mode: 'name', value: table },
    matchType: 'allConditions',
    filters: { conditions: [{ keyName: matchKey, keyValue: filterValueExpr }] },
    columns: {
      mappingMode: 'defineBelow',
      value: valueMap,
      matchingColumns: [matchKey],
      schema: [],
    },
    options: {},
  },
  id: `${prefix}-${suffix}`.replace(/\s+/g, '-'),
  name: `${prefix} ${suffix}`,
  type: 'n8n-nodes-base.dataTable',
  typeVersion: 1,
  position: [0, 0],
  alwaysOutputData: true,
});

// executeWorkflow-нода (вызов под-воркфлоу по стабильному id, напр. wf-rag). Локализуется
// под стенд через localize_workflow_refs.mjs (как wf-auth). Item пробрасывается как вход sub.
const execWf = (prefix, suffix, wfId) => ({
  parameters: { workflowId: { __rl: true, value: wfId, mode: 'id' }, options: {} },
  id: `${prefix}-${suffix}`.replace(/\s+/g, '-'),
  name: `${prefix} ${suffix}`,
  type: 'n8n-nodes-base.executeWorkflow',
  typeVersion: 1.2,
  position: [0, 0],
});

// ── Сборщик одного эндпоинта (как в build_wf_api_projects.mjs) ─────────────────
const allNodes = [];
const connections = {};
const addConn = (from, toList) => {
  connections[from] = { main: [toList.map((node) => ({ node, type: 'main', index: 0 }))] };
};

let endpointIndex = 0;
const endpoint = (prefix, method, path, webhookId, chain) => {
  const y = endpointIndex * 400;
  endpointIndex += 1;

  const wh = webhook(prefix, method, path, webhookId);
  const au = auth(prefix);
  const iff = ifAuth(prefix);
  const re = respond(prefix);

  const series = [wh, au, iff, ...chain, re];
  series.forEach((n, i) => {
    n.position = [-1500 + i * 240, y];
  });
  allNodes.push(...series);

  addConn(wh.name, [au.name]);
  addConn(au.name, [iff.name]);
  connections[iff.name] = {
    main: [
      [{ node: chain[0].name, type: 'main', index: 0 }],
      [{ node: re.name, type: 'main', index: 0 }],
    ],
  };
  for (let i = 0; i < chain.length - 1; i += 1) addConn(chain[i].name, [chain[i + 1].name]);
  addConn(chain[chain.length - 1].name, [re.name]);
};

// ── Логика Code-нод как функции (сериализуются в jsCode через funcBody) ────────

// GET: отдать сохранённую архитектуру проекта (или {status:'none'}).
function archGetRespBody() {
  const rows = $input.all().map((i) => i.json).filter((r) => r && r.project_id);
  const q = ($('[archGet] Webhook').first().json.query) || {};
  const pid = q.project_id ? String(q.project_id) : '';
  const row = rows.find((r) => r.project_id === pid) || (pid ? null : rows[0]);
  if (!row || !row.project_id) {
    return [{ json: { _http_code: 200, _body: { status: 'none', project_id: pid } } }];
  }
  return [
    {
      json: {
        _http_code: 200,
        _body: {
          project_id: row.project_id,
          status: row.status || 'ready',
          generated_at: (row.generated_at || '').toString(),
          provider: row.provider || '',
          model: row.model || '',
          sources_count: Number(row.sources_count) || 0,
          summary_md: row.summary_md || '',
          c4_context: row.c4_context || '',
          c4_container: row.c4_container || '',
        },
      },
    },
  ];
}

// POST: распарсить project_id из тела.
function genParseBody() {
  const hook = $('[gen] Webhook').first().json || {};
  const body = hook.body && typeof hook.body === 'object' ? hook.body : hook;
  const project_id = body.project_id ? String(body.project_id) : '';
  return [{ json: { _http_code: 200, project_id } }];
}

// POST: сформировать ОДИН запрос к wf_rag по документам проекта (includeDocumentIds).
// Выносим RAG из Generate-ноды, чтобы поиск шёл через backend-aware wf_rag (config rag_backend:
// local docs_chunks / develonica arch-docs-rag), а не прямым Qdrant-HTTP в local docs_chunks
// (который на develonica-бэкенде возвращал пусто, хотя чат через wf_rag работал).
function genBuildRagReqBody() {
  const docs = $('[gen] Get Docs').all().map((i) => i.json).filter((r) => r && r.document_id);
  const okDoc = (s) => !s || ['completed', 'partial', 'ready', 'processing'].includes(String(s));
  const docIds = docs.filter((d) => okDoc(d.status)).map((d) => String(d.document_id));
  if (!docIds.length) return []; // нет годных документов → wf_rag не зовём; Generate отдаст заглушку
  const query =
    'архитектура системы; технологический стек и платформы; программные компоненты, модули и сервисы; ' +
    'хранение данных и базы данных; интеграции, API и внешние системы; роли доступа и безопасность; ' +
    'развёртывание и инфраструктура; нефункциональные требования, производительность, отказоустойчивость';
  return [{ json: { query, topK: 40, includeDocumentIds: docIds } }];
}

// POST: ВЫВОД архитектуры. callLLM-провайдер = тот же, что при обработке документов
// (строка config(llm_extraction), читается нодой [gen] Get LLM Config).
async function genArchitectureBody() {
  const http = this.helpers.httpRequest.bind(this.helpers);
  const nowIso = new Date().toISOString();

  const docs = $('[gen] Get Docs').all().map((i) => i.json).filter((r) => r && r.document_id);
  const projectId = $('[gen] Parse Request').first().json.project_id || '';

  // RAG-контекст — из wf_rag (нода [gen] RAG Search (sub)), а НЕ прямым обращением к Qdrant.
  // wf_rag backend-aware и сам фильтрует по includeDocumentIds (запрос формирует [gen] Build RAG
  // Request). hits: [{ score, payload: {...metadata, content} }].
  const hits = [];
  for (const it of $('[gen] RAG Search (sub)').all()) {
    const j = it.json || {};
    if (Array.isArray(j.hits)) hits.push(...j.hits);
  }

  // Нет документов/контекста — сохраняем заглушку, LLM не зовём.
  if (!docs.length || !hits.length) {
    const msg = !docs.length
      ? 'В проекте нет обработанных документов. Добавьте и обработайте документы, затем сгенерируйте архитектуру.'
      : 'Не удалось собрать контекст из документов проекта (RAG вернул пусто).';
    return [
      {
        json: {
          _http_code: 200,
          _gen: {
            project_id: projectId,
            status: 'empty',
            generated_at: nowIso,
            provider: '',
            model: '',
            sources_count: 0,
            summary_md: '> ' + msg,
            c4_context: '',
            c4_container: '',
            raw_json: '',
          },
        },
      },
    ];
  }

  // Контекст из RAG-хитов и список документов проекта.
  const ctxText = hits
    .map((h, i) => {
      const pl = h.payload || {};
      const head = pl.chapter_title || pl.section_title || pl.document_title || '';
      return '[' + (i + 1) + '] ' + (head ? head + ': ' : '') + String(pl.content || '').trim();
    })
    .join('\n');
  const docList = docs.map((d) => '- ' + (d.title || d.filename || d.document_id)).join('\n');

  // --- выбор LLM-провайдера: один-в-один с [upload] Merge Chunks ---
  // Провайдер/модель/base_url/ключ — из строки config(llm_extraction), читаем нодой
  // [gen] Get LLM Config (dataTable), БЕЗ self-HTTP к /webhook/llm-config: на «чужих» стендах
  // task-runner — отдельный контейнер, сеть до n8n (localhost:5678) не доходит, а dataTable
  // читается нативно. Ключ — из колонки api_key той же строки (как в [upload] Merge Chunks), без $env.
  const OLLAMA = 'http://host.docker.internal:11434/api/generate';
  const MODEL = 'qwen3:8b';
  let DEVELONICA_URL = 'https://ai.develonica.group'.replace(/\/+$/, '') + '/api/v1/chat/completions';
  let LMSTUDIO_URL = 'http://192.168.2.135:1234/v1'.replace(/\/+$/, '') + '/chat/completions';
  let API_KEY = '';
  let PROVIDER = 'ollama',
    CLAUDE_MODEL = 'claude-haiku-4-5',
    DEVELONICA_MODEL = 'dvl-analyst',
    LMSTUDIO_MODEL = 'google/gemma-4-12b';
  {
    const _c = $('[gen] Get LLM Config').first();
    const lc = (_c && _c.json) || {};
    const _p = String(lc.provider || '').toLowerCase();
    API_KEY = lc.api_key ? String(lc.api_key) : '';
    if (_p === 'claude') {
      PROVIDER = 'claude';
      if (lc.model) CLAUDE_MODEL = String(lc.model);
    } else if (_p === 'develonica') {
      PROVIDER = 'develonica';
      if (lc.model) DEVELONICA_MODEL = String(lc.model);
      if (lc.base_url) DEVELONICA_URL = String(lc.base_url).replace(/\/+$/, '') + '/api/v1/chat/completions';
    } else if (_p === 'lmstudio') {
      PROVIDER = 'lmstudio';
      if (lc.model) LMSTUDIO_MODEL = String(lc.model);
      if (lc.base_url) LMSTUDIO_URL = String(lc.base_url).replace(/\/+$/, '') + '/chat/completions';
    }
  }

  const stripJson = (s) => {
    let t = String(s || '').trim();
    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (m) t = m[1].trim();
    const a = t.indexOf('{'),
      b = t.lastIndexOf('}');
    return a >= 0 && b > a ? t.slice(a, b + 1) : t;
  };
  const _sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const _httpStatus = (e) => {
    const s =
      e &&
      (e.httpCode ||
        e.statusCode ||
        (e.response && (e.response.status || e.response.statusCode)) ||
        (e.cause && e.cause.statusCode));
    if (s) return Number(s);
    const m = String((e && e.message) || '').match(/\b(429|529|500|502|503|504)\b/);
    return m ? Number(m[1]) : 0;
  };
  const _withRetry = async (fn) => {
    const MAX = 4;
    let delay = 2000;
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const st = _httpStatus(e);
        const retriable =
          st === 429 ||
          st === 529 ||
          st === 500 ||
          st === 502 ||
          st === 503 ||
          st === 504 ||
          (st === 0 &&
            /timeout|socket|network|ECONN|EAI_AGAIN|ETIMEDOUT|aborted/i.test(
              String((e && e.message) || ''),
            ));
        if (attempt >= MAX || !retriable) throw e;
        await _sleep(Math.min(delay, 30000) + Math.floor(Math.random() * 500));
        delay *= 2;
      }
    }
  };
  // LM Studio: strict json_schema (GBNF) для structured output НЕ используем — на reasoning-моделях
  // (gpt-oss) он зависает (>150с → таймаут), на gemma-qat вызывает дегенерацию строк. Структуру
  // задаём в промпте. reasoning серверно не гасим (qwen3-PayGate давится reasoning_effort/
  // enable_thinking → пустой content); вместо этого ПЕРЕЖИДАЕМ его большим max_tokens. stripJson
  // снимает ```-заборы (reasoning приходит в отдельном reasoning_content, content остаётся чистым).
  const callLLM = async (prompt, maxTok) => {
    const _mt = maxTok || 4096;
    if (PROVIDER === 'claude') {
      const r = await _withRetry(() =>
        http({
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          json: true,
          timeout: 180000,
          headers: {
            'x-api-key': (API_KEY || '').trim(),
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: {
            model: CLAUDE_MODEL,
            max_tokens: _mt,
            temperature: 0.2,
            messages: [{ role: 'user', content: prompt }],
          },
        }),
      );
      return stripJson((r && r.content && r.content[0] && r.content[0].text) || '');
    }
    if (PROVIDER === 'develonica') {
      const r = await _withRetry(() =>
        http({
          method: 'POST',
          url: DEVELONICA_URL,
          json: true,
          timeout: 180000,
          headers: {
            Authorization: 'Bearer ' + (API_KEY || '').trim(),
            'content-type': 'application/json',
          },
          body: {
            model: DEVELONICA_MODEL,
            max_tokens: _mt,
            temperature: 0.2,
            stream: false,
            messages: [{ role: 'user', content: prompt }],
          },
        }),
      );
      return stripJson(
        (r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) ||
          '',
      );
    }
    if (PROVIDER === 'lmstudio') {
      const _body = {
        model: LMSTUDIO_MODEL,
        max_tokens: _mt,
        temperature: 0.3,
        stream: false,
        // qwen3 на PayGate ДАВИТСЯ gpt-oss-параметрами (reasoning_effort/enable_thinking/
        // chat_template_kwargs) — сервер отдаёт ПУСТОЙ content → status:error (замер
        // probe_lmstudio_qwen3_arch.sh). thinking серверно не выключить, поэтому ПЕРЕЖИДАЕМ его
        // большим max_tokens: модель тратит ~6-7k ток (reasoning в отдельном reasoning_content) и
        // сама останавливается (finish:stop), потолок не доедает. /no_think чуть сокращает reasoning.
        messages: [{ role: 'user', content: prompt + '\n/no_think' }],
      };
      const r = await _withRetry(() =>
        http({
          method: 'POST',
          url: LMSTUDIO_URL,
          json: true,
          timeout: 300000,
          headers: {
            Authorization: 'Bearer ' + (API_KEY || 'lm-studio').trim(),
            'content-type': 'application/json',
          },
          body: _body,
        }),
      );
      return stripJson(
        (r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) ||
          '',
      );
    }
    const r = await _withRetry(() =>
      http({
        method: 'POST',
        url: OLLAMA,
        json: true,
        timeout: 300000,
        body: {
          model: MODEL,
          prompt,
          stream: false,
          format: 'json',
          options: { temperature: 0.2, num_ctx: 16384, num_predict: _mt },
        },
      }),
    );
    return r && r.response ? r.response : '';
  };

  const PROMPT =
    'Ты — системный архитектор. На основе фрагментов из требований ВЫВЕДИ архитектуру целевой ' +
    'программной системы, которую эти требования описывают (это аргументированное ПРЕДЛОЖЕНИЕ ' +
    'архитектуры, а не пересказ текста). Верни СТРОГО ОДИН JSON-объект по схеме (без markdown, без ```):\n' +
    '{\n' +
    '  "system_name": "краткое имя целевой системы",\n' +
    '  "overview": "2-4 предложения: назначение и суть системы",\n' +
    '  "stack": [{"name": "технология/платформа", "purpose": "зачем в этой системе"}],\n' +
    '  "decisions": [{"title": "архитектурное решение", "rationale": "обоснование из требований"}],\n' +
    '  "context": {\n' +
    '    "persons": [{"id": "лат_ид", "name": "роль/пользователь", "descr": "кратко"}],\n' +
    '    "external_systems": [{"id": "лат_ид", "name": "внешняя система", "descr": "кратко"}],\n' +
    '    "relations": [{"from": "ид", "to": "ид", "label": "что делает"}]\n' +
    '  },\n' +
    '  "containers": {\n' +
    '    "items": [{"id": "лат_ид", "name": "контейнер", "tech": "технология", "descr": "кратко", "kind": "app|db|queue|ext"}],\n' +
    '    "relations": [{"from": "ид", "to": "ид", "label": "что делает", "tech": "протокол/формат"}]\n' +
    '  }\n' +
    '}\n' +
    'Правила: (1) Сама целевая система в context имеет фиксированный id "system" — НЕ описывай её в массивах, ' +
    'используй "system" в relations как ид. (2) id — только латиница/цифры/подчёркивание, без пробелов, уникальные. ' +
    '(3) relations.from/to ссылаются на id персон, внешних систем, контейнеров или "system". ' +
    '(4) Всё по-русски; строки короткие, без переносов строк. (5) Опирайся на требования; где данных мало — ' +
    'выдвини разумные типовые предположения и отметь это в rationale. (6) 3-8 контейнеров, не плоди лишнего.\n\n' +
    'Документы проекта:\n' +
    docList +
    '\n\nФрагменты требований (RAG):\n' +
    ctxText +
    '\n\nJSON:';

  let parsed = {};
  try {
    // 16384: qwen3-thinking (lmstudio/PayGate) тратит ~6-7k ток на reasoning+JSON и сам тормозит
    // (finish:stop) — запас, чтобы JSON не обрезался по бюджету. Прочие провайдеры потолок не доедают.
    parsed = JSON.parse(stripJson(await callLLM(PROMPT, 16384)));
  } catch (e) {
    parsed = {};
  }

  // --- детерминированная сборка summary_md + C4 DSL (надёжнее, чем сырой mermaid от LLM) ---
  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/"/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  const alias = (s, fb) => {
    let a = String(s == null ? '' : s)
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    if (!a) a = fb;
    if (/^[0-9]/.test(a)) a = 'n' + a;
    return a;
  };

  const sysName = esc(parsed.system_name) || 'Целевая система';
  const overview = String(parsed.overview || '').trim();
  const stack = Array.isArray(parsed.stack) ? parsed.stack : [];
  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];

  let md = '## ' + sysName + '\n\n';
  if (overview) md += overview + '\n\n';
  if (stack.length) {
    md += '### Технологический стек\n\n';
    for (const s of stack)
      md +=
        '- **' +
        String(s.name || '').trim() +
        '**' +
        (s.purpose ? ' — ' + String(s.purpose).trim() : '') +
        '\n';
    md += '\n';
  }
  if (decisions.length) {
    md += '### Ключевые архитектурные решения\n\n';
    for (const d of decisions)
      md +=
        '- **' +
        String(d.title || '').trim() +
        '**' +
        (d.rationale ? ' — ' + String(d.rationale).trim() : '') +
        '\n';
    md += '\n';
  }

  // C4 уровень 1 — Context.
  const ctx = parsed.context || {};
  const persons = Array.isArray(ctx.persons) ? ctx.persons : [];
  const externals = Array.isArray(ctx.external_systems) ? ctx.external_systems : [];
  const aliasSet = { system: 'system' };
  const emittedC = new Set(['system']); // объявленные алиасы — без дублей (иначе ломается рендер C4)
  const cLines = [
    'C4Context',
    '  title Контекст системы: ' + sysName,
    '  System(system, "' + sysName + '")',
  ];
  persons.forEach((p, i) => {
    const a = alias(p.id, 'p' + (i + 1));
    aliasSet[String(p.id)] = a;
    if (emittedC.has(a)) return;
    emittedC.add(a);
    cLines.push(
      '  Person(' + a + ', "' + esc(p.name || p.id) + '"' + (p.descr ? ', "' + esc(p.descr) + '"' : '') + ')',
    );
  });
  externals.forEach((e, i) => {
    const a = alias(e.id, 'e' + (i + 1));
    aliasSet[String(e.id)] = a;
    if (emittedC.has(a)) return;
    emittedC.add(a);
    cLines.push(
      '  System_Ext(' + a + ', "' + esc(e.name || e.id) + '"' + (e.descr ? ', "' + esc(e.descr) + '"' : '') + ')',
    );
  });
  (Array.isArray(ctx.relations) ? ctx.relations : []).forEach((r) => {
    const f = aliasSet[String(r.from)];
    const t = aliasSet[String(r.to)];
    if (f && t && f !== t) cLines.push('  Rel(' + f + ', ' + t + ', "' + esc(r.label || '') + '")');
  });
  const c4_context = cLines.join('\n');

  // C4 уровень 2 — Container (контейнеры внутри границы системы).
  const cont = parsed.containers || {};
  const items = Array.isArray(cont.items) ? cont.items : [];
  const kset = {};
  const emittedK = new Set(); // объявленные алиасы контейнерной диаграммы — без дублей
  const kLines = ['C4Container', '  title Контейнеры: ' + sysName];
  persons.forEach((p, i) => {
    const a = aliasSet[String(p.id)] || alias(p.id, 'p' + (i + 1));
    kset[String(p.id)] = a;
    if (emittedK.has(a)) return;
    emittedK.add(a);
    kLines.push('  Person(' + a + ', "' + esc(p.name || p.id) + '")');
  });
  kLines.push('  System_Boundary(system_b, "' + sysName + '") {');
  items
    .filter((it) => (it.kind || 'app') !== 'ext')
    .forEach((it, i) => {
      const a = alias(it.id, 'c' + (i + 1));
      kset[String(it.id)] = a;
      if (emittedK.has(a)) return;
      emittedK.add(a);
      const macro =
        it.kind === 'db' ? 'ContainerDb' : it.kind === 'queue' ? 'ContainerQueue' : 'Container';
      kLines.push(
        '    ' +
          macro +
          '(' +
          a +
          ', "' +
          esc(it.name || it.id) +
          '", "' +
          esc(it.tech || '') +
          '"' +
          (it.descr ? ', "' + esc(it.descr) + '"' : '') +
          ')',
      );
    });
  kLines.push('  }');
  externals.forEach((e, i) => {
    const a = aliasSet[String(e.id)] || alias(e.id, 'e' + (i + 1));
    kset[String(e.id)] = a;
    if (emittedK.has(a)) return;
    emittedK.add(a);
    kLines.push('  System_Ext(' + a + ', "' + esc(e.name || e.id) + '")');
  });
  items
    .filter((it) => (it.kind || 'app') === 'ext')
    .forEach((it, i) => {
      const a = alias(it.id, 'x' + (i + 1));
      kset[String(it.id)] = a;
      if (emittedK.has(a)) return;
      emittedK.add(a);
      kLines.push('  System_Ext(' + a + ', "' + esc(it.name || it.id) + '")');
    });
  (Array.isArray(cont.relations) ? cont.relations : []).forEach((r) => {
    const f = kset[String(r.from)] || (String(r.from) === 'system' ? 'system_b' : null);
    const t = kset[String(r.to)] || (String(r.to) === 'system' ? 'system_b' : null);
    if (f && t && f !== t)
      kLines.push(
        '  Rel(' + f + ', ' + t + ', "' + esc(r.label || '') + '"' + (r.tech ? ', "' + esc(r.tech) + '"' : '') + ')',
      );
  });
  const c4_container = kLines.join('\n');

  const _activeModel =
    PROVIDER === 'claude'
      ? CLAUDE_MODEL
      : PROVIDER === 'develonica'
        ? DEVELONICA_MODEL
        : PROVIDER === 'lmstudio'
          ? LMSTUDIO_MODEL
          : MODEL;
  const okResult = !!(overview || stack.length || items.length);
  return [
    {
      json: {
        _http_code: 200,
        _gen: {
          project_id: projectId,
          status: okResult ? 'ready' : 'error',
          generated_at: nowIso,
          provider: PROVIDER,
          model: _activeModel,
          sources_count: hits.length,
          summary_md:
            md.trim() || '> Не удалось сформировать описание (LLM вернул пустой результат).',
          c4_context,
          c4_container,
          raw_json: JSON.stringify(parsed).slice(0, 60000),
        },
      },
    },
  ];
}

// POST: финальный ответ из результата генерации.
function genRespBody() {
  const g = ($('[gen] Generate Architecture').first().json || {})._gen || {};
  return [{ json: { _http_code: 200, _body: g } }];
}

// ── 1) GET /projects/architecture — отдать сохранённое ─────────────────────────
{
  const p = '[archGet]';
  const getSaved = dtGet(p, 'Get Saved', 'project_architecture', [
    {
      keyName: 'project_id',
      condition: 'eq',
      keyValue: "={{ ($('[archGet] Webhook').first().json.query || {}).project_id }}",
    },
  ]);
  const build = code(p, 'Build Response', funcBody(archGetRespBody));
  endpoint(p, 'GET', 'projects/architecture', 'docs-arch-get', [getSaved, build]);
}

// ── 2) POST /projects/architecture/generate — собрать контекст, вызвать LLM, сохранить ──
{
  const p = '[gen]';
  const parse = code(p, 'Parse Request', funcBody(genParseBody));
  const getDocs = dtGet(p, 'Get Docs', 'graphs', [
    {
      keyName: 'project_id',
      condition: 'eq',
      keyValue: "={{ $('[gen] Parse Request').first().json.project_id }}",
    },
  ]);
  // Провайдер LLM — из строки config(llm_extraction). Читаем ОТДЕЛЬНОЙ нодой dataTable (а не
  // self-HTTP к /webhook/llm-config): на «чужих» стендах task-runner не достучится до n8n.
  const getLlmCfg = dtGet(
    p,
    'Get LLM Config',
    'config',
    [{ keyName: 'key', condition: 'eq', keyValue: 'llm_extraction' }],
    { returnAll: false, limit: 1 },
  );
  // RAG-поиск — через backend-aware wf_rag: [gen] Build RAG Request формирует {query,
  // includeDocumentIds, topK} → [gen] RAG Search (sub) (executeWorkflow → wf-rag) → hits.
  // Generate читает hits из RAG Search (sub) (раньше ходил в Qdrant напрямую и не видел develonica).
  const buildRag = code(p, 'Build RAG Request', funcBody(genBuildRagReqBody));
  const ragSearch = execWf(p, 'RAG Search (sub)', 'wf-rag');
  const gen = code(p, 'Generate Architecture', funcBody(genArchitectureBody));
  const genRef = "$('[gen] Generate Architecture').first().json._gen";
  const save = dtUpsert(
    p,
    'Save Architecture',
    'project_architecture',
    'project_id',
    "={{ $('[gen] Parse Request').first().json.project_id }}",
    {
      project_id: `={{ ${genRef}.project_id }}`,
      status: `={{ ${genRef}.status }}`,
      generated_at: `={{ ${genRef}.generated_at }}`,
      provider: `={{ ${genRef}.provider }}`,
      model: `={{ ${genRef}.model }}`,
      sources_count: `={{ ${genRef}.sources_count }}`,
      summary_md: `={{ ${genRef}.summary_md }}`,
      c4_context: `={{ ${genRef}.c4_context }}`,
      c4_container: `={{ ${genRef}.c4_container }}`,
      raw_json: `={{ ${genRef}.raw_json }}`,
    },
  );
  const build = code(p, 'Build Response', funcBody(genRespBody));
  endpoint(p, 'POST', 'projects/architecture/generate', 'docs-arch-generate', [
    parse,
    getDocs,
    getLlmCfg,
    buildRag,
    ragSearch,
    gen,
    save,
    build,
  ]);
}

// ── Сборка и запись ───────────────────────────────────────────────────────────
const workflow = {
  id: 'wf-api-architecture',
  name: 'wf_api_architecture',
  nodes: allNodes,
  connections,
  settings: { executionOrder: 'v1' },
};

const outPath = join(__dirname, 'workflows', 'wf_api_architecture.json');
writeFileSync(outPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
console.log(
  `wrote ${outPath} — ${allNodes.length} nodes, ${Object.keys(connections).length} connection sources`,
);
