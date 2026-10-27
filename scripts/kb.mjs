#!/usr/bin/env node
// kb.mjs - Installazione, cablaggio e aggiornamento della knowledge base. Solo Node:
// nessun bash o Python sui PC (sul server Linux le unit systemd restano in bash).
//
//   node scripts/kb.mjs install [--role server|client|standalone-dev] [--dry-run] [--all] [--only id,id]
//                               [--wiki-search] [--llm-wiki] [--every 15] [--no-schedule]
//   node scripts/kb.mjs test [--quick | --deep] [--only id,id] [--json]   # tabella per programma
//   node scripts/kb.mjs uninstall [--restore] [--only id,id]              # toglie la KB dai programmi
//   node scripts/kb.mjs update  [--quiet] [--force] [--apply-now]        # lo lancia tick
//   node scripts/kb.mjs tick [--background]                              # job pianificato: update + sync
//   node scripts/kb.mjs connect [--role ...] [--llm-wiki]                # solo cablaggio dei programmi
//   node scripts/kb.mjs maintenance [--quiet] [--force]                  # server: riavvii in sospeso
//   node scripts/kb.mjs token [show|rotate|set VALORE|set -]             # KB_TOKEN in <repo>/.env
//   node scripts/kb.mjs status
//
// Programmi supportati: scripts/lib/adapters.mjs. Controlli di `test`: scripts/lib/checks.mjs.
//
// Ruoli:
//   server          agentmemory locale = DB primario, kb-proxy sulla LAN con token, unit
//                   systemd, backup delle memorie sul branch orfano kb-data.
//   client          niente agentmemory locale e niente sync: gli agenti usano il server
//                   centrale (config/endpoint.env + KB_TOKEN in .env).
//   standalone-dev  PC sviluppatore autonomo: agentmemory locale + sync P2P delle memorie
//                   via kb-data ogni N minuti (il vecchio ruolo "pc").
//
// update (lo lancia da solo kb-auto-sync.mjs, al massimo una volta ogni KB_UPDATE_HOURS ore,
// default 24): fetch + `git merge --ff-only`. Non tocca nulla se ci sono modifiche locali a
// file tracciati, se il clone non e' su main o se la storia locale e' divergente: lo scrive
// nel log e salta. Sul server i riavvii dei servizi non avvengono subito: vengono segnati e
// applicati da `maintenance` (timer notturno kb-maintenance.timer) o con --apply-now.
// Log: ~/.agentmemory/kb-update.log
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKbConfig, newToken, readEnvFile, setEnvVar, validToken } from './lib/env.mjs';
import { buildServers, LOCAL_AM_URL } from './lib/agents.mjs';
import { ADAPTERS, applyAdapter, clonesInConfigs, restoreAdapter, selectAdapters } from './lib/adapters.mjs';
import { allGreen, formatTable, runChecks } from './lib/checks.mjs';
import { DATA_BRANCH, dataDir } from './lib/data-branch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const HOME = os.homedir();
const WIN = process.platform === 'win32';
const AM_HOME = path.join(HOME, '.agentmemory');
const STATE_FILE = path.join(AM_HOME, 'kb-install.json');
const UPDATE_LOG = path.join(AM_HOME, 'kb-update.log');
const ENV_FILE = path.join(REPO, '.env');
const AM_TASK = 'KB agentmemory';
const AM_VBS = path.join(AM_HOME, 'kb-agentmemory.vbs');
const CRON_MARK = '# kb-agentmemory';
const ROLES = ['server', 'client', 'standalone-dev'];
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
    shell: opts.shell ?? (WIN && ['npm', 'npx', 'claude', 'opencode', 'gemini', 'codex'].includes(cmd)),
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
// I vecchi stati hanno role 'pc': e' il comportamento che ora si chiama standalone-dev
const normalizeRole = (r) => (r === 'pc' ? 'standalone-dev' : r);
function loadState() {
  const s = readJson(STATE_FILE, {});
  if (s.role) s.role = normalizeRole(s.role);
  return s;
}
const saveState = (s) => writeJson(STATE_FILE, s);
const kbConfig = () => loadKbConfig(REPO);

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
// File tracciati modificati (il worktree .kb-data e i file ignorati non contano)
const dirtyFiles = () => git(['status', '--porcelain', '--untracked-files=no']).stdout.split('\n').filter(Boolean);

// Aggiornamento sicuro del codice: solo fast-forward, mai rebase/autostash/reset.
// Ritorna { ok, reason }.
function fastForward() {
  const main = defaultBranch();
  if (busyGit()) return { ok: false, reason: 'git ha un merge/rebase in corso nel clone' };
  const cur = currentBranch();
  if (cur !== main) return { ok: false, reason: `il clone e' sul branch '${cur}', non su '${main}'` };
  const f = git(['fetch', 'origin', main]);
  if (f.status !== 0) return { ok: false, reason: `git fetch: ${f.out.split('\n')[0]}` };
  const dirty = dirtyFiles();
  if (dirty.length) {
    return { ok: false, reason: `modifiche locali a file tracciati, non aggiorno: ${dirty.map((l) => l.slice(3)).join(', ')}` };
  }
  const m = git(['merge', '--ff-only', '-q', `origin/${main}`]);
  if (m.status !== 0) return { ok: false, reason: `main locale non e' un fast-forward di origin/${main} (commit locali?): ${m.out.split('\n')[0]}` };
  return { ok: true };
}

// Install: porta il clone sul branch principale. I commit locali del branch vecchio
// vengono uniti, cosi' nessuna modifica resta indietro.
function ensureMainBranch() {
  const main = defaultBranch();
  const cur = currentBranch();
  const f = git(['fetch', 'origin']);
  if (f.status !== 0) die(`git fetch: ${f.out}\n  ${PROXY_HINT}`);
  if (cur === main) return;
  log(`il clone e' sul branch '${cur}': passo a '${main}'`);
  const sw = git(['checkout', main]);
  if (sw.status !== 0) {
    const sw2 = git(['checkout', '-b', main, '--track', `origin/${main}`]);
    if (sw2.status !== 0) die(`non riesco a passare a ${main}: ${sw.out}`);
  }
  git(['branch', `--set-upstream-to=origin/${main}`, main]);
  const ff = fastForward();
  if (!ff.ok) die(ff.reason);
  if (cur !== 'HEAD' && git(['rev-list', '--count', `${main}..${cur}`]).stdout.trim() !== '0') {
    const m = git(['merge', '--no-edit', cur]);
    if (m.status !== 0) {
      git(['merge', '--abort']);
      warn(`i commit locali di '${cur}' non si uniscono da soli a ${main}: restano su quel branch (${m.out.split('\n')[0]})`);
    } else ok(`commit locali di '${cur}' uniti in ${main} (non pubblicati: valuta tu se fare push)`);
  }
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

// Health di agentmemory: locale, o del server centrale passando dal kb-proxy con il token
async function health(url = LOCAL_AM_URL, token = '') {
  try {
    const res = await fetch(`${url}/agentmemory/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5000),
    });
    if (res.status === 401) return { unauthorized: true };
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
    env: { ...process.env, AGENTMEMORY_BIN: bin, KB_NODE_BIN: process.execPath }, timeout: 5 * 60000,
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

// Ruolo client: agentmemory locale non deve piu' ripartire da solo (non lo si ferma:
// potrebbe avere memorie non ancora esportate; lo dice il messaggio)
function removeLocalAutostart() {
  if (WIN) {
    if (run('schtasks', ['/Query', '/TN', AM_TASK]).status === 0) {
      run('schtasks', ['/Delete', '/F', '/TN', AM_TASK]);
      ok(`attivita' "${AM_TASK}" rimossa: agentmemory locale non riparte piu' all'accesso`);
    }
    return;
  }
  const cur = run('crontab', ['-l']);
  if (cur.error || cur.status !== 0 || !cur.stdout.includes(CRON_MARK)) return;
  const kept = cur.stdout.split('\n').filter((l) => l && !l.includes(CRON_MARK));
  run('crontab', ['-'], { input: kept.length ? kept.join('\n') + '\n' : '' });
  ok('riga @reboot di agentmemory locale rimossa dalla crontab');
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
  if (!h) die(`agentmemory non risponde su ${LOCAL_AM_URL}. Log: ${path.join(AM_HOME, 'agentmemory.log')}`);
  ok(`agentmemory ${h.version || ''} attivo su ${LOCAL_AM_URL}`);
  return h;
}

// Client: il server centrale risponde e accetta il token?
async function checkCentral() {
  const cfg = kbConfig();
  if (!cfg.token) warn(`KB_TOKEN mancante in ${ENV_FILE}: chiedi il token a chi gestisce il server e aggiungi la riga KB_TOKEN=...`);
  const h = await health(cfg.apiUrl, cfg.token);
  if (h?.unauthorized) warn(`il server ${cfg.apiUrl} risponde 401: KB_TOKEN mancante o errato in ${ENV_FILE}`);
  else if (!h) warn(`server centrale non raggiungibile su ${cfg.apiUrl} (config/endpoint.env): cablo lo stesso, gli agenti lo useranno quando risponde`);
  else ok(`server centrale ${cfg.apiUrl} raggiungibile (agentmemory ${h.version || ''})`);
  return h;
}

// --------------------------------------------------------------- agenti ---
function llmWikiServer(enabled) {
  if (!enabled) return null;
  const dir = path.join(REPO, 'mcp', 'llm-wiki-mcp');
  const bin = path.join(dir, 'dist', 'src', 'index.js');
  if (!fs.existsSync(path.join(dir, 'node_modules'))) {
    const r = run('npm', ['install', '--no-audit', '--no-fund', '--omit=dev'], { cwd: dir, timeout: 10 * 60000 });
    if (r.status !== 0) { warn(`llm-wiki-mcp: npm install fallito, salto (${r.out.split('\n').pop()})`); return null; }
  }
  return fs.existsSync(bin) ? { bin, url: kbConfig().wikiUrl, node: process.execPath } : null;
}

function serversFor(role, { llmWiki = false } = {}) {
  const cfg = kbConfig();
  return buildServers({
    mode: role === 'client' ? 'remote' : 'local',
    apiUrl: cfg.apiUrl, token: cfg.token, win: WIN,
    wikiSearch: role === 'client' ? null : wikiSearchCmd(),
    llmWiki: llmWikiServer(llmWiki),
  });
}

// Contesto per gli adattatori: la macchina vera
const CTX = { home: HOME, platform: process.platform, env: process.env, has, run };

// Cabla tutti i programmi installati (o --all / --only). Con dryRun dice solo cosa cambierebbe.
function wireAgents(role, opts = {}) {
  const servers = serversFor(role, opts);
  const where = role === 'client' ? `server centrale ${kbConfig().apiUrl}` : `agentmemory locale ${LOCAL_AM_URL}`;
  const done = [];
  for (const a of selectAdapters(CTX, opts)) {
    try {
      const res = applyAdapter(CTX, a, servers, { dryRun: opts.dryRun });
      const errs = res.filter((r) => r.error);
      for (const r of errs) warn(`${a.label}: ${r.file}: ${r.error}`);
      const changed = res.filter((r) => r.changed).map((r) => r.file);
      if (errs.length === res.length) continue;
      done.push(a.id);
      if (opts.dryRun) log(`${a.label}: ${changed.length ? `cambierebbe ${changed.join(', ')}` : 'gia\' a posto'}`);
      else ok(`${a.label} -> ${where} (${Object.keys(servers).join(', ')})${changed.length ? `, scritto ${changed.join(', ')}` : ', gia\' a posto'}`);
    } catch (e) { warn(`${a.label}: ${e.message}`); }
  }
  if (!done.length) warn(`nessun programma trovato (${ADAPTERS.map((a) => a.label).join(', ')}): installane uno e rilancia`);
  return done;
}

function installSkills() {
  if (process.env.KB_SKIP_SKILLS === '1') return;
  const r = run('npx', ['-y', 'skills', 'add', 'rohitg00/agentmemory', '-y'], { timeout: 5 * 60000 });
  if (r.status === 0) ok('skill di agentmemory installate negli agenti');
  else warn(`skill di agentmemory non installate (${r.out.split('\n').pop()}): non blocca nulla`);
}

// ------------------------------------------------------- ricerca wiki ---
// Su Windows wiki-search.sh stampa percorsi di Git Bash (/c/...), che gli agenti nativi
// non capiscono: la ricerca wiki si cabla solo su Linux/macOS (sui PC Windows arrivera'
// dal server centrale via MCP HTTP, Fase 2).
function wikiSearchCmd() {
  if (WIN) return null;
  const r = run('bash', [path.join(REPO, 'scripts', 'wiki-search.sh'), 'mcp-cmd']);
  if (r.status !== 0) return null;
  const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines : null;
}

function wikiSearchSetup() {
  if (WIN) { warn('ricerca wiki (qmd): su Windows non ancora supportata da kb.mjs, salto'); return; }
  log('installo la ricerca locale sulla wiki (qmd, scarica i modelli al primo giro)...');
  const r = run('bash', [path.join(REPO, 'scripts', 'wiki-search.sh'), 'setup'], { timeout: 30 * 60000 });
  if (r.status === 0) ok('ricerca wiki (qmd) pronta');
  else warn(`ricerca wiki non installata, il resto funziona lo stesso:\n${r.out.split('\n').slice(-6).join('\n')}`);
}

// -------------------------------------------------- pianificazione ---
// server/standalone-dev: sync memorie + aggiornamento ogni N minuti (+ hook Claude Code).
// client: solo l'aggiornamento del codice (kb-auto-sync.mjs salta la sync), niente hook.
function scheduleSync(role, every) {
  const sched = path.join(HERE, 'schedule-memory-sync.mjs');
  const args = [sched, 'install', '--every', String(every)];
  const claude = role !== 'client' && (has('claude') || fs.existsSync(path.join(HOME, '.claude')));
  if (role === 'client') run(process.execPath, [sched, 'uninstall']); // toglie anche gli hook di sync
  if (claude) args.push('--claude-hooks');
  if (!WIN && run('crontab', ['-l']).error) {
    if (!claude) { warn('crontab non disponibile: niente aggiornamento automatico su questa macchina'); return; }
    warn('crontab non disponibile: sync e aggiornamento solo a ogni sessione di Claude Code');
    args.push('--no-schedule');
  }
  const r = run(process.execPath, args);
  if (r.status !== 0) { warn(`pianificazione non installata: ${r.out}`); return; }
  const what = role === 'client' ? 'controllo aggiornamenti' : 'sync memorie + controllo aggiornamenti';
  ok(`${what}${args.includes('--no-schedule') ? '' : ` ogni ${every} minuti`}${claude ? ' e a ogni sessione di Claude Code' : ''}`);
}

function firstSync() {
  log(`prima sync delle memorie (import dagli altri agenti, poi pull/push sul branch ${DATA_BRANCH})...`);
  const imp = run(process.execPath, [path.join(HERE, 'import-agent-memories.mjs')], { timeout: 10 * 60000 });
  if (imp.status !== 0) warn(`import memorie degli agenti: ${imp.out.split('\n').pop()}`);
  const s = run(process.execPath, [path.join(HERE, 'memory-sync.mjs')], { timeout: 10 * 60000 });
  if (s.status === 0) ok(`sync riuscita: ${s.out.split('\n').filter(Boolean).pop()}`);
  else warn(`sync non riuscita (riprovera' da sola):\n${s.out.split('\n').slice(-4).join('\n')}`);
}

// ---------------------------------------------------------------- ruolo ---
function detectRole(state, flag) {
  if (flag) return normalizeRole(flag);
  if (state.role) return state.role;
  if (process.platform === 'linux' && (REPO.startsWith('/DATA/AppData') || fs.existsSync(path.join(HOME, '.config', 'systemd', 'user', 'kb-proxy.service')))) return 'server';
  return 'standalone-dev';
}

function checkPrereq() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) die(`serve Node.js 20 o superiore (questo e' ${process.version}). Windows: winget install OpenJS.NodeJS.LTS`);
  if (!has('git')) die('git non trovato. Windows: winget install Git.Git');
  if (!fs.existsSync(path.join(REPO, '.git'))) die(`${REPO} non e' un clone git del repo`);
  if (git(['remote', 'get-url', 'origin']).status !== 0) die('il clone non ha il remote "origin"');
}

function updateIntervalHours() {
  const v = Number(process.env.KB_UPDATE_HOURS || readEnvFile(ENV_FILE).KB_UPDATE_HOURS || 24);
  return Number.isFinite(v) && v >= 0 ? v : 24;
}

// ------------------------------------------------------------- comandi ---
async function install(opt) {
  checkPrereq();
  const state = loadState();
  const role = detectRole(state, opt.role);
  if (opt.dryRun) {
    log(`prova senza scrivere nulla: ruolo ${role}, repo ${REPO}`);
    wireAgents(role, { ...opt, llmWiki: opt.llmWiki || Boolean(state.llmWiki) });
    return;
  }
  const others = otherClones();
  if (others.length) warn(`KB-CLONE altri clone di knowledge-base: ${others.join(', ')}. Non li tocco: le config dei programmi vengono riscritte su ${REPO}`);
  const remote = git(['remote', 'get-url', 'origin']).stdout.trim();
  log(`installazione: ruolo ${role}, repo ${REPO}, remote ${remote}`);
  ensureMainBranch();
  const ff = fastForward();
  if (!ff.ok) die(ff.reason);
  const base = { ...state, role, repo: REPO, every: opt.every, wikiSearch: false, llmWiki: opt.llmWiki || Boolean(state.llmWiki),
    appliedCommit: head(), installedAt: new Date().toISOString(), completed: false, pendingRestart: false };
  if (role === 'client') {
    removeLocalAutostart();
    await checkCentral();
    delete base.agentmemory;
  } else {
    npmInstall();
    await ensureAgentmemory(role);
    base.agentmemory = pinnedVersion();
  }
  // Stato subito, poi a ogni tappa: se l'installazione viene interrotta (timeout
  // dell'agente, rete) `status` lo dice e il rilancio riprende da qui.
  saveState(base);
  const agents = wireAgents(role, { ...opt, llmWiki: base.llmWiki });
  base.all = Boolean(opt.all);
  installSkills();
  if (opt.schedule) scheduleSync(role, opt.every);
  if (role !== 'client') firstSync();
  saveState({ ...base, agents, completed: true });
  log('');
  log('FATTO. Riavvia gli agenti cablati per caricare gli strumenti MCP.');
  log('Da qui in poi la macchina si aggiorna da sola: non serve rilanciare nulla.');
  log('');
  await test({ report: true });
  // Per ultima, perche' scarica fino a ~2 GB di modelli e puo' durare molti minuti:
  // se l'agente la interrompe, tutto il resto e' gia' a posto.
  if (opt.wikiSearch && role !== 'client') {
    wikiSearchSetup();
    const again = wireAgents(role, { ...opt, llmWiki: base.llmWiki }); // ora c'e' anche wiki-search
    saveState({ ...base, agents: again, completed: true, wikiSearch: Boolean(wikiSearchCmd()) });
  }
}

// Solo cablaggio degli agenti (sostituisce connect-agent.sh)
async function connect(opt) {
  const state = loadState();
  const role = detectRole(state, opt.role);
  const llmWiki = opt.llmWiki || Boolean(state.llmWiki);
  log(`cablaggio agenti: ruolo ${role}${role === 'client' ? `, server ${kbConfig().apiUrl}` : ''}`);
  if (role === 'client') await checkCentral();
  const agents = wireAgents(role, { ...opt, llmWiki });
  installSkills();
  if (state.appliedCommit) saveState({ ...state, agents, llmWiki });
  log('Riavvia gli agenti cablati per caricare gli strumenti MCP.');
}

// File che, se cambiano, richiedono di riavviare i servizi del server
const RESTART_RE = /^package\.json$|^systemd\/|^scripts\/(install-systemd\.sh|kb-proxy\.js)$/;

// Chiamato dalla sync automatica: aggiorna il clone (solo fast-forward) e riapplica cio' che e' cambiato
async function update(opt) {
  let state = loadState();
  if (!state.appliedCommit) { log('kb.mjs install non ancora eseguito su questa macchina: salto'); return; }
  const hours = updateIntervalHours();
  const last = Date.parse(state.lastUpdateCheck || '') || 0;
  if (!opt.force && !process.env.KB_REEXEC && Date.now() - last < hours * 3600e3) {
    if (opt.applyNow && state.pendingRestart) await maintenance({ force: true });
    return;
  }
  state = { ...state, lastUpdateCheck: new Date().toISOString() };
  saveState(state);
  const before = head();
  const ff = fastForward();
  if (!ff.ok) { warn(`aggiornamento saltato: ${ff.reason}`); return; }
  const now = head();
  if (now !== before) log(`aggiornato ${before.slice(0, 7)} -> ${now.slice(0, 7)}`);
  if (now === state.appliedCommit) {
    if (opt.applyNow && state.pendingRestart) await maintenance({ force: true });
    return;
  }
  const changed = git(['diff', '--name-only', state.appliedCommit, now]).stdout.split('\n').filter(Boolean);
  log(`${changed.length} file cambiati da ${state.appliedCommit.slice(0, 7)}`);
  const touched = (re) => changed.some((f) => re.test(f));
  if (touched(/^scripts\/kb\.mjs$|^scripts\/lib\//) && !process.env.KB_REEXEC) {
    // questo processo ha in memoria il kb.mjs vecchio: applica con quello nuovo
    const args = [fileURLToPath(import.meta.url), 'update', ...(QUIET ? ['--quiet'] : []), ...(opt.applyNow ? ['--apply-now'] : [])];
    const r = spawnSync(process.execPath, args, {
      env: { ...process.env, KB_REEXEC: '1' }, stdio: QUIET ? 'ignore' : 'inherit', windowsHide: true, timeout: 20 * 60000,
    });
    process.exit(r.status ?? 1);
  }
  let pendingRestart = Boolean(state.pendingRestart);
  let applyNow = opt.applyNow;
  if (state.role === 'server') {
    if (touched(RESTART_RE)) {
      pendingRestart = true;
      if (hasSystemdUser() && run('systemctl', ['--user', 'is-enabled', 'kb-maintenance.timer']).status !== 0) {
        // server installato prima del timer: nessuno applicherebbe il riavvio, lo si fa ora (una volta)
        log('timer di manutenzione non ancora installato: applico subito (lo installa install-systemd.sh)');
        applyNow = true;
      } else log('servizi da riavviare: lo fa la finestra di manutenzione (kb-maintenance.timer) o `kb.mjs update --apply-now`');
    }
  } else if (state.role === 'standalone-dev') {
    if (touched(/^package\.json$/)) npmInstall();
    if (touched(RESTART_RE)) await ensureAgentmemory(state.role, { restart: false });
  }
  if (touched(/^scripts\/(kb\.mjs|wiki-search\.sh)$|^scripts\/lib\/|^mcp\/|^config\/endpoint\.env$/)) wireAgents(state.role, { llmWiki: state.llmWiki, all: state.all });
  if (touched(/^scripts\/(kb\.mjs|schedule-memory-sync\.mjs|kb-auto-sync\.mjs)$/)) scheduleSync(state.role, state.every || 15);
  state = { ...state, repo: REPO, appliedCommit: now, updatedAt: new Date().toISOString(), pendingRestart };
  if (state.role !== 'client') state.agentmemory = pinnedVersion();
  saveState(state);
  log('aggiornamento applicato');
  if (applyNow && pendingRestart) await maintenance({ force: true });
}

// Server: applica i riavvii in sospeso (dipendenze nuove, unit, kb-proxy). Lo lancia il
// timer notturno kb-maintenance.timer; kb-proxy svuota le richieste in corso prima di uscire.
async function maintenance(opt) {
  const state = loadState();
  if (state.role !== 'server') { log('maintenance serve solo sul server: niente da fare'); return; }
  if (!state.pendingRestart && !opt.force) { log('nessun riavvio in sospeso'); return; }
  log('manutenzione: dipendenze e riavvio dei servizi');
  npmInstall();
  await ensureAgentmemory('server', { restart: true });
  saveState({ ...loadState(), pendingRestart: false, maintenanceAt: new Date().toISOString(), agentmemory: pinnedVersion() });
  ok('manutenzione completata');
}

// KB_TOKEN del kb-proxy in <repo>/.env (sostituisce kb-token.sh)
async function token(args) {
  const [sub = 'show', value] = args;
  const cur = readEnvFile(ENV_FILE).KB_TOKEN || '';
  const comment = 'Token condiviso kb-proxy (node scripts/kb.mjs token)';
  if (sub === 'show') {
    if (cur) { console.log(cur); return; }
    const t = newToken();
    setEnvVar(ENV_FILE, 'KB_TOKEN', t, comment);
    console.error(`Nuovo KB_TOKEN generato in ${ENV_FILE}`);
    console.log(t);
  } else if (sub === 'rotate') {
    const t = newToken();
    setEnvVar(ENV_FILE, 'KB_TOKEN', t, comment);
    console.error(`KB_TOKEN ruotato in ${ENV_FILE}: riavvia kb-proxy e aggiorna KB_TOKEN nei .env dei client`);
    console.log(t);
  } else if (sub === 'set') {
    let t = value || '';
    if (t === '-') t = fs.readFileSync(0, 'utf8').split(/\r?\n/)[0];
    t = t.trim();
    if (!t) die('Uso: kb.mjs token set VALORE (oppure: echo VALORE | kb.mjs token set -)');
    if (!validToken(t)) die('token non valido: usa solo lettere, cifre e . _ ~ + = -');
    if (t.length < 12) console.error(`ATTENZIONE: token corto (${t.length} caratteri): facile da indovinare, va bene solo in rete fidata`);
    setEnvVar(ENV_FILE, 'KB_TOKEN', t, comment);
    console.error(`KB_TOKEN impostato in ${ENV_FILE}: riavvia kb-proxy (systemctl --user restart kb-proxy)`);
  } else die('Uso: kb.mjs token {show|rotate|set VALORE}');
}

async function status() {
  const state = loadState();
  const main = defaultBranch();
  const cfg = kbConfig();
  const fetched = git(['fetch', 'origin', main]).status === 0;
  const behind = git(['rev-list', '--count', `HEAD..origin/${main}`]).stdout.trim();
  const dirty = dirtyFiles();
  const role = state.role;
  const line = (k, v) => console.log(`${`${k}:`.padEnd(14)}${v}`);
  line('repo', REPO);
  line('remote', git(['remote', 'get-url', 'origin']).stdout.trim());
  line('branch', `${currentBranch()} (${!fetched ? 'remote non raggiungibile' : behind === '0' ? 'aggiornato' : `${behind} commit indietro rispetto a origin/${main}`})`
    + `${dirty.length ? `, ${dirty.length} file tracciati modificati: l'aggiornamento automatico e' fermo` : ''}`);
  line('ruolo', role ? `${role}${state.completed === false ? ' (INSTALLAZIONE INCOMPLETA: rilancia bootstrap.mjs)' : ''}` : 'non installato (kb.mjs install non e\' arrivato in fondo)');
  if (role === 'client') {
    const h = await health(cfg.apiUrl, cfg.token);
    line('server', `${cfg.apiUrl} -> ${h?.unauthorized ? '401: KB_TOKEN mancante o errato' : h ? `attivo, agentmemory ${h.version || ''}` : 'NON raggiungibile'}`);
    line('token', cfg.token ? `presente in ${ENV_FILE}` : `MANCANTE (KB_TOKEN in ${ENV_FILE})`);
  } else {
    const h = await health();
    line('agentmemory', `${h ? `attivo, ${h.version}` : 'NON risponde'} su ${LOCAL_AM_URL} (repo vuole ${pinnedVersion()})`);
    const dd = dataDir(REPO);
    line('dati sync', fs.existsSync(path.join(dd, '.git')) ? `${dd} (branch ${DATA_BRANCH})` : `worktree ${DATA_BRANCH} non ancora creato (lo crea la prima sync)`);
  }
  if (role === 'server') line('manutenzione', state.pendingRestart ? 'riavvio dei servizi IN SOSPESO (kb-maintenance.timer o kb.mjs update --apply-now)' : `nessun riavvio in sospeso${state.maintenanceAt ? `, ultima ${state.maintenanceAt}` : ''}`);
  line('agenti', (state.agents || []).join(', ') || '-');
  line('installato', state.installedAt || '-');
  line('aggiornato', `${state.updatedAt || '-'}   ultimo controllo: ${state.lastUpdateCheck || '-'} (ogni ${updateIntervalHours()} h)`);
  line('log', `${UPDATE_LOG}${role === 'client' ? '' : `, ${path.join(AM_HOME, 'memory-sync.log')}`}`);
  run(process.execPath, [path.join(HERE, 'schedule-memory-sync.mjs'), 'status'], { shell: false }).out.split('\n').forEach((l) => console.log(l));
}

// Altri clone di knowledge-base sulla macchina: nei posti soliti e nelle config dei programmi
function otherClones() {
  const names = ['knowledge-base', 'my-knowledge-base'];
  const roots = [HOME, '/DATA/AppData', ...(WIN ? 'CDEFG'.split('').map((d) => `${d}:\\`) : [])];
  const cands = roots.flatMap((r) => names.map((n) => path.join(r, n)));
  const found = cands.filter((p) => path.resolve(p) !== path.resolve(REPO) && fs.existsSync(path.join(p, '.git')));
  return [...new Set([...found.map((p) => path.resolve(p)), ...clonesInConfigs(CTX, REPO)])];
}

// Controllo completo: per ogni programma config, avvio MCP, memoria, altre macchine
async function test(opt) {
  const state = loadState();
  const role = state.role || detectRole(state, opt.role);
  const cfg = kbConfig();
  const h = role === 'client' ? await health(cfg.apiUrl, cfg.token) : await health();
  const header = {
    repo: REPO, branch: currentBranch(), ruolo: role,
    agentmemory: role === 'client'
      ? `${cfg.apiUrl}: ${h?.unauthorized ? 'KB-401 token mancante o errato' : h ? `attivo ${h.version || ''}` : 'NON raggiungibile'}`
      : `${LOCAL_AM_URL}: ${h ? `attivo ${h.version || ''}` : 'NON risponde (KB-PORT? rilancia install)'} (repo vuole ${pinnedVersion()})`,
    'ultimo update': state.updatedAt || state.installedAt || '-',
  };
  const servers = serversFor(role, { llmWiki: Boolean(state.llmWiki) });
  const adapters = selectAdapters(CTX, { all: Boolean(state.all), only: opt.only });
  const down = h?.unauthorized ? 'KB-401: KB_TOKEN mancante o errato nel .env del clone'
    : !h ? `agentmemory non risponde su ${role === 'client' ? cfg.apiUrl : LOCAL_AM_URL}` : null;
  const rows = await runChecks(CTX, adapters, servers, {
    down, host: os.hostname().toLowerCase(), day: new Date().toISOString().slice(0, 10), quick: opt.quick, deep: opt.deep,
  });
  if (opt.json) { console.log(JSON.stringify({ ...header, programmi: rows }, null, 2)); return; }
  for (const [k, v] of Object.entries(header)) console.log(`${`${k}`.padEnd(14)}${v}`);
  console.log('');
  console.log(rows.length ? formatTable(rows, opt) : 'nessun programma trovato: installane uno e rilancia install');
  const others = [...new Set(rows.flatMap((r) => r.others || []))];
  if (others.length) console.log(`\naltre macchine viste: ${others.join(', ')}`);
  console.log(allGreen(rows) ? '\nTUTTO OK' : '\nCi sono righe rosse: leggi la nota a destra di ciascuna.');
  if (!allGreen(rows) && !opt.report) process.exitCode = 1;
}

// Toglie la KB dai programmi e le attivita' pianificate. I dati di agentmemory e il clone restano.
async function uninstall(opt) {
  const none = { agentmemory: null, 'wiki-search': null, 'llm-wiki': null };
  for (const a of selectAdapters(CTX, { all: true, only: opt.only })) {
    const restored = opt.restore ? restoreAdapter(CTX, a) : [];
    if (restored.length) { ok(`${a.label}: rimesso il backup ${restored.join(', ')}`); continue; }
    const changed = applyAdapter(CTX, a, none).filter((r) => r.changed);
    if (changed.length) ok(`${a.label}: voci della KB tolte da ${changed.map((r) => r.file).join(', ')}`);
  }
  run(process.execPath, [path.join(HERE, 'schedule-memory-sync.mjs'), 'uninstall']);
  ok('sync e aggiornamento automatici tolti');
  const state = loadState();
  if (state.role === 'server') warn('server: i servizi systemd restano (systemctl --user disable --now kb-proxy agentmemory)');
  else removeLocalAutostart();
  saveState({ ...state, completed: false, uninstalledAt: new Date().toISOString() });
  log('Fatto. Il database di agentmemory e il clone non sono stati toccati. Per reinstallare: node scripts/kb.mjs install');
}

// Job pianificato: aggiornamento del codice + sync delle memorie (kb-auto-sync.mjs)
function tick(opt) {
  const r = spawnSync(process.execPath, [path.join(HERE, 'kb-auto-sync.mjs'), ...(opt.background ? ['--background'] : [])],
    { stdio: 'inherit', windowsHide: true });
  process.exitCode = r.status ?? 1;
}

const [cmd = 'status', ...rest] = process.argv.slice(2);
const opt = { role: null, every: 15, wikiSearch: false, llmWiki: false, schedule: true, force: false, applyNow: false,
  dryRun: false, all: false, only: null, quick: false, deep: false, json: false, restore: false, background: false };
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--role') opt.role = rest[++i];
  else if (rest[i] === '--every') opt.every = Number(rest[++i]);
  else if (rest[i] === '--only') opt.only = String(rest[++i] || '').split(',').filter(Boolean);
  else if (rest[i] === '--wiki-search') opt.wikiSearch = true;
  else if (rest[i] === '--llm-wiki') opt.llmWiki = true;
  else if (rest[i] === '--no-schedule') opt.schedule = false;
  else if (rest[i] === '--force') opt.force = true;
  else if (rest[i] === '--apply-now') opt.applyNow = true;
  else if (rest[i] === '--dry-run') opt.dryRun = true;
  else if (rest[i] === '--all') opt.all = true;
  else if (rest[i] === '--quick') opt.quick = true;
  else if (rest[i] === '--deep') opt.deep = true;
  else if (rest[i] === '--json') opt.json = true;
  else if (rest[i] === '--restore') opt.restore = true;
  else if (rest[i] === '--background') opt.background = true;
  else if (rest[i] === '--quiet') QUIET = true;
  else if (cmd === 'token' && !rest[i].startsWith('--')) positional.push(rest[i]);
  else die(`argomento sconosciuto: ${rest[i]}`);
}
if (opt.role && !ROLES.includes(normalizeRole(opt.role))) die(`--role vuole ${ROLES.join(' | ')}`);
const ids = ADAPTERS.map((a) => a.id);
if (opt.only?.some((id) => !ids.includes(id))) die(`--only vuole uno o piu' tra: ${ids.join(', ')}`);

const COMMANDS = { install, test, update, tick, uninstall, connect, maintenance, status,
  token: () => token(positional) };
if (!COMMANDS[cmd]) die(`comando sconosciuto: ${cmd} (install | test | update | uninstall | tick | connect | status | token | maintenance)`);
await COMMANDS[cmd](opt);
