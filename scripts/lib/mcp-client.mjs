// mcp-client.mjs - Client MCP minimo su stdio (JSON-RPC, un messaggio per riga).
// Serve a `kb test`: avvia un server MCP con lo stesso comando scritto nella config
// di un agente e lo interroga come farebbe l'agente.
import { spawn } from 'node:child_process';

// command: [eseguibile, ...argomenti]; env: variabili in piu'
export function connect(command, env = {}, { timeoutMs = 90000, shell = false } = {}) {
  const child = spawn(command[0], command.slice(1), {
    env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell,
  });
  const pending = new Map();
  let nextId = 1;
  let buf = '';
  let stderr = '';
  let exited = null;

  const failAll = (err) => { for (const { reject } of pending.values()) reject(err); pending.clear(); };
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; } // righe di log su stdout: si ignorano
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  });
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  child.on('error', (e) => { exited = e; failAll(e); });
  child.on('exit', (code) => {
    exited = new Error(`il server MCP e' uscito (codice ${code}): ${stderr.trim().split('\n').pop() || 'nessun messaggio'}`);
    failAll(exited);
  });

  function request(method, params = {}) {
    if (exited) return Promise.reject(exited);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`nessuna risposta a ${method} in ${timeoutMs / 1000}s`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  return {
    async initialize() {
      const r = await request('initialize', {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'kb-test', version: '1' },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      return r;
    },
    async tools() { return (await request('tools/list')).tools || []; },
    // Testo della risposta di uno strumento
    async call(name, args) {
      const r = await request('tools/call', { name, arguments: args });
      const text = (r.content || []).map((c) => c.text || '').join('\n');
      if (r.isError) throw new Error(text || `${name} ha risposto con un errore`);
      return text;
    },
    close() { failAll(new Error('chiuso')); try { child.kill(); } catch { /* gia' uscito */ } },
  };
}
