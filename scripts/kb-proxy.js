#!/usr/bin/env node
// Reverse proxy: espone i servizi (che restano su 127.0.0.1) sulla LAN.
// iii v0.11.2 riscrive host: 127.0.0.1 ad ogni boot, quindi si bypassa
// con questo proxy su porte 83xx. Avviato da scripts/start-kb.sh.
const http = require('http');
const net = require('net');

const PROXY_MAP = [
  { external: 8311, internal: 3111, name: 'REST API agentmemory' },
  { external: 8313, internal: 3113, name: 'Viewer agentmemory' },
  { external: 8318, internal: 19828, name: 'LLM Wiki API' },
];

function createProxy(extPort, intPort, name) {
  const server = http.createServer((req, res) => {
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: intPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:' + intPort },
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
console.log('Knowledge Base reverse proxy started (kb-proxy)');
