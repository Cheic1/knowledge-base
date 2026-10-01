#!/usr/bin/env node
// Reverse proxy: espone i servizi (che restano su 127.0.0.1) sulla LAN.
// iii v0.11.2 riscrive host: 127.0.0.1 ad ogni boot, quindi si bypassa
// con questo proxy su porte 83xx. Avviato da scripts/start-kb.sh
// o dalla unit systemd kb-proxy.service.
//
// Autenticazione (token condiviso KB_TOKEN, da env o da <repo>/.env):
//   - client/agenti:  header "Authorization: Bearer <KB_TOKEN>"
//   - browser:        apri una volta http://IP:8313/?token=<KB_TOKEN>
//                     -> cookie HttpOnly kb_token, poi redirect all'URL pulito
//   - KB_AUTH=off     disabilita il controllo (sconsigliato)
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROXY_MAP = [
  { external: 8311, internal: 3111, name: 'REST API agentmemory' },
  { external: 8313, internal: 3113, name: 'Viewer agentmemory' },
  { external: 8315, internal: 3115, name: 'Viewer fallback' },
  { external: 8318, internal: 19828, name: 'LLM Wiki API' },
];

const COOKIE_NAME = 'kb_token';
const EX_CONFIG = 78; // la unit systemd non riavvia su questo exit code

function loadToken() {
  if (process.env.KB_TOKEN) return process.env.KB_TOKEN.trim();
  const envFile = path.join(__dirname, '..', '.env');
  try {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*KB_TOKEN\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  } catch (_) { /* .env assente */ }
  return '';
}

const AUTH_ENABLED = (process.env.KB_AUTH || 'on').toLowerCase() !== 'off';
const TOKEN = loadToken();

if (AUTH_ENABLED && !TOKEN) {
  console.error('KB_TOKEN non impostato: genera il token con scripts/kb-token.sh');
  console.error('  (oppure KB_AUTH=off per disabilitare l\'autenticazione, sconsigliato)');
  process.exit(EX_CONFIG);
}
if (!AUTH_ENABLED) {
  console.warn('ATTENZIONE: KB_AUTH=off, proxy LAN senza autenticazione');
}

const TOKEN_DIGEST = crypto.createHash('sha256').update(TOKEN).digest();

function tokenMatches(candidate) {
  if (!candidate) return false;
  const digest = crypto.createHash('sha256').update(candidate).digest();
  return crypto.timingSafeEqual(digest, TOKEN_DIGEST);
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch (_) { /* cookie malformato: ignorato */ }
  }
  return out;
}

// Rimuove il cookie del proxy prima di inoltrare la richiesta al servizio
function stripProxyCookie(header) {
  if (!header) return header;
  const kept = header.split(';').map((p) => p.trim())
    .filter((p) => p && !p.startsWith(COOKIE_NAME + '='));
  return kept.length ? kept.join('; ') : undefined;
}

// Ritorna { ok, queryToken, cleanPath }
function checkAuth(req) {
  const url = new URL(req.url, 'http://proxy');
  const queryToken = url.searchParams.get('token');
  url.searchParams.delete('token');
  const cleanPath = url.pathname + url.search;
  if (!AUTH_ENABLED) return { ok: true, queryToken: null, cleanPath: req.url };

  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const cookie = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const ok = tokenMatches(bearer) || tokenMatches(cookie) || tokenMatches(queryToken);
  return { ok, queryToken: ok && tokenMatches(queryToken) ? queryToken : null, cleanPath };
}

function forwardHeaders(req, intPort) {
  const headers = { ...req.headers, host: '127.0.0.1:' + intPort };
  const cookie = stripProxyCookie(headers.cookie);
  if (cookie === undefined) delete headers.cookie; else headers.cookie = cookie;
  return headers;
}

function createProxy(extPort, intPort, name) {
  const server = http.createServer((req, res) => {
    const auth = checkAuth(req);
    if (!auth.ok) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="kb"', 'Content-Type': 'text/plain' });
      res.end('Unauthorized: serve il token KB (Authorization: Bearer o ?token=)\n');
      return;
    }
    // Login via browser: ?token= valido -> cookie + redirect all'URL senza token
    if (auth.queryToken && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(302, {
        'Set-Cookie': COOKIE_NAME + '=' + encodeURIComponent(auth.queryToken) +
          '; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000',
        Location: auth.cleanPath,
      });
      res.end();
      return;
    }

    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: intPort,
      path: auth.cleanPath,
      method: req.method,
      headers: forwardHeaders(req, intPort),
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
      res.writeHead(502);
      res.end('Bad Gateway: ' + e.message);
    });
    req.pipe(proxyReq);
  });

  // WebSocket (streams 3112/49134 transitano dalla stessa mappa se esposti)
  server.on('upgrade', (req, socket, head) => {
    if (!checkAuth(req).ok) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Bearer realm="kb"\r\nConnection: close\r\n\r\n');
      return;
    }
    const proxySocket = net.connect(intPort, '127.0.0.1', () => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n\r\n'
      );
      proxySocket.write(req.rawHeaders.join('\r\n') + '\r\n\r\n');
      if (head && head.length) proxySocket.write(head);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });
    proxySocket.on('error', () => socket.destroy());
  });

  server.listen(extPort, '0.0.0.0', () => {
    console.log('Proxy ' + name + ': 0.0.0.0:' + extPort + ' -> 127.0.0.1:' + intPort);
  });

  server.on('error', (e) => {
    console.error('Proxy ' + name + ' error on port ' + extPort + ': ' + e.message);
    if (e.code === 'EADDRINUSE') {
      console.error('  (porta gia in uso: un altro kb-proxy e probabilmente gia in esecuzione)');
    }
  });
}

PROXY_MAP.forEach((p) => createProxy(p.external, p.internal, p.name));
console.log('Knowledge Base reverse proxy started (kb-proxy, auth ' + (AUTH_ENABLED ? 'on' : 'off') + ')');
