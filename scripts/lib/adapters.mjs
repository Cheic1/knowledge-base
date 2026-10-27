// adapters.mjs - I programmi che usano la KB: dove sta la loro config MCP, come
// capire se sono installati e come provarli. Per aggiungere un programma basta una
// voce in ADAPTERS (e un test in test/adapters.test.mjs).
//
// ctx = { home, platform, env, has(cmd), run(cmd, args) }: tutto cio' che tocca la
// macchina passa da qui, cosi' i test girano su una HOME finta.
import fs from 'node:fs';
import path from 'node:path';
import { claudeAddArgs, claudeEntryMatches, mergeCodex, mergeHermes, mergeMcpServers, mergeOpenCode, mergeVsCode } from './agents.mjs';

const exists = (p) => fs.existsSync(p);
const win = (ctx) => ctx.platform === 'win32';
const appData = (ctx) => ctx.env.APPDATA || path.join(ctx.home, 'AppData', 'Roaming');
const localAppData = (ctx) => ctx.env.LOCALAPPDATA || path.join(ctx.home, 'AppData', 'Local');

// Cartella utente di VS Code (anche le estensioni come Cline ci tengono la config)
function vscodeUserDir(ctx) {
  const cands = win(ctx) ? [path.join(appData(ctx), 'Code', 'User')]
    : [path.join(ctx.home, '.config', 'Code', 'User'), path.join(ctx.home, 'Library', 'Application Support', 'Code', 'User')];
  return cands.find(exists) || null;
}

// Claude Desktop: anche la versione del Microsoft Store, che tiene i file in Packages
function claudeDesktopDirs(ctx) {
  if (win(ctx)) {
    const dirs = [path.join(appData(ctx), 'Claude')];
    const pk = path.join(localAppData(ctx), 'Packages');
    if (exists(pk)) {
      for (const d of fs.readdirSync(pk).filter((n) => /^Claude_/.test(n))) dirs.push(path.join(pk, d, 'LocalCache', 'Roaming', 'Claude'));
    }
    return dirs.filter(exists);
  }
  const d = ctx.platform === 'darwin' ? path.join(ctx.home, 'Library', 'Application Support', 'Claude') : path.join(ctx.home, '.config', 'Claude');
  return exists(d) ? [d] : [];
}

function clineDirs(ctx) {
  const vs = vscodeUserDir(ctx);
  return [vs && path.join(vs, 'globalStorage', 'saoudrizwan.claude-dev', 'settings'), path.join(ctx.home, '.cline', 'data', 'settings')]
    .filter((d) => d && exists(d));
}

const ANTIGRAVITY_FILES = ['antigravity', 'antigravity-ide', 'config'].map((d) => ['.gemini', d, 'mcp_config.json']);
const cursorApp = (ctx) => ctx.has('cursor') || exists(path.join(localAppData(ctx), 'Programs', 'cursor')) || exists('/Applications/Cursor.app');

const SEARCH = 'usa lo strumento memory_smart_search per cercare kb-test e rispondi solo con i titoli trovati';

// format: 'json' (merge su oggetto), 'text' (merge su testo) o 'claude' (CLI)
// detect: il programma e' installato? (una config senza programma non conta, salvo --all)
// files: i file di config da scrivere; headless: comando non interattivo per `kb test --deep`
export const ADAPTERS = [
  {
    id: 'claude-code', label: 'Claude Code', format: 'claude',
    detect: (ctx) => ctx.has('claude'),
    files: (ctx) => [path.join(ctx.home, '.claude.json')],
    headless: ['claude', '-p', SEARCH, '--allowedTools', 'mcp__agentmemory__memory_smart_search'],
  },
  {
    id: 'opencode', label: 'OpenCode (CLI e Desktop)', format: 'json', merge: mergeOpenCode,
    detect: (ctx) => ctx.has('opencode') || exists(path.join(ctx.home, '.config', 'opencode')),
    files: (ctx) => [path.join(ctx.home, '.config', 'opencode', 'opencode.json')],
    headless: ['opencode', 'run', SEARCH],
  },
  {
    id: 'gemini-cli', label: 'Gemini CLI', format: 'json', merge: mergeMcpServers,
    detect: (ctx) => ctx.has('gemini'),
    files: (ctx) => [path.join(ctx.home, '.gemini', 'settings.json')],
    headless: ['gemini', '-y', '-p', SEARCH],
  },
  {
    id: 'vscode', label: 'VS Code / Copilot', format: 'json', merge: mergeVsCode,
    detect: (ctx) => Boolean(vscodeUserDir(ctx)),
    files: (ctx) => [path.join(vscodeUserDir(ctx), 'mcp.json')],
  },
  {
    id: 'cline', label: 'Cline', format: 'json', merge: (c, s) => mergeMcpServers(c, s, { disabled: false }),
    detect: (ctx) => clineDirs(ctx).length > 0,
    files: (ctx) => clineDirs(ctx).map((d) => path.join(d, 'cline_mcp_settings.json')),
  },
  {
    id: 'claude-desktop', label: 'Claude Desktop', format: 'json', merge: mergeMcpServers,
    detect: (ctx) => claudeDesktopDirs(ctx).length > 0,
    files: (ctx) => claudeDesktopDirs(ctx).map((d) => path.join(d, 'claude_desktop_config.json')),
  },
  {
    id: 'antigravity', label: 'Antigravity (IDE e agy)', format: 'json', merge: mergeMcpServers,
    // solo i file che esistono: il percorso cambia tra IDE e CLI
    detect: (ctx) => ANTIGRAVITY_FILES.some((f) => exists(path.join(ctx.home, ...f))),
    files: (ctx) => ANTIGRAVITY_FILES.map((f) => path.join(ctx.home, ...f)).filter(exists),
  },
  {
    id: 'cursor', label: 'Cursor', format: 'json', merge: mergeMcpServers,
    detect: cursorApp, detectAll: (ctx) => exists(path.join(ctx.home, '.cursor')),
    files: (ctx) => [path.join(ctx.home, '.cursor', 'mcp.json')],
  },
  {
    id: 'windsurf', label: 'Windsurf', format: 'json', merge: mergeMcpServers,
    detect: (ctx) => exists(path.join(ctx.home, '.codeium', 'windsurf')),
    files: (ctx) => [path.join(ctx.home, '.codeium', 'windsurf', 'mcp_config.json')],
  },
  {
    id: 'codex', label: 'Codex CLI', format: 'text', merge: mergeCodex,
    detect: (ctx) => ctx.has('codex'),
    files: (ctx) => [path.join(ctx.home, '.codex', 'config.toml')],
  },
  {
    id: 'hermes', label: 'Hermes', format: 'text', merge: mergeHermes,
    detect: (ctx) => exists(path.join(ctx.home, '.hermes', 'config.yaml')),
    files: (ctx) => [path.join(ctx.home, '.hermes', 'config.yaml')],
  },
];

// Programmi da gestire: installati, oppure anche solo con la config (--all), oppure --only
export function selectAdapters(ctx, { all = false, only = null } = {}) {
  return ADAPTERS.filter((a) => (only ? only.includes(a.id) : a.detect(ctx) || (all && a.detectAll?.(ctx))));
}

function backupOnce(file) {
  const bak = `${file}.bak-kb`;
  if (exists(file) && !exists(bak)) fs.copyFileSync(file, bak);
}

// Un file: { file, changed, error }. Scrive solo se cambia qualcosa e non e' dryRun.
function applyFile(a, file, servers, dryRun) {
  const before = exists(file) ? fs.readFileSync(file, 'utf8') : '';
  let after;
  if (a.format === 'json') {
    let cfg = {};
    if (before.trim()) {
      try { cfg = JSON.parse(before); } catch { return { file, changed: false, error: 'KB-JSON: non e\' JSON valido, non lo tocco' }; }
    }
    const next = a.merge(cfg, servers);
    if (JSON.stringify(next) === JSON.stringify(cfg)) return { file, changed: false };
    after = JSON.stringify(next, null, 2) + '\n';
  } else {
    after = a.merge(before, servers);
    if (after === before || (!before && !after.trim())) return { file, changed: false };
  }
  if (!dryRun) {
    backupOnce(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, after);
  }
  return { file, changed: true };
}

// Claude Code si configura con la sua CLI; la verifica legge ~/.claude.json
function applyClaude(ctx, a, servers, dryRun) {
  const file = a.files(ctx)[0];
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers || {}; } catch { /* nessuna config ancora */ }
  const todo = Object.entries(servers).filter(([n, s]) => (s ? !claudeEntryMatches(cur[n], s) : Boolean(cur[n])));
  if (!todo.length || dryRun) return [{ file, changed: todo.length > 0 }];
  for (const [name, s] of todo) {
    ctx.run('claude', ['mcp', 'remove', '--scope', 'user', name]);
    if (!s) continue;
    const r = ctx.run('claude', claudeAddArgs(name, s, win(ctx)));
    if (r.status !== 0) return [{ file, changed: false, error: `claude mcp add ${name}: ${r.out}` }];
  }
  return [{ file, changed: true }];
}

// Scrive (o con dryRun controlla soltanto) le voci `servers` nel programma `a`.
// servers: { nome: {command, env} | null } (null = togli). Ritorna un risultato per file.
export function applyAdapter(ctx, a, servers, { dryRun = false } = {}) {
  if (a.format === 'claude') return applyClaude(ctx, a, servers, dryRun);
  return a.files(ctx).map((f) => applyFile(a, f, servers, dryRun));
}

// Rimette i backup .bak-kb fatti alla prima modifica
export function restoreAdapter(ctx, a) {
  return a.files(ctx).filter((f) => exists(`${f}.bak-kb`)).map((f) => { fs.copyFileSync(`${f}.bak-kb`, f); return f; });
}

// Percorsi di altri clone di knowledge-base citati nelle config (es. llm-wiki-mcp di un clone vecchio)
export function clonesInConfigs(ctx, repo) {
  const found = new Set();
  for (const a of ADAPTERS) {
    let files = [];
    try { files = a.files(ctx); } catch { continue; }
    for (const f of files) {
      if (!exists(f)) continue;
      const text = fs.readFileSync(f, 'utf8').replace(/\\\\/g, '\\');
      for (const m of text.matchAll(/([A-Za-z]:[\\/]|\/)[^"'\n]*?knowledge-base(?=[\\/])/g)) {
        const p = path.resolve(m[0]);
        if (p !== path.resolve(repo) && exists(path.join(p, '.git'))) found.add(p);
      }
    }
  }
  return [...found];
}
