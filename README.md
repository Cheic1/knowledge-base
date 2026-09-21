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

### 4. Avvia agentmemory
```bash
./scripts/start-agentmemory.sh start
```

### 5. Avvia LLM Wiki
```bash
# Scarica da: https://github.com/nashsu/llm_wiki/releases
# Apri la cartella: /DATA/AppData/my-knowledge-base/wiki
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

### Agenti AI supportati
- **OpenCode**: via MCP
- **VS Code / Cursor**: via MCP
- **Claude Desktop**: via MCP
- **Hermes**: via MCP
- **Qualsiasi agente MCP**: configurazione standard

### File di configurazione
- `AGENTS.md`: Configurazione agenti AI
- `MCP-CONFIG.json`: Configurazione MCP
- `scripts/sync.sh`: Script di sincronizzazione
- `scripts/backup.sh`: Script di backup

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

- **API keys**: mai committate (usa .env)
- **Dati sensibili**: criptati o esclusi da Git
- **Accesso**: solo locale (127.0.0.1)
- **Backup**: automatico su Git privato

## 📝 Licenza

Uso personale. Non distribuire.