// Генератор workflows/wf_api_projects.json — REST-роутер «Проектов».
//
// Зачем генератор, а не рукописный JSON: каждый эндпоинт — почти идентичная цепочка
// Webhook → Auth(wf-auth) → If Auth OK → dataTable → Build Response(code) → Respond, а Code-ноды
// содержат JS, который в JSON пришлось бы экранировать руками (\n, кавычки) — источник ошибок.
// Здесь ноды описаны как обычные JS-объекты, а connections собираются хелпером. JSON —
// первоисточник для import/deploy; этот скрипт — «как он собран» (прецедент: n8n/_patch_*.py).
//
// Прецеденты паттернов (см. CLAUDE.md / память):
//  • Цепочка эндпоинта и ветвление If Auth OK (выход 0=true→бизнес, 1=false→Respond с 401 из Auth)
//    скопированы из wf_api_documents.json (узлы [documents] / [graphByDoc]).
//  • Частичный upsert (обновить ОДНУ колонку, не затерев строку) — как Update Graph Status в
//    wf_job_store.json: dataTable upsert с matchingColumns + value лишь из нужных полей.
//  • project_id генерит КЛИЕНТ (как job_id/document_id), бэкенд только пишет.
//  • alwaysOutputData=true на dataTable-нодах — чтобы при 0 строк следующая нода всё равно
//    выполнилась (иначе n8n не запускает ноду с пустым входом и Respond не отвечает).
//
// Запуск:  node build_wf_api_projects.mjs   →  пишет workflows/wf_api_projects.json
// Деплой:  N8N_URL=http://localhost:5678 N8N_OWNER_EMAIL=… N8N_OWNER_PASSWORD=… \
//            node deploy_workflow_live.mjs workflows/wf_api_projects.json

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Шаблоны-хелперы нод ───────────────────────────────────────────────────────
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
  id: `${prefix}-${suffix}`,
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
  id: `${prefix}-${suffix}`,
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
  id: `${prefix}-${suffix}`,
  name: `${prefix} ${suffix}`,
  type: 'n8n-nodes-base.dataTable',
  typeVersion: 1,
  position: [0, 0],
  alwaysOutputData: true,
});

const dtDelete = (prefix, suffix, table, matchKey, filterValueExpr) => ({
  parameters: {
    operation: 'deleteRows',
    dataTableId: { __rl: true, mode: 'name', value: table },
    matchType: 'allConditions',
    filters: { conditions: [{ keyName: matchKey, condition: 'eq', keyValue: filterValueExpr }] },
    options: {},
  },
  id: `${prefix}-${suffix}`,
  name: `${prefix} ${suffix}`,
  type: 'n8n-nodes-base.dataTable',
  typeVersion: 1,
  position: [0, 0],
  alwaysOutputData: true,
});

// ── Сборщик одного эндпоинта ─────────────────────────────────────────────────
// chain — бизнес-ноды между If-true и Respond (последняя ОБЯЗАНА вернуть {_http_code,_body}).
// Возвращает {nodes, connections}. Раскладка по X слева направо, по Y — индекс эндпоинта.
const allNodes = [];
const connections = {};
const addConn = (from, toList) => {
  connections[from] = { main: [toList.map((node) => ({ node, type: 'main', index: 0 }))] };
};

let endpointIndex = 0;
const endpoint = (prefix, method, path, webhookId, chain) => {
  const y = endpointIndex * 280;
  endpointIndex += 1;

  const wh = webhook(prefix, method, path, webhookId);
  const au = auth(prefix);
  const iff = ifAuth(prefix);
  const re = respond(prefix);

  const series = [wh, au, iff, ...chain, re];
  series.forEach((n, i) => {
    n.position = [-1300 + i * 220, y];
  });
  allNodes.push(...series);

  // Линейные связи: Webhook→Auth→If
  addConn(wh.name, [au.name]);
  addConn(au.name, [iff.name]);
  // If: выход 0 (true) → chain[0]; выход 1 (false) → Respond
  connections[iff.name] = {
    main: [
      [{ node: chain[0].name, type: 'main', index: 0 }],
      [{ node: re.name, type: 'main', index: 0 }],
    ],
  };
  // Внутри chain: последовательно, последняя → Respond
  for (let i = 0; i < chain.length - 1; i += 1) addConn(chain[i].name, [chain[i + 1].name]);
  addConn(chain[chain.length - 1].name, [re.name]);
};

// ── 1) GET /projects — список проектов + счётчик документов ────────────────────
{
  const p = '[list]';
  const getProjects = dtGet(p, 'Get Projects', 'projects', [], { orderBy: true, orderByColumn: 'created_at' });
  const getGraphs = dtGet(p, 'Get Graphs', 'graphs', []);
  const build = code(
    p,
    'Build Response',
    [
      "// Считаем документы по project_id из graphs и приклеиваем счётчик к каждому проекту.",
      "const projects = $('[list] Get Projects').all().map((i) => i.json).filter((r) => r && r.project_id);",
      "const graphs = $('[list] Get Graphs').all().map((i) => i.json).filter((r) => r && r.project_id);",
      'const counts = {};',
      'for (const g of graphs) counts[g.project_id] = (counts[g.project_id] || 0) + 1;',
      'const items = projects.map((pr) => ({',
      '  project_id: pr.project_id,',
      "  name: pr.name || '',",
      "  description: pr.description || '',",
      "  created_at: (pr.created_at || '').toString().slice(0, 19),",
      "  created_by: pr.created_by || '',",
      '  document_count: counts[pr.project_id] || 0,',
      '}));',
      'return [{ json: { _http_code: 200, _body: items } }];',
    ].join('\n'),
  );
  endpoint(p, 'GET', 'projects', 'docs-projects-list', [getProjects, getGraphs, build]);
}

// ── 2) POST /projects — создать проект (project_id приходит с клиента) ──────────
{
  const p = '[create]';
  const whRef = "$('[create] Webhook').first().json.body";
  const upsert = dtUpsert(p, 'Upsert Project', 'projects', 'project_id', `={{ ${whRef}.project_id }}`, {
    project_id: `={{ ${whRef}.project_id }}`,
    name: `={{ ${whRef}.name }}`,
    description: `={{ ${whRef}.description || '' }}`,
    created_at: '={{ $now.toISO() }}',
    created_by: "={{ $json._username || '' }}",
  });
  const build = code(
    p,
    'Build Response',
    [
      "const b = $('[create] Webhook').first().json.body || {};",
      'return [{ json: { _http_code: 200, _body: {',
      "  project_id: b.project_id || '',",
      "  name: b.name || '',",
      "  description: b.description || '',",
      '} } }];',
    ].join('\n'),
  );
  endpoint(p, 'POST', 'projects', 'docs-projects-create', [upsert, build]);
}

// ── 3) POST /projects/update — переименовать / изменить описание ───────────────
// Частичный upsert: обновляем только name+description, created_at/created_by сохраняются.
{
  const p = '[update]';
  const whRef = "$('[update] Webhook').first().json.body";
  const upsert = dtUpsert(p, 'Upsert Project', 'projects', 'project_id', `={{ ${whRef}.project_id }}`, {
    name: `={{ ${whRef}.name }}`,
    description: `={{ ${whRef}.description || '' }}`,
  });
  const build = code(p, 'Build Response', 'return [{ json: { _http_code: 200, _body: { ok: true } } }];');
  endpoint(p, 'POST', 'projects/update', 'docs-projects-update', [upsert, build]);
}

// ── 4) POST /projects/delete — удалить проект ─────────────────────────────────
// Отвязку документов (graphs.project_id='') делает ФРОНТ циклом /projects/assign перед удалением.
// Осиротевший project_id в graphs безвреден: не сматчится ни с одним проектом → «вне проекта».
{
  const p = '[delete]';
  const whRef = "$('[delete] Webhook').first().json.body";
  const del = dtDelete(p, 'Del Project', 'projects', 'project_id', `={{ ${whRef}.project_id }}`);
  const build = code(p, 'Build Response', 'return [{ json: { _http_code: 200, _body: { ok: true } } }];');
  endpoint(p, 'POST', 'projects/delete', 'docs-projects-delete', [del, build]);
}

// ── 5) POST /projects/assign — привязать/отвязать документ (project_id='' = отвязать) ──
// Частичный upsert graphs по document_id — обновляет ТОЛЬКО project_id, граф/абзацы целы
// (как Update Graph Status в wf_job_store).
{
  const p = '[assign]';
  const whRef = "$('[assign] Webhook').first().json.body";
  const upsert = dtUpsert(p, 'Assign Doc', 'graphs', 'document_id', `={{ ${whRef}.document_id }}`, {
    project_id: `={{ ${whRef}.project_id || '' }}`,
  });
  const build = code(p, 'Build Response', 'return [{ json: { _http_code: 200, _body: { ok: true } } }];');
  endpoint(p, 'POST', 'projects/assign', 'docs-projects-assign', [upsert, build]);
}

// ── Сборка и запись ───────────────────────────────────────────────────────────
const workflow = {
  id: 'wf-api-projects',
  name: 'wf_api_projects',
  nodes: allNodes,
  connections,
  settings: { executionOrder: 'v1' },
};

const outPath = join(__dirname, 'workflows', 'wf_api_projects.json');
writeFileSync(outPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
console.log(`wrote ${outPath} — ${allNodes.length} nodes, ${Object.keys(connections).length} connection sources`);
