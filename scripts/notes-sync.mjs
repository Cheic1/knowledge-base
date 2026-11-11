#!/usr/bin/env node
// notes-sync.mjs - Sync git automatica di cartelle di note (es. il second brain)
// tra tutte le macchine, appoggiandosi al loro repo su GitHub.
//
// Le cartelle si elencano nel .env del clone della KB, separate da ';':
//   KB_NOTES_DIRS=/DATA/AppData/secondbrain
//   KB_NOTES_DIRS=D:\Francesco\Desktop\Python\SecondBrain
//
// Per ogni cartella (che deve essere gia' un clone git con un remote origin):
//   1. se ci sono modifiche: git add -A + commit "notes-sync: <macchina> <data>"
//      (il .gitignore della cartella decide cosa resta fuori: segreti, sessioni, ...);
//   2. git pull --rebase dal branch corrente;
//   3. git push.
// Se il rebase va in conflitto lo annulla: i commit locali restano, nulla si perde,
// e il conflitto si segnala nel log finche' qualcuno non lo risolve a mano.
// Se qualcosa e' cambiato (commit locali o scaricati) e la ricerca wiki (qmd) e' installata, l'indice
// si riallinea in background, cosi' gli agenti trovano subito le note nuove.
//
// Lo lancia kb-auto-sync.mjs a ogni giro (ogni 15 minuti), per qualsiasi ruolo.
//   node scripts/notes-sync.mjs          # a mano: stampa cosa fa
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT = Number(process.env.KB_SYNC_GIT_TIMEOUT || 90) * 1000;

function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: TIMEOUT, windowsHide: true });
  r.out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.error?.code === 'ETIMEDOUT') r.out = `git ${args[0]} bloccato da oltre ${TIMEOUT / 1000}s (rete?)`;
  return r;
}
const ok = (r) => r.status === 0;
// Lo scheduler puo' non avere un'identita' git: se manca se ne usa una di servizio
const ident = (dir) => (git(dir, ['config', 'user.email']).stdout.trim()
  ? [] : ['-c', 'user.name=notes-sync', '-c', 'user.email=notes-sync@localhost']);

export function notesDirs(value = process.env.KB_NOTES_DIRS || '') {
  return value.split(';').map((d) => d.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean);
}

// Sincronizza una cartella. Ritorna { dir, status, msg } con status:
//   'ok' | 'skip' (non e' un clone utilizzabile) | 'conflict' | 'error'
export function syncNotesDir(dir, { host = os.hostname() } = {}) {
  const res = (status, msg) => ({ dir, status, msg });
  if (!fs.existsSync(dir)) return res('skip', 'cartella inesistente');
  if (!ok(git(dir, ['rev-parse', '--is-inside-work-tree']))) return res('skip', 'non e\' un repo git');
  if (!git(dir, ['remote']).stdout.split('\n').includes('origin')) return res('skip', 'nessun remote origin');
  const branch = git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']).stdout.trim();
  if (!branch) return res('skip', 'HEAD staccato: nessun branch da sincronizzare');
  const gitDir = git(dir, ['rev-parse', '--absolute-git-dir']).stdout.trim();
  if (['rebase-merge', 'rebase-apply', 'MERGE_HEAD'].some((f) => fs.existsSync(path.join(gitDir, f)))) {
    return res('conflict', 'rebase o merge in corso: risolvilo a mano');
  }

  const notes = [];
  if (git(dir, ['status', '--porcelain']).stdout.trim()) {
    const add = git(dir, ['add', '-A']);
    if (!ok(add)) return res('error', `git add: ${add.out}`);
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const c = git(dir, [...ident(dir), 'commit', '-q', '-m', `notes-sync: ${host} ${stamp}`]);
    if (!ok(c)) return res('error', `git commit: ${c.out}`);
    notes.push('modifiche locali committate');
  }

  const remote = `origin/${branch}`;
  const oldRemote = git(dir, ['rev-parse', '-q', '--verify', remote]).stdout.trim();
  const f = git(dir, ['fetch', '-q', 'origin', branch]);
  if (!ok(f)) return res('error', `git fetch: ${f.out}`);
  if (ok(git(dir, ['rev-parse', '-q', '--verify', remote]))) {
    const rb = git(dir, [...ident(dir), 'rebase', '-q', remote]);
    if (!ok(rb)) {
      git(dir, ['rebase', '--abort']);
      return res('conflict', `conflitto con ${remote}: commit locali tenuti, risolvi a mano (git pull --rebase)`);
    }
  }
  const newRemote = git(dir, ['rev-parse', '-q', '--verify', remote]).stdout.trim();
  const pulled = !newRemote || newRemote === oldRemote ? 0
    : Number(git(dir, ['rev-list', '--count', oldRemote ? `${oldRemote}..${newRemote}` : newRemote]).stdout.trim() || 0);
  if (pulled) notes.push(`${pulled} commit scaricati`);

  const ahead = Number(git(dir, ['rev-list', '--count', newRemote ? `${remote}..HEAD` : 'HEAD']).stdout.trim() || 0);
  if (ahead) {
    const p = git(dir, ['push', '-q', 'origin', `HEAD:${branch}`]);
    if (!ok(p)) return res('error', `git push: ${p.out}`);
    notes.push(`${ahead} commit inviati`);
  }
  return { ...res('ok', notes.join(', ') || 'gia\' allineato'), changed: notes.length > 0 };
}

// Riallinea l'indice qmd in background, se la ricerca wiki e' installata qui
function reindex() {
  const script = path.join(HERE, 'wiki-search.sh');
  const qmd = path.join(os.homedir(), '.local', 'share', 'kb-qmd', 'node-path');
  if (process.platform === 'win32' || !fs.existsSync(script) || !fs.existsSync(qmd)) return;
  spawn('bash', [script, 'update', '--no-pull', '--background'], { detached: true, stdio: 'ignore' }).unref();
}

export function main() {
  const dirs = notesDirs();
  if (!dirs.length) { console.log('notes-sync: KB_NOTES_DIRS vuota, niente da fare'); return 0; }
  let code = 0;
  let changed = false;
  for (const dir of dirs) {
    const r = syncNotesDir(dir);
    console.log(`notes-sync ${dir}: ${r.status} - ${r.msg}`);
    if (r.status === 'conflict' || r.status === 'error') code = 1;
    if (r.changed) changed = true;
  }
  if (changed) reindex();
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
