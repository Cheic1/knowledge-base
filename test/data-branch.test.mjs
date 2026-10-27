import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { ensureDataWorktree, legacySyncBlobs, pullData, pushData } from '../scripts/lib/data-branch.mjs';
import { clone, git, makeRemote, write } from './helpers.mjs';

// main con memories/sync/*.json, poi un commit (merge di una PR) che li toglie
function legacyRemote() {
  const r = makeRemote({ 'README.md': 'codice\n', 'memories/sync/.gitkeep': '', 'memories/sync/pc1.json': '{"v":1}\n' });
  write(path.join(r.seed, 'memories/sync/server.json'), '{"v":"server-vecchio"}\n');
  git(r.seed, 'add', '-A'); git(r.seed, 'commit', '-q', '-m', 'memory-sync: server');
  // la PR parte da qui e toglie i file...
  git(r.seed, 'checkout', '-q', '-b', 'pr');
  git(r.seed, 'rm', '-q', 'memories/sync/pc1.json', 'memories/sync/server.json');
  git(r.seed, 'commit', '-q', '-m', 'dati fuori da main');
  // ...nel frattempo il server esporta ancora su main
  git(r.seed, 'checkout', '-q', 'main');
  write(path.join(r.seed, 'memories/sync/server.json'), '{"v":"server-nuovo"}\n');
  git(r.seed, 'commit', '-q', '-am', 'memory-sync: server');
  // conflitto modifica/cancellazione, risolto come farebbe la PR: i dati escono da main
  spawnSync('git', ['merge', '-q', '--no-edit', 'pr'], { cwd: r.seed });
  git(r.seed, 'rm', '-q', 'memories/sync/server.json');
  git(r.seed, 'commit', '-q', '--no-edit');
  git(r.seed, 'push', '-q', 'origin', 'main');
  return r;
}

test('legacySyncBlobs: prende i dati piu\' recenti di main prima del merge che li toglie', () => {
  const r = legacyRemote();
  const blobs = legacySyncBlobs(r.seed, 'main');
  assert.deepEqual(blobs.map((b) => b.name).sort(), ['pc1.json', 'server.json']);
  const server = blobs.find((b) => b.name === 'server.json');
  assert.equal(git(r.seed, 'cat-file', '-p', server.sha), '{"v":"server-nuovo"}');
});

test('ensureDataWorktree: crea kb-data ORFANO, lo apre in .kb-data e un secondo clone lo riusa', () => {
  const r = legacyRemote();
  const a = clone(r.origin, path.join(r.root, 'a'));
  const logs = [];
  const dir = ensureDataWorktree(a, { log: (m) => logs.push(m) });
  assert.equal(dir, path.join(a, '.kb-data'));
  assert.equal(fs.readFileSync(path.join(dir, 'memories/sync/server.json'), 'utf8'), '{"v":"server-nuovo"}\n');
  assert.ok(fs.existsSync(path.join(dir, 'memories/sync/pc1.json')));
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'kb-data');
  // orfano: nessun antenato comune con main, un solo commit
  const mb = spawnSync('git', ['merge-base', 'main', 'kb-data'], { cwd: a });
  assert.notEqual(mb.status, 0, 'kb-data non deve condividere storia con main');
  assert.equal(git(a, 'rev-list', '--count', 'kb-data'), '1');
  assert.equal(git(a, 'status', '--porcelain'), '', 'main resta pulito (.kb-data ignorato)');
  assert.ok(logs.some((l) => /orfano/.test(l)));
  // push e secondo clone: usa il branch remoto, non ne crea un altro
  write(path.join(dir, 'memories/sync/a.json'), '{}\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'memory-sync: a');
  assert.ok(pushData(dir).ok);
  const b = clone(r.origin, path.join(r.root, 'b'));
  const dirB = ensureDataWorktree(b);
  assert.ok(fs.existsSync(path.join(dirB, 'memories/sync/a.json')));
  assert.equal(git(dirB, 'rev-parse', 'HEAD'), git(dir, 'rev-parse', 'HEAD'));
  // b esporta e fa push, a fa pull
  write(path.join(dirB, 'memories/sync/b.json'), '{}\n');
  git(dirB, 'add', '-A'); git(dirB, 'commit', '-q', '-m', 'memory-sync: b');
  assert.ok(pushData(dirB).ok);
  assert.ok(pullData(dir).ok);
  assert.ok(fs.existsSync(path.join(dir, 'memories/sync/b.json')));
});

test('pullData: due kb-data orfani creati insieme -> vince il remoto', () => {
  const r = legacyRemote();
  const a = clone(r.origin, path.join(r.root, 'a'));
  const b = clone(r.origin, path.join(r.root, 'b'));
  const dirA = ensureDataWorktree(a, { offline: true });
  process.env.GIT_COMMITTER_DATE = '2020-01-01T00:00:00Z'; // commit orfano diverso da quello di a
  let dirB;
  try { dirB = ensureDataWorktree(b, { offline: true }); } finally { delete process.env.GIT_COMMITTER_DATE; }
  assert.notEqual(git(dirA, 'rev-parse', 'HEAD'), git(dirB, 'rev-parse', 'HEAD'));
  write(path.join(dirA, 'memories/sync/a.json'), '{}\n');
  git(dirA, 'add', '-A'); git(dirA, 'commit', '-q', '-m', 'a');
  assert.ok(pushData(dirA).ok);
  assert.ok(!pushData(dirB).ok, 'storie non collegate: push rifiutato');
  const logs = [];
  const pr = pullData(dirB, { log: (m) => logs.push(m) });
  assert.ok(pr.ok, pr.out);
  assert.equal(git(dirB, 'rev-parse', 'HEAD'), git(dirA, 'rev-parse', 'HEAD'));
  assert.ok(logs.some((l) => /non collegato/.test(l)));
});
