# Prompt di installazione

Incolla questo prompt nell'agente della macchina (Claude Code, OpenCode, Gemini CLI, ...).
È lo stesso per tutte le macchine; cambia solo `<RUOLO>`:

| Macchina | `<RUOLO>` |
|---|---|
| PC personale, PC di lavoro (anche fuori casa) | *(vuoto)* |
| PC sempre in rete col server centrale | `--role client` (serve `KB_TOKEN`) |
| Server di casa Linux sempre acceso | `--role server --wiki-search` |

Funziona sia con l'installer di oggi sia con quello nuovo della spec
(`docs/superpowers/specs/2026-10-25-kb-tutti-agenti-design.md`): col nuovo il passo 5
non trova più nulla da fare, perché `install` collega da solo tutti i programmi.

```text
Installa e collega la knowledge base Cheic1/knowledge-base su questo computer, per TUTTI i miei agenti e programmi.
Regole: non cancellare nulla; niente checkout -f, reset --hard, clean; prima di modificare un file di config fanne una copia <file>.kb-backup (solo se non esiste già); non mostrare mai token o chiavi. Se un passo fallisce fermati e riportami l'errore così com'è.

1. SISTEMA. Capisci OS, versione di Node.js e git (servono Node 20+ e git: se mancano chiedimi conferma e installali; Windows: winget install OpenJS.NodeJS.LTS / Git.Git) e se c'è un proxy aziendale.

2. CLONE. Cerca TUTTI i clone di knowledge-base (home, radici dei dischi come D:\ ed E:\, /DATA/AppData/my-knowledge-base) e guarda a quale puntano le config MCP degli agenti.
   - Più clone: usa come principale quello su main a cui puntano le config (se nessuno, il più recente). Gli altri non toccarli: elencameli.
   - Nessun clone: git clone https://github.com/Cheic1/knowledge-base.git ~/knowledge-base

3. INSTALLA. Nella cartella del clone principale, senza fare pull/checkout/stash a mano prima:
     git fetch origin
     git show origin/main:scripts/bootstrap.mjs > <cartella temporanea>/kb-bootstrap.mjs
     node <cartella temporanea>/kb-bootstrap.mjs <RUOLO>
   - "modifiche locali a file tracciati": mostrami l'elenco e aspetta.
   - errore di rete/proxy: git config http.proxy "" solo per questo repo (in PowerShell: cmd /c 'git config http.proxy ""') e rilancia.
   - con --role client: nel .env del clone serve KB_TOKEN=...; se manca chiedimelo.
   Annota quali agenti l'installazione dice di aver collegato.

4. INVENTARIO. Elenca i programmi compatibili con MCP installati davvero (comando nel PATH o app installata; una config senza programma non conta): Claude Code, OpenCode CLI/Desktop, Hermes, Gemini CLI, Codex CLI, VS Code (mcp.json utente) e le sue estensioni Cline/Roo/Continue/Kilo, Cursor, Windsurf, Zed, Claude Desktop, Antigravity IDE e CLI agy (~/.gemini/**/mcp_config.json), LM Studio, e ogni altro client MCP che trovi.

5. COLLEGA QUELLI MANCANTI. Per ogni programma del passo 4 che l'installazione NON ha collegato, aggiungi nella sua config MCP un server "agentmemory" identico a quello che l'installazione ha scritto per Claude Code o OpenCode (stesso comando e stesse variabili: su Windows command "cmd" con args ["/c","npx","-y","@agentmemory/mcp"], su Linux/macOS "npx" con ["-y","@agentmemory/mcp"]; env AGENTMEMORY_URL come scritto dall'installazione, più AGENTMEMORY_SECRET solo se c'è). Formati:
   - Gemini CLI ~/.gemini/settings.json, Claude Desktop claude_desktop_config.json, Cline cline_mcp_settings.json (tutti i file che trovi), Antigravity mcp_config.json, Cursor ~/.cursor/mcp.json, Windsurf ~/.codeium/windsurf/mcp_config.json: chiave "mcpServers" -> {command, args, env}
   - VS Code mcp.json: chiave "servers" -> {type:"stdio", command, args, env}
   - Codex ~/.codex/config.toml: blocco [mcp_servers.agentmemory] con command, args, [mcp_servers.agentmemory.env]
   Tocca SOLO la voce agentmemory: tutti gli altri server (matlab, browser_mcp, ...) restano identici. Se un file non è JSON valido non toccarlo e dimmelo. Se trovi voci agentmemory o llm-wiki che puntano a un altro clone o a un indirizzo che risponde 401, dimmelo (agentmemory sostituiscila con quella nuova, llm-wiki lasciala).

6. VERIFICA. Dimmi di riavviare gli agenti e le app. Poi:
   a) se esiste esegui node scripts/kb.mjs test, altrimenti node scripts/kb.mjs status;
   b) salva con memory_save la memoria "kb-test <nome macchina> <data>" e ritrovala con memory_smart_search;
   c) per le CLI installate prova la KB in modalità non interattiva, per esempio
      claude -p "usa memory_smart_search per cercare kb-test e dimmi cosa trovi"
      gemini -p "usa memory_smart_search per cercare kb-test e dimmi cosa trovi"
      opencode run "usa memory_smart_search per cercare kb-test e dimmi cosa trovi"
      e controlla se compaiono anche memorie kb-test di altre macchine.

Alla fine riportami una tabella: programma | collegato da (installazione / a mano / no) | file config | prova (ok / errore / da provare a mano) | note. Poi: OS, clone principale e clone ignorati, ruolo, eventuale copia di data/, output di test o status, e memorie kb-test viste da altre macchine.
```

Problemi comuni e codici di errore: [README](README.md#problemi-comuni).
Flusso e casi di errore dell'installazione: [docs/flusso-installazione.md](docs/flusso-installazione.md).
