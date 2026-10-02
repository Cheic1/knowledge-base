# Memorie condivise tra PC

Non c'è un server centrale: ogni PC fa girare il **proprio agentmemory locale** e
`scripts/memory-sync.py` tiene allineate le memorie passando da questo repo.

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
python3 scripts/memory-sync.py              # sync completo (default)
python3 scripts/memory-sync.py --dry-run    # mostra cosa importerebbe
python3 scripts/memory-sync.py export       # solo scrive il proprio file
python3 scripts/memory-sync.py import       # solo importa dagli altri
```

| Variabile | Default | |
|-----------|---------|--|
| `KB_MEMORY_URL` | `http://127.0.0.1:3111` | agentmemory di questo PC |
| `AGENTMEMORY_SECRET` | — | token Bearer, se agentmemory lo richiede |
| `KB_SYNC_NODE` | hostname | nome del file di questo PC |
| `KB_SYNC_DIR` | — | cartella OneDrive/share al posto di git (come `--dir`) |

## Automatico ogni 15 minuti

Linux/macOS (`crontab -e`):

```
*/15 * * * * cd /percorso/knowledge-base && python3 scripts/memory-sync.py >> /tmp/memory-sync.log 2>&1
```

Windows (Utilità di pianificazione, da PowerShell):

```powershell
schtasks /Create /SC MINUTE /MO 15 /TN "KB memory-sync" `
  /TR "python C:\percorso\knowledge-base\scripts\memory-sync.py"
```

Il PC deve poter fare `git push` senza password (chiave SSH o credential manager).

## OneDrive o cartella condivisa

Stessa logica, senza git: ogni PC scrive il proprio file nella cartella.

```bash
python3 scripts/memory-sync.py --dir "~/OneDrive/kb-memories"
python3 scripts/memory-sync.py --dir "//server/share/kb-memories"
```

Funziona, ma si perde lo storico e OneDrive può creare copie "in conflitto"
se due PC scrivono lo stesso file (qui non succede, ognuno ha il suo).

## Limiti

- Le **cancellazioni non si propagano**: un record cancellato su un PC torna dagli altri.
- Tutti i PC devono avere **la stessa versione di agentmemory** (l'export ha un campo `version`).
- Il contenuto delle memorie finisce nel repo: tienilo privato e non salvare segreti in memoria.
