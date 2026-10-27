// agents.mjs - Formati delle config MCP degli agenti. Solo funzioni pure: ricevono
// oggetti/testo e restituiscono la versione aggiornata; i file li legge e scrive
// adapters.mjs.
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


// In tutte le merge* un server con valore null viene tolto: la stessa funzione
// serve per cablare e per `uninstall`. Le chiavi che non sono nostre non si toccano.
function mergeKey(cfg, key, servers, entry) {
  const out = { ...cfg, [key]: { ...(cfg[key] || {}) } };
  for (const [name, s] of Object.entries(servers)) {
    if (s) out[key][name] = entry(s);
    else delete out[key][name];
  }
  return out;
}

// ~/.config/opencode/opencode.json: chiave "mcp", campo "environment"
export const mergeOpenCode = (cfg, servers) => mergeKey(cfg, 'mcp', servers, (s) => (
  { type: 'local', command: s.command, ...(withEnv(s.env) ? { environment: s.env } : {}), enabled: true, timeout: 30000 }));

// Formato piu' diffuso ("mcpServers" con command/args/env): Cursor, Gemini CLI, Claude
// Desktop, Antigravity, Windsurf, Cline (che vuole anche disabled: false)
export const mergeMcpServers = (cfg, servers, extra = {}) => mergeKey(cfg, 'mcpServers', servers, (s) => (
  { command: s.command[0], args: s.command.slice(1), ...(withEnv(s.env) ? { env: s.env } : {}), ...extra }));
export const mergeCursor = mergeMcpServers;

// mcp.json di VS Code: "servers" con type stdio
export const mergeVsCode = (cfg, servers) => mergeKey(cfg, 'servers', servers, (s) => (
  { type: 'stdio', command: s.command[0], args: s.command.slice(1), ...(withEnv(s.env) ? { env: s.env } : {}) }));

// Testo diviso in blocchi: ogni blocco nostro si sostituisce (o si toglie) e il resto
// resta identico. isStart(riga, indice) -> nome del blocco che inizia su quella riga, o null.
function replaceBlocks(lines, servers, isStart, isEnd, render, insertAt) {
  for (const [name, s] of Object.entries(servers)) {
    const at = lines.findIndex((l, i) => isStart(l, i) === name);
    const block = s ? render(name, s) : [];
    if (at < 0) {
      if (s) lines.splice(insertAt(lines), 0, ...block);
      continue;
    }
    let stop = at + 1;
    while (stop < lines.length && !isEnd(lines[stop])) stop++;
    while (stop - 1 > at && lines[stop - 1].trim() === '') stop--; // le righe vuote restano
    lines.splice(at, stop - at, ...block);
  }
  return lines;
}
const toLines = (text) => {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\n*$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') lines.pop();
  return lines;
};

// ~/.hermes/config.yaml: blocchi "  <nome>:" sotto mcp_servers
export function mergeHermes(text, servers) {
  const lines = toLines(text);
  let top = lines.findIndex((l) => /^mcp_servers:\s*$/.test(l));
  if (top < 0) {
    if (!Object.values(servers).some(Boolean)) return lines.length ? lines.join('\n') + '\n' : '';
    if (lines.length) lines.push('');
    lines.push('mcp_servers:');
    top = lines.length - 1;
  }
  const yq = (v) => JSON.stringify(String(v));
  const render = (name, s) => {
    const env = Object.entries(s.env);
    return [`  ${name}:`, `    command: ${yq(s.command[0])}`, '    args:',
      ...s.command.slice(1).map((a) => `      - ${yq(a)}`),
      ...(env.length ? ['    env:', ...env.map(([k, v]) => `      ${k}: ${yq(v)}`)] : []),
      '    enabled: true'];
  };
  // fine della sezione mcp_servers: prima riga non vuota e non indentata
  const sectionEnd = () => {
    let end = top + 1;
    while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
    return end;
  };
  const isStart = (l, i) => {
    const m = /^ {2}([^\s:]+):\s*$/.exec(l);
    return m && i > top && i < sectionEnd() ? m[1] : null;
  };
  const isEnd = (l) => /^ {2}\S/.test(l) || /^\S/.test(l);
  return replaceBlocks(lines, servers, isStart, isEnd, render, () => top + 1).join('\n') + '\n';
}

// ~/.codex/config.toml: tabelle [mcp_servers.<nome>] e [mcp_servers.<nome>.env]
export function mergeCodex(text, servers) {
  const lines = toLines(text);
  const tq = (v) => JSON.stringify(String(v));
  const render = (name, s) => {
    const env = Object.entries(s.env);
    return [`[mcp_servers.${name}]`, `command = ${tq(s.command[0])}`,
      `args = [${s.command.slice(1).map(tq).join(', ')}]`,
      ...(env.length ? ['', `[mcp_servers.${name}.env]`, ...env.map(([k, v]) => `${k} = ${tq(v)}`)] : [])];
  };
  // il blocco comprende anche la sua tabella .env: finisce alla prima tabella di un altro server
  const isStart = (l) => /^\[mcp_servers\.([^.\]]+)\]\s*$/.exec(l)?.[1] ?? null;
  for (const [name, s] of Object.entries(servers)) {
    const isEnd = (l) => /^\[/.test(l) && !l.startsWith(`[mcp_servers.${name}.`);
    // in coda, separata da una riga vuota
    replaceBlocks(lines, { [name]: s }, isStart, isEnd, render, (ls) => {
      if (ls.length && ls.at(-1).trim() !== '') ls.push('');
      return ls.length;
    });
  }
  // togliere o aggiungere tabelle non deve accumulare righe vuote
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

// Argomenti di `claude mcp add` (scope utente). Il nome va prima delle opzioni:
// -e accetta piu' valori e si mangerebbe il nome.
export function claudeAddArgs(name, s, win = false) {
  const envArgs = Object.entries(s.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const args = ['mcp', 'add', name, '--scope', 'user', ...envArgs, '--', ...s.command];
  return win ? args.map((a) => (/[\s&|<>^]/.test(a) ? `"${a}"` : a)) : args;
}

// Voce di ~/.claude.json (scope utente) uguale a quella che scriverebbe claudeAddArgs?
export function claudeEntryMatches(entry, s) {
  if (!entry) return false;
  const unq = (a) => String(a).replace(/^"(.*)"$/, '$1');
  const cmd = [entry.command, ...(entry.args || [])].map(unq);
  return JSON.stringify(cmd) === JSON.stringify(s.command) && JSON.stringify(entry.env || {}) === JSON.stringify(s.env);
}
