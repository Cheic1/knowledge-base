// kb.mjs su un clone usa e getta, con HOME finta e senza rete
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { clone, git, isolatedEnv, makeRemote, repoFiles, tmpdir, write } from './helpers.mjs';

// PATH con solo node, git e sistema: niente claude/opencode/npx veri della macchina
function sandbox() {
  const r = makeRemote(repoFiles());
  const home = tmpdir('kb-home-');
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  const env = isolatedEnv(home, { PATH: `${bin}:/usr/bin:/bin` });
  const dir = clone(r.origin, path.join(r.root, 'clone'));
  const kb = (...args) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'kb.mjs'), ...args], { cwd: dir, env, encoding: 'utf8' });
  const state = () => JSON.parse(fs.readFileSync(path.join(home, '.agentmemory', 'kb-install.json'), 'utf8'));
  // nuovo commit su origin/main, come un merge di una PR
  const publish = (file, text) => {
    write(path.join(r.seed, file), text);
    git(r.seed, 'add', '-A'); git(r.seed, 'commit', '-q', '-m', `cambia ${file}`); git(r.seed, 'push', '-q', 'origin', 'main');
    return git(r.seed, 'rev-parse', 'HEAD');
  };
  return { r, home, dir, kb, state, publish };
}

test('install --role client: niente agentmemory locale, OpenCode sul server centrale, stato con il percorso del repo', () => {
  const s = sandbox();
  fs.mkdirSync(path.join(s.home, '.config', 'opencode'), { recursive: true });
  write(path.join(s.home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ model: 'mio/modello' }));
  write(path.join(s.dir, '.env'), 'KB_TOKEN=tok-client\n');
  const out = s.kb('install', '--role', 'client', '--no-schedule');
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.doesNotMatch(out.stdout, /npm install|avvio agentmemory/);
  const st = s.state();
  assert.equal(st.role, 'client');
  assert.equal(st.repo, s.dir);
  assert.equal(st.completed, true);
  const oc = JSON.parse(fs.readFileSync(path.join(s.home, '.config', 'opencode', 'opencode.json'), 'utf8'));
  assert.equal(oc.model, 'mio/modello');
  assert.deepEqual(oc.mcp.agentmemory.environment, { AGENTMEMORY_URL: 'http://127.0.0.1:9', AGENTMEMORY_SECRET: 'tok-client' });
  assert.ok(fs.existsSync(path.join(s.home, '.config', 'opencode', 'opencode.json.bak-kb')));
  // status del client
  const stt = s.kb('status');
  assert.equal(stt.status, 0, stt.stderr);
  assert.match(stt.stdout, /ruolo:\s+client/);
  assert.match(stt.stdout, /server:\s+http:\/\/127\.0\.0\.1:9 -> NON raggiungibile/);
});

test('update: fast-forward quando e\' tutto pulito, poi niente fino al prossimo intervallo', () => {
  const s = sandbox();
  assert.equal(s.kb('install', '--role', 'client', '--no-schedule').status, 0);
  const next = s.publish('README.md', 'nuovo readme\n');
  let u = s.kb('update');
  assert.equal(u.status, 0, u.stderr);
  assert.equal(git(s.dir, 'rev-parse', 'HEAD'), next);
  assert.equal(s.state().appliedCommit, next);
  // entro KB_UPDATE_HOURS non riprova (niente fetch ogni 15 minuti)
  const later = s.publish('README.md', 'ancora\n');
  u = s.kb('update');
  assert.equal(git(s.dir, 'rev-parse', 'HEAD'), next);
  u = s.kb('update', '--force');
  assert.equal(git(s.dir, 'rev-parse', 'HEAD'), later);
});

test('update: con modifiche locali a file tracciati non tocca nulla', () => {
  const s = sandbox();
  assert.equal(s.kb('install', '--role', 'client', '--no-schedule').status, 0);
  const before = git(s.dir, 'rev-parse', 'HEAD');
  s.publish('README.md', 'remoto\n');
  write(path.join(s.dir, 'README.md'), 'modifica locale\n');
  const u = s.kb('update', '--force');
  assert.equal(u.status, 0);
  assert.match(u.stdout, /modifiche locali a file tracciati, non aggiorno: README\.md/);
  assert.equal(git(s.dir, 'rev-parse', 'HEAD'), before);
  assert.equal(fs.readFileSync(path.join(s.dir, 'README.md'), 'utf8'), 'modifica locale\n');
  assert.equal(git(s.dir, 'stash', 'list'), '', 'niente autostash');
  assert.match(s.kb('status').stdout, /1 file tracciati modificati: l'aggiornamento automatico e' fermo/);
});

test('update: storia divergente (commit locali) -> niente rebase, salta', () => {
  const s = sandbox();
  assert.equal(s.kb('install', '--role', 'client', '--no-schedule').status, 0);
  write(path.join(s.dir, 'locale.txt'), 'x\n');
  git(s.dir, 'add', '-A'); git(s.dir, 'commit', '-q', '-m', 'commit locale');
  const mine = git(s.dir, 'rev-parse', 'HEAD');
  s.publish('README.md', 'remoto\n');
  const u = s.kb('update', '--force');
  assert.equal(u.status, 0);
  assert.match(u.stdout, /non e' un fast-forward/);
  assert.equal(git(s.dir, 'rev-parse', 'HEAD'), mine);
});

test('update sul server: i riavvii dei servizi restano in sospeso per la manutenzione', () => {
  const s = sandbox();
  assert.equal(s.kb('install', '--role', 'client', '--no-schedule').status, 0);
  // simula un server installato (install --role server richiede systemd e agentmemory veri)
  const st = { ...s.state(), role: 'server' };
  write(path.join(s.home, '.agentmemory', 'kb-install.json'), JSON.stringify(st));
  s.publish('scripts/kb-proxy.js', fs.readFileSync(path.join(s.dir, 'scripts', 'kb-proxy.js'), 'utf8') + '// cambio\n');
  const u = s.kb('update', '--force');
  assert.equal(u.status, 0, u.stderr);
  assert.match(u.stdout, /finestra di manutenzione/);
  assert.equal(s.state().pendingRestart, true);
  assert.match(s.kb('status').stdout, /riavvio dei servizi IN SOSPESO/);
});

test('ruolo pc delle installazioni vecchie = standalone-dev', () => {
  const s = sandbox();
  assert.equal(s.kb('install', '--role', 'client', '--no-schedule').status, 0);
  write(path.join(s.home, '.agentmemory', 'kb-install.json'), JSON.stringify({ ...s.state(), role: 'pc' }));
  assert.match(s.kb('status').stdout, /ruolo:\s+standalone-dev/);
});

test('token: genera, mostra, ruota e imposta KB_TOKEN in .env (ex kb-token.sh)', () => {
  const s = sandbox();
  write(path.join(s.dir, '.env'), 'ALTRO=1\n');
  const t1 = s.kb('token').stdout.trim();
  assert.match(t1, /^[0-9a-f]{64}$/);
  assert.equal(s.kb('token').stdout.trim(), t1);
  const t2 = s.kb('token', 'rotate').stdout.trim();
  assert.notEqual(t2, t1);
  assert.equal(s.kb('token', 'set', 'scelto-da-me-123').status, 0);
  assert.equal(s.kb('token', 'set', 'non valido').status, 1);
  assert.equal(fs.readFileSync(path.join(s.dir, '.env'), 'utf8').match(/KB_TOKEN=(.*)/)[1], 'scelto-da-me-123');
  assert.match(fs.readFileSync(path.join(s.dir, '.env'), 'utf8'), /^ALTRO=1\n/);
  // il wrapper sh resta compatibile
  const w = spawnSync('sh', [path.join(s.dir, 'scripts', 'kb-token.sh')], { env: isolatedEnv(s.home), encoding: 'utf8' });
  assert.equal(w.stdout.trim(), 'scelto-da-me-123');
});

test('connect: client cabla Cursor e Hermes senza bash ne\' Python', () => {
  const s = sandbox();
  fs.mkdirSync(path.join(s.home, '.cursor'), { recursive: true });
  write(path.join(s.home, '.hermes', 'config.yaml'), 'model: x\n');
  const out = s.kb('connect', '--role', 'client', '--all'); // Cursor ha solo la config: serve --all
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const cur = JSON.parse(fs.readFileSync(path.join(s.home, '.cursor', 'mcp.json'), 'utf8'));
  assert.equal(cur.mcpServers.agentmemory.env.AGENTMEMORY_URL, 'http://127.0.0.1:9');
  assert.match(fs.readFileSync(path.join(s.home, '.hermes', 'config.yaml'), 'utf8'), /^model: x\n\nmcp_servers:\n  agentmemory:/);
});
