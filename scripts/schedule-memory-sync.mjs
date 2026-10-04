#!/usr/bin/env node
// Installa la sync automatica delle memorie (scripts/kb-auto-sync.mjs):
//   - Windows: Utilita' di pianificazione, ogni N minuti e all'accesso, senza finestre
//   - Linux/macOS: crontab dell'utente, ogni N minuti e al riavvio
//   - opzionale: hook di Claude Code (SessionStart e SessionEnd, in background),
//     cosi' l'agente parte con le memorie aggiornate e a fine sessione le pubblica
//
// Uso:
//   node scripts/schedule-memory-sync.mjs install [--every 15] [--claude-hooks] [--no-schedule]
//   node scripts/schedule-memory-sync.mjs uninstall
//   node scripts/schedule-memory-sync.mjs status
//
// Idempotente: rieseguire install sostituisce la pianificazione precedente.
// Log della sync: ~/.agentmemory/memory-sync.log
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kb-auto-sync.mjs');
const NODE = process.execPath;
const WIN = process.platform === 'win32';
const TASK = 'KB memory-sync';
const TASK_LOGON = 'KB memory-sync logon';
const CRON_MARK = '# kb-memory-sync';
const VBS = path.join(os.homedir(), '.agentmemory', 'kb-auto-sync.vbs');
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_EVENTS = ['SessionStart', 'SessionEnd'];

const log = (m) => console.log(`[schedule-memory-sync] ${m}`);
function die(m) { log(`ERRORE: ${m}`); process.exit(1); }

function sh(cmd, args, input) {
  return spawnSync(cmd, args, { encoding: 'utf8', input, windowsHide: true });
}

// ------------------------------------------------------------- Windows ---
function winInstall(every) {
  // wscript + .vbs: lancia node senza aprire una finestra ogni N minuti
  fs.mkdirSync(path.dirname(VBS), { recursive: true });
  const q = (s) => `""${s}""`;
  fs.writeFileSync(VBS, `CreateObject("WScript.Shell").Run "${q(NODE)} ${q(AUTO)}", 0, False\r\n`);
  const tr = `wscript.exe "${VBS}"`;
  for (const [name, sched] of [[TASK, ['/SC', 'MINUTE', '/MO', String(every)]], [TASK_LOGON, ['/SC', 'ONLOGON']]]) {
    const r = sh('schtasks', ['/Create', '/F', '/TN', name, '/TR', tr, ...sched]);
    if (r.status !== 0) die(`schtasks ${name}: ${(r.stderr || r.stdout).trim()}`);
    log(`attivita' "${name}" creata`);
  }
}

function winUninstall() {
  for (const name of [TASK, TASK_LOGON]) {
    const r = sh('schtasks', ['/Delete', '/F', '/TN', name]);
    log(r.status === 0 ? `attivita' "${name}" rimossa` : `attivita' "${name}" non presente`);
  }
  if (fs.existsSync(VBS)) fs.unlinkSync(VBS);
}

function winStatus() {
  for (const name of [TASK, TASK_LOGON]) {
    const r = sh('schtasks', ['/Query', '/TN', name, '/FO', 'LIST']);
    log(r.status === 0 ? `"${name}":\n${r.stdout.trim()}` : `"${name}": non installata`);
  }
}

// --------------------------------------------------------------- cron ---
// null = crontab non disponibile
function cronRead() {
  const r = sh('crontab', ['-l']);
  if (r.error) return null;
  return r.status === 0 ? r.stdout : ''; // nessuna crontab = vuota
}

function cronWrite(text) {
  const r = sh('crontab', ['-'], text);
  if (r.status !== 0) die(`crontab: ${(r.stderr || '').trim()}`);
}

function cronInstall(every) {
  const cur = cronRead();
  if (cur === null) die('crontab non disponibile: installa cron o usa solo --claude-hooks --no-schedule');
  const kept = cur.split('\n').filter((l) => l && !l.includes(CRON_MARK));
  const cmd = `"${NODE}" "${AUTO}"`;
  kept.push(`*/${every} * * * * ${cmd} ${CRON_MARK}`, `@reboot sleep 60 && ${cmd} ${CRON_MARK}`);
  cronWrite(kept.join('\n') + '\n');
  log(`crontab aggiornata: ogni ${every} minuti e al riavvio`);
}

function cronUninstall() {
  const cur = cronRead();
  if (cur === null) { log('crontab non disponibile: niente da rimuovere'); return; }
  const lines = cur.split('\n').filter((l) => l);
  const kept = lines.filter((l) => !l.includes(CRON_MARK));
  if (kept.length === lines.length) { log('nessuna riga kb-memory-sync in crontab'); return; }
  cronWrite(kept.length ? kept.join('\n') + '\n' : '');
  log('righe kb-memory-sync rimosse dalla crontab');
}

function cronStatus() {
  const cur = cronRead();
  if (cur === null) { log('crontab non disponibile'); return; }
  const lines = cur.split('\n').filter((l) => l.includes(CRON_MARK));
  log(lines.length ? `crontab:\n${lines.join('\n')}` : 'crontab: non installata');
}

// ------------------------------------------------- hook di Claude Code ---
function readSettings() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return {};
  try { return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8')); } catch (e) {
    die(`${CLAUDE_SETTINGS} non e' JSON valido (${e.message}): non lo tocco`);
  }
}

function writeSettings(cfg) {
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  if (fs.existsSync(CLAUDE_SETTINGS)) fs.copyFileSync(CLAUDE_SETTINGS, `${CLAUDE_SETTINGS}.bak-kb-sync`);
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cfg, null, 2) + '\n');
}

// Toglie i nostri hook lasciando intatti quelli degli altri (plugin agentmemory compreso)
function stripOurHooks(cfg) {
  for (const ev of HOOK_EVENTS) {
    const groups = cfg.hooks?.[ev];
    if (!Array.isArray(groups)) continue;
    cfg.hooks[ev] = groups
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('kb-auto-sync')) }))
      .filter((g) => g.hooks.length);
    if (!cfg.hooks[ev].length) delete cfg.hooks[ev];
  }
}

function hooksInstall() {
  const cfg = readSettings();
  stripOurHooks(cfg);
  cfg.hooks ??= {};
  const command = `"${NODE}" "${AUTO}" --background`;
  for (const ev of HOOK_EVENTS) {
    (cfg.hooks[ev] ??= []).push({ hooks: [{ type: 'command', command, timeout: 10 }] });
  }
  writeSettings(cfg);
  log(`hook di Claude Code (SessionStart, SessionEnd) scritti in ${CLAUDE_SETTINGS} (backup .bak-kb-sync)`);
}

function hooksUninstall() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return;
  const cfg = readSettings();
  const before = JSON.stringify(cfg);
  stripOurHooks(cfg);
  if (JSON.stringify(cfg) === before) { log('nessun hook kb-auto-sync in Claude Code'); return; }
  writeSettings(cfg);
  log('hook kb-auto-sync rimossi da Claude Code');
}

function hooksStatus() {
  const cfg = fs.existsSync(CLAUDE_SETTINGS) ? readSettings() : {};
  const found = HOOK_EVENTS.filter((ev) => (cfg.hooks?.[ev] || [])
    .some((g) => (g.hooks || []).some((h) => String(h.command || '').includes('kb-auto-sync'))));
  log(`hook Claude Code: ${found.length ? found.join(', ') : 'non installati'}`);
}

// --------------------------------------------------------------- main ---
const [cmd = 'status', ...rest] = process.argv.slice(2);
const opt = { every: 15, claudeHooks: false, schedule: true };
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--every') opt.every = Number(rest[++i]);
  else if (rest[i] === '--claude-hooks') opt.claudeHooks = true;
  else if (rest[i] === '--no-schedule') opt.schedule = false;
  else die(`argomento sconosciuto: ${rest[i]}`);
}
if (!Number.isInteger(opt.every) || opt.every < 1 || opt.every > 59) die('--every deve essere tra 1 e 59 minuti');

if (cmd === 'install') {
  if (opt.schedule) (WIN ? winInstall : cronInstall)(opt.every);
  if (opt.claudeHooks) hooksInstall();
  log(`fatto. Log della sync: ${path.join(os.homedir(), '.agentmemory', 'memory-sync.log')}`);
} else if (cmd === 'uninstall') {
  (WIN ? winUninstall : cronUninstall)();
  hooksUninstall();
} else if (cmd === 'status') {
  (WIN ? winStatus : cronStatus)();
  hooksStatus();
} else {
  die(`comando sconosciuto: ${cmd} (install | uninstall | status)`);
}
