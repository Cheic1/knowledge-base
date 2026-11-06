#!/usr/bin/env node
// Bridge memoria -> wiki ("awareness push" in stile claude-mem): prende dall'
// export di agentmemory le memorie decision/bug e le appende come righe datate
// in wiki/wiki/log.md, poi commit + push su main.
//
// Diverso da memory-sync.mjs (che sincronizza i dati grezzi sul branch kb-data):
// qui si rendono LEGGIBILI e indicizzate da qmd su ogni PC dopo il pull.
//
// Uso:
//   node scripts/memory-log.mjs [run|test] [--dry-run]
//
// Variabili:
//   KB_MEMORY_URL       agentmemory (default http://127.0.0.1:3111)
//   AGENTMEMORY_SECRET  token Bearer (o KB_TOKEN), serve via kb-proxy
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_FILE = path.join(REPO_DIR, 'wiki', 'wiki', 'log.md');
// ponytail: solo decision+bug come claude-mem; aggiungere tipi qui se serve
const TYPES = ['decision', 'bug'];
const TITLE_MAX = 160;

const log = (msg) => console.log(`[memory-log] ${msg}`);
function die(msg) {
  log(`ERRORE: ${msg}`);
  process.exit(1);
}

async function fetchExport() {
  const base = (process.env.KB_MEMORY_URL || 'http://127.0.0.1:3111').replace(/\/+$/, '');
  const headers = {};
  const token = process.env.AGENTMEMORY_SECRET || process.env.KB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(base + '/agentmemory/export', { headers, signal: AbortSignal.timeout(60000) });
  } catch (e) {
    die(`agentmemory non raggiungibile su ${base} (${e.cause?.code || e.message}). E' avviato?`);
  }
  const text = await res.text();
  if (!res.ok) die(`GET /agentmemory/export -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.memories)) {
    die(`export inatteso: ${text.slice(0, 200)}`);
  }
  // ponytail: union engine+shim locale perche' il fallback embedded dello shim MCP
  // (stesso PC) puo' aver scritto memorie mai arrivate all'engine; import
  // api::import troppo rischioso, qui si fonde in memoria. Tolto quando i due
  // store tornano uno solo.
  const map = new Map();
  for (const m of [...data.memories, ...loadStandalone()]) {
    const prev = map.get(m.id);
    if (!prev || String(m.updatedAt || '') > String(prev.updatedAt || '')) map.set(m.id, m);
  }
  return { memories: [...map.values()] };
}

// Store locale dello shim MCP embedded se il REST era giu': ~/.agentmemory/standalone.json
function loadStandalone() {
  try {
    const f = path.join(os.homedir(), '.agentmemory', 'standalone.json');
    return Object.values(JSON.parse(fs.readFileSync(f, 'utf8'))['mem:memories'] || {});
  } catch {
    return [];
  }
}

const byKey = (key) => (a, b) => String(a?.[key] ?? '') < String(b?.[key] ?? '') ? -1 : 1;

// Righe nuove non ancora presenti nel log (dedup per id dentro la riga)
function pickNew(memories, logText) {
  return memories
    .filter((m) => TYPES.includes(m.type) && m.isLatest !== false)
    .sort(byKey('createdAt'))
    .filter((m) => !logText.includes(m.id))
    .map((m) => {
      const ts = m.createdAt ? m.createdAt.slice(11, 16) : '00:00';
      const title = String(m.title || m.content || '(senza titolo)').replace(/\s+/g, ' ').slice(0, TITLE_MAX);
      return { id: m.id, dateIso: m.createdAt ? m.createdAt.slice(0, 10) : '', line: `[${ts}] MEM-${m.type.toUpperCase()}: ${title} [${m.id}]` };
    });
}

// Inserisce le righe nella sezione "### YYYY-MM-DD" del giorno (creandola se
// manca), aggiornando la footer "Ultimo aggiornamento". Puro per il test.
function insertIntoLog(logText, items) {
  let out = logText.replace(/\r\n/g, '\n');
  for (const it of items) {
    const dayRe = new RegExp(`(^\\n?)### ${it.dateIso}\\n`, 'm');
    if (dayRe.test(out)) {
      out = out.replace(dayRe, `$1### ${it.dateIso}\n${it.line}\n`);
    } else {
      const footRe = /\n---\n\s*\n\*Ultimo aggiornamento/;
      const head = `\n### ${it.dateIso}\n${it.line}\n`;
      if (footRe.test(out)) out = out.replace(footRe, `\n${head}\n---\n\n*Ultimo aggiornamento`);
      else out += `\n---\n\n${head}`;
    }
    out = out.replace(/\*Ultimo aggiornamento[^*]*\*/, `*Ultimo aggiornamento: ${it.dateIso}*`);
  }
  return out;
}

function gitCommitAndPush(nNew) {
  const g = (...args) => spawnSync('git', ['-C', REPO_DIR, ...args], { encoding: 'utf8' });
  g('add', path.relative(REPO_DIR, LOG_FILE));
  const c = g('commit', '-m', `memory-log: ${nNew} memorie decision/bug in wiki log`);
  if (c.status !== 0) die(`git commit fallito: ${(c.stderr || c.stdout).trim()}`);
  const p = g('push');
  if (p.status !== 0) die(`git push fallito (${(p.stderr || p.stdout).trim()}); fai git pull e rilancia`);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const command = args.find((x) => !x.startsWith('--')) || 'run';

if (command === 'test') {
  const sample = '# Log\n\n## Formato\nx\n\n## Eventi\n\n### 2026-09-21\n[00:00] INIT: vecchia riga\n\n---\n\n*Ultimo aggiornamento: 2026-09-21*\n';
  const items = [
    { dateIso: '2026-09-21', line: '[10:00] MEM-BUG: fix x [mem_a]' },
    { dateIso: '2026-10-02', line: '[08:15] MEM-DECISION: scelta y [mem_b]' },
  ];
  const out = insertIntoLog(sample, items);
  if (!out.includes('[10:00] MEM-BUG') || !out.includes('[00:00] INIT')) die('test: riga del giorno esistente non inserita');
  if (!out.includes('### 2026-10-02')) die('test: nuova sezione giorno non creata');
  if (!out.match(/\*Ultimo aggiornamento: 2026-10-02\*/)) die('test: footer non aggiornata');
  if (!(out.indexOf('### 2026-10-02') < out.indexOf('\n---\n'))) die('test: sezione fuori posto');
  console.log('[memory-log] test OK');
} else {
  const logText = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '';
  const items = pickNew((await fetchExport()).memories, logText);
  if (!items.length) {
    log('nessuna memoria nuova da aggiungere');
    process.exit(0);
  }
  log(`${items.length} memorie nuove (${items.map((i) => i.id).join(', ')})`);
  if (dryRun) {
    for (const it of items) log(`+ [${it.dateIso}] ${it.line}`);
    process.exit(0);
  }
  fs.writeFileSync(LOG_FILE, insertIntoLog(logText, items), 'utf8');
  gitCommitAndPush(items.length);
}
