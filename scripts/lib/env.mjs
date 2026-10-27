// env.mjs - Lettura di config/endpoint.env e <repo>/.env in puro Node (niente bash).
//
// Precedenza per ogni valore: variabile d'ambiente > config/endpoint.env > default.
// Il token del proxy (KB_TOKEN) viene da env o da <repo>/.env, mai da endpoint.env
// (che e' in git).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// KEY=valore, con commenti, righe vuote, "export ", virgolette e CRLF
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    const q = v.match(/^(['"])(.*)\1$/);
    if (q) v = q[2];
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

export function readEnvFile(file) {
  try { return parseEnv(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

export const DEFAULTS = {
  KB_API_URL: 'http://192.168.68.55:8311',
  KB_VIEWER_URL: 'http://192.168.68.55:8313',
  KB_WIKI_URL: 'http://192.168.68.55:8318',
};

// Configurazione della KB vista da questa macchina
export function loadKbConfig(repo, env = process.env) {
  const endpoint = readEnvFile(path.join(repo, 'config', 'endpoint.env'));
  const dotenv = readEnvFile(path.join(repo, '.env'));
  const pick = (k) => (env[k] || endpoint[k] || DEFAULTS[k] || '').replace(/\/+$/, '');
  return {
    apiUrl: pick('KB_API_URL'),
    viewerUrl: pick('KB_VIEWER_URL'),
    wikiUrl: pick('KB_WIKI_URL'),
    token: (env.KB_TOKEN || dotenv.KB_TOKEN || '').trim(),
  };
}

// Imposta KEY=valore in un file .env lasciando intatte le altre righe; permessi 600
export function setEnvVar(file, key, value, comment = '') {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'm');
  let next;
  if (re.test(text)) next = text.replace(re, `${key}=${value}`);
  else next = `${text}${text && !text.endsWith('\n') ? '\n' : ''}${comment ? `\n# ${comment}\n` : ''}${key}=${value}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
}

export const newToken = () => crypto.randomBytes(32).toString('hex');
export const validToken = (t) => /^[A-Za-z0-9._~+=-]+$/.test(t);
