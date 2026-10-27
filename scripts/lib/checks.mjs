// checks.mjs - `kb test`: per ogni programma installato controlla, in ordine,
//   1 config    le voci della KB ci sono e sono quelle attese
//   2 avvio     il server MCP parte con quel comando e offre gli strumenti
//   3 memoria   salva e ritrova la memoria di prova "kb-test <macchina> <giorno>"
//   4 macchine  vede le memorie di prova delle altre macchine (giallo se nessuna)
//   5 agente    (--deep, solo CLI) l'agente stesso trova kb-test con un prompt vero
// I livelli 2-4 si provano una volta per comando MCP diverso: di solito uno solo.
import { applyAdapter } from './adapters.mjs';
import { connect } from './mcp-client.mjs';

export const OK = 'ok', WARN = 'warn', FAIL = 'fail', SKIP = '-';
const REQUIRED = ['memory_save', 'memory_smart_search'];

// Prova di un server MCP (livelli 2-4). host: nome di questa macchina.
export async function probeServer(server, { host, day, connectFn = connect, quick = false }) {
  const res = { start: SKIP, memory: SKIP, machines: SKIP, note: '', others: [] };
  const c = connectFn(server.command, server.env, { shell: false });
  try {
    await c.initialize();
    const names = (await c.tools()).map((t) => t.name);
    const missing = REQUIRED.filter((n) => !names.includes(n));
    if (missing.length) { res.start = FAIL; res.note = `mancano gli strumenti ${missing.join(', ')}`; return res; }
    res.start = OK;
    if (quick) return res;
    const marker = `kb-test ${host} ${day}`;
    const search = async () => {
      const text = await c.call('memory_smart_search', { query: 'kb-test', limit: 50 });
      return [...text.matchAll(/kb-test (\S+) (\d{4}-\d{2}-\d{2})/g)].map((m) => ({ host: m[1], day: m[2] }));
    };
    let seen = await search();
    // una sola memoria di prova per macchina al giorno
    if (!seen.some((m) => m.host === host && m.day === day)) {
      await c.call('memory_save', { content: marker, type: 'fact', concepts: 'kb-test' });
      seen = await search();
    }
    if (!seen.some((m) => m.host === host && m.day === day)) { res.memory = FAIL; res.note = 'memoria salvata ma la ricerca non la trova'; return res; }
    res.memory = OK;
    const weekAgo = new Date(Date.parse(day) - 7 * 864e5).toISOString().slice(0, 10);
    res.others = [...new Set(seen.filter((m) => m.host !== host && m.day >= weekAgo).map((m) => m.host))];
    res.machines = res.others.length ? OK : WARN;
    if (!res.others.length) res.note = 'nessuna altra macchina negli ultimi 7 giorni (normale alla prima installazione)';
  } catch (e) {
    if (res.start === SKIP) res.start = FAIL;
    else if (res.memory === SKIP) res.memory = FAIL;
    res.note = hint(e.message);
  } finally {
    c.close();
  }
  return res;
}

function hint(msg) {
  if (/401|unauthori/i.test(msg)) return `KB-401: ${msg} -> KB_TOKEN nel .env del clone`;
  if (/ECONNREFUSED|fetch failed/i.test(msg)) return `${msg} -> agentmemory non risponde: rilancia node scripts/kb.mjs install`;
  if (/ENOENT/.test(msg)) return `${msg} -> comando non trovato (npx/node nel PATH?)`;
  return msg;
}

// Tutti i controlli. adapters: quelli selezionati; servers: le voci attese (dal ruolo);
// opts.down: motivo per cui agentmemory non risponde (salta i livelli 2-5)
export async function runChecks(ctx, adapters, servers, opts) {
  const am = servers.agentmemory;
  const probes = new Map(); // un probe per comando
  const rows = [];
  for (const a of adapters) {
    const row = { id: a.id, label: a.label, config: OK, start: SKIP, memory: SKIP, machines: SKIP, agent: SKIP, note: '' };
    const res = applyAdapter(ctx, a, servers, { dryRun: true });
    const bad = res.find((r) => r.error || r.changed);
    if (bad) {
      row.config = FAIL;
      row.note = bad.error ? `${bad.file}: ${bad.error}` : `${bad.file}: voci della KB mancanti o vecchie -> node scripts/kb.mjs install`;
      rows.push(row);
      continue;
    }
    if (opts.down) { Object.assign(row, { start: FAIL, note: opts.down }); rows.push(row); continue; }
    const key = JSON.stringify(am);
    if (!probes.has(key)) probes.set(key, probeServer(am, opts));
    const p = await probes.get(key);
    Object.assign(row, { start: p.start, memory: p.memory, machines: p.machines, note: p.note, others: p.others });
    if (opts.deep && a.headless && p.memory === OK) {
      // su Windows le CLI sono .cmd lanciate via shell: gli argomenti con spazi vanno tra virgolette
      const args = a.headless.slice(1).map((x) => (ctx.platform === 'win32' && /\s/.test(x) ? `"${x}"` : x));
      const r = ctx.run(a.headless[0], args, { timeout: 180000 });
      row.agent = r.status === 0 && /kb-test/.test(r.out) ? OK : FAIL;
      if (row.agent === FAIL) row.note = `prova con l'agente: ${(r.out || '').split('\n').filter(Boolean).pop() || `uscito con ${r.status}`}`;
    }
    rows.push(row);
  }
  return rows;
}

const MARK = { [OK]: '✓', [WARN]: '!', [FAIL]: '✗', [SKIP]: '-' };

export function formatTable(rows, { deep = false } = {}) {
  const cols = ['config', 'start', 'memory', 'machines', ...(deep ? ['agent'] : [])];
  const head = { config: 'config', start: 'avvio', memory: 'memoria', machines: 'macchine', agent: 'agente' };
  const w = Math.max(9, ...rows.map((r) => r.label.length)) + 2;
  const out = [`${'programma'.padEnd(w)}${cols.map((c) => head[c].padEnd(10)).join('')}`];
  for (const r of rows) {
    out.push(`${r.label.padEnd(w)}${cols.map((c) => MARK[r[c]].padEnd(10)).join('')}${r.note ? ` ${r.note}` : ''}`);
  }
  return out.join('\n');
}

export const allGreen = (rows) => rows.every((r) => ![r.config, r.start, r.memory, r.agent].includes(FAIL));
