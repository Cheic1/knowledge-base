#!/usr/bin/env node
// Importa in agentmemory le memorie "native" degli altri agenti presenti sul PC
// (CLAUDE.md, AGENTS.md, regole Cursor/Copilot/Windsurf/Cline, memorie Hermes...),
// cosi' ogni agente collegato via MCP le ritrova con memory_smart_search e
// memory-sync.mjs le porta sugli altri PC.
//
// Ogni file viene spezzato per titoli (## ...) in blocchi e salvato con
// POST /agentmemory/remember. Un blocco gia' importato e invariato non viene
// rimandato (stato in ~/.agentmemory/imported-agent-memories.json); un blocco
// modificato viene risalvato e agentmemory lo marca come nuova versione della
// memoria precedente (supersession per similarita').
//
// Blocchi che sembrano contenere segreti (API key, token, chiavi private)
// vengono SALTATI: le memorie finiscono nel repo git.
//
// Uso:
//   node scripts/import-agent-memories.mjs [--dry-run] [--root DIR ...] [--depth N]
//
//   --root   cartelle dove cercare i file di progetto (CLAUDE.md, AGENTS.md, ...).
//            Ripetibile. Default: la home, profondita' 4.
//   --depth  profondita' massima della ricerca nei root (default 4)
//
// Variabili: KB_MEMORY_URL (default http://127.0.0.1:3111), AGENTMEMORY_SECRET
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const STATE_FILE = path.join(HOME, '.agentmemory', 'imported-agent-memories.json');
const MAX_CHUNK = 4000;

// File globali per agente (percorsi relativi alla home). '*' = tutti i file della cartella.
const GLOBAL_SOURCES = [
  { agent: 'claude-code', files: ['.claude/CLAUDE.md'] },
  { agent: 'claude-code', dirs: ['.claude/projects/*/memory'] },        // auto-memory per progetto
  { agent: 'codex', files: ['.codex/AGENTS.md'] },
  { agent: 'opencode', files: ['.config/opencode/AGENTS.md'] },
  { agent: 'gemini', files: ['.gemini/GEMINI.md'] },
  { agent: 'hermes', files: ['.hermes/memories/MEMORY.md', '.hermes/memories/USER.md', '.hermes/SOUL.md'] },
  { agent: 'cursor', dirs: ['.cursor/rules'] },
  { agent: 'windsurf', files: ['.codeium/windsurf/memories/global_rules.md'], dirs: ['.codeium/windsurf/memories'] },
  { agent: 'cline', dirs: ['Documents/Cline/Rules'] },
  { agent: 'copilot', files: ['.config/github-copilot/instructions.md'] },
];

// File di progetto cercati sotto i root
const PROJECT_FILES = {
  'CLAUDE.md': 'claude-code',
  'CLAUDE.local.md': 'claude-code',
  'AGENTS.md': 'agents-md',
  'GEMINI.md': 'gemini',
  '.cursorrules': 'cursor',
  '.windsurfrules': 'windsurf',
  '.clinerules': 'cline',
  'copilot-instructions.md': 'copilot',   // solo dentro .github/
};
const PROJECT_DIRS = { '.cursor/rules': 'cursor', '.clinerules': 'cline', '.github/instructions': 'copilot' };
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', '.npm', '.nvm', 'Library', 'AppData', '.venv',
  'venv', '__pycache__', 'dist', 'build', '.Trash', 'snap', '.local', '.cargo', '.rustup', 'go', '.m2', '.gradle']);
const TEXT_EXT = /\.(md|mdc|txt)$|^[^.]+$|^\.(cursorrules|windsurfrules|clinerules)$/;

const SECRET_RE = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|glpat-[A-Za-z0-9_-]{20,})\b/,
  /\b(api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*['"]?[A-Za-z0-9_\-\/+=.]{12,}/i,
];

const log = (m) => console.log(`[import-agent-memories] ${m}`);

function parseArgs(argv) {
  const a = { dryRun: false, roots: [], depth: 4 };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--dry-run') a.dryRun = true;
    else if (x === '--root') a.roots.push(argv[++i]);
    else if (x === '--depth') a.depth = Number(argv[++i]);
    else if (x === '-h' || x === '--help') {
      console.log('Uso: node scripts/import-agent-memories.mjs [--dry-run] [--root DIR ...] [--depth N]');
      process.exit(0);
    } else { log(`argomento sconosciuto: ${x}`); process.exit(1); }
  }
  if (!a.roots.length) a.roots = [HOME];
  a.roots = a.roots.map((r) => path.resolve(r.replace(/^~(?=$|[\\/])/, HOME)));
  return a;
}

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// Espande un solo '*' come segmento di percorso
function expand(rel) {
  const parts = rel.split('/');
  let found = [HOME];
  for (const part of parts) {
    const next = [];
    for (const base of found) {
      if (part === '*') {
        if (isDir(base)) for (const e of fs.readdirSync(base)) next.push(path.join(base, e));
      } else next.push(path.join(base, part));
    }
    found = next;
  }
  return found;
}

function filesIn(dir) {
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir).map((e) => path.join(dir, e)).filter((p) => isFile(p) && TEXT_EXT.test(path.basename(p)));
}

function collectGlobal() {
  const out = [];
  for (const s of GLOBAL_SOURCES) {
    for (const f of s.files || []) for (const p of expand(f)) if (isFile(p)) out.push({ path: p, agent: s.agent });
    for (const d of s.dirs || []) for (const p of expand(d)) for (const f of filesIn(p)) out.push({ path: f, agent: s.agent });
  }
  return out;
}

function collectProjects(root, maxDepth) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile()) {
        const agent = PROJECT_FILES[e.name];
        if (!agent) continue;
        if (e.name === 'copilot-instructions.md' && path.basename(dir) !== '.github') continue;
        out.push({ path: full, agent, project: path.basename(e.name === 'copilot-instructions.md' ? path.dirname(dir) : dir) });
      }
    }
    for (const [rel, agent] of Object.entries(PROJECT_DIRS)) {
      for (const f of filesIn(path.join(dir, rel))) out.push({ path: f, agent, project: path.basename(dir) });
    }
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

// Spezza per titoli ## (o # se non ce ne sono), poi per lunghezza
function chunk(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, ''); // frontmatter
  const level = /^## /m.test(body) ? /^(?=## )/m : /^(?=# )/m;
  const pieces = [];
  for (const sec of body.split(level)) {
    let s = sec.trim();
    while (s.length > MAX_CHUNK) {
      const cut = s.lastIndexOf('\n\n', MAX_CHUNK) > MAX_CHUNK / 2 ? s.lastIndexOf('\n\n', MAX_CHUNK) : MAX_CHUNK;
      pieces.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (s.length >= 40) pieces.push(s);
  }
  return pieces;
}

async function remember(body) {
  const base = (process.env.KB_MEMORY_URL || 'http://127.0.0.1:3111').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.AGENTMEMORY_SECRET) headers.Authorization = `Bearer ${process.env.AGENTMEMORY_SECRET}`;
  const res = await fetch(`${base}/agentmemory/remember`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* primo giro */ }

  const seen = new Set();
  const sources = [...collectGlobal(), ...a.roots.flatMap((r) => collectProjects(r, a.depth))]
    .filter((s) => !seen.has(s.path) && seen.add(s.path));
  log(`${sources.length} file trovati`);

  const stats = { saved: 0, unchanged: 0, secrets: 0, errors: 0 };
  for (const src of sources) {
    let text;
    try { text = fs.readFileSync(src.path, 'utf8'); } catch { continue; }
    const rel = src.path.startsWith(HOME) ? `~${src.path.slice(HOME.length)}` : src.path;
    const chunks = chunk(text);
    let fileSaved = 0;
    for (const [i, c] of chunks.entries()) {
      const key = `${src.path}#${i}`;
      const hash = crypto.createHash('sha256').update(c).digest('hex').slice(0, 16);
      if (state[key] === hash) { stats.unchanged++; continue; }
      if (SECRET_RE.some((re) => re.test(c))) {
        stats.secrets++;
        log(`SALTATO (possibile segreto): ${rel} blocco ${i + 1}`);
        continue;
      }
      const content = `[${src.agent}${src.project ? ` · ${src.project}` : ''} · ${rel}]\n${c}`;
      if (a.dryRun) { fileSaved++; continue; }
      try {
        await remember({
          content,
          type: 'preference',
          concepts: ['agent-memory-import', src.agent, ...(src.project ? [src.project] : [])],
          files: [rel],
          ...(src.project ? { project: src.project } : {}),
          agentId: `import:${src.agent}`,
        });
        state[key] = hash;
        fileSaved++;
      } catch (e) {
        stats.errors++;
        log(`errore su ${rel} blocco ${i + 1}: ${e.cause?.code || e.message}`);
        if (e.cause?.code === 'ECONNREFUSED') { log("agentmemory non raggiungibile: e' avviato?"); process.exit(1); }
      }
    }
    stats.saved += fileSaved;
    if (fileSaved) log(`${a.dryRun ? 'da importare' : 'importato'}: ${rel} [${src.agent}] ${fileSaved}/${chunks.length} blocchi`);
  }

  if (!a.dryRun) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  }
  log(`fatto: ${stats.saved} blocchi ${a.dryRun ? 'da importare' : 'importati'}, ${stats.unchanged} invariati, `
    + `${stats.secrets} saltati per segreti, ${stats.errors} errori`);
  if (stats.saved && !a.dryRun) log('ora lancia node scripts/memory-sync.mjs per portarli sugli altri PC');
}

main();
