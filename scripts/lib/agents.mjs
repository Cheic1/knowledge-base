// agents.mjs - Configurazione MCP degli agenti, in puro Node (sostituisce la parte
// Python di connect-agent.sh). Solo funzioni pure: leggono e restituiscono
// oggetti/testo, la scrittura dei file la fa kb.mjs.
//
// Un server MCP e' { command: [eseguibile, ...argomenti], env: { CHIAVE: valore } }.

export const LOCAL_AM_URL = 'http://127.0.0.1:3111';

// Server MCP da cablare.
//   mode 'local'  -> agentmemory di questa macchina (server, standalone-dev)
//   mode 'remote' -> agentmemory del server centrale via kb-proxy, con token (client)
export function buildServers({ mode, apiUrl, token, win = false, wikiSearch = null, llmWiki = null }) {
  const npx = (...a) => (win ? ['cmd', '/c', 'npx', ...a] : ['npx', ...a]);
  const amEnv = mode === 'remote'
    ? { AGENTMEMORY_URL: apiUrl, ...(token ? { AGENTMEMORY_SECRET: token } : {}) }
    : { AGENTMEMORY_URL: LOCAL_AM_URL };
  const servers = { agentmemory: { command: npx('-y', '@agentmemory/mcp'), env: amEnv } };
  if (wikiSearch?.length) servers['wiki-search'] = { command: wikiSearch, env: {} };
  if (llmWiki?.bin && llmWiki?.url) {
    servers['llm-wiki'] = {
      command: [llmWiki.node || 'node', llmWiki.bin],
      env: { LLM_WIKI_API_BASE_URL: llmWiki.url, ...(token ? { LLM_WIKI_API_TOKEN: token } : {}) },
    };
  }
  return servers;
}

const withEnv = (env) => (Object.keys(env).length ? env : undefined);

// ~/.config/opencode/opencode.json: chiave "mcp", campo "environment"
export function mergeOpenCode(cfg, servers) {
  const out = { ...cfg, mcp: { ...(cfg.mcp || {}) } };
  for (const [name, s] of Object.entries(servers)) {
    out.mcp[name] = { type: 'local', command: s.command, ...(withEnv(s.env) ? { environment: s.env } : {}), enabled: true, timeout: 30000 };
  }
  return out;
}

// ~/.cursor/mcp.json: "mcpServers" con command/args/env
export function mergeCursor(cfg, servers) {
  const out = { ...cfg, mcpServers: { ...(cfg.mcpServers || {}) } };
  for (const [name, s] of Object.entries(servers)) {
    out.mcpServers[name] = { command: s.command[0], args: s.command.slice(1), ...(withEnv(s.env) ? { env: s.env } : {}) };
  }
  return out;
}

// mcp.json di VS Code: "servers" con type stdio
export function mergeVsCode(cfg, servers) {
  const out = { ...cfg, servers: { ...(cfg.servers || {}) } };
  for (const [name, s] of Object.entries(servers)) {
    out.servers[name] = { type: 'stdio', command: s.command[0], args: s.command.slice(1), ...(withEnv(s.env) ? { env: s.env } : {}) };
  }
  return out;
}

// ~/.hermes/config.yaml: si riscrivono solo i nostri blocchi sotto mcp_servers, il resto resta com'e'
export function mergeHermes(text, servers) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\n*$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') lines.pop();
  let top = lines.findIndex((l) => /^mcp_servers:\s*$/.test(l));
  if (top < 0) { if (lines.length) lines.push(''); lines.push('mcp_servers:'); top = lines.length - 1; }
  const yq = (v) => JSON.stringify(String(v));
  for (const [name, s] of Object.entries(servers)) {
    const env = Object.entries(s.env);
    const block = [`  ${name}:`, `    command: ${yq(s.command[0])}`, '    args:',
      ...s.command.slice(1).map((a) => `      - ${yq(a)}`),
      ...(env.length ? ['    env:', ...env.map(([k, v]) => `      ${k}: ${yq(v)}`)] : []),
      '    enabled: true'];
    // fine della sezione mcp_servers: prima riga non vuota e non indentata
    let end = top + 1;
    while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
    const at = lines.findIndex((l, i) => i > top && i < end && new RegExp(`^  ${name}:\\s*$`).test(l));
    if (at < 0) { lines.splice(top + 1, 0, ...block); continue; }
    let stop = at + 1;
    while (stop < end && !/^  \S/.test(lines[stop])) stop++;
    while (stop - 1 > at && lines[stop - 1].trim() === '') stop--; // le righe vuote restano
    lines.splice(at, stop - at, ...block);
  }
  return lines.join('\n') + '\n';
}

// Argomenti di `claude mcp add` (scope utente). Il nome va prima delle opzioni:
// -e accetta piu' valori e si mangerebbe il nome.
export function claudeAddArgs(name, s, win = false) {
  const envArgs = Object.entries(s.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const args = ['mcp', 'add', name, '--scope', 'user', ...envArgs, '--', ...s.command];
  return win ? args.map((a) => (/[\s&|<>^]/.test(a) ? `"${a}"` : a)) : args;
}
