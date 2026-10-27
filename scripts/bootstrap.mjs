#!/usr/bin/env node
// bootstrap.mjs - Primo passo dell'installazione: porta il clone su main in modo
// sicuro e poi lancia `kb.mjs install`. Non dipende da altri file del repo, cosi'
// funziona anche su un clone vecchio (dove kb.mjs non esiste ancora):
//
//   # clone esistente, anche su un branch vecchio:
//   git fetch origin && git show origin/main:scripts/bootstrap.mjs > "$TMPDIR/kb-bootstrap.mjs" \
//     && node "$TMPDIR/kb-bootstrap.mjs"
//   # nessun clone: lo crea in ~/knowledge-base
//   node bootstrap.mjs [--dir CARTELLA] [--url URL_REPO]
//
// Opzioni: --dir CARTELLA   clone da usare/creare. Senza --dir lo cerca, in ordine:
//                           KB_REPO_DIR, il clone gia' installato (campo "repo" di
//                           ~/.agentmemory/kb-install.json), la cartella git corrente
//                           (process.cwd(), se e' il nostro repo), ~/knowledge-base.
//                           Non usa mai la cartella dove sta questo file: di solito e'
//                           una cartella temporanea.
//          --url URL        remote da clonare se il clone non esiste (GitHub, GitLab...)
//          --no-install     fermati dopo aver aggiornato il clone
//          tutto il resto   passato a `kb.mjs install` (--role server, --wiki-search...)
//
// Cosa fa, in ordine (idempotente, si puo' rilanciare):
//   1. clone se manca, altrimenti fetch
//   2. se il branch corrente traccia data/ (database vivo di agentmemory, tracciato
//      prima della PR #3): copia di sicurezza in ~/.agentmemory/data-backup-<data>
//      e data/ esce da git SENZA toccare i file sul disco
//   3. modifiche locali ad altri file tracciati: si ferma e le elenca
//   4. passa a main (i commit locali del vecchio branch vengono uniti) e fa pull
//   5. lancia scripts/kb.mjs install
// Non usa mai checkout -f, reset --hard o clean.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const DEFAULT_URL = 'https://github.com/Cheic1/knowledge-base.git';
const PROXY_HINT = 'se sei dietro un proxy aziendale che blocca il remote prova, solo per questo repo: '
  + 'git config http.proxy ""';

const log = (m) => console.log(`[bootstrap] ${m}`);
function die(m) { console.error(`[bootstrap] ERRORE ${m}`); process.exit(1); }

let REPO = '';
function git(args, { cwd, timeout = 120000 } = {}) {
  const r = spawnSync('git', args, { cwd: cwd ?? REPO, encoding: 'utf8', timeout, windowsHide: true });
  if (r.error?.code === 'ENOENT') die('git non trovato. Windows: winget install Git.Git');
  if (r.error?.code === 'ETIMEDOUT') die(`git ${args[0]} bloccato da oltre ${timeout / 1000}s: ${PROXY_HINT}`);
  r.out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return r;
}

// ---- argomenti ----
let dir = '', url = process.env.KB_REPO_URL || DEFAULT_URL, install = true;
const pass = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dir') dir = argv[++i] || die('--dir richiede una cartella');
  else if (argv[i] === '--url') url = argv[++i] || die('--url richiede un indirizzo');
  else if (argv[i] === '--no-install') install = false;
  else pass.push(argv[i]);
}

if (Number(process.versions.node.split('.')[0]) < 20) {
  die(`serve Node.js 20 o superiore (questo e' ${process.version}). Windows: winget install OpenJS.NodeJS.LTS`);
}

// ---- 1. trova o crea il clone ----
function toplevel(cwd) {
  if (!fs.existsSync(cwd)) return '';
  const r = git(['rev-parse', '--show-toplevel'], { cwd });
  return r.status === 0 ? path.resolve(r.stdout.trim()) : '';
}
const expand = (p) => path.resolve(p.replace(/^~(?=$|[\\/])/, HOME));
// Un clone e' nostro se ha la configurazione dell'endpoint o il remote si chiama knowledge-base
function isOurs(r) {
  if (!r) return false;
  if (fs.existsSync(path.join(r, 'config', 'endpoint.env'))) return true;
  return /knowledge-base/i.test(git(['remote', 'get-url', 'origin'], { cwd: r }).stdout);
}
function installedRepo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, '.agentmemory', 'kb-install.json'), 'utf8')).repo || '';
  } catch { return ''; }
}
if (dir) {
  dir = expand(dir);
  REPO = toplevel(dir);
} else {
  const cands = [process.env.KB_REPO_DIR, installedRepo(), process.cwd(), path.join(HOME, 'knowledge-base')];
  for (const c of cands.filter(Boolean)) {
    const top = toplevel(expand(c));
    if (isOurs(top)) { REPO = top; break; }
  }
}
if (!REPO) {
  const target = dir || path.join(HOME, 'knowledge-base');
  if (fs.existsSync(target) && fs.readdirSync(target).length) die(`${target} esiste e non e' un clone git: scegli un'altra cartella con --dir`);
  log(`clone di ${url} in ${target}`);
  const c = git(['clone', url, target], { cwd: HOME, timeout: 10 * 60000 });
  if (c.status !== 0) die(`git clone: ${c.out}\n  ${PROXY_HINT}`);
  REPO = target;
}
log(`clone: ${REPO}`);
const remote = git(['remote', 'get-url', 'origin']);
if (remote.status !== 0) die('il clone non ha il remote "origin"');
log(`remote: ${remote.stdout.trim()}`);

// ---- 2. fetch ----
const f = git(['fetch', 'origin'], { timeout: 5 * 60000 });
if (f.status !== 0) die(`git fetch: ${f.out}\n  ${PROXY_HINT}`);
const sym = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
let main = sym.status === 0 ? sym.stdout.trim().replace(/^origin\//, '') : 'main';
if (git(['rev-parse', '--verify', '-q', `origin/${main}`]).status !== 0) main = 'main';

for (const f2 of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD']) {
  if (fs.existsSync(path.join(REPO, '.git', f2))) die('git ha un merge/rebase in corso nel clone: risolvilo (o git merge --abort / git rebase --abort) e rilancia');
}

// ---- 3. modifiche locali a file tracciati (data/ escluso: ci pensa il punto 4) ----
const dirty = git(['status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude)data']).stdout.split('\n').filter(Boolean);
if (dirty.length) {
  console.error('[bootstrap] ci sono modifiche locali a file tracciati, non le tocco:');
  dirty.forEach((l) => console.error(`    ${l}`));
  die('salvale (git stash) o scartale tu, poi rilancia');
}

// ---- 4. data/ tracciato dal vecchio branch ----
let dataBackup = '';
const trackedData = git(['ls-files', '--', 'data']).stdout.trim();
const mainTracksData = git(['ls-tree', '-r', '--name-only', `origin/${main}`, '--', 'data']).stdout.trim();
if (trackedData && !mainTracksData) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const backup = path.join(HOME, '.agentmemory', `data-backup-${stamp}`);
  const src = path.join(REPO, 'data');
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.cpSync(src, backup, { recursive: true });
    if (!fs.existsSync(backup)) die(`copia di sicurezza di data/ non riuscita: ${backup}`);
    dataBackup = backup;
    log(`copia di sicurezza di data/ -> ${backup}`);
  }
  const rm = git(['rm', '-r', '--cached', '-q', '--ignore-unmatch', 'data']);
  if (rm.status !== 0) die(`git rm --cached data: ${rm.out}`);
  const ident = git(['config', 'user.email']).stdout.trim() ? [] : ['-c', 'user.name=kb-install', '-c', 'user.email=kb@localhost'];
  const cm = git([...ident, 'commit', '-q', '-m', 'Stop tracking data/ (locale)']);
  if (cm.status !== 0 && !/nothing|niente/i.test(cm.out)) die(`commit locale: ${cm.out}`);
  log('data/ non e\' piu\' tracciato da git; i file sul disco non sono stati toccati');
}

// ---- 5. passa a main e aggiorna ----
const cur = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
if (cur !== main) {
  log(`il clone e' sul branch '${cur}': passo a '${main}'`);
  // Un main locale vecchio (che traccia ancora data/) farebbe scrivere git sui file del
  // database: lo si allinea al remote prima, senza toccare la cartella di lavoro.
  if (git(['rev-parse', '--verify', '-q', `refs/heads/${main}`]).status === 0) {
    const ahead = git(['rev-list', '--count', `origin/${main}..${main}`]).stdout.trim();
    if (ahead === '0') git(['branch', '-f', main, `origin/${main}`]);
    else {
      const old = `${main}-vecchio-${Date.now()}`;
      git(['branch', '-m', main, old]);
      log(`il '${main}' locale aveva commit non pubblicati: li ho tenuti nel branch '${old}'`);
    }
  }
  let sw = git(['checkout', main]);
  if (sw.status !== 0) sw = git(['checkout', '-b', main, '--track', `origin/${main}`]);
  if (sw.status !== 0) die(`non riesco a passare a ${main}: ${sw.out}`);
}
git(['branch', `--set-upstream-to=origin/${main}`, main]);
const pull = git(['pull', '--rebase', '--autostash', 'origin', main], { timeout: 5 * 60000 });
if (pull.status !== 0) {
  git(['rebase', '--abort']);
  die(`git pull: ${pull.out}\n  ${PROXY_HINT}`);
}
if (cur !== main && cur !== 'HEAD' && git(['rev-list', '--count', `${main}..${cur}`]).stdout.trim() !== '0') {
  const m = git(['merge', '--no-edit', cur]);
  if (m.status !== 0) {
    git(['merge', '--abort']);
    log(`i commit locali di '${cur}' non si uniscono da soli a ${main}: restano su quel branch (${m.out.split('\n')[0]})`);
  } else log(`commit locali di '${cur}' uniti in ${main}`);
}
// Rete di sicurezza: se per un branch locale strano (testa staccata, altro branch che
// traccia ancora data/) git ha toccato i file del database, rimette quelli della copia.
function restoreData() {
  if (!dataBackup) return;
  let restored = 0;
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dataBackup, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) { walk(r); continue; }
      const from = path.join(dataBackup, r), to = path.join(REPO, 'data', r);
      const same = fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size
        && Buffer.compare(fs.readFileSync(to), fs.readFileSync(from)) === 0;
      if (!same) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); restored++; }
    }
  };
  walk('');
  if (restored) log(`ATTENZIONE: git aveva modificato ${restored} file di data/: ripristinati dalla copia di sicurezza`);
}
restoreData();
log(`clone aggiornato: ${main} @ ${git(['rev-parse', '--short', 'HEAD']).stdout.trim()}`);

// ---- 6. installazione ----
if (!install) { log('--no-install: mi fermo qui'); process.exit(0); }
const kb = path.join(REPO, 'scripts', 'kb.mjs');
if (!fs.existsSync(kb)) die(`${kb} non esiste: il remote non ha ancora l'installatore`);
log('lancio: node scripts/kb.mjs install ' + pass.join(' '));
const r = spawnSync(process.execPath, [kb, 'install', ...pass], { cwd: REPO, stdio: 'inherit', windowsHide: true });
process.exit(r.status ?? 1);
