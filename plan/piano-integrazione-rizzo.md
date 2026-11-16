# Piano: integrare nella KB le idee del video di Simone Rizzo sulle LLM Wiki

Data: 2026-11-16. Stato: **piano, niente da implementare in questa PR.**
Fonte: video "Non implementare un'LLM Wiki prima di aver visto questo video"
(https://www.youtube.com/watch?v=-M_D7RBvkZ4), trascrizione nei file di progetto (`rizzo-llmwiki.txt`).

Si appoggia alle decisioni già prese, che restano valide:
- `design/kb-aziendale-architettura.md` §9 (piano rivisto con Outline, fasi 0-7, decisioni D-16..D-22);
- `design/obiettivo-wiki-outline.md` (Outline = wiki delle persone, OpenCode = agente, qmd per la ricerca);
- piano "usare la wiki ogni giorno" del 2026-11-12 (Outline in docker sul server, MCP integrato di Outline).

Nel testo "Fase 2/3/4/5 del piano Outline" indica sempre le fasi della §9.2.

---

## 1. Cosa dice il video, in breve

Rizzo elenca 5 limiti della LLM Wiki "alla Karpathy" e come li risolve Annota:

| # | Problema | Soluzione di Annota | Per noi |
|---|---|---|---|
| 1 | Indicizzazione lenta e sequenziale (il grafo va costruito da un solo agente) | Riassunti gerarchici in parallelo: scheda per documento, sintesi di più documenti, indice della cartella | **Da prendere** in forma leggera (punto D di questo piano) |
| 2 | Citazioni non verificate | Ogni affermazione + testo citato passano da un classificatore veloce sì/no con confidenza; sotto soglia un secondo LLM ricontrolla; se fallisce, avviso giallo | **Da prendere** (punto A) |
| 3 | Wiki personale, non condivisa | Wiki centralizzata nel cloud, MCP per collegarla agli agenti | **Già deciso**: Outline sul server + MCP |
| 4 | Il grafo non scala oltre 200-300 documenti | Niente grafo precompilato: struttura ad albero, i collegamenti l'agente li segue al momento della domanda | **Già deciso**: niente grafo, qmd + link tra pagine |
| 5 | Nessun permesso (i file markdown stanno sul file system) | Documenti in un database relazionale con permessi per ruolo | **Già deciso** per le persone (Outline + Postgres, permessi per collezione); **manca per gli agenti** (punto C) |

In più nella demo: le parti della risposta che **non vengono dai documenti** portano il tag
"Generale - conoscenza generale, non dai tuoi documenti" (punto B).

Il video quindi **conferma** tre scelte già prese (wiki centralizzata, niente grafo da scalare,
permessi via Outline) e aggiunge quattro cose che oggi mancano. Le mettiamo in ordine di priorità.

### Cosa non prendiamo

- **Un modello di classificazione addestrato apposta** ("decision model" con confidenza calibrata):
  usiamo il reranker che qmd ha già e calibriamo una soglia su pochi esempi. Se non basta, si valuta dopo.
- **Doppio giro di riscrittura della risposta** prima di mostrarla: in OpenCode la risposta la scrive
  l'agente, non una pipeline nostra. Possiamo dare uno strumento di verifica e una regola, non imporre il giro.
- **Annota come prodotto**: non valutato. I documenti andrebbero su un servizio esterno, in contrasto
  con D-19 (riservatezza). Se interessa, è una valutazione a parte.

---

## 2. Le quattro aggiunte

### A. Verifica delle citazioni (priorità 1)

**Idea.** Quando un agente dice "questo viene dalla pagina X", un controllo economico guarda se il
passaggio di X sostiene davvero l'affermazione. Se il punteggio è sotto soglia, un LLM fa un secondo
controllo. Se anche quello dice no, l'affermazione viene marcata "non verificata".

**Come, con quello che abbiamo.**
1. **Primo controllo: reranker di qmd.** qmd usa un modello di rerank locale (Qwen3-Reranker, GGUF via
   `node-llama-cpp`) che dà un punteggio 0..1 a una coppia (domanda, testo). Usiamo la coppia
   (affermazione, passaggio citato). Costo: millisecondi, nessuna chiamata esterna.
   Attenzione: il punteggio che `qmd query` restituisce è una miscela di ricerca + rerank, non il
   punteggio grezzo del reranker. Lo spike (R1) verifica se il punteggio grezzo è esposto; se no,
   chiamiamo il reranker direttamente con `node-llama-cpp` (`createRankingContext().rank()`), con lo
   stesso file di modello che qmd ha già scaricato.
2. **Secondo controllo: LLM.** Solo per i casi sotto soglia. Prompt fisso: "Il passaggio sostiene
   l'affermazione? Rispondi SUPPORTATA / PARZIALE / NON SUPPORTATA e cita la frase esatta". Usa
   l'endpoint già previsto da D-2 (`KB_LLM_BASE_URL`, `KB_LLM_MODEL`, `KB_LLM_API_KEY`, API Leonardo).
3. **Esito** per ogni affermazione: `verificata` / `incerta` / `non supportata`, con il motivo.

**Dove si applica.** Due modi diversi, perché non controlliamo tutto allo stesso modo:

| Dove | Chi scrive | Verifica | Effetto |
|---|---|---|---|
| Distillazione notturna in "Appreso dagli agenti" (Fase 4 del piano Outline) | Pipeline nostra | **Obbligatoria** | Le affermazioni non supportate non vengono pubblicate; le incerte vanno con un avviso nel testo |
| Schede dei PDF (Fase 5) | Pipeline nostra | **Obbligatoria** | Come sopra, la scheda cita la pagina del PDF |
| Risposte degli agenti in OpenCode | L'agente | **Su richiesta**: tool `wiki_verify`, e la regola in AGENTS.md "prima di dare una risposta con citazioni, verificale" | L'agente corregge o mette l'avviso; noi non possiamo bloccarlo |

**Formato delle citazioni.** Per essere verificabili, le citazioni devono avere sempre lo stesso
formato. Lo fissa il punto B: `[fonte: <percorso o URL Outline>#<sezione>]`. Per questo B viene prima di A.

### B. Tag "conoscenza generale" (priorità 2, costo minimo)

**Regola** per tutti gli agenti collegati alla KB:
- ogni affermazione presa dalla wiki o dalla memoria cita la fonte nel formato `[fonte: ...]`;
- ogni affermazione che **non** viene dai nostri documenti porta il tag `[conoscenza generale]`;
- se un'affermazione non ha né fonte né tag, è un errore della risposta.

Serve a capire subito se un dato viene dai documenti aziendali o da quello che il modello "sa già".
È anche il prerequisito di A: senza un formato fisso il verificatore non sa cosa controllare.

**Dove va la regola.** Oggi `kb.mjs connect` configura i server MCP ma **non** scrive istruzioni globali
agli agenti. Due passi:
1. **Subito, a mano** su ogni PC: Francesco la aggiunge con il prompt del §6.1 al file globale di
   istruzioni di ogni agente (`~/.config/opencode/AGENTS.md`, `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`).
2. **Poi, automatico**: `kb.mjs connect` scrive un blocco tra marcatori `<!-- kb:rules:start -->` /
   `<!-- kb:rules:end -->` in quei file, senza toccare il resto (stessa logica degli adattatori in
   `scripts/lib/adapters.mjs`). Il testo sta in un solo file, `config/agent-rules.md`. È lo stesso
   "AGENTS.md globale" che il launcher della Fase 7 deve distribuire: lo anticipiamo.

### C. Permessi nella ricerca degli agenti (priorità 3, quando arrivano i colleghi)

Outline gestisce i permessi per le persone. Il rischio è la **copia markdown per qmd**: se contiene
tutte le collezioni in un unico indice, un agente può leggere ciò che il suo utente non vede.
È già scritto in `obiettivo-wiki-outline.md` §3 e in D-17; qui diventa un lavoro concreto.

1. `outline-sync.mjs` (Fase 2 del piano Outline) scrive la copia **divisa per collezione**:
   `.kb-data/outline/<collection-id>/<slug>.md`, e registra **una collezione qmd per ogni collezione
   Outline** (qmd gestisce più collezioni e il filtro `-c`).
2. `kb-proxy` lega ogni token utente (D-3) a un utente Outline e, con la chiave di quell'utente, chiede
   a Outline quali collezioni vede (`collections.list`, in cache per qualche minuto).
3. `wiki_query` / `wiki_get` / `wiki_verify` cercano **solo** nelle collezioni consentite. Se l'utente
   non è noto, solo le collezioni aperte a tutti.
4. **Fughe laterali** da chiudere:
   - il mirror sul branch git `kb-data` (backup e diff) contiene solo le collezioni aperte a tutti, oppure
     il repo dei dati resta visibile solo agli amministratori;
   - le memorie di agentmemory possono riportare pezzi di pagine riservate: le insight registrate da
     `kb_record_insight` portano la collezione di origine e la distillazione rispetta la stessa regola.

Finché la wiki è aperta a tutti (default di D-17 durante le prove) basta il punto 1, che costa poco
se fatto subito nel sync e molto se rifatto dopo.

### D. Scheda per documento e indice per collezione (priorità 4, media)

È la versione leggera dei "riassunti gerarchici" di Annota. Non serve per la velocità (non costruiamo
un grafo) ma per **orientare l'agente**: prima legge l'indice, poi la scheda, poi il documento.

1. **Scheda per documento**: 5-10 righe (di cosa parla, per chi, parole chiave, data/revisione).
   - Per i PDF è già prevista in Fase 5 in testa alla pagina.
   - Per le pagine scritte da persone **non tocchiamo la pagina**: la scheda va solo nel frontmatter
     della copia per qmd (`summary:`), così la ricerca la trova e Outline resta com'è.
   - Ogni scheda si genera da sola, in parallelo, solo per i documenti cambiati (`updated_at`).
   - Le schede passano dalla verifica A.
2. **Indice per collezione**: una pagina "Indice - <collezione>" generata ogni notte dalle schede
   (titolo, link, una riga), scritta dal bot `kb-agent` e marcata `confidence: auto-learned`.
   Sopra una certa dimensione (es. 80 documenti) l'indice si divide per sottocartella.
3. **Regola in AGENTS.md**: "per una domanda ampia parti dall'indice della collezione, poi segui i link".
   È il "grafo al momento della domanda" di cui parla il video.

---

## 3. Fasi, task e file

Le fasi R0-R4 si agganciano al piano Outline; nessuna lo sostituisce.

| Fase | Contenuto | Dipende da | Sforzo |
|---|---|---|---|
| **R0** | Regola fonti + tag (B), a mano e poi in `kb.mjs connect` | Niente | 0,5 g |
| **R1** | Spike sul reranker di qmd: si può usare come primo controllo? | qmd sul server | 1 g |
| **R2** | Verificatore `kb verify` + tool `wiki_verify` (A) | R0, R1; per il tool: MCP su `kb-proxy` (Fase 3) | 2-3 g |
| **R3** | Copia per collezione + filtro permessi (C) | Outline installato, `outline-sync.mjs` (Fase 2) | 1 g dentro la Fase 2, 1-2 g dentro la Fase 3 |
| **R4** | Schede e indici (D) | R2, Fase 2; per i PDF Fase 5 | 2 g |

Sforzo = giorni di lavoro agente + revisione, stimati; non include l'attesa dei materiali.

### R0. Regola fonti e tag "conoscenza generale"

Task:
1. `config/agent-rules.md` (nuovo): testo della regola (fonti, tag, quando cercare nella wiki, formato
   `[fonte: ...]`).
2. `scripts/lib/adapters.mjs`: per OpenCode, Claude Code e Codex, scrivere/aggiornare il blocco
   `kb:rules` nel file globale di istruzioni; `kb.mjs uninstall` lo toglie; `--dry-run` lo mostra.
3. `scripts/lib/checks.mjs` + `kb.mjs test`: controlla che il blocco ci sia e sia aggiornato.
4. `test/adapters.test.mjs`: blocco inserito, aggiornato senza duplicati, rimosso, testo dell'utente intatto.
5. `AGENTS.md` del repo: una sezione che spiega la regola.

Verifica: `node --test` verde; `node scripts/kb.mjs connect --dry-run` mostra il blocco; su un PC vero,
5 domande di prova all'agente (3 sulla wiki, 2 di cultura generale): ogni affermazione ha fonte o tag.

### R1. Spike: il reranker di qmd basta come primo controllo?

Task (sul server, con il prompt del §6.2; niente codice nella repo):
1. Corpus non riservato: i markdown della repo (`docs/`, `plan/`, `README.md`, `AGENTS.md`), indicizzati in una collezione qmd di prova.
2. 40 coppie (affermazione, passaggio): 20 vere, 10 false ma plausibili, 10 parzialmente vere.
3. Per ogni coppia: punteggio grezzo del reranker (via qmd se esposto, altrimenti `node-llama-cpp`
   con il modello di qmd) e tempo.
4. Scegliere la soglia che separa meglio vere e false; contare quante finirebbero al secondo controllo.

Criterio di successo: con la soglia scelta, **almeno 90% delle false sotto soglia** e **meno del 30%
delle vere sotto soglia** (che andrebbero all'LLM, costo accettabile). Tempo sotto 200 ms a coppia su CPU.
Se fallisce: si salta il primo controllo e si usa solo l'LLM, più lento e costoso ma corretto (decide Francesco, D-24).

### R2. Verificatore

Task:
1. `scripts/lib/verify.mjs` (nuovo): estrae le affermazioni con `[fonte: ...]` da un testo markdown;
   recupera il passaggio citato (file della copia/wiki + sezione); primo controllo reranker; sotto
   soglia, secondo controllo LLM via `KB_LLM_*`; restituisce l'esito per affermazione.
2. `scripts/kb.mjs`: comando `kb verify <file|->` che stampa un riepilogo tipo "5/5 verificate" come
   nel video, e codice di uscita diverso da 0 se ce n'è una non supportata.
3. `config/endpoint.env` / `.env` del server: `KB_VERIFY_THRESHOLD` (dallo spike), `KB_VERIFY_LLM=on|off`.
4. Tool MCP `wiki_verify(claims)` in `kb-proxy` quando arriva la Fase 3 (MCP unificato); prima, i PC
   Linux possono usare `kb verify` dal terminale. Su Windows qmd oggi è saltato da `kb.mjs`, quindi la
   verifica per i colleghi Windows passa per forza dal server.
5. Aggancio nella distillazione (Fase 4) e nelle schede PDF (Fase 5): pubblicano solo affermazioni
   `verificata`/`incerta`, le incerte con avviso.
6. `test/verify.test.mjs`: estrazione delle affermazioni, soglia, ricaduta all'LLM (finto), formato
   del riepilogo, citazione a una pagina inesistente = non supportata.

Verifica: le 40 coppie dello spike rifatte con `kb verify` danno lo stesso esito; un testo con una
citazione inventata viene segnalato.

### R3. Permessi nella ricerca degli agenti

Task (dentro le Fasi 2 e 3 del piano Outline, non a parte):
1. `scripts/outline-sync.mjs`: copia in `.kb-data/outline/<collection-id>/`, una collezione qmd per
   collezione Outline, frontmatter con `collection_id` e `permission: public|restricted`.
2. Commit notturno su `kb-data`: solo collezioni `public` (oppure repo dati visibile solo agli admin, D-25).
3. `scripts/kb-proxy.js`: mappa token -> utente Outline; cache delle collezioni visibili; filtro `-c`
   su `wiki_query`, `wiki_get`, `wiki_verify`.
4. Test con un finto Outline: utente A vede le collezioni 1 e 2, B solo la 1; una ricerca di B su un
   testo che esiste solo nella 2 restituisce zero risultati, anche con `wiki_get` sul percorso diretto.

Verifica: il test sopra; più una prova vera con due utenti Outline quando i colleghi entrano.

### R4. Schede e indici

Task:
1. `scripts/kb-summaries.mjs` (nuovo, notturno via `kb-maintenance.timer`): per i documenti cambiati
   genera la scheda con `KB_LLM_*`, in parallelo (limite configurabile, es. 4), la verifica con R2, la
   scrive nel frontmatter della copia (`summary:`).
2. Indice per collezione: pagina Outline "Indice - <collezione>" creata/aggiornata dal bot `kb-agent`.
3. `config/agent-rules.md`: "domanda ampia: parti dall'indice".
4. Test: solo i documenti cambiati vengono rigenerati; una pagina umana in Outline non viene mai modificata.

Verifica: su 20 documenti di prova, la domanda "che documenti abbiamo su X?" trova la risposta
dall'indice in una sola chiamata; costo e tempo della notte annotati nel rapporto giornaliero.

---

## 4. Rischi

| Rischio | Effetto | Contromisura |
|---|---|---|
| Il punteggio del reranker non è calibrato come un classificatore | Soglia fragile, falsi "verificata" | Spike R1 con criterio numerico; il secondo controllo LLM resta; soglia rivista quando arrivano documenti veri |
| Gli agenti ignorano la regola su fonti e tag | B e A servono a poco nelle chat | `kb.mjs test` controlla che la regola sia installata; per i contenuti che pubblichiamo noi la verifica è obbligatoria |
| L'affermazione è vera ma sparsa su più passaggi | Falsi "non supportata" | Esito `incerta` invece di `non supportata` quando il passaggio è parziale; l'LLM vede la sezione intera |
| Costo/latenza del secondo controllo con l'API Leonardo | Distillazione lenta | Solo sotto soglia; limite di chiamate per notte; `KB_VERIFY_LLM=off` come interruttore |
| Riservatezza: il verificatore manda passaggi all'LLM | Documenti riservati fuori dalla rete | Vale D-19: per le collezioni riservate solo modelli approvati, altrimenti solo primo controllo locale |
| Permessi aggiunti tardi | Rifare il sync e gli indici | Copia per collezione fin dalla prima versione di `outline-sync.mjs` (R3 punto 1) |
| Fughe tramite `kb-data` o agentmemory | Un collega legge testo riservato fuori da Outline | R3 punto 4 e D-25 |
| qmd non gira su Windows con `kb.mjs` | Verifica non disponibile in locale sui PC Windows | Verifica sul server via `kb-proxy` (Fase 3) |
| Outline non ancora installato (stato al 2026-11-12) | R3 e R4 non partono | R0, R1, R2 (CLI) partono subito sulla wiki git; il resto segue la Fase 2 |

---

## 5. Cosa decide Francesco

| # | Decisione | Default proposto | Alternative |
|---|---|---|---|
| D-23 | Formato delle citazioni | `[fonte: <percorso o URL Outline>#<sezione>]` e `[conoscenza generale]` | Note a piè di pagina numerate (più leggibili, più difficili da verificare) |
| D-24 | Se lo spike R1 fallisce | Solo controllo LLM, limitato a distillazione e schede | Rinviare la verifica; oppure provare un modello NLI piccolo dedicato |
| D-25 | Mirror su `kb-data` con collezioni riservate | Solo collezioni aperte a tutti nel git | Tutto nel git, repo dati visibile solo agli admin |
| D-26 | Verifica nelle chat di OpenCode | Su richiesta (tool + regola) | Nessuna, solo sui contenuti che pubblichiamo |
| D-27 | Ordine rispetto al piano Outline | R0 e R1 subito, R2 CLI subito, il resto agganciato alle Fasi 2-5 | Tutto dopo l'installazione di Outline |

Se Francesco non dice altro, si procede con i default, una PR per fase come per il piano approvato.

---

## 6. Prompt pronti per l'agente locale

### 6.1 R0, a mano su ogni PC (subito)

```text
Aggiungi una regola alle istruzioni globali degli agenti AI installati su questo PC.
File da aggiornare, solo se il programma è installato (crea il file se manca):
- OpenCode: ~/.config/opencode/AGENTS.md
- Claude Code: ~/.claude/CLAUDE.md
- Codex: ~/.codex/AGENTS.md
Su Windows ~ è %USERPROFILE%.
In ognuno aggiungi in fondo questo blocco, senza toccare il resto. Se il blocco esiste già
(cerca "kb:rules:start"), sostituiscilo invece di duplicarlo:

<!-- kb:rules:start -->
## Fonti e conoscenza generale (KB)
- Quando usi informazioni dalla wiki o dalla memoria della KB, cita la fonte subito dopo
  l'affermazione nel formato [fonte: <percorso o URL della pagina>#<sezione>].
- Quando un'affermazione NON viene dai documenti della KB (la sai già, o viene dal web),
  mettile il tag [conoscenza generale].
- Ogni affermazione di fatto ha una fonte o il tag. Mai una fonte inventata: se non trovi la
  pagina, usa il tag.
- Per domande su progetti, decisioni o procedure aziendali, cerca prima nella wiki e nella memoria.
<!-- kb:rules:end -->

Poi mostrami, per ogni file, le ultime 15 righe e dimmi quali programmi hai trovato e quali no.
Non modificare altri file.
```

Per verificare: chiedi all'agente due cose sulla KB e una di cultura generale e controlla i tag.

### 6.2 R1, spike sul server 192.168.68.55

```text
Lavora nel clone della repo knowledge-base sul server. Non fare commit e non modificare file
tracciati da git: lavora in una cartella temporanea ~/kb-spike-rerank.

Obiettivo: capire se il reranker di qmd può fare da primo controllo economico per verificare
le citazioni (un'affermazione è sostenuta dal passaggio citato?).

1. Trova qmd installato da scripts/wiki-search.sh (di solito ~/.local/share/kb-qmd) e la sua
   versione. Leggi `qmd --help` e `qmd query --help`: c'è un modo per avere il punteggio GREZZO
   del reranker (non il punteggio misto della ricerca)? Annota la risposta.
2. Crea una collezione qmd di prova (indice separato, NON l'indice "kb") con i file markdown
   della repo: docs/ (anche le sottocartelle), plan/, README.md, AGENTS.md.
3. Scrivi 40 coppie (affermazione, passaggio) prese da quei file: 20 sostenute dal passaggio,
   10 false ma plausibili (stesso argomento, dato sbagliato), 10 sostenute solo in parte.
   Salvale in ~/kb-spike-rerank/pairs.json con il campo "atteso".
4. Per ogni coppia calcola il punteggio del reranker:
   - se qmd espone il punteggio grezzo, usa qmd;
   - altrimenti scrivi uno script Node in ~/kb-spike-rerank che usa node-llama-cpp (è già una
     dipendenza di qmd) con lo stesso file GGUF del reranker che qmd ha scaricato
     (cerca in ~/.cache/qmd o simili), model.createRankingContext() e rank(affermazione, passaggio).
   Misura anche il tempo per coppia.
5. Trova la soglia che separa meglio le vere dalle false. Riporta:
   - con quella soglia: % delle false sotto soglia, % delle vere sotto soglia, come finiscono le parziali;
   - tempo medio per coppia;
   - una tabella con le 40 coppie, punteggio ed esito.
Criterio: buono se almeno 90% delle false sta sotto soglia e meno del 30% delle vere sta sotto
soglia, sotto 200 ms a coppia.
Alla fine dammi un rapporto breve in italiano che posso incollare in chat, con il comando o lo
script usato. Poi cancella l'indice qmd di prova.
```

---

## 7. Ordine consigliato

1. Francesco usa il prompt 6.1 sui suoi PC (10 minuti) e il 6.2 sul server quando ha tempo.
2. PR R0 (regola in `kb.mjs connect`), in parallelo allo spike.
3. Con il rapporto dello spike: PR R2 (`kb verify`), soglia fissata.
4. R3 e R4 entrano nelle PR delle Fasi 2-5 del piano Outline, non come PR separate.
