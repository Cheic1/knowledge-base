// memory-sync.mjs end-to-end con un agentmemory finto: i dati vanno su kb-data, main resta pulito
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { once } from 'node:events';
import { clone, git, isolatedEnv, makeRemote, repoFiles, tmpdir, write } from './helpers.mjs';

async function fakeAgentmemory(memories) {
  const imports = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && req.url === '/agentmemory/export') {
        res.end(JSON.stringify({ version: '0.9.29', sessions: [], memories, summaries: [], observations: {} }));
      } else if (req.method === 'POST' && req.url === '/agentmemory/import') {
        const data = JSON.parse(body).exportData;
        imports.push(data);
        for (const m of data.memories || []) if (!memories.some((x) => x.id === m.id)) memories.push(m);
        res.end(JSON.stringify({ success: true }));
      } else { res.statusCode = 404; res.end('{}'); }
    });
  }).listen(0, '127.0.0.1');
  await once(srv, 'listening');
  return { srv, imports, memories, url: `http://127.0.0.1:${srv.address().port}` };
}

function sync(dir, home, am, node) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(dir, 'scripts', 'memory-sync.mjs')], {
      cwd: dir, env: isolatedEnv(home, { KB_MEMORY_URL: am.url, KB_SYNC_NODE: node }),
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => resolve({ code, out }));
  });
}

test('memory-sync: migra i vecchi file di main su kb-data e scambia le memorie tra due PC', async () => {
  // main com'era prima: memories/sync/vecchio-pc.json tracciato, poi tolto da questa PR
  const files = repoFiles();
  files['memories/sync/vecchio-pc.json'] = JSON.stringify({ version: '0.9.29', sessions: [], summaries: [],
    memories: [{ id: 'mv', content: 'dal vecchio pc', updatedAt: '2026-01-01T00:00:00Z' }], observations: {} });
  const r = makeRemote(files);
  git(r.seed, 'rm', '-q', 'memories/sync/vecchio-pc.json');
  git(r.seed, 'commit', '-q', '-m', 'dati fuori da main');
  git(r.seed, 'push', '-q', 'origin', 'main');
  const mainHead = git(r.seed, 'rev-parse', 'HEAD');

  const homeA = tmpdir('kb-home-'), homeB = tmpdir('kb-home-');
  const a = clone(r.origin, path.join(r.root, 'a'));
  const b = clone(r.origin, path.join(r.root, 'b'));
  const amA = await fakeAgentmemory([{ id: 'ma', content: 'da A', updatedAt: '2026-02-01T00:00:00Z' }]);
  const amB = await fakeAgentmemory([{ id: 'mb', content: 'da B', updatedAt: '2026-03-01T00:00:00Z' }]);
  try {
    let s = await sync(a, homeA, amA, 'pc-a');
    assert.equal(s.code, 0, s.out);
    assert.match(s.out, /branch orfano kb-data con 1 file/);
    assert.ok(amA.imports.some((d) => d.memories?.some((m) => m.id === 'mv')), 'A importa le memorie migrate');
    s = await sync(b, homeB, amB, 'pc-b');
    assert.equal(s.code, 0, s.out);
    assert.deepEqual(amB.memories.map((m) => m.id).sort(), ['ma', 'mb', 'mv']);
    s = await sync(a, homeA, amA, 'pc-a');
    assert.equal(s.code, 0, s.out);
    assert.ok(amA.memories.some((m) => m.id === 'mb'), 'A riceve la memoria di B');
    // main non e' stato toccato: niente commit di dati, clone pulito
    assert.equal(git(r.origin, 'rev-parse', 'main'), mainHead);
    assert.equal(git(a, 'status', '--porcelain'), '');
    assert.deepEqual(fs.readdirSync(path.join(a, '.kb-data', 'memories', 'sync')).sort(), ['.gitkeep', 'pc-a.json', 'pc-b.json', 'vecchio-pc.json']);
    // orfano + export di A + export di B + export di A con la memoria di B
    assert.equal(git(r.origin, 'rev-list', '--count', 'kb-data'), '4');
  } finally { amA.srv.close(); amB.srv.close(); }
});
