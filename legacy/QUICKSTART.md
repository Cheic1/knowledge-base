# ⚡ Quick Start - My Knowledge Base

## 🎯 In 5 minuti

### 1. Aggiorna Node.js (se necessario)
```bash
# Verifica versione
node --version

# Se < 20.0.0, aggiorna (vedi UPDATE_NODEJS.md)
```

### 2. Configura (2 min)
```bash
cd /DATA/AppData/my-knowledge-base
cp .env.example .env
nano .env  # Le API keys sono già configurate!
```

### 3. Avvia servizi (1 min)
```bash
# Terminal 1: agentmemory
./scripts/start-agentmemory.sh start

# Terminal 2: LLM Wiki (apri Desktop App)
# Vai su: https://github.com/nashsu/llm_wiki/releases
# Scarica e installa per il tuo OS
# Apri la cartella: /DATA/AppData/my-knowledge-base/wiki
```

### 4. Configura il tuo agente (1 min)
```bash
# Copia la configurazione MCP
cat MCP-CONFIG.json

# Incolla nel file di configurazione del tuo agente
# (vedi AGENTS.md per istruzioni specifiche)
```

### 5. Inizia a usare (1 min)
```bash
# In qualsiasi agente AI:
memory_smart_search "come implementare JWT"
memory_save "Ho trovato un pattern interessante per X"

# In LLM Wiki:
# Importa documenti nella cartella raw/sources/
# Usa /wiki ingest per processarli
```

---

## 📝 Workflow quotidiano

### Mattina
```bash
# Sincronizza con Git
./scripts/sync.sh pull

# Avvia servizi
./scripts/start-agentmemory.sh start
```

### Durante la giornata
```bash
# Lavora normalmente con il tuo agente preferito
# agentmemory cattura automaticamente tutto

# Aggiungi documenti alla wiki
cp paper.pdf wiki/raw/sources/
# Usa LLM Wiki per processarli
```

### Sera
```bash
# Sincronizza
./scripts/sync.sh push

# Verifica status
./scripts/sync.sh status
```

---

## 🔄 Sincronizzazione tra dispositivi

### Da un nuovo PC
```bash
# Clone la knowledge base
git clone https://github.com/Cheic1/knowledge-base.git
cd knowledge-base

# Configura
cp .env.example .env
nano .env

# Avvia
npx agentmemory &
```

### Sync automatico
```bash
# Aggiungi a crontab (ogni ora)
crontab -e
# Aggiungi:
0 * * * * /DATA/AppData/my-knowledge-base/scripts/sync.sh sync
```

---

## 🤖 Uso con agenti AI

### In OpenCode
```
# Cerca nella knowledge base
memory_smart_search "architettura microservices"

# Salva una scoperta
memory_save "Pattern: Circuit Breaker per fallback graceful"
```

### In VS Code / Cursor
```
# Usa i tools MCP disponibili
memory_recall "ultime sessioni"
memory_timeline "ultima settimana"
```

---

## 📊 Monitoraggio

### Status servizi
```bash
# agentmemory
curl http://localhost:3111/agentmemory/health

# LLM Wiki
curl http://127.0.0.1:19828/api/v1/health
```

### Viewer web
```bash
# Apri browser
open http://localhost:3113  # agentmemory viewer
```

### Obsidian
```bash
# Apri la cartella wiki/ in Obsidian
# Visualizza il grafo della conoscenza
```

---

## 🆘 Problemi comuni

### "agentmemory non si avvia"
```bash
pkill -f agentmemory
npx agentmemory &
```

### "LLM Wiki non risponde"
```bash
# Riavvia l'app Desktop
# Verifica che la porta 19828 sia libera
lsof -ti :19828
```

### "Git push fallisce"
```bash
git pull --rebase origin main
git push origin main
```

### "Non trovo le informazioni"
```bash
# Verifica che agentmemory sia in esecuzione
curl http://localhost:3111/agentmemory/health

# Verifica che i dati siano salvati
ls -la .agentmemory/data/
```

---

## 📚 Prossimi passi

1. **Leggi README.md** per la documentazione completa
2. **Leggi INSTALL.md** per installazione dettagliata
3. **Leggi AGENTS.md** per configurare i tuoi agenti
4. **Esplora la struttura** della knowledge base
5. **Personalizza purpose.md** e **schema.md**

---

## 🎉 Buon lavoro!

La tua knowledge base è ora pronta. Usa, impara, condividi!