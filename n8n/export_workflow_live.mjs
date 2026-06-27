// Экспорт ОДНОГО workflow из живого n8n обратно в файл репозитория — обратная операция к deploy_workflow_live.mjs.
//
// Два режима:
//
//   positions-only (ПО УМОЛЧАНИЮ) — обновляет в существующем файле ТОЛЬКО координаты position
//     каждой ноды (сопоставление по id), не трогая ни форматирование, ни параметры. Diff показывает
//     ровно перемещения нод. Это то, что нужно после правки «расстановки» в UI.
//     Эти файлы — рукописные артефакты с ручным компактным форматированием (inline-объекты,
//     inline-position). Полная перевыгрузка из n8n развернула бы их стандартным JSON.stringify
//     и заодно затащила нормализацию n8n (он выкидывает дефолтные поля вроде "returnAll": false) —
//     то есть кучу изменений, которых пользователь не делал.
//
//   --full — полная перезапись файла из n8n (ровно поля { id, name, nodes, connections, settings },
//     как их читает deploy_workflow_live.mjs), 2-space JSON. Нужен, когда менялись параметры/состав
//     нод, а не только расстановка. Стиль position наследуется из старого файла (inline/multiline),
//     либо принудительно --inline-positions / --multiline-positions. ВНИМАНИЕ: n8n нормализует
//     параметры — diff будет шире, чем ваши правки; ревьюйте внимательно.
//
// id берём ИЗ СУЩЕСТВУЮЩЕГО файла (а не внутренний id n8n) — чтобы стабильно работал upsert при
// обратном deploy/import. Порядок ключей нод n8n REST уже совпадает с репо-каноном — не трогаем.
//
// Запуск (с хоста, n8n проброшен на localhost:5678):
//   N8N_URL=http://localhost:5678 N8N_OWNER_EMAIL=… N8N_OWNER_PASSWORD=… \
//     node export_workflow_live.mjs workflows/wf_rag.json            # только позиции
//     node export_workflow_live.mjs workflows/wf_rag.json --full     # весь workflow
//   # имя workflow в n8n по умолчанию = поле name из файла; переопределить: --name "wf_rag"

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const N8N_URL = process.env.N8N_URL || 'http://localhost:5678';
const EMAIL = process.env.N8N_OWNER_EMAIL;
const PASSWORD = process.env.N8N_OWNER_PASSWORD;

const argv = process.argv.slice(2);
const FILE = argv.find((a) => !a.startsWith('--'));
const flagVal = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
const NAME_OVERRIDE = flagVal('--name');
const FULL = argv.includes('--full');
const FORCE_INLINE = argv.includes('--inline-positions');
const FORCE_MULTILINE = argv.includes('--multiline-positions');

if (!EMAIL || !PASSWORD) { console.error('N8N_OWNER_EMAIL / N8N_OWNER_PASSWORD must be set'); process.exit(1); }
if (!FILE) { console.error('usage: node export_workflow_live.mjs <workflow.json> [--full] [--name "wf_name"] [--inline-positions|--multiline-positions]'); process.exit(1); }

let cookie = '';
const req = async (path, init = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(N8N_URL + path, { ...init, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) { const m = setCookie.match(/(n8n-auth=[^;]+)/); if (m) cookie = m[1]; }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* not json */ }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 400)}`);
  return json;
};
const unwrap = (r) => (r && Object.prototype.hasOwnProperty.call(r, 'data') ? r.data : r);

// positions-only: текстовый патч. Сопоставляем "position" с ближайшим предшествующим node-level "id"
// на том же отступе (вложенные id в parameters имеют другой отступ — отсекаются проверкой indent).
const patchPositions = (oldText, liveNodes) => {
  const liveById = new Map(liveNodes.map((n) => [n.id, n.position]));
  const lines = oldText.split('\n');
  let curId = null, curIndent = null;
  const updated = new Set();
  for (let i = 0; i < lines.length; i++) {
    const mId = lines[i].match(/^(\s+)"id": "([^"]+)",?\s*$/);
    if (mId) { curIndent = mId[1]; curId = mId[2]; continue; }
    const mPos = lines[i].match(/^(\s+)"position": \[[^\]]*\](,?)\s*$/);
    if (mPos && curId && mPos[1] === curIndent && liveById.has(curId)) {
      const p = liveById.get(curId);
      lines[i] = `${mPos[1]}"position": [${p[0]}, ${p[1]}]${mPos[2]}`;
      updated.add(curId);
      curId = null;
    }
  }
  return { text: lines.join('\n'), updated };
};

// --full: стандартный 2-space JSON; при inline-режиме схлопываем position обратно в одну строку.
const serialize = (wf, inlinePositions) => {
  let out = JSON.stringify(wf, null, 2);
  if (inlinePositions) {
    out = out.replace(
      /"position": \[\s*\n\s*(-?\d+(?:\.\d+)?),\s*\n\s*(-?\d+(?:\.\d+)?)\s*\n\s*\]/g,
      '"position": [$1, $2]',
    );
  }
  return out + '\n';
};

const main = async () => {
  const exists = existsSync(FILE);
  const oldText = exists ? readFileSync(FILE, 'utf8') : '';
  const oldWf = exists ? JSON.parse(oldText) : {};
  const wfName = NAME_OVERRIDE || oldWf.name || basename(FILE, '.json');

  await req('/rest/login', { method: 'POST', body: JSON.stringify({ emailOrLdapLoginId: EMAIL, password: PASSWORD }) });
  const list = unwrap(await req('/rest/workflows?take=250&skip=0'));
  const rows = list.data || list;
  const found = rows.find((w) => w.name === wfName);
  if (!found) throw new Error(`workflow "${wfName}" не найден в n8n (${N8N_URL}). Доступные: ${rows.map((w) => w.name).join(', ')}`);
  const full = unwrap(await req(`/rest/workflows/${found.id}`));

  if (!FULL) {
    if (!exists) throw new Error(`файл ${FILE} не существует — для нового workflow используйте --full`);
    const liveIds = new Set(full.nodes.map((n) => n.id));
    const fileIds = new Set((oldWf.nodes || []).map((n) => n.id));
    const added = [...liveIds].filter((x) => !fileIds.has(x));
    const removed = [...fileIds].filter((x) => !liveIds.has(x));
    const { text, updated } = patchPositions(oldText, full.nodes);
    writeFileSync(FILE, text, 'utf8');
    console.log(`positions-only: "${wfName}" (id=${found.id}, active=${found.active}) → ${FILE}`);
    console.log(`  обновлено позиций: ${updated.size}/${(oldWf.nodes || []).length}  ${text === oldText ? '(без изменений)' : ''}`);
    if (added.length || removed.length) {
      console.log(`  ⚠ состав нод РАСХОДИТСЯ с n8n (added=${added.length}, removed=${removed.length}) — менялась не только расстановка.`);
      console.log(`    Это НЕ попало в файл. Для полной синхронизации запустите с --full.`);
    }
    return;
  }

  // --full
  const inlinePositions = FORCE_INLINE ? true : FORCE_MULTILINE ? false : /"position":\s*\[-?\d/.test(oldText);
  const wf = {
    id: oldWf.id || full.id,
    name: full.name,
    nodes: full.nodes,
    connections: full.connections,
    settings: full.settings || {},
  };
  const next = serialize(wf, inlinePositions);
  writeFileSync(FILE, next, 'utf8');
  console.log(`full: "${wfName}" (id=${found.id}, active=${found.active}) → ${FILE}`);
  console.log(`  nodes=${wf.nodes.length}  positions=${inlinePositions ? 'inline' : 'multiline'}  ${exists ? (next === oldText ? '(без изменений)' : 'ИЗМЕНЁН') : 'СОЗДАН'}`);
};

main().catch((e) => { console.error(e.stack || e.message || String(e)); process.exit(1); });
