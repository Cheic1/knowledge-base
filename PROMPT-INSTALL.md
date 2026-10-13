# 📋 Prompt Copia e Incolla

Un solo metodo di installazione per ogni macchina: `scripts/bootstrap.mjs`, che porta il
clone su `main` in modo sicuro e lancia `scripts/kb.mjs install`. Serve solo **Node.js 20+
e git**: niente bash, niente Python sui PC.

## Ruoli

| Ruolo | Per chi | agentmemory | Memorie | Agenti cablati su |
|-------|---------|-------------|---------|-------------------|
| `server` | il server sempre acceso (oggi `192.168.68.55`, domani la VM aziendale) | locale, **DB primario** | backup sul branch orfano `kb-data` | agentmemory locale |
| `client` | PC sviluppatore che usa il server centrale | **nessuno** | nessuna sync | server centrale (`config/endpoint.env` + `KB_TOKEN` in `.env`) |
| `standalone-dev` | PC sviluppatore autonomo/offline (default, ex `pc`) | locale | sync P2P via `kb-data` ogni 15 min | agentmemory locale |

I PC dei colleghi Windows senza Node non installano nulla di questo repo: useranno il
launcher di OpenCode Desktop (Fase 4, `client-dist/`).

```
node scripts/bootstrap.mjs                                  # standalone-dev
node scripts/bootstrap.mjs --role client                    # usa il server centrale
node scripts/bootstrap.mjs --role server --wiki-search      # server Linux, con la ricerca wiki (qmd)
node scripts/kb.mjs status                                  # controllo
node scripts/kb.mjs connect                                 # solo ricablare gli agenti
```

Cosa fa `install`:
- `server` / `standalone-dev`: installa agentmemory alla versione fissata in `package.json`,
  lo avvia e lo fa ripartire da solo (systemd sul server, Utilità di pianificazione su
  Windows, crontab altrove), cabla Claude Code, OpenCode, Hermes, Cursor e VS Code su
  `http://127.0.0.1:3111`, pianifica la sync delle memorie ogni 15 minuti (e a ogni sessione
  di Claude Code) e fa la prima sync. Le memorie stanno nel worktree `.kb-data/` (branch
  orfano `kb-data`), mai su `main`.
- `client`: niente agentmemory locale e niente sync; cabla gli agenti sul server di
  `config/endpoint.env` con il `KB_TOKEN` del `.env` del clone, e pianifica solo il controllo
  degli aggiornamenti.

Aggiornamenti: `kb.mjs update` gira da solo, al massimo una volta ogni 24 ore
(`KB_UPDATE_HOURS` in `.env`). Fa solo fast-forward di `main`: se nel clone ci sono modifiche
a file tracciati o commit locali **non aggiorna** e lo scrive in `~/.agentmemory/kb-update.log`.
Sul server i riavvii dei servizi avvengono nella finestra di manutenzione notturna
(`kb-maintenance.timer`, ore `KB_MAINTENANCE_AT`, default 03:00) o con
`node scripts/kb.mjs update --apply-now`; il kb-proxy lascia finire le richieste in corso.

## Prompt per l'agente della macchina

Vale per qualsiasi sistema e agente. Per un PC che deve usare il server centrale cambia
`<RUOLO>` in `--role client`; sul server Linux in `--role server --wiki-search`; per un
PC autonomo lascialo vuoto.

```
Installa la knowledge base Cheic1/knowledge-base su questo computer.

1. Capisci il sistema (Windows, Linux o macOS). Servono Node.js 20+ e git: se mancano chiedimi conferma e installali (Windows: winget install OpenJS.NodeJS.LTS / Git.Git; macOS: brew install node git; Linux: il gestore pacchetti o nvm).
2. Cerca se il repo e' gia' clonato (cartella knowledge-base nella home, su altri dischi, E:\knowledge-base, /DATA/AppData/my-knowledge-base).
   - SE ESISTE: entra nella cartella ed esegui, senza fare altro prima (niente checkout, pull o stash a mano):
       git fetch origin
       git show origin/main:scripts/bootstrap.mjs > <cartella temporanea>/kb-bootstrap.mjs
       node <cartella temporanea>/kb-bootstrap.mjs <RUOLO>
   - SE NON ESISTE: git clone https://github.com/Cheic1/knowledge-base.git ~/knowledge-base, poi dalla cartella: node scripts/bootstrap.mjs <RUOLO>
   Il bootstrap ritrova da solo il clone gia' installato, lo porta su main in modo sicuro (salva una copia di data/, il database di agentmemory, e non lo tocca), poi lancia l'installazione.
3. Solo con --role client: il file .env nella cartella del repo deve contenere KB_TOKEN=<token>. Se manca chiedimelo (me lo da' chi gestisce il server con: node scripts/kb.mjs token).
4. Se il bootstrap si ferma con un errore, riportamelo cosi' com'e': non provare a "sistemare" con checkout -f, reset --hard, clean o cancellando cartelle.
   - "modifiche locali a file tracciati": mostrami l'elenco e aspetta.
   - errore di rete/proxy aziendale: git config http.proxy "" solo per questo repo e rilancia.
   - il push chiede una password: configura Git Credential Manager o una chiave SSH e rilancia lo stesso comando (e' ripetibile).
5. Dimmi di riavviare l'agente. Poi verifica con node scripts/kb.mjs status e prova a salvare una memoria di prova e a ritrovarla con memory_smart_search.

Non cancellare nulla. Alla fine riportami: sistema, cartella del repo, ruolo, percorso della copia di data/ se e' stata fatta, output di status e agenti collegati.
```

Il diagramma delle scelte e dei casi di errore è in [docs/flusso-installazione.md](docs/flusso-installazione.md).
Per installare a mano, passo per passo: [docs/installazione-manuale.md](docs/installazione-manuale.md).

## ⚠️ Problemi noti (PC Windows / rete aziendale)

| Sintomo | Causa | Soluzione |
|---------|-------|-----------|
| `git fetch`/`push` resta appeso o `CONNECT tunnel failed, response 502` | proxy aziendale (`http.proxy` globale) che non lascia passare GitHub | disattivalo **solo per questa repo**: `git config http.proxy ""`. In PowerShell le `""` vengono scartate: usa `cmd /c 'git config http.proxy ""'`. Va rifatto su ogni clone |
| `kb.mjs status` dice "l'aggiornamento automatico e' fermo" | file tracciati modificati nel clone | `git status` per vederli; salvali (`git stash`) o scartali tu: l'aggiornamento riparte da solo |
| agentmemory non parte: `127.0.0.1:3111 already in use`, ma `/health` non risponde | un'istanza precedente inceppata tiene la porta | ferma i processi vecchi e rilancia `node scripts/kb.mjs install`. PowerShell: `Get-NetTCPConnection -LocalPort 3111 \| % { Stop-Process -Id $_.OwningProcess -Force }`; Linux/macOS: `kill $(lsof -ti :3111)` |
| client: `401` dal server | `KB_TOKEN` mancante o vecchio nel `.env` del clone | chiedi il token attuale e rilancia `node scripts/kb.mjs connect` |
| Clone interrotto lascia una cartella con `.git` vuoto | rete instabile o proxy | cancella la cartella e riclona dopo aver sistemato il proxy |

Il **DB live** di agentmemory (`state_store.db`) e il **repo git** possono stare in una
cartella OneDrive solo se nessun altro PC usa quella stessa cartella: OneDrive non
gestisce bene file scritti di continuo né i file di `.git`. Per condividere le memorie
tra PC usa il server centrale o `memory-sync.mjs`.
