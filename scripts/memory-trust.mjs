#!/usr/bin/env node
// Voto di affidabilita' (0..1) per le memorie condivise di agentmemory.
// Gira sul PC server, accanto a memory-sync.mjs. Design: docs/memory-trust.md
//
// Il voto non e' un numero scritto a mano: si ricalcola ogni volta da zero a
// partire dalle "prove" raccolte, con un modello Beta:
//
//   voto = alpha / (alpha + beta)
//   alpha, beta = prior dell'autore + prove a favore / contro (con decadimento)
//
// Prove:
//   - verdetti del giudice (un agente sul server che rilegge le memorie nuove)
//   - conferme/smentite da memorie di altri autori (sempre dal giudice)
//   - voti umani: memories/trust/votes/<pc>.jsonl (uno per PC, niente conflitti)
//
// File:
//   memories/trust/ledger.json        scritto SOLO dal server (prove + voti calcolati)
//   memories/trust/votes/<pc>.jsonl   scritto SOLO dal PC <pc> (comando vote)
//   memories/trust/people.json        PC -> persona, a mano (facoltativo)
//
// Il voto finisce anche dentro agentmemory, cosi' arriva agli agenti senza
// strumenti nuovi: strength = 1..10 e, sotto soglia, un prefisso nel titolo
// "[⚠ affidabilita' 0.31]". Il record aggiornato si propaga con memory-sync.
//
// Uso:
//   node scripts/memory-trust.mjs queue   [--out FILE] [--all]   memorie da giudicare
//   node scripts/memory-trust.mjs verdict FILE                   registra i verdetti del giudice
//   node scripts/memory-trust.mjs rebalance [--dry-run]          ricalcola voti e reputazioni
//   node scripts/memory-trust.mjs apply     [--dry-run]          scrive i voti in agentmemory
//   node scripts/memory-trust.mjs vote ID up|down "motivo"       voto umano (da qualsiasi PC)
//   node scripts/memory-trust.mjs show [ID | --author NOME]      classifica, dettaglio o memorie di una persona
//
// Variabili: KB_MEMORY_URL, AGENTMEMORY_SECRET, KB_SYNC_NODE (come memory-sync.mjs)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRUST_DIR = process.env.KB_TRUST_DIR || path.join(REPO_DIR, 'memories', 'trust');
const LEDGER = path.join(TRUST_DIR, 'ledger.json');
const PEOPLE = path.join(TRUST_DIR, 'people.json');
const VOTES_DIR = path.join(TRUST_DIR, 'votes');

// Parametri del modello: cambiarli qui ricalcola tutto al prossimo rebalance
const P = {
  priorWeight: 2,          // quanto pesa la reputazione dell'autore (in "prove")
  repSmoothing: 4,         // memorie "finte" a 0.5 nella reputazione: pochi dati -> 0.5
  halfLifeDays: 180,       // dopo 6 mesi una prova vale la meta'
  judge: { correct: 2, doubtful: -0.75, wrong: -2, unverifiable: 0 },
  link: 1,                 // conferma/smentita da un'altra memoria (x confidenza)
  humanVote: 3,            // voto umano
  warnBelow: 0.4,          // sotto questa soglia il titolo prende il prefisso ⚠
};
const TAG_RE = /^\[⚠ affidabilit[aà]'? [0-9.]+\] /;
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
  return { version: data.version, memories: data.memories };
}

// -------------------------------------------------------------- ledger ---
function loadLedger() {
  if (!fs.existsSync(LEDGER)) return { version: 1, updatedAt: null, authors: {}, memories: {} };
  return JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
}

function saveLedger(ledger) {
  ledger.updatedAt = new Date().toISOString();
  fs.mkdirSync(TRUST_DIR, { recursive: true });
  const sorted = Object.fromEntries(Object.keys(ledger.memories).sort().map((k) => [k, ledger.memories[k]]));
  const text = JSON.stringify({ ...ledger, memories: sorted }, null, 1) + '\n';
  fs.writeFileSync(`${LEDGER}.tmp`, text, 'utf8');
  fs.renameSync(`${LEDGER}.tmp`, LEDGER);
}

const bareTitle = (t) => String(t || '').replace(TAG_RE, '');
const hashOf = (m) => crypto.createHash('sha256')
  .update(`${bareTitle(m.title)}\n${m.content || ''}`).digest('hex').slice(0, 16);
// kbAuthor = PC che ha scritto la memoria, lo mette memory-sync all'export
// (docs/memory-trust-sync-change.md). people.json raggruppa i PC per persona:
// { "pc-ufficio": "francesco", "laptop-fra": "francesco", "pc-mario": "mario" }
// cosi' la reputazione e' della persona, non della macchina.
let people;
function personOf(node) {
  people ??= fs.existsSync(PEOPLE) ? JSON.parse(fs.readFileSync(PEOPLE, 'utf8')) : {};
  return people[node] || node;
}
const authorOf = (m) => (m.kbAuthor ? personOf(m.kbAuthor) : UNKNOWN);
const live = (m) => m.isLatest !== false && !m.deleted;

function nodeName() {
  const name = process.env.KB_SYNC_NODE || os.hostname().split('.')[0];
  return name.replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase() || 'pc';
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
      title: bareTitle(m.title),
      content: m.content,
      concepts: m.concepts,
      files: m.files,
      createdAt: m.createdAt,
      currentScore: ledger.memories[m.id]?.score ?? null,
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
  const by = nodeName();
  let ok = 0;
  for (const v of verdicts) {
    const m = byId.get(v.id);
    if (!m) { log(`salto ${v.id}: non esiste in agentmemory`); continue; }
    if (!(v.verdict in P.judge)) { log(`salto ${v.id}: verdetto "${v.verdict}" non valido`); continue; }
    const conf = Math.max(0, Math.min(1, Number(v.confidence ?? 0.5)));
    const entry = (ledger.memories[v.id] ??= { events: [] });
    // un nuovo giudizio sostituisce il precedente dello stesso giudice
    entry.events = entry.events.filter((e) => e.kind !== 'judge');
    entry.events.push({ at, kind: 'judge', verdict: v.verdict, confidence: conf, reason: String(v.reason || '').slice(0, 500), by });
    entry.judgedHash = hashOf(m);
    for (const [list, kind] of [[v.supports, 'supported-by'], [v.contradicts, 'contradicted-by']]) {
      for (const target of list || []) {
        if (!byId.has(target) || target === v.id) continue;
        // conferme dallo stesso autore non contano: un collega non si autoconferma
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

// ----------------------------------------------------------- rebalance ---
function readVotes() {
  const votes = [];
  if (!fs.existsSync(VOTES_DIR)) return votes;
  for (const f of fs.readdirSync(VOTES_DIR).filter((n) => n.endsWith('.jsonl')).sort()) {
    const voter = personOf(f.slice(0, -6));
    for (const line of fs.readFileSync(path.join(VOTES_DIR, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const v = JSON.parse(line);
        if (v.id && (v.vote === 1 || v.vote === -1)) votes.push({ ...v, voter });
      } catch { /* riga rovinata: si ignora */ }
    }
  }
  return votes;
}

const decay = (at, now) => Math.pow(0.5, Math.max(0, now - Date.parse(at)) / 86400000 / P.halfLifeDays);

// Prove a favore/contro di una memoria, gia' pesate e decadute
function evidence(events, votes, author, now) {
  let a = 0, b = 0;
  const add = (w, at) => { const x = w * decay(at, now); if (x >= 0) a += x; else b -= x; };
  for (const e of events || []) {
    if (e.kind === 'judge') add(P.judge[e.verdict] * e.confidence, e.at);
    else if (e.kind === 'supported-by') add(P.link * e.confidence, e.at);
    else if (e.kind === 'contradicted-by') add(-P.link * e.confidence, e.at);
  }
  // l'ultimo voto di ogni PC conta; l'autore non vota se stesso
  const last = new Map();
  for (const v of votes) if (v.voter !== author && (!last.has(v.voter) || v.at > last.get(v.voter).at)) last.set(v.voter, v);
  for (const v of last.values()) add(P.humanVote * v.vote, v.at);
  return { a, b };
}

async function cmdRebalance(args) {
  const dryRun = args.includes('--dry-run');
  const { memories } = await fetchMemories();
  const ledger = loadLedger();
  const votes = readVotes();
  const now = Date.now();
  const votesById = new Map();
  for (const v of votes) (votesById.get(v.id) ?? votesById.set(v.id, []).get(v.id)).push(v);

  // 1. reputazione degli autori, dalle sole prove (prior neutro 1/1),
  //    cosi' voto e reputazione non si rincorrono
  const perAuthor = new Map();
  for (const m of memories.filter(live)) {
    const author = authorOf(m);
    const { a, b } = evidence(ledger.memories[m.id]?.events, votesById.get(m.id) || [], author, now);
    if (a + b === 0) continue; // mai giudicata: non dice niente sull'autore
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
    const { a, b } = evidence(entry.events, votesById.get(m.id) || [], author, now);
    const alpha = P.priorWeight * rep(author) + a;
    const beta = P.priorWeight * (1 - rep(author)) + b;
    const score = round(alpha / (alpha + beta));
    if (entry.score !== score) changed++;
    Object.assign(entry, {
      title: bareTitle(m.title).slice(0, 120),
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

// --------------------------------------------------------------- apply ---
// Riporta il voto dentro agentmemory: strength 1..10 e prefisso ⚠ nel titolo.
// updatedAt avanza, quindi memory-sync propaga il record agli altri PC.
async function cmdApply(args) {
  const dryRun = args.includes('--dry-run');
  const { version, memories } = await fetchMemories();
  const ledger = loadLedger();
  const now = new Date().toISOString();
  const out = [];
  for (const m of memories.filter(live)) {
    const e = ledger.memories[m.id];
    if (!e || e.score == null) continue;
    const strength = Math.max(1, Math.min(10, Math.round(1 + 9 * e.score)));
    const title = (e.score < P.warnBelow ? `[⚠ affidabilità ${e.score.toFixed(2)}] ` : '') + bareTitle(m.title);
    if (m.strength === strength && m.title === title && m.kbTrust === e.score) continue;
    out.push({ ...m, strength, title, kbTrust: e.score, updatedAt: now });
  }
  log(`${out.length} memorie da aggiornare in agentmemory${dryRun ? ' (dry-run)' : ''}`);
  for (const m of out.slice(0, 10)) log(`  ${m.id}  ${m.kbTrust}  ${m.title.slice(0, 70)}`);
  if (dryRun || !out.length) return;
  const res = await api('POST', '/agentmemory/import', {
    exportData: { version, exportedAt: now, sessions: [], memories: out, summaries: [] },
    strategy: 'merge',
  });
  if (res && res.success === false) die(`import fallito: ${res.error}`);
  log('fatto. Lancia memory-sync per propagare agli altri PC');
}

// ---------------------------------------------------------------- vote ---
async function cmdVote(args) {
  const [id, dir, ...why] = args;
  if (!id || !['up', 'down'].includes(dir)) die('uso: vote ID up|down "motivo"');
  const node = nodeName();
  const file = path.join(VOTES_DIR, `${node}.jsonl`);
  fs.mkdirSync(VOTES_DIR, { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), id, vote: dir === 'up' ? 1 : -1, reason: why.join(' ') }) + '\n');
  log(`voto registrato in ${path.relative(REPO_DIR, file)}: committalo con il prossimo sync`);
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
  for (const [id, e] of rows) console.log(`${String(e.score).padEnd(5)} ${String(e.evidence ?? 0).padEnd(5)} ${(e.author || '').padEnd(14)} ${id}  ${e.title}`);
  console.log('\nautori:', JSON.stringify(ledger.authors || {}));
}

// ---------------------------------------------------------------- main ---
const [cmd, ...rest] = process.argv.slice(2);
const cmds = { queue: cmdQueue, verdict: cmdVerdict, rebalance: cmdRebalance, apply: cmdApply, vote: cmdVote, show: cmdShow };
if (!cmds[cmd]) die(`comando sconosciuto "${cmd || ''}". Comandi: ${Object.keys(cmds).join(', ')}`);
await cmds[cmd](rest);
