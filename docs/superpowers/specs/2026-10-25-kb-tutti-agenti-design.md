# KB su tutti gli agenti: installazione semplice e test per ogni programma

Data: 2026-10-25 · Stato: **da approvare** · Si appoggia su: PR #13 (Fase 1)

## 1. Obiettivo

Francesco usa molti agenti e programmi su tre macchine (server di casa Linux, PC
personale Windows, PC di lavoro Windows con proxy aziendale). La knowledge base deve:

- **funzionare in tutti** i programmi compatibili con MCP presenti sulla macchina,
  trovati da soli, senza elencarli a mano;
- installarsi con **un solo comando**, sempre lo stesso, ripetibile, che non rompe nulla;
- dire **in modo trasparente** cosa ha fatto e cosa funziona, programma per programma;
- avere **codice semplice e leggibile**: pochi file, ciascuno con un compito, tutti testati.

### Cosa ha detto Francesco / cosa è assunto

| Detto | Assunto (correggibile) |
|---|---|
| "Tutti" gli agenti e programmi | Si collegano solo i client MCP **installati**; config orfane (es. Cursor senza app) ignorate salvo `--all` |
| Installazione semplice, veloce, efficace | Un comando, ripetibile; sotto 2 minuti su una macchina già installata |
| Architettura efficace, trasparente, senza problemi; codice semplificato al massimo | `kb.mjs` sotto 150 righe; nessuno script shell; un solo job pianificato |
| Approccio A (adattatori + `kb test`) | Si costruisce sopra la PR #13, che va unita prima |
| (non ha scelto il livello di test) | "Funziona" = livello **C**: vede gli strumenti, salva e ritrova, vede le memorie delle altre macchine |

### Criteri di successo

1. Su ognuna delle tre macchine, dopo il prompt di installazione, `kb test` mostra
   **verde** per ogni programma installato (livello C).
2. Sul PC personale l'installazione sistema da sola i due clone (`D:` vecchio `main`,
   `E:` branch di prova) e riporta tutte le config sul clone principale.
3. Aggiungere un programma nuovo = **un file adattatore + un file di test**, senza
   toccare `kb.mjs`.
4. `npm test` verde; nessun file `.sh` in `scripts/`; `kb.mjs` ≤ 150 righe, ogni modulo ≤ 300.
5. La ricerca wiki (qmd) funziona anche su Windows.

### Fuori da qui

- **Collaborazione tra agenti** (bacheca condivisa, passaggio di compiti): sottoprogetto 2,
  con una spec sua. Questo lavoro ne è la base: un agente non collegato non può collaborare.
- Outline, distill, launcher OpenCode Desktop: restano nelle fasi del piano aziendale.
- Obsidian, Ollama, Perplexity e simili: non sono client MCP.

## 2. Architettura

### 2.1 Comando unico `kb`

```
node scripts/kb.mjs install   [--role server|client|standalone-dev] [--dry-run] [--all] [--only id,id]
node scripts/kb.mjs test      [--quick | --deep] [--agent id] [--json]   # --quick: solo livelli 1-2; --deep: anche livello 5
node scripts/kb.mjs update                     # lo chiama tick; a mano solo se serve
node scripts/kb.mjs uninstall [--restore]
# interni / solo server
node scripts/kb.mjs tick      [--background]   # job pianificato: update + sync memorie
node scripts/kb.mjs token     [show|rotate|set VALORE]
node scripts/kb.mjs maintenance
```

- `install` sostituisce anche `connect` (è ripetibile e veloce). `connect` resta come
  alias che stampa "usa install" e lo esegue.
- `test` sostituisce `status`: stessa intestazione (repo, ruolo, versioni, ultimo
  aggiornamento) più la tabella dei programmi. `status` resta come alias di `test --quick`.
- `bootstrap.mjs` resta: è il primo passo per i clone vecchi (va letto da `origin/main`).

### 2.2 Moduli

```
scripts/
├── kb.mjs                 # solo CLI: legge gli argomenti, chiama i moduli (≤150 righe)
├── bootstrap.mjs          # invariato nella logica
├── memory-sync.mjs        # invariato (lo chiama tick)
├── import-agent-memories.mjs  # invariato (lo chiama tick)
├── kb-proxy.js            # invariato (server)
└── lib/
    ├── log.mjs            # log unico ~/.agentmemory/kb.log, errori con codice (KbError)
    ├── env.mjs            # (da #13) .env, endpoint, token
    ├── data-branch.mjs    # (da #13) worktree kb-data
    ├── git.mjs            # fetch, fast-forward, file modificati, ricerca clone
    ├── agentmemory.mjs    # versione fissata, npm install, avvio, health
    ├── service.mjs        # avvio automatico + job tick: systemd | schtasks | cron
    ├── wiki-search.mjs    # qmd in Node (sostituisce wiki-search.sh)
    ├── mcp-client.mjs     # client MCP stdio minimo (initialize, tools/list, tools/call)
    ├── checks.mjs         # i controlli di `kb test` e la tabella
    └── adapters/
        ├── index.mjs      # elenco degli adattatori
        ├── shared.mjs     # editJson, backupOnce, merge "solo le nostre chiavi"
        ├── claude-code.mjs   opencode.mjs     hermes.mjs     vscode.mjs
        ├── cursor.mjs        gemini-cli.mjs   claude-desktop.mjs
        ├── cline.mjs         antigravity.mjs  codex.mjs      windsurf.mjs
```

Ogni modulo ha un compito, si legge da solo e ha il suo `test/<nome>.test.mjs`.
I moduli con effetti (file, processi) ricevono `home`, `platform` e `run` come
parametri, così i test li provano su cartelle temporanee senza toccare la macchina.

**Si tolgono:** `kb-auto-sync.mjs` e `schedule-memory-sync.mjs` (diventano `kb tick` e
`lib/service.mjs`), `install-systemd.sh`, `start-kb.sh`, `wiki-search.sh`,
`kb-token.sh`, `connect-agent.sh`, `MCP-CONFIG.json`, `docs/installazione-manuale.md`.
`lib/agents.mjs` di #13 si scompone in `adapters/`.

**Compatibilità con le macchine già installate.** Le attività pianificate e gli hook di
Claude Code esistenti lanciano `scripts/kb-auto-sync.mjs`: dopo l'aggiornamento
automatico quel file deve esistere ancora, altrimenti l'aggiornamento si ferma per
sempre. Quindi `kb-auto-sync.mjs` resta come **shim di 3 righe** che lancia `kb tick`, e
il primo `tick` col codice nuovo riscrive pianificazione e hook con i nomi nuovi
(`KB tick`) togliendo i vecchi (`KB memory-sync`, `KB memory-sync logon`). Lo shim si
toglie in una versione successiva, quando tutte le macchine hanno fatto il passaggio.

### 2.3 Adattatori

Interfaccia, uguale per tutti:

```js
export default {
  id: 'gemini-cli',            // usato da --only e --agent
  label: 'Gemini CLI',
  detect(ctx),                 // true se il programma è installato (comando o app), non solo la config
  files(ctx),                  // file di config che tocca
  apply(ctx, servers),         // scrive le nostre voci; ritorna { file, before, after } per il diff
  read(ctx),                   // le nostre voci come sono ora (per verify e per test)
  headless: null | (prompt) => [cmd, ...args],   // solo per le CLI: prova con un prompt vero
};
```

`servers` è l'insieme dei server MCP da scrivere, deciso una volta sola dal ruolo
(`agentmemory`, e se attivi `wiki-search` e `llm-wiki`), come in `buildServers` di #13.

| Programma | File | Formato | Headless |
|---|---|---|---|
| Claude Code | `claude mcp add --scope user` | CLI | `claude -p` |
| OpenCode CLI + Desktop | `~/.config/opencode/opencode.json` | `mcp.<n> {type:local, command[], environment}` | `opencode run` |
| Hermes | `~/.hermes/config.yaml` | blocco `mcp_servers:` | – |
| VS Code / Copilot | `<Code/User>/mcp.json` | `servers.<n> {type:stdio, command, args, env}` | – |
| Cursor | `~/.cursor/mcp.json` | `mcpServers` | – |
| Gemini CLI | `~/.gemini/settings.json` | `mcpServers.<n> {command, args, env}` | `gemini -p` |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` (anche Store), `~/Library/Application Support/Claude/…` | `mcpServers` | – |
| Cline | `<Code/User>/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` e `~/.cline/data/settings/cline_mcp_settings.json` | `mcpServers` + `disabled:false` | – |
| Antigravity IDE + CLI `agy` | `~/.gemini/antigravity*/mcp_config.json` (i file trovati) | `mcpServers` | da verificare in implementazione |
| Codex | `~/.codex/config.toml` | `[mcp_servers.<n>]` (solo i nostri blocchi, come Hermes) | `codex exec` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` | – |

I percorsi esatti e i formati si confermano in implementazione con le config reali
(inventario del PC personale del 2026-10-25) e diventano i file di esempio dei test.

**Regole uguali per tutti, implementate una volta in `adapters/shared.mjs`:**

- si toccano **solo** le chiavi `agentmemory`, `wiki-search`, `llm-wiki`; il resto del
  file resta identico, ordine delle chiavi compreso (es. `matlab`, `browser_mcp`);
- backup `<file>.kb-backup` alla prima modifica, mai sovrascritto dopo;
- JSON non valido → il file non si tocca, riga rossa in `test`, si va avanti con gli altri;
- applicare due volte = nessun cambiamento (il file non viene riscritto se è uguale);
- `--dry-run` stampa il diff per file e non scrive.

## 3. `kb test`

Una riga per programma installato. I controlli sono in ordine; il primo che fallisce
ferma la riga e dà il motivo e il comando per sistemare.

| Livello | Controllo | Come |
|---|---|---|
| 1 config | le nostre voci ci sono e sono quelle attese | `adapter.read()` contro `servers` |
| 2 avvio | il server MCP parte **con il comando scritto in quella config** e risponde | `mcp-client`: `initialize` + `tools/list` contiene `memory_save` e `memory_smart_search` |
| 3 memoria | salva e ritrova una memoria di prova | `memory_save` di `kb-test <macchina> <data>` e `memory_smart_search` la trova |
| 4 macchine | vede le memorie di prova delle altre macchine | ricerca `kb-test`: almeno una di un'altra macchina negli ultimi 7 giorni (sul client: risponde il server con il token) |
| 5 agente (solo CLI, `--deep`) | l'agente stesso usa la KB | comando headless con un prompt fisso che chiede di cercare `kb-test`; verde se la risposta contiene il marcatore |

- Programmi con lo stesso comando MCP condividono la prova dei livelli 2–4: un solo
  avvio per comando diverso, così il test resta veloce (obiettivo: sotto 30 s senza `--deep`).
- Livello 4 su una macchina sola (prima installazione) è **giallo**, non rosso.
- La memoria di prova è una per macchina al giorno; se `tools/list` offre una delete,
  si cancellano quelle più vecchie di 7 giorni.
- `--json` stampa lo stesso risultato per l'agente che ha lanciato il prompt.
- La tabella finisce con lo stato dei job: ultimo `tick` riuscito e, se ci sono, gli
  errori di fila.

Esempio di output:

```
repo        D:\Francesco\Desktop\Python\knowledge-base (main, aggiornato)
ruolo       standalone-dev · agentmemory 0.9.29 su 127.0.0.1:3111 · ultimo tick 3 min fa
programma        config  avvio  memoria  macchine
Claude Code      ✓       ✓      ✓        ✓
OpenCode         ✓       ✓      ✓        ✓
Gemini CLI       ✓       ✓      ✓        ✓
Claude Desktop   ✗ KB-JSON  claude_desktop_config.json non è JSON valido → correggi o cancella il file e rilancia install
...
```

## 4. Installazione

`install` è un'unica sequenza ripetibile; ogni passo stampa `OK`/`WARN`/`ERRORE` e finisce nel log.

1. **Prerequisiti.** Node 20+, git, rete verso il remote. Se manca qualcosa: stop con
   cosa installare.
2. **Clone unico.** Cerca altri clone di knowledge-base nei posti soliti (home, radici
   dei dischi su Windows, `/DATA/AppData`) e nei percorsi scritti nelle config degli
   agenti (es. `llm-wiki-mcp` del clone `D:`). Il principale è quello da cui gira il
   comando ed è salvato in `~/.agentmemory/kb-install.json`. Gli altri **non si
   cancellano**: si elencano, e le config che li usavano vengono riscritte sul principale.
3. **Ruolo.** Se già salvato si usa quello. Altrimenti: `server` solo se esplicito;
   se il server di `config/endpoint.env` risponde (anche 401) si propone `client`,
   altrimenti `standalone-dev`. Nel prompt per l'agente il ruolo è sempre esplicito.
4. **Servizi.** agentmemory alla versione di `package.json` (non sul client) e un solo
   job pianificato `kb tick` ogni 15 minuti e all'accesso, più gli hook di Claude Code
   (`SessionStart`/`SessionEnd` → `kb tick --background`). Server: unit systemd come oggi.
5. **Agenti.** Tutti gli adattatori con `detect()` vero (o tutti con `--all`, o solo
   `--only`). Diff mostrato, backup, scrittura.
6. **Test.** `kb test` finale: l'installazione finisce con la tabella.

`uninstall` toglie job, hook e le nostre voci dalle config; con `--restore` rimette i
backup `.kb-backup`. Non tocca i dati di agentmemory né il clone.

## 5. Errori

Regole fisse: niente cancellazioni; niente `reset --hard`, `checkout -f`, `clean`; un
programma che fallisce non blocca gli altri; ogni errore ha un codice e il comando
che lo risolve.

| Codice | Quando | Cosa dice di fare |
|---|---|---|
| `KB-NODE` | Node < 20 o git mancante | comando di installazione per il sistema |
| `KB-NET` | remote non raggiungibile | `git config http.proxy ""` solo per il repo (PowerShell: `cmd /c`) |
| `KB-DIRTY` | file tracciati modificati: update fermo | elenco dei file; `git stash` o scartarli |
| `KB-401` | server risponde 401 | `KB_TOKEN` nel `.env` del clone (`kb token` sul server) |
| `KB-PORT` | 3111 occupata ma agentmemory non risponde | comando per fermare il processo, poi `install` |
| `KB-JSON` | config di un programma non valida | il file e la riga; nessuna modifica fatta |
| `KB-PATH` | programma trovato ma comando non nel PATH (es. `claude`) | dove aggiungerlo al PATH |
| `KB-CLONE` | config che puntavano a un altro clone | quali sono state spostate e dove |
| `KB-TICK` | 3 tick falliti di fila | ultimo errore dal log |

`tick` non si ferma mai per un errore: lo scrive e riprova al giro dopo.

## 6. Documentazione

- **README.md**: cos'è in tre righe, il comando, il prompt per l'agente, `kb test`, i
  programmi supportati, i tre ruoli, problemi comuni (codici errore), sicurezza.
  Riscritto in questo stesso lavoro.
- `PROMPT-INSTALL.md` si riduce al prompt per l'agente (con ruolo per macchina) e
  chiede di riportare l'output di `kb test --json`.
- `AGENTS.md`: istruzioni per gli agenti che lavorano nel repo; via i blocchi di config
  scritti a mano (li generano gli adattatori).
- `docs/flusso-installazione.md` aggiornato al nuovo flusso.

## 7. Test del codice

- **TDD** per ogni adattatore: config reali di esempio in `test/fixtures/<id>/`
  (anche con server estranei come `matlab`), verifica che `apply` aggiunga solo le
  nostre chiavi, che sia idempotente, che salti JSON non validi.
- `mcp-client` e `checks` contro un finto server MCP (`test/fixtures/fake-mcp.mjs`)
  che implementa `initialize`, `tools/list`, `memory_save`, `memory_smart_search`.
- `service` e `git` con `run` finto: si controllano i comandi che verrebbero lanciati
  (schtasks, crontab, systemctl), non si lanciano.
- I test di #13 restano verdi.
- **Prova vera** sulle tre macchine con un prompt per l'agente locale, che riporta
  l'output di `kb test --json`.

## 8. Ordine di lavoro

1. Unire la PR #13 (prerequisito).
2. `log`, `adapters/shared` e gli adattatori esistenti spostati (stesso comportamento).
3. Adattatori nuovi.
4. `mcp-client` + `checks` + `kb test`.
5. `service` + `kb tick` + shim di compatibilità.
6. Clone unico, `--dry-run`, `uninstall`.
7. Shell → Node, pulizia file, docs.
8. Prova sulle tre macchine.

Il piano dettagliato si scrive dopo l'approvazione di questa spec.
