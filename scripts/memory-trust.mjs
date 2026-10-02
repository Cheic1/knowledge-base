#!/usr/bin/env node
// Voto di affidabilita' (0..1) per le memorie condivise. Gira SOLO sul PC
// server. Design: docs/memory-trust.md
//
// I voti sono invisibili agli utenti e solo l'amministratore li puo' toccare:
//   - il ledger (prove, voti, reputazioni) sta fuori dal repo, sul server
//     (KB_TRUST_DIR, default ~/.kb-trust), insieme alla chiave privata admin;
//   - ai PC arriva solo memories/shared/curated.json: l'elenco delle memorie
//     da condividere e di quelle da ritirare, senza voti, firmato dall'admin.
//
// Il voto si ricalcola ogni volta da zero dalle prove, con un modello Beta:
//   voto = alpha / (alpha + beta)
//   alpha, beta = reputazione dell'autore (prior) + prove a favore / contro
// Prove: verdetti del giudice (agente sul server), conferme/smentite da
// memorie di altri autori, voti dell'amministratore. Decadono col tempo.
//
// Uso (sul server):
//   node scripts/memory-trust.mjs keygen                          crea la chiave admin (una volta)
//   node scripts/memory-trust.mjs queue   [--out FILE] [--all]    memorie da giudicare
//   node scripts/memory-trust.mjs verdict FILE                    registra i verdetti del giudice
//   node scripts/memory-trust.mjs rebalance [--dry-run]           ricalcola voti e reputazioni
//   node scripts/memory-trust.mjs publish   [--dry-run]           scrive e firma curated.json
//   node scripts/memory-trust.mjs admin ID up|down|publish|retract|auto ["motivo"]
//   node scripts/memory-trust.mjs show [ID | --author NOME]
//
// Variabili: KB_MEMORY_URL, AGENTMEMORY_SECRET (agentmemory del server), KB_TRUST_DIR
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { curatedPaths, isPersonal, signCurated } from './memory-curated.mjs';

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRUST_DIR = process.env.KB_TRUST_DIR || path.join(os.homedir(), '.kb-trust');
const LEDGER = path.join(TRUST_DIR, 'ledger.json');
const PEOPLE = path.join(TRUST_DIR, 'people.json');
const ADMIN_KEY = path.join(TRUST_DIR, 'admin.key');

// Parametri del modello: cambiarli qui ricalcola tutto al prossimo rebalance
const P = {
  priorWeight: 2,          // quanto pesa la reputazione dell'autore (in "prove")
  repSmoothing: 4,         // memorie "finte" a 0.5 nella reputazione: pochi dati -> 0.5
  halfLifeDays: 180,       // dopo 6 mesi una prova vale la meta'
  judge: { correct: 2, doubtful: -0.75, wrong: -2, unverifiable: 0 },
  link: 1,                 // conferma/smentita da un'altra memoria (x confidenza)
  adminVote: 4,            // voto dell'amministratore
  publishAt: 0.5,          // si condivide da qui in su (solo se giudicata)
  retractBelow: 0.35,      // gia' condivisa: si ritira solo sotto questa soglia
};
// lo stesso valore che memory-sync scrive quando l'autore non e' noto
const UNKNOWN = 'sconosciuto';

const log = (msg) => console.log(`[memory-trust] ${msg}`);
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

async function fetchMemories() {
  const data = await api('GET', '/agentmemory/export');
  if (!data?.version || !Array.isArray(data.memories)) die('export inatteso da agentmemory');
  // le personali del server non si giudicano e non si condividono
  return { version: data.version, memories: data.memories.filter((m) => !isPersonal(m)) };
}

// -------------------------------------------------------------- ledger ---
function loadLedger() {
  if (!fs.existsSync(LEDGER)) return { version: 1, updatedAt: null, authors: {}, memories: {} };
  return JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
}

function saveLedger(ledger) {
  ledger.updatedAt = new Date().toISOString();
  fs.mkdirSync(TRUST_DIR, { recursive: true, mode: 0o700 });
  const sorted = Object.fromEntries(Object.keys(ledger.memories).sort().map((k) => [k, ledger.memories[k]]));
  fs.writeFileSync(`${LEDGER}.tmp`, JSON.stringify({ ...ledger, memories: sorted }, null, 1) + '\n', { mode: 0o600 });
  fs.renameSync(`${LEDGER}.tmp`, LEDGER);
}

const hashOf = (m) => crypto.createHash('sha256')
  .update(`${m.title || ''}\n${m.content || ''}`).digest('hex').slice(0, 16);
const live = (m) => m.isLatest !== false && !m.deleted;

// kbAuthor = PC dove e' nata la memoria: lo timbra memory-sync e viaggia col
// record. people.json (sul server) raggruppa i PC per persona:
// { "pc-ufficio": "francesco", "laptop-fra": "francesco", "pc-mario": "mario" }
let people;
function personOf(node) {
  people ??= fs.existsSync(PEOPLE) ? JSON.parse(fs.readFileSync(PEOPLE, 'utf8')) : {};
  return people[node] || node;
}
const authorOf = (m) => (m.kbAuthor && m.kbAuthor !== UNKNOWN ? personOf(m.kbAuthor) : UNKNOWN);

// -------------------------------------------------------------- keygen ---
function cmdKeygen() {
  const pub = curatedPaths(REPO_DIR).pub;
  if (fs.existsSync(ADMIN_KEY)) die(`${ADMIN_KEY} esiste gia': non la sovrascrivo`);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(TRUST_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(ADMIN_KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.mkdirSync(path.dirname(pub), { recursive: true });
  fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
  log(`chiave privata: ${ADMIN_KEY} (non copiarla nel repo, fanne un backup)`);
  log(`chiave pubblica: ${path.relative(REPO_DIR, pub)} (da committare)`);
}

// --------------------------------------------------------------- queue ---
// Memorie nuove o cambiate dall'ultimo giudizio: il giudice parte da qui
async function cmdQueue(args) {
  const { memories } = await fetchMemories();
  const ledger = loadLedger();
  const all = args.includes('--all');
  const items = memories.filter(live).filter((m) => all || ledger.memories[m.id]?.judgedHash !== hashOf(m))
    .map((m) => ({
      id: m.id,
      author: authorOf(m),
      type: m.type,
      project: m.project,
      title: m.title,
      content: m.content,
      concepts: m.concepts,
      files: m.files,
      createdAt: m.createdAt,
    }));
  const outIdx = args.indexOf('--out');
  const text = JSON.stringify(items, null, 1) + '\n';
  if (outIdx >= 0) {
    fs.writeFileSync(args[outIdx + 1], text, 'utf8');
    log(`${items.length} memorie da giudicare -> ${args[outIdx + 1]}`);
  } else {
    process.stdout.write(text);
  }
}

// ------------------------------------------------------------- verdict ---
// FILE: [{ id, verdict: correct|doubtful|wrong|unverifiable, confidence: 0..1,
//          reason, supports: [id], contradicts: [id] }]
async function cmdVerdict(args) {
  const file = args[0] || die('manca il file dei verdetti');
  const verdicts = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(verdicts)) die('il file deve contenere un array di verdetti');
  const { memories } = await fetchMemories();
  const byId = new Map(memories.map((m) => [m.id, m]));
  const ledger = loadLedger();
  const at = new Date().toISOString();
  let ok = 0;
  for (const v of verdicts) {
    const m = byId.get(v.id);
    if (!m) { log(`salto ${v.id}: non esiste in agentmemory`); continue; }
    if (!(v.verdict in P.judge)) { log(`salto ${v.id}: verdetto "${v.verdict}" non valido`); continue; }
    const conf = Math.max(0, Math.min(1, Number(v.confidence ?? 0.5)));
    const entry = (ledger.memories[v.id] ??= { events: [] });
    // un nuovo giudizio sostituisce il precedente
    entry.events = entry.events.filter((e) => e.kind !== 'judge');
    entry.events.push({ at, kind: 'judge', verdict: v.verdict, confidence: conf, reason: String(v.reason || '').slice(0, 500) });
    entry.judgedHash = hashOf(m);
    for (const [list, kind] of [[v.supports, 'supported-by'], [v.contradicts, 'contradicted-by']]) {
      for (const target of list || []) {
        if (!byId.has(target) || target === v.id) continue;
        // un autore non si conferma da solo
        if (authorOf(byId.get(target)) === authorOf(m) && authorOf(m) !== UNKNOWN) continue;
        const t = (ledger.memories[target] ??= { events: [] });
        t.events = t.events.filter((e) => !(e.kind === kind && e.from === v.id));
        t.events.push({ at, kind, from: v.id, confidence: conf });
      }
    }
    ok++;
  }
  saveLedger(ledger);
  log(`${ok}/${verdicts.length} verdetti registrati. Ora: rebalance`);
}

// --------------------------------------------------------------- admin ---
// Unico intervento umano sui voti: solo da chi ha accesso al server
function cmdAdmin(args) {
  const [id, action, ...why] = args;
  const actions = ['up', 'down', 'publish', 'retract', 'auto'];
  if (!id || !actions.includes(action)) die(`uso: admin ID ${actions.join('|')} "motivo"`);
  const ledger = loadLedger();
  const entry = (ledger.memories[id] ??= { events: [] });
  const at = new Date().toISOString();
  const reason = why.join(' ');
  if (action === 'up' || action === 'down') {
    entry.events = entry.events.filter((e) => e.kind !== 'admin');
    entry.events.push({ at, kind: 'admin', vote: action === 'up' ? 1 : -1, reason });
  } else if (action === 'auto') {
    delete entry.force;
  } else {
    entry.force = { action, at, reason };
  }
  saveLedger(ledger);
  log(`${id}: ${action} registrato. Ora: rebalance e publish`);
}

// ----------------------------------------------------------- rebalance ---
const decay = (at, now) => Math.pow(0.5, Math.max(0, now - Date.parse(at)) / 86400000 / P.halfLifeDays);

// Prove a favore/contro di una memoria, gia' pesate e decadute
function evidence(events, now) {
  let a = 0, b = 0;
  const add = (w, at) => { const x = w * decay(at, now); if (x >= 0) a += x; else b -= x; };
  for (const e of events || []) {
    if (e.kind === 'judge') add(P.judge[e.verdict] * e.confidence, e.at);
    else if (e.kind === 'supported-by') add(P.link * e.confidence, e.at);
    else if (e.kind === 'contradicted-by') add(-P.link * e.confidence, e.at);
    else if (e.kind === 'admin') add(P.adminVote * e.vote, e.at);
  }
  return { a, b };
}

async function cmdRebalance(args) {
  const dryRun = args.includes('--dry-run');
  const { memories } = await fetchMemories();
  const ledger = loadLedger();
  const now = Date.now();

  // 1. reputazione degli autori, dalle sole prove (prior neutro 1/1),
  //    cosi' voto e reputazione non si rincorrono
  const perAuthor = new Map();
  for (const m of memories.filter(live)) {
    const { a, b } = evidence(ledger.memories[m.id]?.events, now);
    if (a + b === 0) continue; // mai giudicata: non dice niente sull'autore
    const author = authorOf(m);
    const s = perAuthor.get(author) || { n: 0, sum: 0 };
    s.n++; s.sum += (1 + a) / (2 + a + b);
    perAuthor.set(author, s);
  }
  const authors = {};
  for (const [author, s] of perAuthor) {
    authors[author] = { memories: s.n, reputation: round((0.5 * P.repSmoothing + s.sum) / (P.repSmoothing + s.n)) };
  }
  const rep = (author) => (author === UNKNOWN ? 0.5 : authors[author]?.reputation ?? 0.5);

  // 2. voto di ogni memoria: prior dell'autore + prove
  let changed = 0;
  for (const m of memories) {
    const entry = (ledger.memories[m.id] ??= { events: [] });
    const author = authorOf(m);
    const { a, b } = evidence(entry.events, now);
    const alpha = P.priorWeight * rep(author) + a;
    const beta = P.priorWeight * (1 - rep(author)) + b;
    const score = round(alpha / (alpha + beta));
    if (entry.score !== score) changed++;
    Object.assign(entry, {
      title: String(m.title || '').slice(0, 120),
      author,
      pc: m.kbAuthor || UNKNOWN,
      status: live(m) ? 'attiva' : 'superata',
      score,
      evidence: round(a + b),
    });
  }
  ledger.authors = authors;
  log(`${memories.length} memorie, ${changed} voti cambiati; autori: `
    + (Object.entries(authors).map(([k, v]) => `${k}=${v.reputation}`).join(', ') || 'nessun giudizio ancora'));
  if (!dryRun) saveLedger(ledger);
}

const round = (x) => Math.round(x * 100) / 100;

// ------------------------------------------------------------- publish ---
// Decide cosa vedono i PC. Niente voti nel file: solo memorie da condividere
// e id da ritirare. Isteresi tra publishAt e retractBelow, cosi' una memoria
// non entra ed esce a ogni giro.
async function cmdPublish(args) {
  const dryRun = args.includes('--dry-run');
  if (!fs.existsSync(ADMIN_KEY)) die(`manca ${ADMIN_KEY}: esegui prima "keygen"`);
  const { version, memories } = await fetchMemories();
  const ledger = loadLedger();
  const publish = [], retracted = new Set(ledger.retracted || []);
  let newlyRetracted = 0;
  for (const m of memories) {
    const e = ledger.memories[m.id];
    if (!e) continue;
    let share;
    if (e.force?.action === 'publish') share = true;
    else if (e.force?.action === 'retract') share = false;
    else if (!live(m)) share = false;
    else if (e.published) share = e.score >= P.retractBelow;
    else share = e.judgedHash === hashOf(m) && e.score >= P.publishAt;
    if (share) {
      publish.push(m);
      retracted.delete(m.id);
    } else if (e.published && !retracted.has(m.id)) {
      retracted.add(m.id);
      newlyRetracted++;
    }
    if (!dryRun) e.published = share;
  }
  log(`${publish.length} memorie condivise, ${newlyRetracted} ritirate in questo giro${dryRun ? ' (dry-run)' : ''}`);
  if (dryRun) return;
  // i ritiri restano nell'elenco: un PC che salta qualche giro li vede comunque
  ledger.retracted = [...retracted].sort();
  saveLedger(ledger);
  const curated = {
    version,
    generatedAt: new Date().toISOString(),
    publish: publish.sort((x, y) => (x.id < y.id ? -1 : 1)),
    retract: ledger.retracted,
  };
  const p = signCurated(REPO_DIR, curated, fs.readFileSync(ADMIN_KEY, 'utf8'));
  log(`scritto e firmato ${path.relative(REPO_DIR, p.file)}`);
}

// ---------------------------------------------------------------- show ---
function cmdShow(args) {
  const ledger = loadLedger();
  const who = args.indexOf('--author') >= 0 ? args[args.indexOf('--author') + 1] : null;
  if (args[0] && args[0] !== '--author') {
    const e = ledger.memories[args[0]] || die(`${args[0]} non e' nel ledger`);
    console.log(JSON.stringify(e, null, 2));
    return;
  }
  const rows = Object.entries(ledger.memories).filter(([, e]) => e.status === 'attiva' && (!who || e.author === who))
    .sort((x, y) => (x[1].score ?? 1) - (y[1].score ?? 1));
  for (const [id, e] of rows) {
    const flag = e.force ? e.force.action : e.published ? 'condivisa' : '-';
    console.log(`${String(e.score).padEnd(5)} ${flag.padEnd(10)} ${(e.author || '').padEnd(12)} ${id}  ${e.title}`);
  }
  console.log('\nautori:', JSON.stringify(ledger.authors || {}));
}

// ---------------------------------------------------------------- main ---
const [cmd, ...rest] = process.argv.slice(2);
const cmds = {
  keygen: cmdKeygen, queue: cmdQueue, verdict: cmdVerdict, rebalance: cmdRebalance,
  publish: cmdPublish, admin: cmdAdmin, show: cmdShow,
};
if (!cmds[cmd]) die(`comando sconosciuto "${cmd || ''}". Comandi: ${Object.keys(cmds).join(', ')}`);
await cmds[cmd](rest);
