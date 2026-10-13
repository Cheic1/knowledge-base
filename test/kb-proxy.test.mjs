// kb-proxy.js: token e arresto senza troncare le richieste in corso
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { once } from 'node:events';
import { REPO } from './helpers.mjs';

const freePort = async () => {
  const s = net.createServer().listen(0, '127.0.0.1');
  await once(s, 'listening');
  const { port } = s.address();
  s.close();
  return port;
};

async function startBackend(delayMs) {
  const srv = http.createServer((req, res) => {
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(`ok ${req.url}`); }, delayMs);
  }).listen(0, '127.0.0.1');
  await once(srv, 'listening');
  return srv;
}

async function startProxy(ext, int, extraEnv = {}) {
  const p = spawn(process.execPath, [path.join(REPO, 'scripts', 'kb-proxy.js')], {
    env: { ...process.env, KB_TOKEN: 'tok-test', KB_PROXY_MAP: `${ext}:${int}`, KB_PROXY_GRACE_MS: '5000', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 50 && !out.includes('started'); i++) await new Promise((r) => setTimeout(r, 100));
  for (let i = 0; i < 50; i++) {
    try { await get(ext, '/', {}); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  return { p, log: () => out };
}

function get(port, p, headers = { Authorization: 'Bearer tok-test' }) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers, agent: false }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('kb-proxy: 401 senza token, inoltra con il token', async () => {
  const be = await startBackend(0);
  const ext = await freePort();
  const { p } = await startProxy(ext, be.address().port);
  try {
    assert.equal((await get(ext, '/x', {})).status, 401);
    const r = await get(ext, '/agentmemory/health');
    assert.deepEqual(r, { status: 200, body: 'ok /agentmemory/health' });
  } finally { p.kill('SIGKILL'); be.close(); }
});

test('kb-proxy: SIGTERM lascia finire la richiesta in corso, poi esce con 0 e non accetta altro', async () => {
  const be = await startBackend(1500);
  const ext = await freePort();
  const { p, log } = await startProxy(ext, be.address().port);
  try {
    const inflight = get(ext, '/lenta');
    await new Promise((r) => setTimeout(r, 300));
    p.kill('SIGTERM');
    const exited = once(p, 'exit');
    const r = await inflight;
    assert.deepEqual(r, { status: 200, body: 'ok /lenta' }, 'risposta completa nonostante il SIGTERM');
    const [code] = await exited;
    assert.equal(code, 0, log());
    assert.match(log(), /arresto pulito/);
    await assert.rejects(get(ext, '/dopo'), /ECONNREFUSED/);
  } finally { p.kill('SIGKILL'); be.close(); }
});
