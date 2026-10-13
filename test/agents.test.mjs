import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServers, claudeAddArgs, mergeCursor, mergeHermes, mergeOpenCode, mergeVsCode } from '../scripts/lib/agents.mjs';

const remote = buildServers({ mode: 'remote', apiUrl: 'http://srv:8311', token: 'tok' });
const local = buildServers({ mode: 'local', apiUrl: 'http://srv:8311', token: 'tok', wikiSearch: ['/n/node', '/q/qmd', 'mcp'] });

test('buildServers: client sul server centrale con token, locale senza', () => {
  assert.deepEqual(remote.agentmemory.env, { AGENTMEMORY_URL: 'http://srv:8311', AGENTMEMORY_SECRET: 'tok' });
  assert.deepEqual(local.agentmemory.env, { AGENTMEMORY_URL: 'http://127.0.0.1:3111' });
  assert.deepEqual(local['wiki-search'].command, ['/n/node', '/q/qmd', 'mcp']);
  assert.deepEqual(buildServers({ mode: 'local', win: true }).agentmemory.command, ['cmd', '/c', 'npx', '-y', '@agentmemory/mcp']);
  const w = buildServers({ mode: 'remote', apiUrl: 'u', token: 't', llmWiki: { bin: '/r/index.js', url: 'http://srv:8318' } });
  assert.deepEqual(w['llm-wiki'].env, { LLM_WIKI_API_BASE_URL: 'http://srv:8318', LLM_WIKI_API_TOKEN: 't' });
});

test('mergeOpenCode: tiene le chiavi dell\'utente e i suoi altri MCP', () => {
  const cfg = { model: 'x', mcp: { suo: { type: 'remote', url: 'u' }, agentmemory: { type: 'local', command: ['vecchio'] } } };
  const out = mergeOpenCode(cfg, remote);
  assert.equal(out.model, 'x');
  assert.deepEqual(out.mcp.suo, { type: 'remote', url: 'u' });
  assert.deepEqual(out.mcp.agentmemory, { type: 'local', command: ['npx', '-y', '@agentmemory/mcp'],
    environment: { AGENTMEMORY_URL: 'http://srv:8311', AGENTMEMORY_SECRET: 'tok' }, enabled: true, timeout: 30000 });
  assert.equal(out.mcp['wiki-search'], undefined);
  assert.equal(mergeOpenCode({}, local).mcp['wiki-search'].environment, undefined);
});

test('mergeCursor e mergeVsCode', () => {
  const c = mergeCursor({ mcpServers: { altro: {} } }, remote);
  assert.deepEqual(c.mcpServers.agentmemory, { command: 'npx', args: ['-y', '@agentmemory/mcp'], env: remote.agentmemory.env });
  assert.ok(c.mcpServers.altro);
  const v = mergeVsCode({}, local);
  assert.deepEqual(v.servers['wiki-search'], { type: 'stdio', command: '/n/node', args: ['/q/qmd', 'mcp'] });
});

test('mergeHermes: sostituisce solo i nostri blocchi', () => {
  const yaml = 'model: x\nmcp_servers:\n  suo:\n    command: "a"\n  agentmemory:\n    command: "vecchio"\n    enabled: false\n\nterminal:\n  shell: bash\n';
  const out = mergeHermes(yaml, remote);
  assert.match(out, /^model: x\nmcp_servers:\n  suo:\n    command: "a"\n  agentmemory:\n    command: "npx"\n/);
  assert.match(out, /      AGENTMEMORY_SECRET: "tok"\n    enabled: true\n\nterminal:\n  shell: bash\n$/);
  assert.doesNotMatch(out, /vecchio/);
  assert.equal(mergeHermes(out, remote), out, 'idempotente');
  assert.match(mergeHermes('', remote), /^mcp_servers:\n  agentmemory:/);
});

test('claudeAddArgs: nome prima delle opzioni, virgolette su Windows', () => {
  assert.deepEqual(claudeAddArgs('agentmemory', remote.agentmemory).slice(0, 5), ['mcp', 'add', 'agentmemory', '--scope', 'user']);
  const w = claudeAddArgs('x', { command: ['C:\\Program Files\\node.exe'], env: {} }, true);
  assert.equal(w.at(-1), '"C:\\Program Files\\node.exe"');
});
