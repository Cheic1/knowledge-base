# Alternative ad agentmemory: classifica e piano di test

Aggiornato al 2026-10-02. Stelle, versioni e funzioni sono prese dai README dei progetti
e da due confronti pubblici di agosto 2026 (link in fondo); i numeri di recall dichiarati
dai progetti **non sono confrontabili tra loro** (dataset e metriche diverse), per questo c'è
il banco di prova in [`bench/memory/`](../bench/memory/README.md).

## Criteri e pesi

Il caso d'uso è il nostro: più PC (casa e lavoro), agenti diversi (OpenCode, Hermes, Cursor,
VS Code), **nessun server centrale per ora**, memorie da tenere allineate.

| Criterio | Peso | Cosa misura |
|---|---|---|
| Sync tra PC | 25% | Come si allineano le memorie tra PC **senza** server centrale (git, cartella, P2P) |
| Locale / self-hosted | 25% | Gira tutto in locale, senza cloud e con poche dipendenze |
| Qualità del recall | 20% | Ricerca semantica, benchmark pubblici, prove nel banco |
| Compatibilità MCP | 15% | Server MCP stdio/HTTP, agenti supportati |
| Maturità | 15% | Release, manutenzione, stabilità, comunità |

Voti da 1 a 5, punteggio = media pesata × 20 (max 100).

## Classifica

| # | Sistema | Sync | Locale | Recall | MCP | Maturità | **Punti** |
|---|---|---|---|---|---|---|---|
| 1 | **basic-memory** | 4 | 5 | 4 | 5 | 4 | **88** |
| 2 | **Engram** | 5 | 5 | 2 | 5 | 4 | **85** |
| – | *agentmemory (attuale, riferimento)* | *3* | *5* | *5* | *5* | *3* | *84* |
| 3 | **mcp-memory-service** | 4 | 4 | 4 | 5 | 3 | **80** |
| 4 | **codemem** | 5 | 5 | 3 | 4 | 2 | **80** |
| 5 | **MemPalace** | 2 | 5 | 5 | 5 | 3 | **79** |
| 6 | Supermemory | 4 | 2 | 4 | 5 | 4 | 73 |
| 7 | MCP server-memory (ufficiale) | 3 | 5 | 1 | 5 | 4 | 71 |
| 8 | claude-mem | 2 | 4 | 4 | 4 | 4 | 70 |
| 9 | Hindsight | 2 | 3 | 5 | 4 | 4 | 69 |
| 10 | Cognee | 2 | 4 | 4 | 3 | 4 | 67 |
| 11 | Graphiti (Zep) | 2 | 3 | 4 | 4 | 4 | 65 |
| 12 | Mem0 (self-hosted) | 2 | 3 | 4 | 3 | 4 | 62 |

Il voto "Sync" è dato **per la situazione attuale** (niente server). Se arriva la VM aziendale,
Hindsight, mcp-memory-service, Engram (cloud serve) e agentmemory salgono, perché diventano
"un server, tutti i PC collegati".

## Schede

### 1. basic-memory — [basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory)
- ~3,6k stelle, AGPL-3.0, v0.22.1, Python (`uvx basic-memory mcp`).
- Le memorie sono **file Markdown** + indice SQLite; ricerca ibrida full-text + vettori
  (FastEmbed, locale) con reranking opzionale. 20+ tool MCP.
- **Sync:** è una cartella di Markdown: va in git (o Syncthing/OneDrive) e si fa merge come la
  wiki. Dopo un pull, `basic-memory reindex`. Cloud a pagamento opzionale, non serve.
- **Perché è in testa:** è l'unica che si sposa con quello che abbiamo già (wiki Obsidian in
  git): niente export JSON, niente DB binario da non toccare.
- **Contro:** non cattura da sola le sessioni (l'agente deve decidere di scrivere note);
  AGPL (irrilevante per uso personale).

### 2. Engram — [Gentleman-Programming/engram](https://github.com/Gentleman-Programming/engram)
- ~6,7k stelle, MIT, v1.20, **singolo binario Go** senza dipendenze, SQLite + FTS5.
- `engram setup opencode|cursor|vscode-copilot|claude-code|...` cabla gli agenti; ~19 tool MCP
  (`mem_save`, `mem_search`, `mem_context`, `mem_session_summary`, ...), TUI, API HTTP,
  rilevamento conflitti, export verso vault Obsidian.
- **Sync:** nativo via git: `engram sync` esporta chunk compressi in `.engram/`, si
  committano, sull'altro PC `engram sync --import`. È esattamente quello che fa il nostro
  `memory-sync.py`, ma già fatto e mantenuto. In più `engram cloud serve` (Postgres, token)
  è un server self-hosted per quando avremo la VM.
- **Contro:** solo full-text, niente vettori. Nel banco: 0% sulle domande parafrasate con la
  ricerca di default (AND), 80% con `match_mode: any` ma con più rumore.

### agentmemory (attuale) — [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory)
- ~28,9k stelle, Apache-2.0, v0.9.x (pre-1.0). Dichiara 95,2% R@5 su LongMemEval-S.
- Recall migliore della lista sulla carta e cattura automatica; i problemi sono
  operativi (iii che riscrive la config, proxy, DB binario) e la sync tra PC fatta a mano.
- Ha strade di sync non ancora provate, vedi "Altri metodi di agentmemory" sotto.

### 3. mcp-memory-service — [doobidoo/mcp-memory-service](https://github.com/doobidoo/mcp-memory-service)
- ~2k stelle, Apache-2.0, v11.13 (settembre 2026), molto attivo; ad agosto 2026 lo sviluppo
  si è spostato su Codeberg.
- sqlite-vec locale, grafo, consolidamento, API REST (76 endpoint), MCP per 25+ client.
  Benchmark pubblicati: LongMemEval 80,4% R@5.
- **Sync:** backend "hybrid" = SQLite locale + sync in background su Cloudflare D1
  (piano gratuito). Funziona senza server nostro, ma i dati passano da Cloudflare.

### 4. codemem — [kunickiaj/codemem](https://github.com/kunickiaj/codemem)
- Progetto piccolo (~70 stelle, MIT) ma pensato **proprio per OpenCode** (e Claude Code, Codex).
- **Sync P2P tra i propri PC** + coordinatore self-hosted opzionale per reti diverse
  (casa/lavoro). Recall non documentato. Outsider da provare se la sync P2P regge.

### 5. MemPalace — [MemPalace/mempalace](https://github.com/MemPalace/mempalace)
- ~59k stelle, MIT, v3.10, Python, 45 tool MCP, backend pluggable (Chroma, SQLite, Postgres…).
- Recall dichiarato altissimo (96,6% R@5 LongMemEval senza LLM), ma va verificato: il progetto
  stesso avverte del rischio di "teaching to the test".
- **Sync:** nessuna. Con backend Postgres diventa un buon candidato per il server centrale.

### 6. Supermemory — [supermemoryai/supermemory-mcp](https://github.com/supermemoryai/supermemory-mcp)
- MIT, nato hosted (Cloudflare Workers). Sync gratis perché è cloud; il self-host esiste ma
  su Cloudflare. Fuori dal requisito "locale".

### 7. MCP server-memory (ufficiale) — `@modelcontextprotocol/server-memory`
- Il server di riferimento: grafo in un file JSONL, ricerca per sottostringa. Nel banco
  **3%** di recall: utile solo come baseline minima.

### 8. claude-mem — [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- ~95k stelle, Apache-2.0, v13. Hook su tutto il ciclo di sessione, SQLite + Chroma, viewer web.
- Nato per Claude Code (ora anche OpenCode, Codex, Gemini, Hermes). Serve un LLM per
  l'"observer". Sync solo con il cloud a pagamento.

### 9. Hindsight — [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight)
- MIT, molto attivo, SOTA dichiarato su LongMemEval. Docker + Postgres/pgvector + LLM
  obbligatorio (va bene Ollama). MCP HTTP per "memory bank".
- È un **server**: perfetto per la VM aziendale, scomodo in locale su ogni PC.

### 10. Cognee — [topoteretes/cognee](https://github.com/topoteretes/cognee)
- ~31k stelle, Apache-2.0, v1.6. Knowledge graph + vettori, code graph, `cognee-mcp`,
  funziona anche senza LLM. Più un motore RAG/grafo che una memoria per agenti: potrebbe
  affiancare la wiki più che sostituire agentmemory.

### 11. Graphiti (Zep) — [getzep/graphiti](https://github.com/getzep/graphiti)
- ~29k stelle, Apache-2.0. Grafo temporale (fatti con validità nel tempo), MCP in Docker.
  Richiede Neo4j/FalkorDB e un LLM con structured output: pesante per ogni PC.

### 12. Mem0 (self-hosted) — [mem0ai/mem0](https://github.com/mem0ai/mem0)
- Il più noto, ma a luglio 2026 il percorso locale OpenMemory è stato rimosso dal monorepo.
  In self-hosting servono Qdrant + Neo4j + LLM e un server MCP della community
  (es. `mem0-mcp-selfhosted`). Sconsigliato per il nostro caso.

Scartati: Letta (framework di agenti, non memoria da collegare a OpenCode), memento-mcp
(abbandonato, ultimo commit maggio 2025), Mnemoverse (solo hosted).

## Altri metodi di agentmemory da provare

Prima di cambiare sistema conviene provare le strade di sync che agentmemory ha già:

| Metodo | Come | Cosa verificare |
|---|---|---|
| A. Export/import JSON via git (attuale, PR #2) | `scripts/memory-sync.py` | Già funzionante; le cancellazioni non si propagano |
| B. `memory_mesh_sync` (P2P tra istanze) | tool MCP esteso, istanze che si vedono in rete | Funziona tra casa e lavoro? Serve VPN? Documentazione scarsa |
| C. Snapshot versionati | `memory_snapshot_create` + commit dello snapshot | Ripristino su un altro PC, dimensione, conflitti |
| D. Server unico + token | `AGENTMEMORY_URL` + `AGENTMEMORY_SECRET` | Solo quando c'è la VM; elimina la sync |

## Piano di test

Il banco è in [`bench/memory/`](../bench/memory/README.md): uno script senza dipendenze che
parla MCP con qualsiasi server, salva 20 fatti finti e fa 30 domande (20 parafrasate,
8 per parole chiave, 2 tra progetti), misurando recall, rumore e latenza.

**Fase 1, recall (un PC, ~1 ora).** Per agentmemory (istanza di test) e i primi cinque:
```bash
python3 bench/memory/mcp_bench.py list-tools <sistema>   # controlla i nomi dei tool
python3 bench/memory/mcp_bench.py run <sistema>
python3 bench/memory/mcp_bench.py compare
```

**Fase 2, sync tra due PC.** Sul PC A `run <sistema>`, poi la sync propria del sistema,
poi sul PC B `run <sistema> --skip-seed`. Il recall sul PC B deve essere uguale a quello del PC A.

| Sistema | Sync da provare |
|---|---|
| basic-memory | cartella delle note in git → `git pull` → `basic-memory reindex` |
| Engram | `engram sync` → commit `.engram/` → `engram sync --import` |
| mcp-memory-service | backend `hybrid` con Cloudflare D1 |
| codemem | sync P2P (e coordinatore per casa ↔ lavoro) |
| agentmemory | metodi A, B, C sopra |

**Fase 3, uso reale.** I due migliori collegati a OpenCode per una settimana ciascuno, con
la stessa configurazione MCP di `kb.mjs connect`.

### Prime prove già fatte (container cloud, 2026-10-02)

Senza accesso a HuggingFace, quindi **senza modelli di embedding**: misurano solo la parte
full-text. Vanno rifatte in locale.

| sistema | recall | parafrasi | keyword | cross | rumore |
|---|---|---|---|---|---|
| engram (default, AND) | 23% | 0% | 88% | 0% | 0.0 |
| engram (`match_mode: any`) | 87% | 80% | 100% | 100% | 3.0 |
| basic-memory (solo text) | 67% | 65% | 88% | 0% | 3.0 |
| server-memory ufficiale | 3% | 0% | 12% | 0% | 0.0 |

Con soli 20 fatti il recall è facile; il "rumore" (altri fatti nella risposta) dice quanto
il sistema stia "pescando a strascico".

## Fonti
- [13 Memory MCP Servers Compared (2026)](https://mnemoverse.com/docs/library/memory-mcp-servers-compared)
- [I Opened All Thirteen Memory MCP Servers… (DEV, 2026)](https://dev.to/izgorodin/i-opened-all-thirteen-memory-mcp-servers-every-public-signal-i-trusted-was-wrong-1i1g)
- [Best AI Agent Memory Frameworks in 2026 (Atlan)](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)
- README dei singoli progetti linkati nelle schede.
