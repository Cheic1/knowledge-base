# Voto di affidabilità delle memorie condivise

Obiettivo: ogni memoria condivisa ha un voto da 0 a 1 che dice quanto ci si
può fidare. Un agente sul PC server rilegge periodicamente le memorie nuove e
ribilancia i voti in base a quello che viene scritto dopo (conferme, smentite,
voti dei colleghi). Gli agenti sui PC vedono il voto senza strumenti nuovi.

Script: `scripts/memory-trust.mjs`. Prompt del giudice: `docs/memory-trust-judge-prompt.md`.

## Cosa offre già agentmemory 0.9.29

Verificato sul sorgente del pacchetto (`src/types.ts` e `functions/`):

| Campo | Dove | Scala | Usato da |
|---|---|---|---|
| `strength` | `Memory` (le memorie normali, quelle che sincronizziamo) | 1–10 in pratica (`remember` mette 7, `consolidate` 1–10) | iniezione contesto (`importance >= 5`), ordinamento in `claude-bridge`, filtro `qualityBelow` di governance-delete. **Non** pesa nel ranking di `memory_smart_search` |
| `confidence` + `reinforcements` + `decayRate` | solo `Lesson` e `Insight` | 0–1 | lezioni/insight, con `lessons/strengthen` e decay automatico |
| `confidence` | `SemanticMemory` | 0–1 | retention score |
| `origin.channel` | `Memory` | user/agent/tool/import | niente: dopo la sync quasi tutto è `import`, quindi non dice chi l'ha scritta |

Conclusioni:

- Non c'è un campo "affidabilità" sulle `Memory`. `strength` è il più vicino e
  lo riusiamo (voto 0..1 → strength 1..10) perché alcune parti di
  agentmemory lo leggono già.
- Le `Lesson` hanno già confidence + rinforzo, ma sono un altro tipo di
  record: non le usiamo come contenitore.
- L'import (`strategy: merge`) salva il record così com'è, campi extra
  compresi: un campo nostro (`kbTrust`, `kbAuthor`) sopravvive e viaggia con
  la sync.
- Manca l'autore. Serve per la reputazione dei colleghi, quindi lo aggiunge
  la sync (vedi `docs/memory-trust-sync-change.md`).

## Chi ha scritto cosa

La memoria **non è divisa per persona**: dopo la sync ogni PC ha tutte le
memorie di tutti, ed è giusto così (lo scopo è condividerle). Quello che
serve è sapere l'autore di ciascuna, per due motivi: vedere chi ha scritto
cosa e pesare il voto con la reputazione di chi l'ha scritta.

Tre livelli:

1. **PC** (`kbAuthor` sul record). Lo timbra la sync la prima volta che la
   memoria esce dal PC dove è nata (`KB_SYNC_NODE`, di default l'hostname) e
   poi viaggia col record. Oggi il file `memories/sync/<pc>.json` dice solo
   "questo PC ha queste memorie", e dopo la prima sync le ha tutte: non basta.
2. **Persona** (`memories/trust/people.json`, a mano, facoltativo). Raggruppa
   i PC per persona, così chi ha due PC ha una reputazione sola:
   ```json
   { "pc-ufficio": "francesco", "laptop-fra": "francesco", "pc-mario": "mario" }
   ```
   Senza questo file la persona è il nome del PC.
3. **Pregresso**: le memorie importate prima della modifica alla sync
   risultano `sconosciuto` e partono da 0.5.

Per vederlo:

- `node scripts/memory-trust.mjs show --author mario` → memorie di Mario con voto
- `node scripts/memory-trust.mjs show ID` → autore, PC, prove e motivazioni
- `memories/trust/ledger.json` → per ogni memoria `author`, `pc`, `score`;
  in `authors` la reputazione di ogni persona

Limite: se due persone usano lo stesso PC (o lo stesso agente sul server)
risultano un solo autore. agentmemory non sa chi c'è alla tastiera; se
serve, ognuno imposta `KB_SYNC_NODE` col proprio nome sul proprio PC.

## Il modello: voto = probabilità che la memoria sia giusta

Ogni memoria ha due contatori, `alpha` (prove a favore) e `beta` (prove
contro). Voto = `alpha / (alpha + beta)`. È un modello Beta: con poche prove
il voto resta vicino al punto di partenza, con tante prove segue le prove.

**Punto di partenza = reputazione dell'autore.** Una memoria nuova di un
collega che di solito scrive cose giuste parte da ~0.7, una di chi sbaglia
spesso da ~0.3. Pesa come 2 prove, quindi bastano un paio di verdetti per
ribaltarlo. La reputazione è la media dei voti delle sue memorie giudicate,
smussata verso 0.5 quando ne ha poche (4 memorie "finte" a 0.5).

**Prove** (pesi in `P` in testa allo script):

| Prova | Effetto | Da dove |
|---|---|---|
| Giudice: corretta | +2 × confidenza | agente sul server |
| Giudice: dubbia | −0.75 × confidenza | agente sul server |
| Giudice: sbagliata | −2 × confidenza | agente sul server |
| Giudice: non verificabile | 0 | agente sul server |
| Confermata da una memoria di **un altro** autore | +1 × confidenza | giudice (`supports`) |
| Smentita da un'altra memoria | −1 × confidenza | giudice (`contradicts`) |
| Voto umano 👍/👎 | ±3 | `vote` da qualsiasi PC; conta l'ultimo voto per PC, l'autore non vota se stesso |

**Decadimento**: una prova dimezza il suo peso ogni 180 giorni. Una memoria
non più toccata torna piano verso la reputazione dell'autore, e il giudice
può rivalutarla (le versioni dei tool cambiano, le memorie invecchiano).

I voti non si salvano "a mano": `rebalance` li ricalcola da zero dalle
prove ogni volta. Cambiare un peso e rilanciare ricalcola tutto; un
verdetto sbagliato si corregge rigiudicando.

Esempio (test con dati finti): `JWT dura 1 ora` di luigi, smentita dal
giudice e con un 👎 di anna → 0.12; `JWT scade dopo 15 min` di mario,
confermata da una memoria di anna → 0.79; reputazione luigi 0.41.

## Come arriva agli agenti

`apply` riscrive in agentmemory, sul server, solo le memorie con voto cambiato:

- `kbTrust` = voto 0..1 (campo nostro, per script e viewer)
- `strength` = `round(1 + 9 × voto)` (campo nativo)
- titolo con prefisso `[⚠ affidabilità 0.31] ` quando il voto è sotto 0.4.
  È l'unico modo perché un agente lo veda nei risultati di
  `memory_smart_search`, che restituisce titolo e testo ma non i campi.
  Il prefisso si toglie da solo se il voto risale.

`updatedAt` avanza, quindi la sync esistente propaga il record agli altri PC
(vince il più recente). Le memorie non vengono mai cancellate né nascoste: la
memoria sbagliata resta, ma marcata. In `AGENTS.md` c'è la regola per gli
agenti.

## File

| File | Chi scrive | Note |
|---|---|---|
| `memories/trust/ledger.json` | solo il server | prove, voto, autore, reputazioni; leggibile da tutti |
| `memories/trust/votes/<pc>.jsonl` | solo il PC `<pc>` | voti umani, una riga per voto: niente conflitti git |

Stesso schema della sync: un file per scrittore.

## Il giro sul server

Periodico (es. ogni notte), lanciato da cron con l'agente headless e il
prompt `docs/memory-trust-judge-prompt.md`:

1. `memory-sync.mjs sync` – prende memorie e voti degli altri PC
2. `memory-trust.mjs queue --out .trust-queue.json` – memorie nuove o cambiate (hash di titolo+testo)
3. l'agente giudica ciascuna: cerca memorie correlate con `memory_smart_search`, controlla wiki e documentazione, scrive `.trust-verdicts.json`
4. `memory-trust.mjs verdict .trust-verdicts.json`
5. `memory-trust.mjs rebalance` e `apply`
6. `memory-sync.mjs sync` + commit di `memories/trust/ledger.json`

I passi 4–6 sono deterministici: il giudizio è l'unica parte affidata
all'LLM, e ogni verdetto ha una motivazione salvata nel ledger
(`memory-trust.mjs show ID`).

## Limiti e rischi

- **Dipende dalla sync (PR #2)** e dalla piccola modifica `kbAuthor` descritta
  in `docs/memory-trust-sync-change.md`. Senza autore tutto parte da 0.5 e la
  reputazione dei colleghi non funziona.
- **Il giudice può sbagliare.** Pesa al massimo 2, un voto umano pesa 3: un
  👍/👎 di chi ha provato davvero vince sul giudice.
- **Conflitto di scrittura**: se l'autore modifica la memoria mentre il server
  aggiorna il voto, vince il più recente; il giro successivo rimette il voto
  (l'hash cambia e la memoria torna in coda).
- **Consolidamento di agentmemory** cerca memorie con lo stesso titolo esatto:
  il prefisso ⚠ può far nascere un doppione invece di una nuova versione.
  Accettabile per ora (il doppione verrebbe comunque giudicato).
- Il giudice è una spesa di token: limitare il numero di memorie per giro
  (nel prompt: 40).

## Possibili evoluzioni

- Segnale d'uso: se dopo aver richiamato una memoria la sessione registra un
  errore che la riguarda, prova contro (servono gli access log).
- Voto per argomento, non solo per autore (un collega bravo su Docker e meno su JWT).
- Tool MCP `kb_vote` per far votare gli agenti direttamente.
