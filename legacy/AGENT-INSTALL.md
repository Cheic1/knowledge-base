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
npm install -g @agentmemory/agentmemory@0.9.29
```

### STEP 5: Configura environment
Copia la configurazione agentmemory nella home:
```bash
mkdir -p ~/.agentmemory
cp .agentmemory/.env ~/.agentmemory/.env
```

### STEP 6: Avvia servizi (agentmemory + proxy LAN)
Non modificare `data/iii-config.yaml`: iii riscrive l'host a 127.0.0.1 ad ogni boot.
L'esposizione sulla LAN è gestita da `scripts/kb-proxy.js` (porta 8311→API, 8313→viewer, 8318→wiki).
```bash
cd /DATA/AppData/my-knowledge-base
./scripts/start-kb.sh
```

### STEP 7: Cabla gli agenti di questa macchina
```bash
cd /DATA/AppData/my-knowledge-base
./scripts/connect-agent.sh
```
Lo script rileva OpenCode / Hermes / Cursor / VS Code e scrive la config MCP
puntando a `KB_API_URL` (definito in `config/endpoint.env`).

### STEP 8: Verifica installazione
Controlla che:
1. agentmemory risponde: `curl http://localhost:3111/agentmemory/health` → `"status":"healthy"`
2. Il proxy è su: `ss -tlnp | grep -E '8311|8313'`
3. Raggiungibile dalla LAN: `curl http://<IP_SERVER>:8311/agentmemory/health`

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

L'endpoint è centralizzato in `config/endpoint.env` (cambiabile).

| Servizio | Indirizzo |
|----------|-----------|
| REST API | `KB_API_URL` → http://192.168.68.55:8311 |
| Viewer Web | `KB_VIEWER_URL` → http://192.168.68.55:8313 |
| LLM Wiki API | `KB_WIKI_URL` → http://192.168.68.55:8318 |
| Locale (solo server) | http://127.0.0.1:3111/agentmemory/health |

Le porte 83xx sono del proxy LAN (`scripts/kb-proxy.js`): iii resta su 127.0.0.1.

## 🔧 Riavvio rapido

```bash
cd /DATA/AppData/my-knowledge-base
./scripts/start-kb.sh          # avvia tutto
./scripts/start-kb.sh status   # stato
./scripts/start-kb.sh stop     # ferma tutto
```

## 🔌 Collegamento nuovi agenti/PC

```bash
./scripts/connect-agent.sh     # cabla MCP leggendo config/endpoint.env
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
