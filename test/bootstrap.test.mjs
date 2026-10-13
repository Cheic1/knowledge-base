// bootstrap.mjs lanciato da una cartella temporanea: deve ritrovare il clone installato
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { clone, isolatedEnv, makeRemote, repoFiles, tmpdir, write, REPO } from './helpers.mjs';

test('bootstrap da %TEMP%: usa il clone di kb-install.json, non ne crea un secondo in ~/knowledge-base', () => {
  const r = makeRemote(repoFiles());
  const home = tmpdir('kb-home-');
  const installed = clone(r.origin, path.join(r.root, 'E-knowledge-base')); // es. E:\knowledge-base
  write(path.join(home, '.agentmemory', 'kb-install.json'), JSON.stringify({ role: 'standalone-dev', repo: installed }));
  const temp = tmpdir('kb-temp-');
  const script = path.join(temp, 'kb-bootstrap.mjs');
  fs.copyFileSync(path.join(REPO, 'scripts', 'bootstrap.mjs'), script);
  const out = spawnSync(process.execPath, [script, '--no-install'], { cwd: temp, env: isolatedEnv(home), encoding: 'utf8' });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, new RegExp(`clone: ${installed.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`));
  assert.ok(!fs.existsSync(path.join(home, 'knowledge-base')), 'nessun secondo clone');
});

test('bootstrap: KB_REPO_DIR vince, e un repo estraneo nella cartella corrente viene ignorato', () => {
  const r = makeRemote(repoFiles());
  const home = tmpdir('kb-home-');
  const mine = clone(r.origin, path.join(r.root, 'mio'));
  const other = makeRemote({ 'x.txt': 'altro progetto\n' }).seed;
  const out = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'bootstrap.mjs'), '--no-install'], {
    cwd: other, env: isolatedEnv(home, { KB_REPO_DIR: mine }), encoding: 'utf8',
  });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /clone: .*mio/);
});
