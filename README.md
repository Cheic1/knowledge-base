# 🧠 Knowledge Base per agenti

Una memoria condivisa per tutti i tuoi agenti AI (Claude Code, OpenCode, Gemini CLI,
VS Code, Claude Desktop, ...) su tutte le tue macchine. Quello che un agente impara,
gli altri lo ritrovano. Si installa con un comando e si aggiorna da solo.

> Questo README descrive il comportamento della spec
> [`docs/superpowers/specs/2026-10-25-kb-tutti-agenti-design.md`](docs/superpowers/specs/2026-10-25-kb-tutti-agenti-design.md),
> in corso di implementazione.

## Installa

Serve solo **Node.js 20+ e git**. Il modo più semplice: incolla nel tuo agente il prompt
di [`PROMPT-INSTALL.md`](PROMPT-INSTALL.md). A mano:

```bash
git clone https://github.com/Cheic1/knowledge-base.git ~/knowledge-base
cd ~/knowledge-base
node scripts/bootstrap.mjs                 # PC autonomo (standalone-dev)
node scripts/bootstrap.mjs --role client   # PC che usa il server centrale
node scripts/bootstrap.mjs --role server   # il server sempre acceso
```

Clone già presente? Non fare pull o checkout a mano: `git fetch origin`, poi
`git show origin/main:scripts/bootstrap.mjs > /tmp/kb-bootstrap.mjs && node /tmp/kb-bootstrap.mjs`
(su Windows al posto di `/tmp` usa `%TEMP%`).

L'installazione:
1. porta il clone su `main` senza perdere nulla e segnala eventuali clone doppi;
2. avvia agentmemory (versione fissata in `package.json`) e un job che ogni 15 minuti
   aggiorna il codice e sincronizza le memorie;
3. trova i programmi installati e aggiunge la KB alla loro config MCP, con backup e
   toccando solo le voci della KB;
4. finisce con `kb test`.

Si può rilanciare quando vuoi: non cambia ciò che è già a posto.

## Controlla

```bash
node scripts/kb.mjs test           # tabella: per ogni programma config, avvio, memoria, altre macchine
node scripts/kb.mjs test --deep    # in più fa usare la KB alle CLI con un prompt vero
node scripts/kb.mjs install --dry-run   # cosa cambierebbe, senza scrivere
```

Ogni riga rossa dice il motivo e il comando per sistemarla.

## Programmi supportati

| Programma | Dove scrive |
|---|---|
| Claude Code | `claude mcp add --scope user` |
| OpenCode (CLI e Desktop) | `~/.config/opencode/opencode.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| VS Code / Copilot | `mcp.json` utente |
| Cline | `cline_mcp_settings.json` |
| Claude Desktop | `claude_desktop_config.json` |
| Antigravity (IDE e `agy`) | `mcp_config.json` |
| Cursor, Windsurf, Codex, Hermes | i rispettivi file di config |

Vengono collegati solo i programmi installati. Uno nuovo si aggiunge con un file in
`scripts/lib/adapters/`.

## Ruoli delle macchine

| Ruolo | Per | Memorie |
|---|---|---|
| `standalone-dev` (default) | PC che lavora anche fuori casa | agentmemory locale, sync con le altre macchine via branch `kb-data` |
| `client` | PC sempre in rete col server | nessuna copia locale: gli agenti usano il server con `KB_TOKEN` nel `.env` |
| `server` | macchina sempre accesa (`192.168.68.55`) | DB principale, proxy LAN con token, wiki |

L'indirizzo del server è solo in `config/endpoint.env`.

## Usa

Negli agenti la KB appare come server MCP `agentmemory`:

```
memory_smart_search "come abbiamo configurato il proxy aziendale"
memory_save "Su Windows npx va lanciato con cmd /c"
```

La wiki (`wiki/`) è cercabile con lo strumento `wiki-search` dove è attiva (`--wiki-search`).

## Problemi comuni

| Codice | Cosa fare |
|---|---|
| `KB-NET` | proxy aziendale: `git config http.proxy ""` solo per questo repo (PowerShell: `cmd /c 'git config http.proxy ""'`) |
| `KB-DIRTY` | file del repo modificati a mano: l'aggiornamento è fermo finché non li salvi (`git stash`) o scarti |
| `KB-401` | token mancante o vecchio: chiedi `KB_TOKEN` a chi gestisce il server e rilancia `install` |
| `KB-PORT` | porta 3111 occupata da un'istanza bloccata: ferma il processo e rilancia `install` |
| `KB-JSON` | config di un programma non valida: il file non è stato toccato, correggilo e rilancia |

Log unico: `~/.agentmemory/kb.log`. Per togliere tutto: `node scripts/kb.mjs uninstall --restore`.

## Struttura

```
scripts/kb.mjs            comando unico: install | test | update | uninstall
scripts/bootstrap.mjs     primo passo per clone nuovi o vecchi
scripts/lib/              moduli (adapters/, service, git, agentmemory, checks, ...)
config/endpoint.env       indirizzo del server
wiki/  projects/          conoscenza scritta
test/                     npm test
```

## Sicurezza

- Token e chiavi mai nel repo (`.env`, permessi 600). Il DB live `data/` non si sincronizza mai.
- Le memorie sul branch `kb-data` sono in chiaro: il repo deve restare **privato**.
- Le porte LAN chiedono il token; è HTTP in chiaro, non esporlo a internet.
- Chi può scrivere su `main` esegue codice su tutte le macchine (aggiornamento automatico):
  dai accesso in scrittura solo a chi gestisce la KB.

Uso personale. Non distribuire.
