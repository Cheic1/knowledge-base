import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadKbConfig, parseEnv, setEnvVar, validToken } from '../scripts/lib/env.mjs';
import { tmpdir, write } from './helpers.mjs';

test('parseEnv: commenti, export, virgolette, CRLF', () => {
  const e = parseEnv('# commento\r\nA=1\r\nexport B="due tre"\nC=\'x#y\'\nD=val # nota\n\nnon valida\n');
  assert.deepEqual(e, { A: '1', B: 'due tre', C: 'x#y', D: 'val' });
});

test('loadKbConfig: env > endpoint.env > default, token solo da env o .env', () => {
  const repo = tmpdir();
  write(path.join(repo, 'config', 'endpoint.env'), 'KB_API_URL=http://10.0.0.5:8311/\nKB_TOKEN=nel-file-in-git\n');
  write(path.join(repo, '.env'), 'KB_TOKEN="segreto-locale"\n');
  let c = loadKbConfig(repo, {});
  assert.equal(c.apiUrl, 'http://10.0.0.5:8311');
  assert.equal(c.wikiUrl, 'http://192.168.68.55:8318');
  assert.equal(c.token, 'segreto-locale');
  c = loadKbConfig(repo, { KB_API_URL: 'http://vm-aziendale:8311', KB_TOKEN: 'da-env' });
  assert.equal(c.apiUrl, 'http://vm-aziendale:8311');
  assert.equal(c.token, 'da-env');
});

test('setEnvVar: sostituisce o aggiunge senza toccare le altre righe, permessi 600', () => {
  const file = path.join(tmpdir(), '.env');
  write(file, 'ALTRO=1\nKB_TOKEN=vecchio\n# fine\n');
  setEnvVar(file, 'KB_TOKEN', 'nuovo');
  assert.equal(fs.readFileSync(file, 'utf8'), 'ALTRO=1\nKB_TOKEN=nuovo\n# fine\n');
  setEnvVar(file, 'KB_UPDATE_HOURS', '6', 'commento');
  assert.match(fs.readFileSync(file, 'utf8'), /# fine\n\n# commento\nKB_UPDATE_HOURS=6\n$/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('validToken', () => {
  assert.ok(validToken('abc.DEF_1~+=-'));
  assert.ok(!validToken('con spazio'));
  assert.ok(!validToken('a;rm'));
});
