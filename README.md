# 🧠 My Knowledge Base

Knowledge base personale ibrida per tutti i progetti e le idee.

> **Installazione su una macchina nuova:** `node scripts/bootstrap.mjs` porta il clone
> su main in sicurezza e lancia `scripts/kb.mjs install`, che installa secondo il ruolo
> (`server`, `client`, `standalone-dev`), cabla gli agenti e attiva l'aggiornamento automatico. Dettagli e prompt da incollare in [PROMPT-INSTALL.md](PROMPT-INSTALL.md).

## 🎯 Struttura

```
knowledge-base/
├── config/endpoint.env      # indirizzo del server centrale (unico punto da cambiare)
├── scripts/
│   ├── bootstrap.mjs        # primo passo dell'installazione (ritrova/porta il clone su main)
│   ├── kb.mjs               # install | connect | update | maintenance | token | status
│   ├── kb-proxy.js          # proxy LAN con token (8311 API, 8313 viewer, 8318 wiki)
│   ├── memory-sync.mjs      # export/import delle memorie sul branch kb-data
│   └── lib/                 # moduli condivisi (env, cablaggio agenti, branch dati)
├── systemd/                 # unit utente del server (agentmemory, kb-proxy, manutenzione)
├── wiki/                    # LLM Wiki: schema.md, purpose.md, wiki/ (pagine)
├── projects/                # note per progetto
├── memories/README.md       # come funziona la sync delle memorie
├── test/                    # node --test
├── legacy/                  # script e guide del primo setup, non piu' usati
└── .kb-data/                # (non in git) worktree del branch orfano kb-data: dati di sync/backup
```

## 🧭 Ruoli delle macchine

| Ruolo | Quando | Come |
|-------|--------|------|
| **server** | la macchina sempre accesa che tiene il DB primario (oggi `192.168.68.55`, domani la VM aziendale) | agentmemory locale + kb-proxy LAN con token, unit systemd, manutenzione notturna |
| **client** | PC che usa il server centrale | niente agentmemory locale ne' sync: gli agenti puntano a `config/endpoint.env` con `KB_TOKEN` |
| **standalone-dev** | PC autonomo/offline (default) | agentmemory locale; memorie allineate con `scripts/memory-sync.mjs` sul branch `kb-data` |

Installazione e prompt da incollare nell'agente: [`PROMPT-INSTALL.md`](PROMPT-INSTALL.md).
Passo per passo a mano: [`docs/installazione-manuale.md`](docs/installazione-manuale.md).
Sync delle memorie: [`memories/README.md`](memories/README.md).

```bash
node scripts/bootstrap.mjs [--role server|client|standalone-dev]   # installa (idempotente)
node scripts/kb.mjs status                                          # stato
node scripts/kb.mjs connect                                         # ricabla gli agenti
npm test                                                            # test (node --test)
```

## 📚 Componenti

### LLM Wiki (Knowledge Base Strutturata)
- **Scopo**: Knowledge base statica e ricercabile
- **Uso**: Paper tecnologici, documentazione, note strutturate
- **Tool**: nashsu/llm_wiki (desktop app), ricerca locale con qmd (`scripts/wiki-search.sh`)
- **Sincronizzazione**: Git (`wiki/` su main)

### agentmemory (Memoria Operativa)
- **Scopo**: Memoria automatica delle sessioni di coding
- **Uso**: Contesto operativo, decisioni, bug trovati
- **Tool**: agentmemory (MCP server), versione fissata in `package.json`
- **Sincronizzazione**: export JSON per macchina sul branch orfano `kb-data`
  (worktree `.kb-data/`), mai su `main`; il DB live `data/` non si sincronizza mai

### Git
- `main`: solo codice e documentazione. Le macchine si aggiornano da sole con
  `kb.mjs update` (solo fast-forward, mai con modifiche locali, al massimo ogni 24 h)
- `kb-data`: branch orfano con i soli dati di sync/backup, scritto dagli script

## 🔌 Integrazioni

### Collegamento (endpoint unico e cambiabile)
- **Endpoint centralizzato**: `config/endpoint.env` (`KB_API_URL`, `KB_VIEWER_URL`, `KB_WIKI_URL`)
- **Server**: unit systemd (`scripts/install-systemd.sh`, lanciato da `kb.mjs install --role server`); `./scripts/start-kb.sh status`
- **Ogni macchina**: `node scripts/kb.mjs connect` (cabla MCP negli agenti trovati)

### Agenti AI supportati
- **Claude Code**: `claude mcp add` (scope utente)
- **OpenCode**: `~/.config/opencode/opencode.json`
- **Hermes**: `~/.hermes/config.yaml`, blocco `mcp_servers:`
- **Cursor**: `~/.cursor/mcp.json`; **VS Code**: `mcp.json` utente
- **Qualsiasi agente MCP**: `MCP-CONFIG.json` come riferimento
- **Memorie native degli altri agenti** (Claude Code, Codex, Cursor, Copilot, Hermes,
  Gemini, Windsurf, Cline): importate in agentmemory con `scripts/import-agent-memories.mjs`

## 📖 Utilizzo

```bash
# Via MCP (in qualsiasi agente)
memory_smart_search "come implementare JWT"
memory_save "Ho trovato un bug in React 18 con StrictMode"

# Sync manuale delle memorie (standalone-dev e server; di solito e' automatica)
node scripts/import-agent-memories.mjs   # porta dentro CLAUDE.md, AGENTS.md, regole...
node scripts/memory-sync.mjs             # --dry-run per vedere cosa farebbe
```

## 🔒 Sicurezza

- **API keys e token**: mai committati (`.env`, permessi 600)
- **Dati sensibili**: `data/` escluso da Git
- **Accesso**: servizi su 127.0.0.1, esposti in LAN solo dal kb-proxy
  (8311/8313/8318) con token `KB_TOKEN`; HTTP in chiaro: non esporre a internet
- **Memorie su GitHub**: il branch `kb-data` contiene le memorie in chiaro: il repo
  deve restare privato. L'import salta i blocchi che sembrano segreti
- **Aggiornamento automatico**: chi puo' scrivere su `main` esegue codice su tutte le
  macchine installate: dai accesso in scrittura solo a chi gestisce la KB

## 📝 Licenza

Uso personale. Non distribuire.