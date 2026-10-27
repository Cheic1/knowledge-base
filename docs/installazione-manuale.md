# Installazione a mano

Riferimento passo per passo di cosa fa `node scripts/bootstrap.mjs` /
`node scripts/kb.mjs install`. Usalo solo se l'installazione automatica non va bene per
la tua macchina: le versioni sono fissate e devono restare uguali su tutte le macchine.

| Componente | Versione | Dove è fissata |
|------------|----------|----------------|
| Node.js | 20 o superiore (22 per la ricerca wiki qmd) | — |
| `@agentmemory/agentmemory` | **0.9.29** | `package.json` |
| `@tobilu/qmd` (ricerca wiki) | **2.8.3** (`^2.8.3`) | `scripts/wiki-search.sh` (`QMD_VERSION`) |

Non usare `npm install -g` senza versione: ogni macchina finirebbe con una versione diversa
e gli export delle memorie non si importano tra versioni diverse.

## Server (Linux, systemd utente)

```bash
cd /DATA/AppData && git clone https://github.com/Cheic1/knowledge-base.git my-knowledge-base
cd my-knowledge-base
npm install --no-audit --no-fund --omit=dev           # agentmemory 0.9.29 in node_modules
node scripts/kb.mjs token                              # genera KB_TOKEN in .env (chmod 600)
AGENTMEMORY_BIN="$PWD/node_modules/.bin/agentmemory" ./scripts/install-systemd.sh
node scripts/kb.mjs connect --role server              # cabla gli agenti di questa macchina
```

`install-systemd.sh` installa le unit utente `kb-agentmemory`, `kb-proxy` (porte LAN
8311/8313/8318 con token) e il timer `kb-maintenance` (riavvii in sospeso, ogni notte
alle `KB_MAINTENANCE_AT`, default 03:00).

Non modificare `data/iii-config.yaml` per l'host: iii v0.11.2 lo riscrive a `127.0.0.1`
a ogni avvio. L'esposizione LAN la fa `scripts/kb-proxy.js`.

Verifica da un altro dispositivo:

```bash
curl -H "Authorization: Bearer <KB_TOKEN>" http://192.168.68.55:8311/agentmemory/health   # "status":"healthy"
curl -o /dev/null -w "%{http_code}\n" http://192.168.68.55:8311/agentmemory/health        # 401 senza token
```

## PC client (usa il server centrale)

```bash
git clone https://github.com/Cheic1/knowledge-base.git ~/knowledge-base && cd ~/knowledge-base
echo "KB_TOKEN=<token del server>" >> .env
node scripts/kb.mjs connect --role client
```

L'indirizzo del server sta in `config/endpoint.env` (`KB_API_URL`): per passare dal
server di casa alla VM aziendale si cambia solo quel file.

## PC autonomo (standalone-dev)

```bash
git clone https://github.com/Cheic1/knowledge-base.git ~/knowledge-base && cd ~/knowledge-base
npm install --no-audit --no-fund --omit=dev
node node_modules/@agentmemory/agentmemory/dist/cli.mjs &           # agentmemory locale su 127.0.0.1:3111
node scripts/kb.mjs connect --role standalone-dev
node scripts/memory-sync.mjs                                         # prima sync (crea .kb-data/)
node scripts/schedule-memory-sync.mjs install --every 15 --claude-hooks
```

Windows (PowerShell), per avviare agentmemory senza finestra:
`Start-Process -WindowStyle Hidden node -ArgumentList 'node_modules/@agentmemory/agentmemory/dist/cli.mjs'`.

Opzionale, se c'è Claude Code: `npx -y @agentmemory/agentmemory@0.9.29 import-jsonl`
importa le sessioni passate.
