import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { notesDirs, syncNotesDir } from '../scripts/notes-sync.mjs';
import { clone, git, makeRemote, tmpdir, write } from './helpers.mjs';

// Due "macchine" (pc e server) con un clone ciascuna dello stesso repo di note
function twoMachines() {
  const r = makeRemote({ 'CODA.md': '# Coda\n', '.gitignore': 'segreti/\n' });
  const pc = clone(r.origin, path.join(r.root, 'pc'));
  const server = clone(r.origin, path.join(r.root, 'server'));
  return { ...r, pc, server };
}
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

test('notesDirs: separa con ; e toglie spazi e virgolette', () => {
  assert.deepEqual(notesDirs(' /a/b ; "D:\\Note\\SB";;'), ['/a/b', 'D:\\Note\\SB']);
  assert.deepEqual(notesDirs(''), []);
});

test('syncNotesDir: una nota nuova sul pc arriva al server', () => {
  const m = twoMachines();
  write(path.join(m.pc, '00_Inbox/idea.md'), 'idea\n');
  const a = syncNotesDir(m.pc, { host: 'pc' });
  assert.equal(a.status, 'ok', a.msg);
  assert.match(git(m.pc, 'log', '-1', '--format=%s'), /^notes-sync: pc /);
  const b = syncNotesDir(m.server, { host: 'server' });
  assert.equal(b.status, 'ok', b.msg);
  assert.equal(read(m.server, '00_Inbox/idea.md'), 'idea\n');
});

test('syncNotesDir: modifiche su file diversi nelle due macchine si uniscono', () => {
  const m = twoMachines();
  write(path.join(m.pc, 'pc.md'), 'dal pc\n');
  write(path.join(m.server, 'server.md'), 'dal server\n');
  assert.equal(syncNotesDir(m.pc).status, 'ok');
  assert.equal(syncNotesDir(m.server).status, 'ok');
  assert.equal(syncNotesDir(m.pc).status, 'ok');
  assert.equal(read(m.pc, 'server.md'), 'dal server\n');
  assert.equal(read(m.server, 'pc.md'), 'dal pc\n');
  assert.equal(git(m.pc, 'rev-parse', 'HEAD'), git(m.server, 'rev-parse', 'HEAD'));
});

test('syncNotesDir: il .gitignore resta rispettato', () => {
  const m = twoMachines();
  write(path.join(m.pc, 'segreti/token.txt'), 'xxx\n');
  assert.equal(syncNotesDir(m.pc).status, 'ok');
  assert.equal(git(m.origin, 'ls-tree', '-r', '--name-only', 'main').includes('segreti'), false);
});

test('syncNotesDir: conflitto sulla stessa riga -> annulla il rebase e non perde nulla', () => {
  const m = twoMachines();
  write(path.join(m.pc, 'CODA.md'), '# Coda\n- dal pc\n');
  write(path.join(m.server, 'CODA.md'), '# Coda\n- dal server\n');
  assert.equal(syncNotesDir(m.server).status, 'ok');
  const r = syncNotesDir(m.pc);
  assert.equal(r.status, 'conflict');
  assert.equal(read(m.pc, 'CODA.md'), '# Coda\n- dal pc\n');
  assert.equal(git(m.pc, 'status', '--porcelain'), '');
  assert.equal(fs.existsSync(path.join(m.pc, '.git', 'rebase-merge')), false);
});

test('syncNotesDir: salta cartelle che non sono un clone', () => {
  const d = tmpdir();
  assert.equal(syncNotesDir(d).status, 'skip');
  assert.equal(syncNotesDir(path.join(d, 'non-esiste')).status, 'skip');
});

test('syncNotesDir: con *.md merge=union nel .gitattributes tiene entrambe le righe', () => {
  const r = makeRemote({ 'CODA.md': '# Coda\n', '.gitattributes': '*.md merge=union\n' });
  const pc = clone(r.origin, path.join(r.root, 'pc'));
  const server = clone(r.origin, path.join(r.root, 'server'));
  write(path.join(pc, 'CODA.md'), '# Coda\n- dal pc\n');
  write(path.join(server, 'CODA.md'), '# Coda\n- dal server\n');
  assert.equal(syncNotesDir(server).status, 'ok');
  const res = syncNotesDir(pc);
  assert.equal(res.status, 'ok', res.msg);
  assert.match(read(pc, 'CODA.md'), /- dal server\n[\s\S]*- dal pc|- dal pc\n[\s\S]*- dal server/);
});
