#!/usr/bin/env node
// kb.mjs - Installazione unica e aggiornamento automatico della knowledge base.
//
// Un solo comando per ogni macchina (server Linux, PC Windows, PC Linux/macOS):
//
//   node scripts/kb.mjs install [--role server|pc] [--wiki-search] [--every 15]
//   node scripts/kb.mjs update  [--quiet]      # lo lancia da solo la sync automatica
//   node scripts/kb.mjs status
//
// install (idempotente, si puo' rilanciare quando si vuole):
//   1. porta il clone sul branch principale del remote (main) e lo aggiorna
//   2. installa la versione di agentmemory fissata in package.json (uguale ovunque)
//   3. avvia agentmemory in locale e lo fa ripartire da solo:
//        server Linux -> unit systemd (scripts/install-systemd.sh, con kb-proxy e token)
//        Windows      -> attivita' "KB agentmemory" all'accesso, senza finestre
//        Linux/macOS  -> riga @reboot nella crontab
//   4. cabla gli agenti trovati su agentmemory locale: Claude Code, OpenCode, Hermes
//   5. sync delle memorie ogni N minuti + hook di Claude Code (schedule-memory-sync.mjs)
//   6. (--wiki-search) ricerca locale sulla wiki con qmd
//
// update: git pull dal remote da cui e' stato clonato (GitHub, GitLab, ...); se il
// codice e' cambiato riapplica solo cio' che serve. Lo chiama kb-auto-sync.mjs a ogni
// giro, quindi ogni macchina si aggiorna da sola. Log: ~/.agentmemory/kb-update.log
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const HOME = os.homedir();
const WIN = process.platform === 'win32';
const AM_HOME = path.join(HOME, '.agentmemory');
const STATE_FILE = path.join(AM_HOME, 'kb-install.json');
const UPDATE_LOG = path.join(AM_HOME, 'kb-update.log');
const AM_URL = 'http://127.0.0.1:3111';
const AM_TASK = 'KB agentmemory';
const AM_VBS = path.join(AM_HOME, 'kb-agentmemory.vbs');
const CRON_MARK = '# kb-agentmemory';
const PROXY_HINT = 'se sei dietro un proxy aziendale che blocca il remote prova, solo per questo repo: '
  + 'git config http.proxy ""';

// ------------------------------------------------------------- utilita' ---
let QUIET = false;
function log(m) {
  if (QUIET) {
    try {
      fs.mkdirSync(AM_HOME, { recursive: true });
      if (fs.existsSync(UPDATE_LOG) && fs.statSync(UPDATE_LOG).size > 512 * 1024) fs.writeFileSync(UPDATE_LOG, '');
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      fs.appendFileSync(UPDATE_LOG, `${stamp} ${m}\n`);
    } catch { /* il log non deve mai bloccare */ }
  } else console.log(`[kb] ${m}`);
}
const ok = (m) => log(`OK   ${m}`);
const warn = (m) => log(`WARN ${m}`);
function die(m) { log(`ERRORE ${m}`); process.exit(1); }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8', windowsHide: true, timeout: opts.timeout ?? 120000,
    cwd: opts.cwd ?? REPO, input: opts.input, env: opts.env ?? process.env,
    // su Windows npm/npx/claude sono .cmd: servono via shell
    shell: opts.shell ?? (WIN && ['npm', 'npx', 'claude', 'opencode'].includes(cmd)),
  });
  r.out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return r;
}
function has(cmd) {
  const r = WIN ? run('where', [cmd]) : run('sh', ['-c', `command -v ${cmd}`]);
  return r.status === 0;
}
function git(args, timeout = 90000) {
  const r = run('git', args, { timeout });
  if (r.error?.code === 'ETIMEDOUT') r.out = `git ${args[0]} bloccato da oltre ${timeout / 1000}s: ${PROXY_HINT}`;
  return r;
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
function backupOnce(file) {
  const bak = `${file}.bak-kb`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
}
const loadState = () => readJson(STATE_FILE, {});
const saveState = (s) => writeJson(STATE_FILE, s);

// ------------------------------------------------------------------ git ---
function defaultBranch() {
  const r = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  return r.status === 0 ? r.stdout.trim().replace(/^origin\//, '') : 'main';
}
const head = () => git(['rev-parse', 'HEAD']).stdout.trim();
const currentBranch = () => git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();

function busyGit() {
  const gd = path.join(REPO, '.git');
  return ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD'].some((f) => fs.existsSync(path.join(gd, f)));
}

// Porta il clone sul branch principale. I commit locali del branch vecchio (di solito
// solo memories/sync/<pc>.json) vengono uniti, cosi' nessuna memoria resta indietro.
function ensureMainBranch() {
  const main = defaultBranch();
  const cur = currentBranch();
  let f = git(['fetch', 'origin']);
  if (f.status !== 0) die(`git fetch: ${f.out}\n  ${PROXY_HINT}`);
  if (cur === main) return;
  log(`il clone e' sul branch '${cur}': passo a '${main}'`);
  const sw = git(['checkout', main]);
  if (sw.status !== 0) {
    const sw2 = git(['checkout', '-b', main, '--track', `origin/${main}`]);
    if (sw2.status !== 0) die(`non riesco a passare a ${main}: ${sw.out}`);
  }
  git(['branch', `--set-upstream-to=origin/${main}`, main]);
  pull(true);
  if (cur !== 'HEAD' && git(['rev-list', '--count', `${main}..${cur}`]).stdout.trim() !== '0') {
    const m = git(['merge', '--no-edit', cur]);
    if (m.status !== 0) {
      git(['merge', '--abort']);
      warn(`i commit locali di '${cur}' non si uniscono da soli a ${main}: restano su quel branch (${m.out.split('\n')[0]})`);
    } else {
      ok(`commit locali di '${cur}' uniti in ${main}`);
      const p = git(['push']);
      if (p.status !== 0) warn(`push dopo l'unione non riuscito, lo rifara' la sync: ${p.out.split('\n')[0]}`);
    }
  }
}

function pull(strict) {
  if (busyGit()) { if (strict) die('git ha un merge/rebase in corso nel clone: risolvilo prima'); return false; }
  const r = git(['pull', '--rebase', '--autostash']);
  if (r.status !== 0) {
    git(['rebase', '--abort']);
    if (strict) die(`git pull: ${r.out}\n  ${PROXY_HINT}`);
    warn(`git pull non riuscito, riprovo al prossimo giro: ${r.out.split('\n')[0]}`);
    return false;
  }
  return true;
}

// ---------------------------------------------------------- agentmemory ---
function pinnedVersion() {
  const pkg = readJson(path.join(REPO, 'package.json'), {});
  return String(pkg.dependencies?.['@agentmemory/agentmemory'] || '').replace(/^[\^~=]/, '');
}
function installedVersion() {
  return readJson(path.join(REPO, 'node_modules', '@agentmemory', 'agentmemory', 'package.json'), {}).version || '';
}
function amCli() {
  return path.join(REPO, 'node_modules', '@agentmemory', 'agentmemory', 'dist', 'cli.mjs');
}

function npmInstall() {
  if (installedVersion() === pinnedVersion() && fs.existsSync(amCli())) return;
  log(`installo le dipendenze del repo (agentmemory ${pinnedVersion()})...`);
  const r = run('npm', ['install', '--no-audit', '--no-fund', '--omit=dev'], { timeout: 15 * 60000 });
  if (r.status !== 0) die(`npm install: ${r.out.split('\n').slice(-8).join('\n')}`);
  if (!fs.existsSync(amCli())) die('npm install riuscito ma agentmemory non e\' in node_modules');
  ok(`agentmemory ${installedVersion()} in node_modules`);
}

async function health() {
  try {
    const res = await fetch(`${AM_URL}/agentmemory/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function waitHealthy(seconds) {
  for (let i = 0; i < seconds / 2; i++) {
    const h = await health();
    if (h?.status === 'healthy' || h?.service === 'agentmemory') return h;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

// Cartella da cui lanciare agentmemory: se esiste gia' un DB in <cartella>/data
// agentmemory continua a usare quello, quindi si riparte da dove era.
function amWorkDir(role) {
  if (role === 'server') return REPO;
  if (fs.existsSync(path.join(REPO, 'data', 'state_store.db'))) return REPO;
  return HOME;
}

function semverGt(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function hasSystemdUser() {
  return !WIN && process.platform === 'linux' && run('systemctl', ['--user', 'show-environment']).status === 0;
}

function serverService(force) {
  const bin = path.join(REPO, 'node_modules', '.bin', 'agentmemory');
  const r = run('bash', [path.join(REPO, 'scripts', 'install-systemd.sh')], {
    env: { ...process.env, AGENTMEMORY_BIN: bin }, timeout: 5 * 60000,
  });
  if (r.status !== 0) die(`install-systemd.sh:\n${r.out}`);
  ok(`agentmemory + kb-proxy come servizi systemd (riavvio automatico)${force ? ', riavviati' : ''}`);
}

function winAutostart(workDir) {
  fs.mkdirSync(AM_HOME, { recursive: true });
  const q = (s) => `""${s}""`;
  fs.writeFileSync(AM_VBS,
    `Set sh = CreateObject("WScript.Shell")\r\nsh.CurrentDirectory = "${workDir}"\r\n`
    + `sh.Run "${q(process.execPath)} ${q(amCli())}", 0, False\r\n`);
  const r = run('schtasks', ['/Create', '/F', '/TN', AM_TASK, '/TR', `wscript.exe "${AM_VBS}"`, '/SC', 'ONLOGON']);
  if (r.status !== 0) warn(`attivita' "${AM_TASK}" non creata: ${r.out}`);
  else ok(`agentmemory parte da solo all'accesso (attivita' "${AM_TASK}")`);
}

function cronAutostart(workDir) {
  const cur = run('crontab', ['-l']);
  if (cur.error) { warn('crontab non disponibile: agentmemory non ripartira\' da solo al riavvio'); return; }
  const kept = (cur.status === 0 ? cur.stdout : '').split('\n').filter((l) => l && !l.includes(CRON_MARK));
  kept.push(`@reboot cd "${workDir}" && "${process.execPath}" "${amCli()}" > "${path.join(AM_HOME, 'agentmemory.log')}" 2>&1 ${CRON_MARK}`);
  const w = run('crontab', ['-'], { input: kept.join('\n') + '\n' });
  if (w.status !== 0) warn(`crontab: ${w.out}`); else ok('agentmemory riparte da solo al riavvio (crontab @reboot)');
}

function startDetached(workDir) {
  if (WIN && fs.existsSync(AM_VBS)) {
    spawn('wscript.exe', [AM_VBS], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  fs.mkdirSync(AM_HOME, { recursive: true });
  const out = fs.openSync(path.join(AM_HOME, 'agentmemory.log'), 'a');
  spawn(process.execPath, [amCli()], { cwd: workDir, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
}

async function ensureAgentmemory(role, { restart = false } = {}) {
  const pinned = pinnedVersion();
  let h = await health();
  if (h && h.version && h.version !== pinned) {
    if (semverGt(h.version, pinned)) {
      warn(`agentmemory in esecuzione e' ${h.version}, piu' nuovo di quello fissato nel repo (${pinned}): lo lascio. `
        + 'Aggiorna package.json se vuoi questa versione su tutte le macchine.');
      return h;
    }
    log(`agentmemory in esecuzione e' ${h.version}, il repo vuole ${pinned}: lo riavvio`);
    restart = true;
  }
  if (role === 'server' && hasSystemdUser()) {
    const enabled = run('systemctl', ['--user', 'is-enabled', 'kb-proxy.service']).status === 0;
    if (!enabled || restart || !h) serverService(restart);
  } else {
    const workDir = amWorkDir(role);
    if (WIN) winAutostart(workDir); else cronAutostart(workDir);
    if (h && restart) {
      run(process.execPath, [amCli(), 'stop', '--force'], { cwd: workDir, timeout: 60000 });
      h = null;
    }
    if (!h) { log('avvio agentmemory (il primo avvio puo\' richiedere un minuto)...'); startDetached(workDir); }
  }
  h = await waitHealthy(150);
  if (!h) die(`agentmemory non risponde su ${AM_URL}. Log: ${path.join(AM_HOME, 'agentmemory.log')}`);
  ok(`agentmemory ${h.version || ''} attivo su ${AM_URL}`);
  return h;
}

// --------------------------------------------------------------- agenti ---
// Comando MCP di agentmemory. Su Windows npx e' un .cmd: gli agenti lo lanciano via cmd /c
const npxCmd = (...a) => (WIN ? ['cmd', '/c', 'npx', ...a] : ['npx', ...a]);
function mcpServers() {
  const servers = {
    agentmemory: { command: npxCmd('-y', '@agentmemory/mcp'), env: { AGENTMEMORY_URL: AM_URL } },
  };
  const ws = wikiSearchCmd();
  if (ws) servers['wiki-search'] = { command: ws, env: {} };
  return servers;
}

function wireOpenCode(servers) {
  const dir = path.join(HOME, '.config', 'opencode');
  if (!fs.existsSync(dir) && !has('opencode')) return null;
  const file = path.join(dir, 'opencode.json');
  const cfg = readJson(file, fs.existsSync(file) ? null : {});
  if (cfg === null) { warn(`${file} non e' JSON valido: non lo tocco`); return null; }
  backupOnce(file);
  cfg.mcp ??= {};
  for (const [name, s] of Object.entries(servers)) {
    cfg.mcp[name] = { type: 'local', command: s.command, ...(Object.keys(s.env).length ? { environment: s.env } : {}), enabled: true, timeout: 30000 };
  }
  writeJson(file, cfg);
  return file;
}

// YAML di Hermes: si riscrivono solo i nostri blocchi sotto mcp_servers, il resto resta com'e'
function wireHermes(servers) {
  const file = path.join(HOME, '.hermes', 'config.yaml');
  if (!fs.existsSync(file)) return null;
  backupOnce(file);
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\n*$/, '').split('\n');
  let top = lines.findIndex((l) => /^mcp_servers:\s*$/.test(l));
  if (top < 0) { lines.push('', 'mcp_servers:'); top = lines.length - 1; }
  const yq = (v) => JSON.stringify(String(v));
  for (const [name, s] of Object.entries(servers)) {
    const env = Object.entries(s.env);
    const block = [`  ${name}:`, `    command: ${yq(s.command[0])}`, '    args:',
      ...s.command.slice(1).map((a) => `      - ${yq(a)}`),
      ...(env.length ? ['    env:', ...env.map(([k, v]) => `      ${k}: ${yq(v)}`)] : []),
      '    enabled: true'];
    // fine della sezione mcp_servers: prima riga non vuota e non indentata
    let end = top + 1;
    while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
    const at = lines.findIndex((l, i) => i > top && i < end && new RegExp(`^  ${name}:\\s*$`).test(l));
    if (at < 0) { lines.splice(top + 1, 0, ...block); continue; }
    let stop = at + 1;
    while (stop < end && !/^  \S/.test(lines[stop])) stop++;
    while (stop - 1 > at && lines[stop - 1].trim() === '') stop--; // le righe vuote restano
    lines.splice(at, stop - at, ...block);
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

function wireClaude(servers) {
  if (!has('claude')) {
    if (fs.existsSync(path.join(HOME, '.claude.json'))) warn('Claude Code trovato ma il comando "claude" non e\' nel PATH: MCP non cablato');
    return null;
  }
  for (const [name, s] of Object.entries(servers)) {
    run('claude', ['mcp', 'remove', '--scope', 'user', name], { timeout: 60000 });
    const envArgs = Object.entries(s.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    // il nome prima delle opzioni: -e accetta piu' valori e si mangerebbe il nome
    const args = ['mcp', 'add', name, '--scope', 'user', ...envArgs, '--', ...s.command];
    const r = run('claude', WIN ? args.map((a) => (/[\s&|<>^]/.test(a) ? `"${a}"` : a)) : args, { timeout: 60000 });
    if (r.status !== 0) { warn(`claude mcp add ${name}: ${r.out}`); return null; }
  }
  return 'claude mcp (scope user)';
}

function wireAgents(role) {
  const servers = mcpServers();
  const done = [];
  for (const [label, fn] of [['Claude Code', wireClaude], ['OpenCode', wireOpenCode], ['Hermes', wireHermes]]) {
    try {
      const where = fn(servers);
      if (where) { ok(`${label} cablato (${Object.keys(servers).join(', ')}) -> ${where}`); done.push(label); }
    } catch (e) { warn(`${label}: ${e.message}`); }
  }
  if (!done.length) warn('nessun agente trovato (Claude Code, OpenCode, Hermes): installane uno e rilancia install');
  return done;
}

function installSkills() {
  const r = run('npx', ['-y', 'skills', 'add', 'rohitg00/agentmemory', '-y'], { timeout: 5 * 60000 });
  if (r.status === 0) ok('skill di agentmemory installate negli agenti');
  else warn(`skill di agentmemory non installate (${r.out.split('\n').pop()}): non blocca nulla`);
}

// ------------------------------------------------------- ricerca wiki ---
function gitBash() {
  if (!WIN) return 'bash';
  const r = run('git', ['--exec-path']);
  const cand = r.status === 0 ? path.resolve(r.stdout.trim(), '..', '..', '..', 'bin', 'bash.exe') : '';
  return cand && fs.existsSync(cand) ? cand : null;
}

// Su Windows wiki-search.sh stampa percorsi di Git Bash (/c/...), che gli agenti nativi
// non capiscono: per ora la ricerca wiki si cabla solo su Linux/macOS.
function wikiSearchCmd() {
  if (WIN) return null;
  const bash = gitBash();
  if (!bash) return null;
  const r = run(bash, [path.join(REPO, 'scripts', 'wiki-search.sh'), 'mcp-cmd']);
  if (r.status !== 0) return null;
  const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines : null;
}

function wikiSearchSetup() {
  if (WIN) { warn('ricerca wiki (qmd): su Windows non ancora supportata da kb.mjs, salto'); return; }
  const bash = gitBash();
  if (!bash) { warn('ricerca wiki: serve bash (Git Bash su Windows), salto'); return; }
  log('installo la ricerca locale sulla wiki (qmd, scarica i modelli al primo giro)...');
  const r = run(bash, [path.join(REPO, 'scripts', 'wiki-search.sh'), 'setup'], { timeout: 30 * 60000 });
  if (r.status === 0) ok('ricerca wiki (qmd) pronta');
  else warn(`ricerca wiki non installata, il resto funziona lo stesso:\n${r.out.split('\n').slice(-6).join('\n')}`);
}

// -------------------------------------------------------- sync memorie ---
function scheduleSync(every) {
  const args = [path.join(HERE, 'schedule-memory-sync.mjs'), 'install', '--every', String(every)];
  const claude = has('claude') || fs.existsSync(path.join(HOME, '.claude'));
  if (claude) args.push('--claude-hooks');
  if (!WIN && run('crontab', ['-l']).error) {
    if (!claude) { warn('crontab non disponibile: niente sync/aggiornamento automatici su questa macchina'); return; }
    warn('crontab non disponibile: sync e aggiornamento solo a ogni sessione di Claude Code');
    args.push('--no-schedule');
  }
  const r = run(process.execPath, args);
  if (r.status !== 0) warn(`sync automatica non installata: ${r.out}`);
  else ok(`sync memorie + aggiornamento automatico${args.includes('--no-schedule') ? '' : ` ogni ${every} minuti`}${claude ? ' e a ogni sessione di Claude Code' : ''}`);
}

function firstSync() {
  log('prima sync delle memorie (import dagli altri agenti, poi pull/push)...');
  const imp = run(process.execPath, [path.join(HERE, 'import-agent-memories.mjs')], { timeout: 10 * 60000 });
  if (imp.status !== 0) warn(`import memorie degli agenti: ${imp.out.split('\n').pop()}`);
  const s = run(process.execPath, [path.join(HERE, 'memory-sync.mjs')], { timeout: 10 * 60000 });
  if (s.status === 0) ok(`sync riuscita: ${s.out.split('\n').filter(Boolean).pop()}`);
  else warn(`sync non riuscita (riprovera' da sola):\n${s.out.split('\n').slice(-4).join('\n')}`);
}

// ---------------------------------------------------------------- ruolo ---
function detectRole(state, flag) {
  if (flag) return flag;
  if (state.role) return state.role;
  if (process.platform === 'linux' && (REPO.startsWith('/DATA/AppData') || fs.existsSync(path.join(HOME, '.config', 'systemd', 'user', 'kb-proxy.service')))) return 'server';
  return 'pc';
}

function checkPrereq() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) die(`serve Node.js 20 o superiore (questo e' ${process.version}). Windows: winget install OpenJS.NodeJS.LTS`);
  if (!has('git')) die('git non trovato. Windows: winget install Git.Git');
  if (!fs.existsSync(path.join(REPO, '.git'))) die(`${REPO} non e' un clone git del repo`);
  if (git(['remote', 'get-url', 'origin']).status !== 0) die('il clone non ha il remote "origin"');
}

// ------------------------------------------------------------- comandi ---
async function install(opt) {
  checkPrereq();
  const state = loadState();
  const role = detectRole(state, opt.role);
  const remote = git(['remote', 'get-url', 'origin']).stdout.trim();
  log(`installazione: ruolo ${role}, repo ${REPO}, remote ${remote}`);
  ensureMainBranch();
  pull(true);
  npmInstall();
  await ensureAgentmemory(role);
  // Stato subito, poi a ogni tappa: se l'installazione viene interrotta (timeout
  // dell'agente, rete) `status` lo dice e il rilancio riprende da qui.
  const base = { ...state, role, every: opt.every, wikiSearch: false, appliedCommit: head(),
    agentmemory: pinnedVersion(), installedAt: new Date().toISOString(), completed: false };
  saveState(base);
  const agents = wireAgents(role);
  installSkills();
  scheduleSync(opt.every);
  firstSync();
  saveState({ ...base, agents, completed: true });
  log('');
  log('FATTO. Riavvia gli agenti cablati per caricare gli strumenti MCP.');
  log('Da qui in poi la macchina si aggiorna da sola: non serve rilanciare nulla.');
  // Per ultima, perche' scarica fino a ~2 GB di modelli e puo' durare molti minuti:
  // se l'agente la interrompe, tutto il resto e' gia' a posto.
  if (opt.wikiSearch) {
    wikiSearchSetup();
    const again = wireAgents(role); // ora c'e' anche wiki-search
    saveState({ ...base, agents: again, completed: true, wikiSearch: Boolean(wikiSearchCmd()) });
  }
}

// Chiamato dalla sync automatica: aggiorna il clone e riapplica cio' che e' cambiato
async function update() {
  const state = loadState();
  if (!state.appliedCommit) { log('kb.mjs install non ancora eseguito su questa macchina: salto'); return; }
  const before = head();
  if (!pull(false)) return;
  const now = head();
  if (now === state.appliedCommit) return;
  const changed = git(['diff', '--name-only', state.appliedCommit, now]).stdout.split('\n').filter(Boolean);
  log(`aggiornato ${before.slice(0, 7)} -> ${now.slice(0, 7)} (${changed.length} file cambiati)`);
  const touched = (re) => changed.some((f) => re.test(f));
  if (touched(/^scripts\/kb\.mjs$/) && !process.env.KB_REEXEC) {
    // questo processo ha in memoria il kb.mjs vecchio: applica con quello nuovo
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'update', '--quiet'], {
      env: { ...process.env, KB_REEXEC: '1' }, stdio: 'ignore', windowsHide: true, timeout: 20 * 60000,
    });
    process.exit(r.status ?? 1);
  }
  if (touched(/^package\.json$/)) npmInstall();
  if (touched(/^package\.json$|^systemd\/|^scripts\/(install-systemd\.sh|kb-proxy\.js)$/)) {
    await ensureAgentmemory(state.role, { restart: state.role === 'server' });
  }
  if (touched(/^scripts\/(kb\.mjs|wiki-search\.sh)$|^mcp\//)) wireAgents(state.role);
  if (touched(/^scripts\/(kb\.mjs|schedule-memory-sync\.mjs|kb-auto-sync\.mjs)$/)) scheduleSync(state.every || 15);
  saveState({ ...state, appliedCommit: now, agentmemory: pinnedVersion(), updatedAt: new Date().toISOString() });
  log('aggiornamento applicato');
}

async function status() {
  const state = loadState();
  const main = defaultBranch();
  git(['fetch', 'origin']);
  const behind = git(['rev-list', '--count', `HEAD..origin/${main}`]).stdout.trim();
  const h = await health();
  console.log(`repo:        ${REPO}`);
  console.log(`remote:      ${git(['remote', 'get-url', 'origin']).stdout.trim()}`);
  console.log(`branch:      ${currentBranch()} (${behind === '0' ? 'aggiornato' : `${behind} commit indietro rispetto a origin/${main}`})`);
  console.log(`ruolo:       ${state.role ? `${state.role}${state.completed === false ? ' (INSTALLAZIONE INCOMPLETA: rilancia bootstrap.mjs)' : ''}` : 'non installato (kb.mjs install non e\' arrivato in fondo)'}`);
  console.log(`agentmemory: ${h ? `attivo, ${h.version}` : 'NON risponde'} (repo vuole ${pinnedVersion()})`);
  console.log(`agenti:      ${(state.agents || []).join(', ') || '-'}`);
  console.log(`installato:  ${state.installedAt || '-'}   ultimo aggiornamento: ${state.updatedAt || '-'}`);
  console.log(`log:         ${UPDATE_LOG}, ${path.join(AM_HOME, 'memory-sync.log')}`);
  run(process.execPath, [path.join(HERE, 'schedule-memory-sync.mjs'), 'status'], { shell: false }).out.split('\n').forEach((l) => console.log(l));
}

const [cmd = 'status', ...rest] = process.argv.slice(2);
const opt = { role: null, every: 15, wikiSearch: false };
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--role') opt.role = rest[++i];
  else if (rest[i] === '--every') opt.every = Number(rest[++i]);
  else if (rest[i] === '--wiki-search') opt.wikiSearch = true;
  else if (rest[i] === '--quiet') QUIET = true;
  else die(`argomento sconosciuto: ${rest[i]}`);
}
if (opt.role && !['server', 'pc'].includes(opt.role)) die('--role vuole server o pc');

if (cmd === 'install') await install(opt);
else if (cmd === 'update') await update();
else if (cmd === 'status') await status();
else die(`comando sconosciuto: ${cmd} (install | update | status)`);
