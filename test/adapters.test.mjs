import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ADAPTERS, applyAdapter, clonesInConfigs, restoreAdapter, selectAdapters } from '../scripts/lib/adapters.mjs';
import { buildServers, mergeCodex } from '../scripts/lib/agents.mjs';
import { tmpdir, write } from './helpers.mjs';

const servers = buildServers({ mode: 'local', win: true });
const none = { agentmemory: null };
const byId = (id) => ADAPTERS.find((a) => a.id === id);

// HOME finta su "Windows" con i programmi trovati nell'inventario del PC personale
function winHome(cmds = []) {
  const home = tmpdir('kb-home-');
  const env = { APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local') };
  const calls = [];
  const ctx = { home, platform: 'win32', env, has: (c) => cmds.includes(c), run: (c, a) => { calls.push([c, ...a]); return { status: 0, out: '' }; } };
  return { home, env, ctx, calls };
}

test('selectAdapters: solo i programmi installati; config orfana solo con --all', () => {
  const { home, env, ctx } = winHome(['gemini', 'claude']);
  write(path.join(home, '.cursor', 'mcp.json'), '{}'); // Cursor disinstallato, config rimasta
  write(path.join(env.APPDATA, 'Code', 'User', 'mcp.json'), '{"servers":{}}');
  write(path.join(env.APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), '{"mcpServers":{}}');
  write(path.join(env.APPDATA, 'Claude', 'claude_desktop_config.json'), '{"mcpServers":{}}');
  write(path.join(home, '.gemini', 'antigravity-ide', 'mcp_config.json'), '{"mcpServers":{"matlab":{"command":"m"}}}');
  const ids = selectAdapters(ctx).map((a) => a.id);
  assert.deepEqual(ids, ['claude-code', 'gemini-cli', 'vscode', 'cline', 'claude-desktop', 'antigravity']);
  assert.ok(selectAdapters(ctx, { all: true }).some((a) => a.id === 'cursor'));
  assert.deepEqual(selectAdapters(ctx, { only: ['cursor'] }).map((a) => a.id), ['cursor']);
});

test('json: aggiunge solo agentmemory, tiene gli altri server, backup, idempotente, dry-run', () => {
  const { home, ctx } = winHome(['gemini']);
  const file = path.join(home, '.gemini', 'settings.json');
  write(file, JSON.stringify({ theme: 'x', mcpServers: { matlab: { command: 'm.exe' } } }));
  const a = byId('gemini-cli');
  assert.deepEqual(applyAdapter(ctx, a, servers, { dryRun: true }), [{ file, changed: true }]);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.agentmemory, undefined, 'dry-run non scrive');
  assert.deepEqual(applyAdapter(ctx, a, servers), [{ file, changed: true }]);
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(cfg.theme, 'x');
  assert.deepEqual(cfg.mcpServers.matlab, { command: 'm.exe' });
  assert.deepEqual(cfg.mcpServers.agentmemory, { command: 'cmd', args: ['/c', 'npx', '-y', '@agentmemory/mcp'], env: { AGENTMEMORY_URL: 'http://127.0.0.1:3111' } });
  assert.ok(fs.existsSync(`${file}.bak-kb`));
  assert.deepEqual(applyAdapter(ctx, a, servers), [{ file, changed: false }], 'idempotente');
  applyAdapter(ctx, a, none);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers, { matlab: { command: 'm.exe' } }, 'uninstall toglie solo la nostra voce');
});

test('json non valido: non si tocca e si segnala', () => {
  const { env, ctx } = winHome();
  const file = path.join(env.APPDATA, 'Claude', 'claude_desktop_config.json');
  write(file, '{ rotto');
  const [r] = applyAdapter(ctx, byId('claude-desktop'), servers);
  assert.match(r.error, /KB-JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ rotto');
});

test('cline: tutti i file trovati, con disabled false', () => {
  const { home, env, ctx } = winHome();
  const f1 = path.join(env.APPDATA, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  const f2 = path.join(home, '.cline', 'data', 'settings', 'cline_mcp_settings.json');
  write(f1, '{"mcpServers":{}}');
  write(f2, '');
  const res = applyAdapter(ctx, byId('cline'), servers);
  assert.equal(res.length, 2);
  for (const f of [f1, f2]) assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).mcpServers.agentmemory.disabled, false);
});

test('claude desktop dello Store: scrive anche nella cartella Packages', () => {
  const { env, ctx } = winHome();
  fs.mkdirSync(path.join(env.LOCALAPPDATA, 'Packages', 'Claude_abc123', 'LocalCache', 'Roaming', 'Claude'), { recursive: true });
  const res = applyAdapter(ctx, byId('claude-desktop'), servers);
  assert.equal(res.length, 1);
  assert.match(res[0].file, /Packages[\\/]Claude_abc123/);
});

test('claude code: claude mcp add solo se la voce in ~/.claude.json e\' diversa', () => {
  const { home, ctx, calls } = winHome(['claude']);
  const a = byId('claude-code');
  assert.deepEqual(applyAdapter(ctx, a, servers, { dryRun: true }), [{ file: path.join(home, '.claude.json'), changed: true }]);
  assert.equal(calls.length, 0);
  applyAdapter(ctx, a, servers);
  assert.deepEqual(calls.map((c) => c.slice(0, 3)), [['claude', 'mcp', 'remove'], ['claude', 'mcp', 'add']]);
  write(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { agentmemory: {
    type: 'stdio', command: 'cmd', args: ['/c', 'npx', '-y', '@agentmemory/mcp'], env: { AGENTMEMORY_URL: 'http://127.0.0.1:3111' } } } }));
  calls.length = 0;
  assert.equal(applyAdapter(ctx, a, servers)[0].changed, false);
  assert.equal(calls.length, 0);
});

test('codex: tabelle toml nostre sostituite, il resto intatto', () => {
  const toml = 'model = "o4"\n\n[mcp_servers.altro]\ncommand = "x"\n\n[mcp_servers.agentmemory]\ncommand = "vecchio"\n\n[mcp_servers.agentmemory.env]\nA = "1"\n\n[profiles.p]\nmodel = "y"\n';
  const local = buildServers({ mode: 'local' });
  const out = mergeCodex(toml, local);
  assert.match(out, /\[mcp_servers\.altro\]\ncommand = "x"/);
  assert.match(out, /\[mcp_servers\.agentmemory\]\ncommand = "npx"\nargs = \["-y", "@agentmemory\/mcp"\]\n\n\[mcp_servers\.agentmemory\.env\]\nAGENTMEMORY_URL = "http:\/\/127\.0\.0\.1:3111"\n/);
  assert.doesNotMatch(out, /vecchio|A = "1"/);
  assert.match(out, /\[profiles\.p\]\nmodel = "y"\n$/);
  assert.equal(mergeCodex(out, local), out, 'idempotente');
  assert.doesNotMatch(mergeCodex(out, none), /agentmemory/);
  assert.match(mergeCodex('', local), /^\[mcp_servers\.agentmemory\]/);
});

test('restoreAdapter rimette il backup', () => {
  const { home, ctx } = winHome(['gemini']);
  const file = path.join(home, '.gemini', 'settings.json');
  write(file, '{"a":1}');
  applyAdapter(ctx, byId('gemini-cli'), servers);
  assert.deepEqual(restoreAdapter(ctx, byId('gemini-cli')), [file]);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}');
});

test('clonesInConfigs: trova un altro clone citato nelle config', () => {
  const { home, ctx } = winHome(['opencode']);
  const other = path.join(home, 'vecchio', 'knowledge-base');
  fs.mkdirSync(path.join(other, '.git'), { recursive: true });
  write(path.join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ mcp: { 'llm-wiki': { command: ['node', path.join(other, 'mcp', 'index.js')] } } }));
  assert.deepEqual(clonesInConfigs(ctx, path.join(home, 'knowledge-base')), [other]);
  assert.deepEqual(clonesInConfigs(ctx, other), []);
});
