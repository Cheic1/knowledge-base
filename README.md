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

## 🚀 Setup rapido

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
- **Sincronizzazione**: Git

### Git (Version Control)
- **Scopo**: Sincronizzazione tra dispositivi
- **Uso**: Versioning, backup, collaboration
- **Branch**: main (produzione), dev (sviluppo)

## 🔌 Integrazioni

### Collegamento (endpoint unico e cambiabile)
- **Endpoint centralizzato**: `config/endpoint.env` (`KB_API_URL`, `KB_VIEWER_URL`, `KB_WIKI_URL`)
- **Server**: `./scripts/start-kb.sh` (agentmemory + proxy LAN 8311/8313/8318)
- **Ogni macchina**: `./scripts/connect-agent.sh` (cabla MCP negli agenti trovati)
- **Prompt per agenti**: `PROMPT-INSTALL.md` (blocco copy-paste)

### Agenti AI supportati
- **OpenCode**: via MCP (`~/.config/opencode/opencode.json`)
- **Hermes**: via MCP (`~/.hermes/config.yaml`, blocco `mcp_servers:`)
- **VS Code / Cursor**: via MCP (`mcp.json`)
- **Qualsiasi agente MCP**: `MCP-CONFIG.json` come riferimento

### File di configurazione
- `config/endpoint.env`: endpoint unico di rete
- `AGENTS.md`: configurazione dettagliata agenti
- `MCP-CONFIG.json`: riferimento MCP per ogni agente
- `scripts/start-kb.sh`, `scripts/connect-agent.sh`, `scripts/sync.sh`

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
# Sync automatico
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
- **Backup**: automatico su Git privato

## 📝 Licenza

Uso personale. Non distribuire.