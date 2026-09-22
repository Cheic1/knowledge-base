# 📋 Prompt Copia e Incolla

Copia il blocco sottostante e incollalo in un agente AI (OpenCode, Hermes, VS Code, Cursor).
Funziona **sia sul server che su un PC client**: l'endpoint è unico e centralizzato.

---

## 🔌 Sei su un PC client (solo connessione)

L'intero pacchetto (agentmemory + proxy) gira già sul server. Qui cabli solo l'agente.

```
Collega questa macchina alla knowledge base condivisa (server: 192.168.68.55).

1. CLONA la repo (scegli una cartella che esiste; usa ~/knowledge-base se non sai dove):
   git clone https://github.com/Cheic1/knowledge-base.git ~/knowledge-base
   cd ~/knowledge-base

2. VERIFICA di raggiungere il server:
   curl -sf http://192.168.68.55:8311/agentmemory/health
   Se fallisce: il server è spento o kb-proxy non gira → avvisa l'utente.

3. VERIFICA Node.js 20+ (richiesto da @agentmemory/mcp; se manca o è < 20):
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
   nvm install 20 && nvm alias default 20

4. ESEGUI lo script di cablaggio (configura MCP in automatico in OpenCode,
   Hermes, Cursor o VS Code se presenti su questa macchina):
   cd ~/knowledge-base && ./scripts/connect-agent.sh

5. VERIFICA: lo script deve riportare "[OK] agentmemory cablato" e l'endpoint
   http://192.168.68.55:8311. Poi riavvia l'agente corrente.

6. TESTA la connessione dalla tua sessione:
   curl -X POST http://192.168.68.55:8311/agentmemory/search \
     -H 'Content-Type: application/json' -d '{"query":"architettura"}'
   Risposta con "results": funziona.

L'endpoint è centralizzato: per cambiarlo modifica config/endpoint.env nella repo
e riesegui ./scripts/connect-agent.sh. Non serve reinstallare nient'altro.
```

## 🖥️ Sei sul server (installazione completa)

Il server è già installato e funzionante. Per un rebuild da zero o un nuovo server:

```
Installazione completa della knowledge base sul server.

1. CLONA:
   cd /DATA/AppData && git clone https://github.com/Cheic1/knowledge-base.git my-knowledge-base

2. Node.js 20+ via nvm (se assente):
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm install 20 && nvm alias default 20

3. INSTALLA agentmemory:
   cd /DATA/AppData/my-knowledge-base && npm install -g @agentmemory/agentmemory

4. CONFIGURA env:
   cp .env.example .env && nano .env        # endpoint LLM, key
   mkdir -p ~/.agentmemory && cp .agentmemory/.env ~/.agentmemory/.env

5. AVVIA tutto (agentmemory + proxy LAN):
   ./scripts/start-kb.sh
   Deve riportare "[OK] agentmemory healthy" e mostrare URL http://<IP>:8313

6. CABLA gli agenti di questa macchina (es. OpenCode e Hermes):
   ./scripts/connect-agent.sh

7. VERIFICA remoto (da un altro dispositivo):
   curl -sf http://192.168.68.55:8313/          # viewer → 200
   curl -sf http://192.168.68.55:8311/agentmemory/health  # → "status":"healthy"

NON modificare data/iii-config.yaml per l'host: iii v0.11.2 lo riscrive a
127.0.0.1 ad ogni avvio. L'esposizione LAN è fatta da scripts/kb-proxy.js
(porte 8311 API / 8313 viewer / 8318 wiki), avviato da start-kb.sh.
```
