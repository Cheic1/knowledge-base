# Memorie condivise tra PC

Non c'è un server centrale: ogni PC fa girare il **proprio agentmemory locale** e
`scripts/memory-sync.mjs` (solo Node, niente Python) tiene allineate le memorie passando da questo repo.

Il DB live (`data/state_store.db`) non va mai sincronizzato, né con git né con
OneDrive o una share: è binario e scritto di continuo, due copie si corrompono.
Si sincronizzano gli **export JSON**, un file per PC:

```
memories/sync/<nome-pc>.json   ← lo scrive solo quel PC, quindi git non va mai in conflitto
```

Ad ogni `sync`: `git pull` → importa dagli altri file ciò che manca o è più recente
(per `updatedAt`) → riscrive il proprio file → commit + push solo di quel file.

## Uso

```bash
node scripts/memory-sync.mjs              # sync completo (default)
node scripts/memory-sync.mjs --dry-run    # mostra cosa importerebbe
node scripts/memory-sync.mjs export       # solo scrive il proprio file
node scripts/memory-sync.mjs import       # solo importa dagli altri
```

| Variabile | Default | |
|-----------|---------|--|
| `KB_MEMORY_URL` | `http://127.0.0.1:3111` | agentmemory di questo PC |
| `AGENTMEMORY_SECRET` | — | token Bearer, se agentmemory lo richiede |
| `KB_SYNC_NODE` | hostname | nome del file di questo PC |
| `KB_SYNC_DIR` | — | cartella OneDrive/share al posto di git (come `--dir`) |

## Memorie degli altri agenti

`scripts/import-agent-memories.mjs` cerca sul PC le memorie "native" degli agenti
e le salva in agentmemory, così ogni agente collegato via MCP le ritrova e
`memory-sync` le porta sugli altri PC.

| Agente | Cosa legge |
|--------|------------|
| Claude Code | `~/.claude/CLAUDE.md`, `~/.claude/projects/*/memory/`, `CLAUDE.md` nei progetti |
| Codex / OpenCode | `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md`, `AGENTS.md` nei progetti |
| Hermes | `~/.hermes/memories/MEMORY.md`, `USER.md`, `~/.hermes/SOUL.md` |
| Cursor | `~/.cursor/rules/`, `.cursor/rules/` e `.cursorrules` nei progetti |
| Copilot | `.github/copilot-instructions.md`, `.github/instructions/` |
| Gemini, Windsurf, Cline | `GEMINI.md`, `.windsurfrules`, `.clinerules` e le cartelle globali |

```bash
node scripts/import-agent-memories.mjs --dry-run           # cosa importerebbe
node scripts/import-agent-memories.mjs --root ~/progetti    # cerca anche lì (ripetibile)
```

- I file sono spezzati per titoli `##`. Un blocco già importato e invariato non viene
  rimandato (stato in `~/.agentmemory/imported-agent-memories.json`); uno modificato
  diventa la nuova versione della memoria precedente.
- I blocchi che sembrano contenere **segreti** (API key, token, chiavi private) sono saltati.
- È un import a senso unico: agentmemory non riscrive i file degli agenti. Gli agenti
  restano allineati perché leggono tutti la stessa memoria via MCP.

## Automatico

```bash
node scripts/schedule-memory-sync.mjs install --every 15 --claude-hooks
node scripts/schedule-memory-sync.mjs status
node scripts/schedule-memory-sync.mjs uninstall
```

- **Windows**: due attività nell'Utilità di pianificazione ("KB memory-sync" ogni N minuti
  e "KB memory-sync logon" all'accesso), lanciate tramite `wscript` senza aprire finestre.
- **Linux/macOS**: due righe nella crontab dell'utente (ogni N minuti e `@reboot`),
  marcate `# kb-memory-sync`; le altre righe restano intatte.
- **`--claude-hooks`**: aggiunge in `~/.claude/settings.json` due hook (SessionStart e
  SessionEnd) che lanciano la sync in background: l'agente parte con le memorie degli
  altri PC e a fine sessione pubblica le sue. Gli altri hook (es. plugin agentmemory)
  restano; backup in `settings.json.bak-kb-sync`.

Ogni giro esegue `scripts/kb-auto-sync.mjs`: import delle memorie degli altri agenti,
poi `memory-sync`. Scrive solo nel log `~/.agentmemory/memory-sync.log`; se agentmemory
è spento salta il giro. Le variabili (`AGENTMEMORY_SECRET`, `KB_SYNC_DIR`, ...) che lo
scheduler non vede le legge da `.env` nella cartella del repo.
Il PC deve poter fare `git push` senza password (chiave SSH o credential manager).

Per configurare un PC nuovo da zero con un agente, vedi la sezione
"PC autonomo" in [PROMPT-INSTALL.md](../PROMPT-INSTALL.md).

## OneDrive o cartella condivisa

Stessa logica, senza git: ogni PC scrive il proprio file nella cartella.

```bash
node scripts/memory-sync.mjs --dir "~/OneDrive/kb-memories"
node scripts/memory-sync.mjs --dir "//server/share/kb-memories"
```

Funziona, ma si perde lo storico e OneDrive può creare copie "in conflitto"
se due PC scrivono lo stesso file (qui non succede, ognuno ha il suo).

## Autore delle memorie (`kbAuthor`)

Ogni memoria nei file di sync porta `kbAuthor`, il PC dove è nata: serve ai pesi di
affidabilità (`scripts/memory-trust.mjs`). Lo timbra la sync al primo export e poi
viaggia col record; un PC che conosce l'autore lo passa agli altri.
Le memorie scambiate prima di questa regola, o arrivate da un import, restano
`sconosciuto` finché il PC autore non le rivendica al suo primo sync.
La sync committa anche `memories/trust/votes/<nome-pc>.jsonl`, se esiste.

## Memorie personali

Una memoria con il concetto `personale` (o con un progetto che inizia per `personale`)
resta solo sul PC dove è nata: la sync non la esporta. Per salvarne una dall'agente:
`memory_save` con `concepts: ["personale"]`.

## Limiti

- Le **cancellazioni non si propagano**: un record cancellato su un PC torna dagli altri.
- Tutti i PC devono avere **la stessa versione di agentmemory** (l'export ha un campo `version`).
- Il contenuto delle memorie finisce nel repo: tienilo privato e non salvare segreti in memoria.
