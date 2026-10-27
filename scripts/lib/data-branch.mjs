// data-branch.mjs - Dati di sync/backup separati dal codice.
//
// Le memorie esportate (memories/sync/<nodo>.json) non stanno piu' su main ma sul
// branch ORFANO `kb-data` (nessuna storia in comune con main), aperto come worktree
// in <repo>/.kb-data/ (ignorato da git). Cosi':
//   - `kb.mjs update` aggiorna il codice senza mai tirare dati, e viceversa;
//   - un push di memorie non tocca mai main.
//
// Il branch si crea da solo al primo uso, con i file memories/sync/*.json presi
// dall'ultima versione di main che li conteneva (migrazione una tantum).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_BRANCH = 'kb-data';
export const DATA_DIR = '.kb-data';
const SYNC_PATH = 'memories/sync';

function git(repo, args, { input, timeout = 90000 } = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', input, timeout, windowsHide: true });
  r.out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.error?.code === 'ETIMEDOUT') r.out = `git ${args[0]} bloccato da oltre ${timeout / 1000}s (proxy?)`;
  return r;
}
const ok = (r) => r.status === 0;
const ident = (repo) => (git(repo, ['config', 'user.email']).stdout.trim()
  ? [] : ['-c', 'user.name=kb-sync', '-c', 'user.email=kb@localhost']);

export const dataDir = (repo) => path.join(repo, DATA_DIR);
export const dataSyncDir = (repo) => path.join(dataDir(repo), ...SYNC_PATH.split('/'));

// File memories/sync/*.json dell'ultima versione di `ref` che li conteneva: [{name, sha}]
export function legacySyncBlobs(repo, ref) {
  const list = (rev) => git(repo, ['ls-tree', `${rev}:${SYNC_PATH}`]).stdout.split('\n')
    .map((l) => l.match(/^100644 blob ([0-9a-f]+)\t(.+\.json)$/)).filter(Boolean)
    .map((m) => ({ sha: m[1], name: m[2] }));
  const last = git(repo, ['rev-list', '-1', '--first-parent', ref, '--', SYNC_PATH]).stdout.trim();
  if (!last) return [];
  const here = list(last);
  // l'ultimo commit puo' essere quello che li ha tolti (o il merge della PR): si prende il primo genitore
  return here.length ? here : list(`${last}^`);
}

// Crea il branch orfano kb-data con i plumbing di git, senza toccare la cartella
// di lavoro di main (equivale a `git checkout --orphan kb-data` + commit dei soli dati).
export function createOrphanDataBranch(repo, blobs) {
  const mktree = (entries) => {
    const r = git(repo, ['mktree'], { input: entries.map((e) => `${e}\n`).join('') });
    if (!ok(r)) throw new Error(`git mktree: ${r.out}`);
    return r.stdout.trim();
  };
  const readme = git(repo, ['hash-object', '-w', '--stdin'], {
    input: '# kb-data\n\nBranch orfano con i soli dati di sync/backup della knowledge base.\n'
      + 'Lo scrivono gli script (scripts/memory-sync.mjs): non modificarlo a mano.\n'
      + 'Il codice sta su main.\n',
  }).stdout.trim();
  const keep = git(repo, ['hash-object', '-w', '--stdin'], { input: '' }).stdout.trim();
  const sync = mktree([`100644 blob ${keep}\t.gitkeep`, ...blobs.map((b) => `100644 blob ${b.sha}\t${b.name}`)]);
  const memories = mktree([`040000 tree ${sync}\tsync`]);
  const root = mktree([`100644 blob ${readme}\tREADME.md`, `040000 tree ${memories}\tmemories`]);
  const c = git(repo, [...ident(repo), 'commit-tree', root, '-m', 'kb-data: dati di sync e backup (branch orfano)']);
  if (!ok(c)) throw new Error(`git commit-tree: ${c.out}`);
  const b = git(repo, ['branch', DATA_BRANCH, c.stdout.trim()]);
  if (!ok(b)) throw new Error(`git branch ${DATA_BRANCH}: ${b.out}`);
  return c.stdout.trim();
}

const hasRef = (repo, ref) => ok(git(repo, ['rev-parse', '--verify', '-q', ref]));

// Garantisce il worktree .kb-data sul branch kb-data e ne ritorna il percorso.
//   log(msg): messaggi per l'utente. offline: non fa fetch.
export function ensureDataWorktree(repo, { log = () => {}, offline = false, mainRef = 'origin/main' } = {}) {
  const dir = dataDir(repo);
  if (fs.existsSync(path.join(dir, '.git'))) return dir;
  git(repo, ['worktree', 'prune']);
  if (!offline) git(repo, ['fetch', 'origin', DATA_BRANCH]); // fallisce se il branch non esiste ancora: ok
  const remote = hasRef(repo, `refs/remotes/origin/${DATA_BRANCH}`);
  if (!hasRef(repo, `refs/heads/${DATA_BRANCH}`)) {
    if (remote) {
      git(repo, ['branch', DATA_BRANCH, `origin/${DATA_BRANCH}`]);
    } else {
      const ref = hasRef(repo, mainRef) ? mainRef : 'HEAD';
      const blobs = legacySyncBlobs(repo, ref);
      createOrphanDataBranch(repo, blobs);
      log(`creato il branch orfano ${DATA_BRANCH} con ${blobs.length} file di sync presi da ${ref}`);
    }
  }
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
    throw new Error(`${dir} esiste ma non e' un worktree git: spostalo e rilancia`);
  }
  // .kb-data/ e' gia' in .gitignore di main; l'exclude locale copre anche i clone su versioni vecchie
  const exclude = path.resolve(repo, git(repo, ['rev-parse', '--git-path', 'info/exclude']).stdout.trim());
  const ex = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  if (!ex.split(/\r?\n/).includes(`/${DATA_DIR}/`)) {
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, `${ex && !ex.endsWith('\n') ? '\n' : ''}/${DATA_DIR}/\n`);
  }
  const w = git(repo, ['worktree', 'add', dir, DATA_BRANCH]);
  if (!ok(w)) throw new Error(`git worktree add: ${w.out}`);
  if (remote) git(dir, ['branch', `--set-upstream-to=origin/${DATA_BRANCH}`, DATA_BRANCH]);
  log(`dati di sync nel worktree ${dir} (branch ${DATA_BRANCH})`);
  return dir;
}

// Pull dei dati. Se due macchine hanno creato kb-data insieme (storie non collegate),
// vince quella remota: i dati locali sono solo export rigenerabili.
export function pullData(dir, { log = () => {} } = {}) {
  const f = git(dir, ['fetch', 'origin', DATA_BRANCH]);
  if (!ok(f)) {
    if (/couldn't find remote ref|not find remote ref/i.test(f.out)) return { ok: true, remote: false };
    return { ok: false, out: f.out };
  }
  if (!ok(git(dir, ['merge-base', 'HEAD', `origin/${DATA_BRANCH}`]))) {
    git(dir, ['reset', '-q', '--hard', `origin/${DATA_BRANCH}`]);
    git(dir, ['branch', `--set-upstream-to=origin/${DATA_BRANCH}`, DATA_BRANCH]);
    log(`${DATA_BRANCH} locale non collegato al remoto: allineato a origin/${DATA_BRANCH} (l'export si rigenera)`);
    return { ok: true, remote: true };
  }
  const r = git(dir, ['rebase', '-q', '--autostash', `origin/${DATA_BRANCH}`]);
  if (!ok(r)) {
    git(dir, ['rebase', '--abort']);
    return { ok: false, out: r.out };
  }
  return { ok: true, remote: true };
}

export function pushData(dir) {
  const r = git(dir, ['push', '-u', 'origin', DATA_BRANCH]);
  return { ok: ok(r), out: r.out };
}
