import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ADAPTERS, applyAdapter } from '../scripts/lib/adapters.mjs';
import { buildServers } from '../scripts/lib/agents.mjs';
import { allGreen, FAIL, formatTable, OK, probeServer, runChecks, WARN } from '../scripts/lib/checks.mjs';
import { tmpdir, write } from './helpers.mjs';

// Finto agentmemory MCP: tiene le memorie in un array
function fakeServer(memories = [], { tools = ['memory_save', 'memory_smart_search'] } = {}) {
  let starts = 0;
  const connectFn = () => {
    starts++;
    return {
      initialize: async () => ({}),
      tools: async () => tools.map((name) => ({ name })),
      call: async (name, args) => {
        if (name === 'memory_save') { memories.push(args.content); return '{"success":true}'; }
        return JSON.stringify({ results: memories.filter((m) => m.includes(args.query)).map((title) => ({ title })) });
      },
      close() {},
    };
  };
  return { connectFn, memories, starts: () => starts };
}
const am = buildServers({ mode: 'local' }).agentmemory;
const opts = (f) => ({ host: 'pc1', day: '2026-10-27', connectFn: f.connectFn });

test('probeServer: salva una sola memoria al giorno e vede le altre macchine', async () => {
  const f = fakeServer(['kb-test server 2026-10-25', 'kb-test vecchio 2026-09-01']);
  const r = await probeServer(am, opts(f));
  assert.deepEqual([r.start, r.memory, r.machines], [OK, OK, OK]);
  assert.deepEqual(r.others, ['server'], 'quelle piu\' vecchie di 7 giorni non contano');
  await probeServer(am, opts(f));
  assert.equal(f.memories.filter((m) => m === 'kb-test pc1 2026-10-27').length, 1);
});

test('probeServer: prima macchina = giallo; strumenti mancanti = rosso', async () => {
  const r = await probeServer(am, opts(fakeServer()));
  assert.equal(r.machines, WARN);
  const bad = await probeServer(am, opts(fakeServer([], { tools: ['memory_recall'] })));
  assert.equal(bad.start, FAIL);
  assert.match(bad.note, /memory_save/);
});

test('runChecks: config vecchia = rosso senza avvio; un solo avvio per comando', async () => {
  const home = tmpdir('kb-home-');
  const ctx = { home, platform: 'linux', env: {}, has: (c) => ['gemini', 'opencode'].includes(c), run: () => ({ status: 0, out: '' }) };
  const servers = buildServers({ mode: 'local' });
  const pick = ADAPTERS.filter((a) => ['opencode', 'gemini-cli'].includes(a.id));
  write(path.join(home, '.gemini', 'settings.json'), '{}');
  applyAdapter(ctx, pick[0], servers); // solo OpenCode cablato
  const f = fakeServer();
  const rows = await runChecks(ctx, pick, servers, opts(f));
  assert.equal(rows[0].config, OK);
  assert.equal(rows[0].memory, OK);
  assert.equal(rows[1].config, FAIL);
  assert.match(rows[1].note, /kb\.mjs install/);
  assert.equal(allGreen(rows), false);
  applyAdapter(ctx, pick[1], servers);
  const again = await runChecks(ctx, pick, servers, opts(f));
  assert.ok(allGreen(again));
  assert.equal(f.starts(), 2, 'un avvio per giro, non uno per programma');
  assert.match(formatTable(again), /Gemini CLI\s+✓\s+✓\s+✓\s+!/);
  const down = await runChecks(ctx, pick, servers, { ...opts(f), down: 'agentmemory non risponde' });
  assert.equal(down[0].start, FAIL);
});
