# 🚀 Prompt di Installazione Automatica

Copia e incolla questo prompt in un agente AI per installare la knowledge base.

---

## Prompt per l'agente

```
Sei un assistente di installazione. Segui questi passaggi in ordine per installare la "My Knowledge Base" sul sistema.

### STEP 1: Verifica prerequisiti
Controlla che siano installati:
- Git: `git --version`
- Node.js 20+: `node --version` (serve v20.0.0 o superiore)
- npm: `npm --version`
- nvm (opzionale ma raccomandato): `nvm --version`

Se Node.js è < 20, installa nvm e Node.js 20:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
nvm alias default 20
```

### STEP 2: Clona la repository
```bash
cd /DATA/AppData
git clone https://github.com/Cheic1/knowledge-base.git my-knowledge-base
cd my-knowledge-base
```

### STEP 3: Configura Node.js
Assicurati che Node.js 20+ sia attivo:
```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20
```

### STEP 4: Installa agentmemory
```bash
npm install -g @agentmemory/agentmemory
```

### STEP 5: Configura environment
Copia la configurazione agentmemory nella home:
```bash
mkdir -p ~/.agentmemory
cp .agentmemory/.env ~/.agentmemory/.env
```

### STEP 6: Configura III per accesso remoto
Modifica il file `data/iii-config.yaml`:
1. Cambia `host: 127.0.0.1` in `host: 0.0.0.0` per `iii-http`
2. Cambia `host: 127.0.0.1` in `host: 0.0.0.0` per `iii-stream`
3. Cambia `allowed_origins` in `["*"]` per `iii-http`

### STEP 7: Avvia agentmemory
```bash
cd /DATA/AppData/my-knowledge-base
nohup agentmemory > /tmp/agentmemory.log 2>&1 &
sleep 10
curl http://localhost:3111/agentmemory/health
```

### STEP 8: Verifica installazione
Controlla che:
1. agentmemory risponde: `curl http://localhost:3111/agentmemory/health`
2. Le porte sono aperte: `ss -tlnp | grep -E '3111|3113'`
3. Il bind è su 0.0.0.0: `ss -tlnp | grep '0.0.0.0:3111'`

### STEP 9: Inizializza Git
```bash
cd /DATA/AppData/my-knowledge-base
git remote remove origin 2>/dev/null
git remote add origin git@github.com:Cheic1/knowledge-base.git
git add .
git commit -m "Initial setup" || true
git push -u origin main 2>/dev/null || echo "Push non necessario o remote non configurato"
```

### STEP 10: Crea script di avvio rapido
Crea un file `~/start-kb.sh` con:
```bash
#!/bin/bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20
cd /DATA/AppData/my-knowledge-base
pkill -f agentmemory 2>/dev/null
pkill -f iii 2>/dev/null
sleep 2
nohup agentmemory > /tmp/agentmemory.log 2>&1 &
sleep 10
echo "Knowledge Base avviata!"
echo "REST API: http://$(hostname -I | awk '{print $1}'):3111"
echo "Viewer: http://$(hostname -I | awk '{print $1}'):3113"
```
Rendi eseguibile: `chmod +x ~/start-kb.sh`

### Completamento
L'installazione è completata quando:
- agentmemory risponde su http://localhost:3111/agentmemory/health
- Il viewer è accessibile su http://<IP_SERVER>:3113
- La configurazione è in ~/.agentmemory/.env

Mostra all'utente gli indirizzi di accesso e come riavviare il servizio.
```
---

## 📋 Indirizzi di accesso (dopo installazione)

| Servizio | Indirizzo |
|----------|-----------|
| REST API | http://192.168.68.55:3111 |
| Viewer Web | http://192.168.68.55:3113 |
| WebSocket | ws://192.168.68.55:3112 |
| Engine | ws://192.168.68.55:49134 |

## 🔧 Riavvio rapido

Dopo l'installazione, per riavviare la knowledge base:
```bash
~/start-kb.sh
```

## 📦 Struttura installata

```
/DATA/AppData/my-knowledge-base/
├── .env                    # Configurazione LLM
├── .agentmemory/           # Config agentmemory
├── AGENTS.md              # Configurazione agenti AI
├── QUICKSTART.md          # Guida rapida
├── INSTALL.md             # Installazione dettagliata
├── MCP-CONFIG.json        # Configurazione MCP
├── wiki/                  # LLM Wiki (nashsu/llm_wiki)
│   ├── purpose.md
│   ├── schema.md
│   └── wiki/
├── projects/              # Progetti
├── scripts/               # Script di utilità
└── data/                  # Dati agentmemory
```
