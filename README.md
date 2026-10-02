# 🧠 My Knowledge Base

Knowledge base personale ibrida per tutti i progetti e le idee.

## 🎯 Struttura

```
my-knowledge-base/
├── wiki/                    # LLM Wiki (nashsu/llm_wiki)
│   ├── purpose.md          # Obiettivi e scope della knowledge base
│   ├── schema.md           # Regole strutturali
│   ├── raw/sources/        # Documenti originali (PDF, MD, ecc.)
│   └── wiki/               # Pagine generate dall'LLM
├── memory/                  # agentmemory (memoria operativa)
│   ├── observations/       # Osservazioni catturate
│   ├── memories/           # Memorie strutturate
│   └── sessions/           # Cronologia sessioni
├── projects/                # Progetti specifici
│   ├── frontend-app/
│   ├── backend-api/
│   └── library-common/
├── .agentmemory/           # Config agentmemory
├── .git/                   # Version control
└── scripts/                # Script di utilità
```

## 🧭 Due modi di usarla

| Modo | Quando | Come |
|------|--------|------|
| **Server LAN** | i PC raggiungono il server di casa (192.168.68.55) | agentmemory gira solo sul server, gli agenti si collegano via `config/endpoint.env` (setup qui sotto) |
| **PC autonomo** | nessun server raggiungibile (es. PC di lavoro) | ogni PC ha il suo agentmemory locale e le memorie si allineano via GitHub con `scripts/memory-sync.mjs` |

Per un **PC autonomo** basta Node 20+ e git: dai all'agente la sezione
"💻 PC autonomo" di [`PROMPT-INSTALL.md`](PROMPT-INSTALL.md) e fa tutto lui
(agentmemory locale, cablaggio MCP, import delle memorie degli altri agenti, prima sync).
Dettagli in [`memories/README.md`](memories/README.md).

## 🚀 Setup rapido (server)

### 1. Aggiorna Node.js (necessario)
```bash
# Verifica versione
node --version

# Se < 20.0.0, aggiorna (vedi UPDATE_NODEJS.md)
```

### 2. Configura le API keys
```bash
cd /DATA/AppData/my-knowledge-base
cp .env.example .env
nano .env  # Inserisci le tue API keys
```

### 3. Inizializza Git
```bash
git remote add origin git@github.com:Cheic1/knowledge-base.git
git add .
git commit -m "Initial setup"
git push -u origin main
```

### 4. Avvia knowledge base (server)
```bash
# Assicurati di usare Node.js 20+
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && nvm use 20

# Avvia agentmemory + kb-proxy (LAN 8311/8313/8318)
./scripts/start-kb.sh

# Verifica
curl http://localhost:3111/agentmemory/health   # → "status":"healthy"
```

### 5. Cabla i tuoi agenti
```bash
./scripts/connect-agent.sh    # rileva OpenCode/Hermes/Cursor/VS Code e scrive il config MCP
```

### 6. Avvia LLM Wiki (opzionale)
```bash
# Scarica da: https://github.com/nashsu/llm_wiki/releases
# Apri la cartella: /DATA/AppData/my-knowledge-base/wiki
# API esposta dal proxy su http://<IP>:8318
```

## 📚 Componenti

### LLM Wiki (Knowledge Base Strutturata)
- **Scopo**: Knowledge base statica e ricercabile
- **Uso**: Paper tecnologici, documentazione, note strutturate
- **Tool**: nashsu/llm_wiki (desktop app)
- **Sincronizzazione**: Git

### agentmemory (Memoria Operativa)
- **Scopo**: Memoria automatica delle sessioni di coding
- **Uso**: Contesto operativo, decisioni, bug trovati
- **Tool**: agentmemory (MCP server)
- **Sincronizzazione**: export JSON per PC in `memories/sync/` via `scripts/memory-sync.mjs`
  (il DB live `data/` non si sincronizza mai: è binario e scritto di continuo)

### Git (Version Control)
- **Scopo**: Sincronizzazione tra dispositivi
- **Uso**: Versioning, backup, collaboration
- **Branch**: main (produzione), dev (sviluppo)

## 🔌 Integrazioni

### Collegamento (endpoint unico e cambiabile)
- **Endpoint centralizzato**: `config/endpoint.env` (`KB_API_URL`, `KB_VIEWER_URL`, `KB_WIKI_URL`)
- **Server**: `./scripts/start-kb.sh` (agentmemory + proxy LAN 8311/8313/8318)
- **Ogni macchina**: `./scripts/connect-agent.sh` (cabla MCP negli agenti trovati)
- **Prompt per agenti**: `PROMPT-INSTALL.md` (blocchi copy-paste: client, PC autonomo, server)

### Agenti AI supportati
- **OpenCode**: via MCP (`~/.config/opencode/opencode.json`)
- **Hermes**: via MCP (`~/.hermes/config.yaml`, blocco `mcp_servers:`)
- **VS Code / Cursor**: via MCP (`mcp.json`)
- **Qualsiasi agente MCP**: `MCP-CONFIG.json` come riferimento
- **Memorie native degli altri agenti** (Claude Code, Codex, Cursor, Copilot, Hermes,
  Gemini, Windsurf, Cline): importate in agentmemory con `scripts/import-agent-memories.mjs`

### File di configurazione
- `config/endpoint.env`: endpoint unico di rete
- `AGENTS.md`: configurazione dettagliata agenti
- `MCP-CONFIG.json`: riferimento MCP per ogni agente
- `scripts/start-kb.sh`, `scripts/connect-agent.sh`, `scripts/sync.sh`
- `scripts/memory-sync.mjs`: sync delle memorie tra PC (git, OneDrive o share)
- `scripts/import-agent-memories.mjs`: import di CLAUDE.md, AGENTS.md, regole Cursor/Copilot...

## 📖 Utilizzo

### 1. Aggiungi conoscenza
```bash
# Aggiungi documenti alla wiki
cp paper.pdf wiki/raw/sources/
# Avvia LLM Wiki per processare

# Oppure usa agentmemory per catturare sessioni
npx agentmemory
```

### 2. Cerca conoscenza
```bash
# Via MCP (in qualsiasi agente)
memory_smart_search "come implementare JWT"

# Via LLM Wiki
# Usa l'interfaccia desktop o MCP
```

### 3. Sincronizza
```bash
# Memorie agentmemory tra PC (import dagli altri PC + push del proprio file)
node scripts/import-agent-memories.mjs   # porta dentro CLAUDE.md, AGENTS.md, regole...
node scripts/memory-sync.mjs             # --dry-run per vedere cosa farebbe

# Wiki e progetti
./scripts/sync.sh

# Oppure manuale
git add .
git commit -m "Aggiornamento knowledge base"
git push origin main
```

## 🔒 Sicurezza

- **API keys**: mai committate (usa .env, `chmod 600 .env`)
- **Dati sensibili**: `data/` escluso da Git
- **Accesso**: servizi su 127.0.0.1, esposti in LAN solo dal kb-proxy
  (8311/8313/8318, rete fidata 192.168.68.0/24 — senza auth, non esporre a internet)
- **Memorie su GitHub**: `memories/sync/*.json` contiene le memorie in chiaro: il repo
  deve restare privato. L'import salta i blocchi che sembrano segreti
- **Token agentmemory**: con `AGENTMEMORY_SECRET` impostato agentmemory accetta solo
  richieste con quel token (gli script di sync lo leggono dalla stessa variabile)
- **Backup**: automatico su Git privato

## 📝 Licenza

Uso personale. Non distribuire.