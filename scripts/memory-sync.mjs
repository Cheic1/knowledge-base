#!/usr/bin/env node
// Sincronizza la memoria agentmemory tra piu' PC senza un server centrale.
// Richiede solo Node 18+ (stesso Node di agentmemory) e, per la modalita' git, git.
//
// Ogni PC fa girare il proprio agentmemory locale. Il DB live (data/state_store.db)
// NON si sincronizza: e' binario e scritto di continuo. Si sincronizzano gli
// export JSON, uno per PC:
//
//   memories/sync/<nodo>.json    scritto SOLO dal PC <nodo>
//
// Cosi' git non ha mai conflitti. Ad ogni sync:
//   1. git pull                 (prende i file degli altri PC)
//   2. import                   (record degli altri PC: aggiunto se manca,
//                                sovrascritto se il loro e' piu' recente)
//   3. export                   (riscrive il proprio file, ordinato e stabile)
//   4. git commit + push        (solo il proprio file)
//
// Con --dir si usa una cartella (OneDrive, share SMB) al posto di git: stessa
// logica, senza i passi 1 e 4.
//
// Limiti: le cancellazioni non si propagano; tutti i PC devono avere la stessa
// versione di agentmemory.
//
// Uso:
//   node scripts/memory-sync.mjs [sync|export|import] [--dir CARTELLA] [--dry-run]
//
// Variabili:
//   KB_MEMORY_URL       agentmemory locale (default http://127.0.0.1:3111)
//   AGENTMEMORY_SECRET  token Bearer, se agentmemory ne richiede uno
//   KB_SYNC_NODE        nome di questo PC nei file (default hostname)
//   KB_SYNC_DIR         equivalente di --dir
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIR = path.join(REPO_DIR, 'memories', 'sync');

// Collezioni dell'export indicizzate per chiave (come le scrive mem::import)
const KEYED = {
  sessions: 'id', memories: 'id', summaries: 'sessionId', profiles: 'project',
  graphNodes: 'id', graphEdges: 'id', semanticMemories: 'id', proceduralMemories: 'id',
  actions: 'id', actionEdges: 'id', routines: 'id', signals: 'id', checkpoints: 'id',
  sentinels: 'id', sketches: 'id', crystals: 'id', facets: 'id', lessons: 'id', insights: 'id',
};
const REQUIRED = ['sessions', 'memories', 'summaries'];
const TS_FIELDS = ['updatedAt', 'lastUpdated', 'createdAt', 'timestamp', 'startedAt'];

const log = (msg) => console.log(`[memory-sync] ${msg}`);
function die(msg) {
  log(`ERRORE: ${msg}`);
  process.exit(1);
}

// ------------------------------------------------------------------ API ---
async function api(method, p, body) {
  const base = (process.env.KB_MEMORY_URL || 'http://127.0.0.1:3111').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.AGENTMEMORY_SECRET) headers.Authorization = `Bearer ${process.env.AGENTMEMORY_SECRET}`;
  let res;
  try {
    res = await fetch(base + p, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    die(`agentmemory non raggiungibile su ${base} (${e.cause?.code || e.message}). E' avviato?`);
  }
  const text = await res.text();
  if (!res.ok) die(`${method} ${p} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function fetchExport() {
  const data = await api('GET', '/agentmemory/export');
  if (!data || typeof data !== 'object' || !data.version) die(`export inatteso: ${JSON.stringify(data).slice(0, 300)}`);
  if (data.pagination?.hasMore) die('export paginato (memoria troppo grande): non supportato ancora');
  return data;
}

// ------------------------------------------------------ normalizzazione ---
const byKey = (key) => (a, b) => {
  const x = String(a?.[key] ?? ''), y = String(b?.[key] ?? '');
  return x < y ? -1 : x > y ? 1 : 0;
};

// Legge i file degli altri PC (non il proprio) presenti nella cartella di sync
function readOthers(syncDir, node) {
  if (!fs.existsSync(syncDir)) return [];
  const out = [];
  for (const f of fs.readdirSync(syncDir).filter((n) => n.endsWith('.json')).sort()) {
    const name = f.slice(0, -5);
    if (name === node) continue;
    try {
      out.push({ name, file: f, data: JSON.parse(fs.readFileSync(path.join(syncDir, f), 'utf8')) });
    } catch (e) {
      log(`salto ${f}: illeggibile (${e.message})`);
    }
  }
  return out;
}

// Autore delle memorie (kbAuthor), usato dai pesi di affidabilita' (memory-trust).
// agentmemory non lo salva: lo timbra la sync al primo export e poi viaggia col record.
//   - gia' presente nel record           -> resta
//   - un altro PC lo ha gia' attribuito  -> si adotta quel nome
//   - un altro PC ha la memoria senza alcun autore (file scritto prima di questa
//     regola), oppure e' arrivata da un import -> 'sconosciuto'
//   - altrimenti e' nata qui             -> questo PC
// Nota: mem::import conserva origin, quindi origin.channel non basta a capire
// se una memoria e' arrivata da un altro PC: serve guardare i loro file.
const UNKNOWN_AUTHOR = 'sconosciuto';

function authorIndex(others) {
  const authors = new Map();
  const seen = new Set();
  for (const { data } of others) {
    for (const m of data.memories || []) {
      // 'sconosciuto' non si adotta: un PC che ha solo ricevuto la memoria la
      // marca cosi', ma l'autore vero puo' ancora rivendicarla
      if (m.kbAuthor && m.kbAuthor !== UNKNOWN_AUTHOR) authors.set(m.id, m.kbAuthor);
      else if (!m.kbAuthor) seen.add(m.id); // file scritto prima di questa regola
    }
  }
  return { authors, seen };
}

function stampAuthors(memories, node, index) {
  for (const m of memories || []) {
    if (m.kbAuthor && m.kbAuthor !== UNKNOWN_AUTHOR) continue;
    const known = index.authors.get(m.id);
    if (known) m.kbAuthor = known;
    else if (m.kbAuthor) continue;
    else if (index.seen.has(m.id) || m.origin?.channel === 'import') m.kbAuthor = UNKNOWN_AUTHOR;
    else m.kbAuthor = node;
  }
}

// Export stabile: stesso contenuto -> stessi byte (diff git minimi).
// Toglie exportedAt, accessLogs e pagination che cambiano ad ogni chiamata.
function normalize(exp, ctx) {
  if (ctx) stampAuthors(exp.memories, ctx.node, ctx.index);
  const out = { version: exp.version };
  for (const [name, key] of Object.entries(KEYED)) {
    if (Array.isArray(exp[name]) && exp[name].length) out[name] = [...exp[name]].sort(byKey(key));
  }
  out.observations = {};
  for (const sid of Object.keys(exp.observations || {}).sort()) {
    const items = exp.observations[sid];
    if (Array.isArray(items) && items.length) out.observations[sid] = [...items].sort(byKey('id'));
  }
  for (const name of REQUIRED) out[name] ??= [];
  return out;
}

// JSON con chiavi ordinate, cosi' l'ordine dei campi non sporca i diff
function stableStringify(value) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
    }
    return v;
  };
  return JSON.stringify(sortKeys(value), null, 1) + '\n';
}

function ts(record) {
  for (const f of TS_FIELDS) if (typeof record?.[f] === 'string' && record[f]) return record[f];
  return '';
}

// True se il record remoto va importato sopra quello locale
function newer(remote, local) {
  if (local === undefined) return true;
  if (stableStringify(remote) === stableStringify(local)) return false;
  // agentmemory marca la versione vecchia isLatest=false senza toccare updatedAt:
  // una volta superata, resta superata anche sugli altri PC
  if (ts(remote) === ts(local)) {
    if (remote.isLatest === false && local.isLatest !== false) return true;
    // a parita' di data si prende l'autore se qui manca o e' sconosciuto
    return Boolean(remote.kbAuthor) && remote.kbAuthor !== UNKNOWN_AUTHOR
      && (!local.kbAuthor || local.kbAuthor === UNKNOWN_AUTHOR);
  }
  return ts(remote) > ts(local);
}

// Record di `remote` mancanti o piu' recenti rispetto a `local`
function delta(remote, local) {
  const out = {};
  let count = 0;
  for (const [name, key] of Object.entries(KEYED)) {
    const loc = new Map((local[name] || []).map((x) => [String(x[key]), x]));
    const picked = (remote[name] || []).filter((x) => newer(x, loc.get(String(x[key]))));
    if (picked.length) { out[name] = picked; count += picked.length; }
  }
  out.observations = {};
  for (const [sid, items] of Object.entries(remote.observations || {})) {
    const loc = new Map(((local.observations || {})[sid] || []).map((x) => [String(x.id), x]));
    const picked = items.filter((x) => newer(x, loc.get(String(x.id))));
    if (picked.length) { out.observations[sid] = picked; count += picked.length; }
  }
  for (const name of REQUIRED) out[name] ??= [];
  return { payload: out, count };
}

// ---------------------------------------------------------------- passi ---
function nodeName() {
  const name = process.env.KB_SYNC_NODE || os.hostname().split('.')[0];
  return name.replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase() || 'pc';
}

// Confronta con il DB locale cosi' com'e' (senza timbro kbAuthor): se un altro PC
// conosce l'autore e qui manca, il record viene reimportato e l'autore entra nel DB
async function stepImport(ctx, dryRun) {
  let local = normalize(await fetchExport());
  for (const { name: other, file: f, data: remote } of ctx.others) {
    if (remote.version !== local.version) {
      log(`salto ${f}: versione ${remote.version} != locale ${local.version}`);
      continue;
    }
    const { payload, count } = delta(remote, local);
    if (!count) { log(`${other}: niente di nuovo`); continue; }
    log(`${other}: ${count} record nuovi o aggiornati`);
    if (dryRun) continue;
    payload.version = local.version;
    payload.exportedAt = new Date().toISOString();
    const res = await api('POST', '/agentmemory/import', { exportData: payload, strategy: 'merge' });
    if (res && res.success === false) die(`import da ${f} fallito: ${res.error}`);
    // i record importati ora sono locali: non reimportarli dal file successivo
    local = normalize(await fetchExport());
  }
}

async function stepExport(ctx, dryRun) {
  const { syncDir, node } = ctx;
  const data = normalize(await fetchExport(), ctx);
  const target = path.join(syncDir, `${node}.json`);
  const text = stableStringify(data);
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === text) {
    log(`${node}.json: invariato`);
    return { target, changed: false };
  }
  if (!dryRun) {
    fs.mkdirSync(syncDir, { recursive: true });
    fs.writeFileSync(`${target}.tmp`, text, 'utf8');
    fs.renameSync(`${target}.tmp`, target);
  }
  const nObs = Object.values(data.observations).reduce((s, v) => s + v.length, 0);
  log(`${node}.json: scritto (${data.memories.length} memorie, ${nObs} osservazioni)`);
  return { target, changed: true };
}

const PROXY_HINT = "se sei dietro un proxy aziendale che blocca GitHub, disattivalo solo per questa repo: "
  + 'git config http.proxy "" (da PowerShell: cmd /c \'git config http.proxy ""\')';

function git(args, check = true) {
  // timeout: dietro un proxy aziendale pull/push possono restare appesi per minuti
  const r = spawnSync('git', ['-C', REPO_DIR, ...args], { encoding: 'utf8', timeout: 90000 });
  if (r.error?.code === 'ETIMEDOUT') die(`git ${args[0]} bloccato da oltre 90s: ${PROXY_HINT}`);
  if (r.error) die(`git non trovato (${r.error.code}). Installa git o usa --dir con una cartella condivisa`);
  if (r.status !== 0 && /proxy|CONNECT tunnel|502|407|Failed to connect/i.test(r.stderr || '')) {
    die(`git ${args[0]}: ${r.stderr.trim()}\n  ${PROXY_HINT}`);
  }
  if (check && r.status !== 0) die(`git ${args.join(' ')}: ${(r.stderr || r.stdout).trim()}`);
  return r;
}

function gitPull() {
  const r = git(['pull', '--rebase', '--autostash'], false);
  if (r.status !== 0) {
    git(['rebase', '--abort'], false);
    die(`git pull fallito, repo lasciato com'era: ${r.stderr.trim()}`);
  }
}

// Committa solo i file di questo PC: il proprio export e, se c'e', il proprio
// file di voti di affidabilita' (memories/trust/votes/<node>.jsonl)
function gitPush(target, node) {
  const files = [target, path.join(REPO_DIR, 'memories', 'trust', 'votes', `${node}.jsonl`)]
    .filter((f) => fs.existsSync(f))
    .map((f) => path.relative(REPO_DIR, f).split(path.sep).join('/'));
  git(['add', '--', ...files]);
  if (git(['diff', '--cached', '--quiet', '--', ...files], false).status === 0) return;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  git(['commit', '-m', `memory-sync: ${node} ${stamp}`, '--', ...files]);
  for (let i = 0; i < 3; i++) {
    if (git(['push'], false).status === 0) { log('push completato'); return; }
    gitPull(); // qualcun altro ha pushato nel frattempo
  }
  die('push fallito dopo 3 tentativi');
}

// Evita due sync in parallelo sullo stesso PC (scheduler + manuale)
function lock() {
  const file = path.join(REPO_DIR, '.memory-sync.lock');
  try {
    const fd = fs.openSync(file, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
  } catch {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = pid !== process.pid; } catch { /* morto */ }
    if (alive) die(`un altro memory-sync e' gia' in corso (pid ${pid})`);
    fs.writeFileSync(file, String(process.pid));
  }
  const release = () => { try { fs.unlinkSync(file); } catch { /* gia' tolto */ } };
  process.on('exit', release);
}

function parseArgs(argv) {
  const a = { command: 'sync', dir: process.env.KB_SYNC_DIR || '', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--dry-run') a.dryRun = true;
    else if (x === '--dir') a.dir = argv[++i] || die('--dir richiede una cartella');
    else if (x.startsWith('--dir=')) a.dir = x.slice(6);
    else if (['sync', 'export', 'import'].includes(x)) a.command = x;
    else if (x === '-h' || x === '--help') {
      console.log('Uso: node scripts/memory-sync.mjs [sync|export|import] [--dir CARTELLA] [--dry-run]');
      process.exit(0);
    } else die(`argomento sconosciuto: ${x}`);
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const useGit = !a.dir;
  const syncDir = a.dir ? path.resolve(a.dir.replace(/^~(?=$|[\\/])/, os.homedir())) : DEFAULT_DIR;
  const node = nodeName();
  lock();
  log(`nodo '${node}', cartella ${syncDir}${useGit ? ' (git)' : ''}`);

  if (a.command === 'sync' && useGit && !a.dryRun) gitPull();
  const others = readOthers(syncDir, node);
  const ctx = { syncDir, node, others, index: authorIndex(others) };
  if (a.command === 'sync' || a.command === 'import') await stepImport(ctx, a.dryRun);
  if (a.command === 'sync' || a.command === 'export') {
    const { target } = await stepExport(ctx, a.dryRun);
    // anche con export invariato puo' esserci un voto nuovo da pushare
    if (a.command === 'sync' && useGit && !a.dryRun) gitPush(target, node);
  }
}

main();
