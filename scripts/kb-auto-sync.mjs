#!/usr/bin/env node
// Sync automatica delle memorie: aggiornamento del codice (kb.mjs update, che da solo
// controlla al massimo una volta ogni KB_UPDATE_HOURS ore), poi import-agent-memories +
// memory-sync (salvo il ruolo client, che non ha memorie locali), senza output
// a video, con log in ~/.agentmemory/memory-sync.log. Pensato per essere lanciato
// dallo scheduler (Utilita' di pianificazione, cron) e dagli hook di Claude Code.
//
//   node scripts/kb-auto-sync.mjs               # esegue e scrive il log
//   node scripts/kb-auto-sync.mjs --background  # torna subito, lavora in background
//                                               # (per gli hook: non blocca l'agente)
//
// Se agentmemory non risponde esce senza errori: il prossimo giro riprova.
// Le variabili di memory-sync (KB_MEMORY_URL, AGENTMEMORY_SECRET, KB_SYNC_DIR,
// KB_SYNC_NODE) passano invariate; se mancano si leggono da <repo>/.env.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(os.homedir(), '.agentmemory', 'memory-sync.log');
const MAX_LOG = 1024 * 1024;

if (process.argv.includes('--background')) {
  const args = process.argv.slice(2).filter((a) => a !== '--background');
  spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
  process.exit(0);
}

function log(text) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > MAX_LOG) {
      const old = fs.readFileSync(LOG, 'utf8');
      fs.writeFileSync(LOG, old.slice(old.length / 2));
    }
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    fs.appendFileSync(LOG, text.trim().split('\n').map((l) => `${stamp} ${l}`).join('\n') + '\n');
  } catch { /* il log non deve mai far fallire la sync */ }
}

function run(script) {
  const r = spawnSync(process.execPath, [path.join(HERE, script)], {
    encoding: 'utf8', windowsHide: true, timeout: 10 * 60 * 1000,
  });
  log(`${(r.stdout || '')}${(r.stderr || '')}` || `${script}: nessun output`);
  return r.status;
}

// Lo scheduler non eredita le variabili della shell: le prende da <repo>/.env
function loadEnv() {
  const file = path.join(HERE, '..', '.env');
  if (!fs.existsSync(file)) return;
  const keys = ['KB_MEMORY_URL', 'AGENTMEMORY_SECRET', 'KB_SYNC_DIR', 'KB_SYNC_NODE'];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && keys.includes(m[1]) && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// Prima di tutto si aggiorna il codice dal remote (kb.mjs update): cosi' ogni macchina
// installata con kb.mjs install riceve da sola le novita', anche ad agentmemory spento.
function selfUpdate() {
  const r = spawnSync(process.execPath, [path.join(HERE, 'kb.mjs'), 'update', '--quiet'], {
    encoding: 'utf8', windowsHide: true, timeout: 20 * 60 * 1000,
  });
  if (r.status !== 0) log(`kb.mjs update uscito con codice ${r.status}: vedi ~/.agentmemory/kb-update.log`);
}

// Ruolo dalla installazione (kb.mjs install): un client non ha agentmemory locale
// ne' sync, controlla solo gli aggiornamenti del codice
function role() {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.agentmemory', 'kb-install.json'), 'utf8')).role || '';
  } catch { return ''; }
}

async function main() {
  loadEnv();
  selfUpdate();
  if (role() === 'client') return;
  const base = (process.env.KB_MEMORY_URL || 'http://127.0.0.1:3111').replace(/\/+$/, '');
  const headers = process.env.AGENTMEMORY_SECRET ? { Authorization: `Bearer ${process.env.AGENTMEMORY_SECRET}` } : {};
  try {
    const res = await fetch(`${base}/agentmemory/health`, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    log(`agentmemory non raggiungibile su ${base} (${e.cause?.code || e.message}): salto questo giro`);
    return;
  }
  run('import-agent-memories.mjs');
  const status = run('memory-sync.mjs');
  if (status !== 0) log(`memory-sync uscito con codice ${status}`);
}

main();
