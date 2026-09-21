# 📦 Installazione - My Knowledge Base

## 🎯 Prerequisiti

### Software base
- **Node.js** >= 20 (https://nodejs.org/)
- **npm** o **yarn** o **pnpm**
- **Git** (https://git-scm.com/)

### Opzionale
- **Docker** (per containerizzazione)
- **qmd** (per ricerca semantica avanzata)
- **Obsidian** (per visualizzazione grafo)

---

## 🚀 Setup rapido

### 1. Clone la knowledge base
```bash
cd /DATA/AppData
git clone git@github.com:tuo-username/knowledge-base.git my-knowledge-base
cd my-knowledge-base
```

Oppure usa la struttura già creata:
```bash
cd /DATA/AppData/my-knowledge-base
```

### 2. Configura le variabili d'ambiente
```bash
# Copia il file di esempio
cp .env.example .env

# Modifica con le tue chiavi
nano .env
```

### 3. Installa dipendenze
```bash
# Agentmemory
npm install -g @agentmemory/agentmemory

# LLM Wiki (opzionale - Desktop App)
# Scarica da: https://github.com/nashsu/llm_wiki/releases

# qmd (opzionale - ricerca semantica)
npm install -g @tobilu/qmd
```

### 4. Inizializza Git
```bash
git init
git remote add origin git@github.com:tuo-username/knowledge-base.git
git add .
git commit -m "Initial setup"
git push -u origin main
```

---

## 🔧 Installazione dettagliata

### agentmemory

#### Installazione globale
```bash
npm install -g @agentmemory/agentmemory
```

#### Avvio
```bash
# Avvia agentmemory
npx agentmemory &

# Verifica health
curl http://localhost:3111/agentmemory/health
```

#### Configurazione
Modifica `.agentmemory/.env`:
```bash
# LLM Provider
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4

# O per uso locale
OPENAI_API_KEY=local
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=qwen3:8b
```

### LLM Wiki

#### Opzione 1: Desktop App (Consigliata)
1. Vai su https://github.com/nashsu/llm_wiki/releases
2. Scarica il binario per il tuo OS
3. Installa e avvia
4. Apri il progetto: `/DATA/AppData/my-knowledge-base/wiki`

#### Opzione 2: Claude Code Skill
```bash
# Installa la skill
git clone https://github.com/read2001/wiki.git ~/.claude/skills/wiki

# In Claude Code
cd /DATA/AppData/my-knowledge-base/wiki
/wiki init
```

#### Opzione 3: Build from source
```bash
git clone https://github.com/nashsu/llm_wiki.git
cd llm_wiki
npm install
npm run tauri dev
```

### qmd (Ricerca Semantica)

#### Installazione
```bash
npm install -g @tobilu/qmd
```

#### Primo utilizzo
```bash
# Il primo download scarica modelli ~2GB
qmd --help
```

#### Configurazione per CJK
```bash
# Per wiki in cinese/giapponese/coreano
export QMD_EMBED_MODEL=Qwen3-embedding
```

---

## 📁 Struttura directory

```
my-knowledge-base/
├── .git/                    # Version control
├── .agentmemory/           # Config agentmemory
│   ├── .env               # Variabili d'ambiente
│   └── data/              # Dati agentmemory
├── wiki/                    # LLM Wiki
│   ├── purpose.md         # Obiettivi
│   ├── schema.md          # Regole
│   ├── raw/sources/       # Fonti originali
│   └── wiki/              # Pagine generate
├── projects/                # Progetti specifici
├── scripts/                 # Script di utilità
├── .env.example            # Template variabili
├── .gitignore              # File esclusi da Git
├── AGENTS.md               # Config agenti AI
├── INSTALL.md              # Questo file
├── MCP-CONFIG.json         # Config MCP
└── README.md               # Documentazione principale
```

---

## 🔌 Configurazione Agenti

### OpenCode
Aggiungi a `~/.config/opencode/opencode.json`:
```json
{
  "mcp": {
    "agentmemory": {
      "type": "local",
      "command": ["npx", "-y", "@agentmemory/mcp"],
      "env": {
        "AGENTMEMORY_URL": "http://localhost:3111",
        "AGENTMEMORY_DATA_DIR": "/DATA/AppData/my-knowledge-base/.agentmemory"
      }
    }
  }
}
```

### VS Code / Cursor
Aggiungi a `.vscode/settings.json`:
```json
{
  "mcpServers": {
    "agentmemory": {
      "command": "npx",
      "args": ["-y", "@agentmemory/mcp"],
      "env": {
        "AGENTMEMORY_URL": "http://localhost:3111",
        "AGENTMEMORY_DATA_DIR": "/DATA/AppData/my-knowledge-base/.agentmemory"
      }
    }
  }
}
```

### Claude Desktop
Aggiungi a `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "agentmemory": {
      "command": "npx",
      "args": ["-y", "@agentmemory/mcp"],
      "env": {
        "AGENTMEMORY_URL": "http://localhost:3111",
        "AGENTMEMORY_DATA_DIR": "/DATA/AppData/my-knowledge-base/.agentmemory"
      }
    }
  }
}
```

---

## 🚀 Avvio servizi

### Script automatici
```bash
# Avvia agentmemory
./scripts/start-agentmemory.sh start

# Avvia LLM Wiki
./scripts/start-llm-wiki.sh start

# Sync con Git
./scripts/sync.sh sync
```

### Avvio manuale
```bash
# Terminal 1: agentmemory
cd /DATA/AppData/my-knowledge-base
npx agentmemory &

# Terminal 2: LLM Wiki (Desktop App)
# Avvia l'applicazione e apri la cartella wiki/

# Terminal 3: Sync (opzionale)
watch -n 3600 ./scripts/sync.sh sync
```

---

## 🔍 Verifica installazione

```bash
# Verifica agentmemory
curl http://localhost:3111/agentmemory/health

# Verifica LLM Wiki
curl http://127.0.0.1:19828/api/v1/health

# Verifica Git
git status
git log --oneline -5

# Verifica struttura
ls -la wiki/
ls -la .agentmemory/
```

---

## 🐛 Troubleshooting

### agentmemory non si avvia
```bash
# Verifica porta in uso
lsof -ti :3111

# Kill processo esistente
pkill -f agentmemory

# Riavvia
npx agentmemory &
```

### LLM Wiki non si avvia
```bash
# Verifica Node.js
node --version

# Reinstalla dipendenze
npm install

# Riavvia
npm run tauri dev
```

### Git push fallisce
```bash
# Verifica connessione
ssh -T git@github.com

# Verifica remote
git remote -v

# Force push (attenzione!)
git push -u origin main --force
```

### Porte in uso
```bash
# Trova processi sulle porte
lsof -ti :3111,3113,19828

# Kill processi
kill $(lsof -ti :3111) $(lsof -ti :3113) $(lsof -ti :19828)
```

---

## 📝 Prossimi passi

1. **Configura un provider LLM** nel file `.env`
2. **Importa i tuoi primi documenti** nella cartella `wiki/raw/sources/`
3. **Configura il tuo agente AI** preferito (vedi AGENTS.md)
4. **Inizia a usare** la knowledge base!

---

## 🆘 Supporto

- **agentmemory**: https://github.com/rohitg00/agentmemory
- **LLM Wiki**: https://github.com/nashsu/llm_wiki
- **qmd**: https://github.com/tobi/qmd
- **Problemi**: Apri un issue sul repo Git