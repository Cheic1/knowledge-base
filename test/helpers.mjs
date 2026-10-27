// Utilita' dei test: repo git temporanei, mai la rete, mai la HOME vera.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function tmpdir(prefix = 'kb-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'kb-test', GIT_AUTHOR_EMAIL: 'kb@test', GIT_COMMITTER_NAME: 'kb-test', GIT_COMMITTER_EMAIL: 'kb@test',
  GIT_CONFIG_NOSYSTEM: '1',
};

export function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} (${cwd}): ${r.stderr}`);
  return r.stdout.trim();
}

export function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// Remote "origin" bare con un primo commit su main, e un clone di lavoro.
//   files: { 'percorso': 'contenuto' } del primo commit
export function makeRemote(files) {
  const root = tmpdir();
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'init', '-q', '-b', 'main', seed);
  for (const [f, t] of Object.entries(files)) write(path.join(seed, f), t);
  git(seed, 'add', '-A', '-f'); // -f: anche i file che il .gitignore attuale esclude (stato vecchio di main)
  git(seed, 'commit', '-q', '-m', 'primo');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', '-u', 'origin', 'main');
  return { root, origin, seed };
}

export function clone(origin, dir) {
  git(path.dirname(dir), 'clone', '-q', origin, dir);
  git(dir, 'config', 'user.name', 'kb-test');
  git(dir, 'config', 'user.email', 'kb@test');
  return dir;
}

// Copia del repo vero (file tracciati + modifiche non committate), per far girare
// gli script su un clone usa e getta
export function repoFiles() {
  const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' });
  const out = {};
  for (const f of r.stdout.split('\n').filter(Boolean)) {
    if (/^(memories\/sync\/.*\.json|wiki\/|bench\/|mcp\/)/.test(f)) continue;
    const p = path.join(REPO, f);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) out[f] = fs.readFileSync(p, 'utf8');
  }
  return out;
}

// Ambiente isolato per lanciare gli script: HOME finta, niente skill/npx
export function isolatedEnv(home, extra = {}) {
  return {
    ...process.env, ...GIT_ENV, HOME: home, USERPROFILE: home, KB_SKIP_SKILLS: '1',
    KB_API_URL: 'http://127.0.0.1:9', KB_TOKEN: '', ...extra,
  };
}
