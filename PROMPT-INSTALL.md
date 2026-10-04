# 📋 Prompt Copia e Incolla

## ⭐ Installazione unica (consigliata, ogni macchina)

Un solo comando installa e cabla tutto, e da quel momento la macchina si aggiorna
da sola dal remote da cui e' stata clonata (GitHub o GitLab):

```
node scripts/kb.mjs install                 # PC (Windows, Linux, macOS)
node scripts/kb.mjs install --wiki-search   # server Linux, con la ricerca wiki (qmd)
node scripts/kb.mjs status                  # controllo
```

Cosa fa: porta il clone su `main`, installa agentmemory alla versione fissata in
`package.json` (uguale su tutte le macchine), lo avvia in locale e lo fa ripartire
da solo (systemd sul server, Utilita' di pianificazione su Windows, crontab altrove),
cabla Claude Code, OpenCode e Hermes su `http://127.0.0.1:3111`, installa la sync
delle memorie ogni 15 minuti e a ogni sessione di Claude Code, e fa la prima sync.
A ogni giro la sync esegue anche `kb.mjs update`: `git pull` e, se il codice e'
cambiato, riapplica solo cio' che serve. Log in `~/.agentmemory/kb-update.log`.

Prompt da incollare nell'agente della macchina:

```
Installa la knowledge base Cheic1/knowledge-base su questa macchina.
1. Se il clone esiste gia' (cercalo: E:\knowledge-base, ~/knowledge-base, /DATA/AppData/my-knowledge-base),
   entra nella cartella ed esegui: git fetch origin && git checkout main && git pull
   (se git si blocca dietro un proxy aziendale: git config http.proxy "" e riprova).
   Se non esiste: git clone https://github.com/Cheic1/knowledge-base.git ~/knowledge-base
2. Serve Node.js 20+ e git (Windows: winget install OpenJS.NodeJS.LTS / Git.Git).
3. Esegui: node scripts/kb.mjs install
4. Mostrami l'output e poi: node scripts/kb.mjs status
Non cancellare nulla. Se un passo fallisce fermati e riportami l'errore esatto.
```

Le sezioni sotto restano come riferimento per installazioni a mano.

---


Copia il blocco sottostante e incollalo in un agente AI (OpenCode, Hermes, VS Code, Cursor).
Funziona **sia sul server che su un PC client**: l'endpoint è unico e centralizzato.

---

## 🔌 Sei su un PC client (solo connessione)

L'intero pacchetto (agentmemory + proxy) gira già sul server. Qui cabli solo l'agente.

```
Collega questa macchina alla knowledge base condivisa (server: 192.168.68.55).

0. CONTROLLA se è già installata (NON reinstallare se lo è):
   - Repo presente?   ls ~/knowledge-base/.git  (o /DATA/AppData/my-knowledge-base/.git)
   - Server vivo?     curl -sf http://192.168.68.55:8311/agentmemory/health
                      → JSON con "status":"healthy" = server OK
   - Agente già cablato? grep -q agentmemory ~/.config/opencode/opencode.json
                      (oppure ~/.hermes/config.yaml / ~/.cursor/mcp.json)
   Se TUTTO già così: salta al punto 6 (test), non reinstallare nulla.
   Se manca solo il cablaggio: esegui solo il punto 4 (connect-agent.sh).

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

5. VERIFICA: lo script deve riportare "[OK] agentmemory cablato", le skill
   ("[OK] skill agentmemory", altrimenti: npx skills add rohitg00/agentmemory -y) e l'endpoint
   http://192.168.68.55:8311. Poi riavvia l'agente corrente.

6. TESTA la connessione dalla tua sessione:
   curl -X POST http://192.168.68.55:8311/agentmemory/search \
     -H 'Content-Type: application/json' -d '{"query":"architettura"}'
   Risposta con "results": funziona.

L'endpoint è centralizzato: per cambiarlo modifica config/endpoint.env nella repo
e riesegui ./scripts/connect-agent.sh. Non serve reinstallare nient'altro.
```

## 💻 PC autonomo (senza server, memorie sincronizzate via GitHub)

Per un PC che non raggiunge il server: agentmemory gira in locale e le memorie
si allineano con gli altri PC tramite `scripts/memory-sync.mjs`.
Serve solo **Node 20+** e **git** (senza git: OneDrive o share, vedi punto 6).

```
Configura questa macchina con una knowledge base agentmemory LOCALE,
sincronizzata con gli altri PC via GitHub (repo Cheic1/knowledge-base).

0. CONTROLLA cosa c'è già (non reinstallare ciò che funziona):
   - node --version   → serve v20 o superiore
   - git --version
   - Repo presente?   ls ~/knowledge-base/.git
   - agentmemory vivo? curl -sf http://127.0.0.1:3111/agentmemory/health
     (su Windows senza curl: node -e "fetch('http://127.0.0.1:3111/agentmemory/health').then(r=>r.text()).then(console.log)")

1. NODE 20+ se manca o è vecchio:
   Linux/macOS: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
                export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm install 20 && nvm alias default 20
   Windows:     winget install OpenJS.NodeJS.LTS

2. CLONA la repo (serve accesso al repo privato: chiave SSH o login GitHub):
   git clone git@github.com:Cheic1/knowledge-base.git ~/knowledge-base
   cd ~/knowledge-base

3. AVVIA agentmemory in locale (resta in ascolto su 127.0.0.1:3111, viewer su :3113):
   Linux/macOS: nohup npx -y @agentmemory/agentmemory@0.9.29 > ~/agentmemory.log 2>&1 &
   Windows (PowerShell):
                Start-Process -WindowStyle Hidden npx.cmd -ArgumentList '-y','@agentmemory/agentmemory@0.9.29'
   Attendi che /agentmemory/health risponda "healthy" (può servire un minuto al primo avvio).
   Tutti i PC devono usare la STESSA versione di agentmemory (oggi 0.9.29).

4. CABLA l'agente su agentmemory LOCALE (non sul server):
   - Con bash e python3 disponibili:
       KB_API_URL=http://127.0.0.1:3111 ./scripts/connect-agent.sh
   - Altrimenti scrivi tu la config MCP dell'agente come in AGENTS.md
     (sezioni OpenCode / VS Code-Cursor / Hermes) con
     AGENTMEMORY_URL=http://127.0.0.1:3111. Il blocco llm-wiki si può omettere.
   - Installa le skill native di agentmemory (dicono all'agente quando cercare e
     salvare in memoria; connect-agent.sh lo fa già, altrimenti a mano):
       npx skills add rohitg00/agentmemory -y
   Poi riavvia l'agente.

5. IMPORTA le memorie degli altri agenti di questo PC (CLAUDE.md, AGENTS.md,
   memorie di Claude Code e Hermes, regole di Cursor/Copilot/Windsurf/Cline, GEMINI.md):
   node scripts/import-agent-memories.mjs --dry-run     # mostra cosa troverebbe
   node scripts/import-agent-memories.mjs               # le salva in agentmemory
   Se i progetti stanno fuori dalla home aggiungi --root <cartella> (ripetibile).
   I blocchi che sembrano contenere segreti vengono saltati: riportali all'utente.
   Opzionale, se c'è Claude Code: npx -y @agentmemory/agentmemory@0.9.29 import-jsonl
   (importa anche le conversazioni passate di Claude Code).

6. PRIMA SINCRONIZZAZIONE:
   node scripts/memory-sync.mjs --dry-run   # mostra quante memorie arriverebbero dagli altri PC
   node scripts/memory-sync.mjs             # importa, scrive memories/sync/<nome-pc>.json e fa push
   Se il push fallisce per credenziali: configura chiave SSH o credential manager e riprova.

7. SENZA git (OneDrive o cartella condivisa), al posto del punto 6:
   node scripts/memory-sync.mjs --dir "<cartella OneDrive o share>/kb-memories"

8. AUTOMATIZZA la sync (pull, import, push) ogni 15 minuti, all'accesso e,
   se c'è Claude Code, all'inizio e alla fine di ogni sessione:
     node scripts/schedule-memory-sync.mjs install --every 15 --claude-hooks
   (senza Claude Code togli --claude-hooks). Usa l'Utilità di pianificazione su
   Windows e crontab su Linux/macOS, senza finestre che si aprono. Controlla con:
     node scripts/schedule-memory-sync.mjs status
   e dopo qualche minuto leggi ~/.agentmemory/memory-sync.log.
   Per toglierla: node scripts/schedule-memory-sync.mjs uninstall

Se qualcosa si blocca (proxy, porta 3111 occupata, python3 su Windows) leggi
"Problemi noti" subito sotto questo blocco in PROMPT-INSTALL.md.

9. VERIFICA: dall'agente esegui memory_smart_search su un argomento noto
   (es. "architettura"): devono comparire le memorie degli altri PC.
   Mostra all'utente il nome del file in memories/sync/ e come rilanciare la sync.
```

### ⚠️ Problemi noti (PC Windows / rete aziendale)

| Sintomo | Causa | Soluzione |
|---------|-------|-----------|
| `git pull`/`push` resta appeso o `CONNECT tunnel failed, response 502` | proxy aziendale (`http.proxy` globale) che non lascia passare GitHub | disattivalo **solo per questa repo**: `git config http.proxy ""`. In PowerShell le `""` vengono scartate: usa `cmd /c 'git config http.proxy ""'`. Va rifatto su ogni clone. `memory-sync.mjs` si ferma dopo 90s e lo ricorda |
| `connect-agent.sh` fallisce su Python | su Windows `python3` è spesso lo stub del Microsoft Store | lo script ora prova `python3` e `python` e, se nessuno funziona, dice di scrivere il config MCP a mano come in AGENTS.md |
| agentmemory non parte: `127.0.0.1:3111 already in use`, ma `/health` non risponde | un'istanza precedente inceppata tiene la porta | ferma i processi vecchi e riavvia con lo stesso data dir. PowerShell: `Get-NetTCPConnection -LocalPort 3111 \| % { Stop-Process -Id $_.OwningProcess -Force }`; Linux/macOS: `kill $(lsof -ti :3111)` |
| Clone interrotto lascia una cartella con `.git` vuoto | rete instabile o proxy | cancella la cartella e riclona dopo aver sistemato il proxy |

Il **DB live** di agentmemory (`state_store.db`) e il **repo git** possono stare in una
cartella OneDrive solo se nessun altro PC usa quella stessa cartella: OneDrive non
gestisce bene file scritti di continuo né i file di `.git`. Per condividere le memorie
tra PC usa sempre `memory-sync.mjs`.

## 🖥️ Sei sul server (installazione completa)

Il server è già installato e funzionante. Per un rebuild da zero o un nuovo server:

```
Installazione completa della knowledge base sul server.

0. CONTROLLA se è già installata (NON reinstallare se lo è):
   - Repo presente?     ls /DATA/AppData/my-knowledge-base/.git
   - agentmemory vivo?  curl -sf http://127.0.0.1:3111/agentmemory/health
                        → "status":"healthy" = già installato e sano
   - Proxy vivo?        ss -tlnp | grep 8311   (oppure curl -sf http://<IP>:8311/agentmemory/health)
   Se TUTTO già così: salta al punto 7 (verifica remoto) e comunque esegui
   il punto 6 (connect-agent.sh, è idempotente) per cablare gli agenti.
   Se manca solo il proxy: ./scripts/start-kb.sh (riavvia tutto in modo sicuro).

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
