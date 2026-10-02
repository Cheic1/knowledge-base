# 🤖 Configurazione Agenti AI

## 📋 Panoramica

Questa knowledge base si integra con diversi agenti AI tramite **MCP (Model Context Protocol)**. Ogni agente può accedere alla stessa memoria e conoscenza.

## 🔌 Configurazione per agente

> ⚡ **Cablaggio automatico**: invece di editare i file a mano, esegui
> `./scripts/connect-agent.sh` — legge l'endpoint da `config/endpoint.env`
> e configura MCP in OpenCode, Hermes, Cursor e VS Code trovati sulla macchina.
> I blocchi sotto sono il riferimento di cosa scrive lo script.

### OpenCode
Aggiungi al file `~/.config/opencode/opencode.json` (nota: il campo env si chiama `environment`):

```json
{
  "mcp": {
    "agentmemory": {
      "type": "local",
      "command": ["npx", "-y", "@agentmemory/mcp"],
      "environment": { "AGENTMEMORY_URL": "http://192.168.68.55:8311" },
      "enabled": true,
      "timeout": 10000
    },
    "llm-wiki": {
      "type": "local",
      "command": ["node", "<REPO>/mcp/llm-wiki-mcp/dist/src/index.js"],
      "environment": { "LLM_WIKI_API_BASE_URL": "http://192.168.68.55:8318" },
      "enabled": true,
      "timeout": 10000
    }
  }
}
```

L'endpoint (`KB_API_URL`, `KB_WIKI_URL`) è centralizzato in `config/endpoint.env`:
cambialo lì e riesegui `scripts/connect-agent.sh` su ogni macchina.

### VS Code / Cursor
Cursor: `~/.cursor/mcp.json` — VS Code: `.vscode/mcp.json`:

```json
{
  "mcpServers": {
    "agentmemory": {
      "command": "npx",
      "args": ["-y", "@agentmemory/mcp"],
      "env": { "AGENTMEMORY_URL": "http://192.168.68.55:8311" }
    },
    "llm-wiki": {
      "command": "node",
      "args": ["<REPO>/mcp/llm-wiki-mcp/dist/src/index.js"],
      "env": { "LLM_WIKI_API_BASE_URL": "http://192.168.68.55:8318" }
    }
  }
}
```

### Hermes
Blocco `mcp_servers:` in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  agentmemory:
    command: npx
    args: ["-y", "@agentmemory/mcp"]
    env:
      AGENTMEMORY_URL: http://192.168.68.55:8311
    enabled: true
  llm-wiki:
    command: node
    args:
      - <REPO>/mcp/llm-wiki-mcp/dist/src/index.js
    env:
      LLM_WIKI_API_BASE_URL: http://192.168.68.55:8318
    enabled: true
```

## 🛠️ Strumenti disponibili

### agentmemory (54 tools)
- `memory_save`: Salva un insight, decisione o pattern
- `memory_recall`: Cerca nelle osservazioni passate
- `memory_smart_search`: Ricerca ibrida (BM25 + vettori + grafo)
- `memory_sessions`: Lista sessioni recenti
- `memory_timeline`: Cronologia osservazioni
- `memory_export`: Esporta tutti i dati
- `memory_graph_query`: Interroga il grafo della conoscenza
- `memory_consolidate`: Esegui consolidamento a 4 livelli
- ... e altri 46 tools

### LLM Wiki (via HTTP API)
- `GET /api/v1/health`: Stato del server
- `GET /api/v1/projects`: Lista progetti
- `POST /api/v1/projects/{id}/search`: Ricerca ibrida
- `POST /api/v1/projects/{id}/chat`: Chat con la wiki
- `GET /api/v1/projects/{id}/graph`: Grafo della conoscenza
- `POST /api/v1/projects/{id}/sources/rescan`: Ris scanning fonti

### wiki-search (qmd, ricerca locale sulla wiki)
Funziona **senza l'app LLM Wiki aperta**: indicizza in locale i markdown di
`wiki/wiki/` e `projects/` (parole chiave + ricerca semantica + rerank, modelli locali).
- `query`: ricerca con sotto-query `lex` (parole), `vec` (semantica), `hyde`
- `get` / `multi_get`: leggi una pagina (path o `#docid`) o più pagine
- `status`: stato dell'indice

Schema documenti: **una macchina fa l'ingestion** (app LLM Wiki o agente) e fa
push di `wiki/`; gli altri PC fanno pull e cercano con wiki-search, in sola lettura.

```bash
./scripts/wiki-search.sh setup     # una volta per PC: Node 22+, installa qmd, indice, hook git
./scripts/connect-agent.sh         # aggiunge il MCP "wiki-search" agli agenti
./scripts/wiki-search.sh search "docker"   # prova da terminale
```
Dopo ogni `git pull` l'indice si aggiorna da solo in background (hook git,
log in `~/.cache/qmd/kb-update.log`). L'indice (`~/.cache/qmd/kb.sqlite`) è
per-PC e non va in git. Il primo `setup` scarica ~2 GB di modelli; senza
modelli resta la ricerca per parole.

## 🚀 Avvio servizi

### 1. Avvia tutto (server)
```bash
cd /DATA/AppData/my-knowledge-base
./scripts/start-kb.sh          # agentmemory + kb-proxy (LAN 8311/8313/8318)
./scripts/start-kb.sh status   # stato
```

### 2. Avvia LLM Wiki (opzionale)
```bash
# Avvia l'app desktop nashsu/llm_wiki
# Punto alla cartella: /DATA/AppData/my-knowledge-base/wiki
# API esposta via proxy su 8318 quando l'app è attiva
```

### 3. Verifica servizi
```bash
# Locale
curl http://127.0.0.1:3111/agentmemory/health     # → "status":"healthy"
# Remoto (LAN)
curl http://192.168.68.55:8311/agentmemory/health # → "status":"healthy"
# Viewer remoto
curl -o /dev/null -w "%{http_code}\n" http://192.168.68.55:8313/
```

### Mappe porte (perché esistono le 83xx)
iii v0.11.2 riscrive `data/iii-config.yaml` a `host: 127.0.0.1` ad ogni boot
(e III_HOST non funziona), quindi i servizi restano in locale e `kb-proxy.js`
li espone sulla LAN: **8311→3111** (API), **8313→3113** (viewer),
**8318→19828** (wiki). Non serve modificare iii-config.yaml.

## 📝 Utilizzo

### In qualsiasi agente
```
# Cerca nella knowledge base
memory_smart_search "come implementare JWT"

# Salva una scoperta
memory_save "Ho trovato un bug in React 18 con StrictMode"

# Cerca nella wiki
"Cosa dice la mia wiki su Docker?"
```

### Workflow tipico
1. **Lavora** con il tuo agente preferito
2. **Cattura** automaticamente le osservazioni (agentmemory)
3. **Cerca** quando hai bisogno di contesto
4. **Sincronizza** tra dispositivi con Git

## 🔒 Sicurezza

- **Accesso LAN**: servizi in ascolto su 127.0.0.1, esposti solo dal
  kb-proxy su 8311/8313/8318 (rete 192.168.68.0/24, **senza auth**:
  in rete fidata domestica; non esporre l'host a internet)
- **API keys**: mai committate (usa .env, `chmod 600 .env`)
- **Git privato**: repo GitHub Cheic1/knowledge-base
- **Backup**: Git per wiki/progetti; `data/` (stato runtime) è escluso

## 🔌 Riepilogo collegamento

| Da dove | Cosa fa l'agente |
|---------|------------------|
| **Server** (OpenCode, Hermes) | `./scripts/connect-agent.sh` → cabla MCP a `localhost` via endpoint |
| **PC client** (OpenCode) | clone repo + `./scripts/connect-agent.sh` → cabla MCP a `192.168.68.55:8311` |
| Cambio endpoint | modifica `config/endpoint.env` + riesegui `connect-agent.sh` ovunque |