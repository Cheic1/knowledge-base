# Voto di affidabilità delle memorie condivise

Obiettivo: ogni memoria condivisa ha un voto da 0 a 1 su quanto ci si può
fidare. Un agente sul PC server giudica le memorie nuove e ribilancia i voti
in base a quello che viene scritto dopo. Requisiti di Francesco:

1. il PC di origine viaggia con ogni memoria;
2. ogni PC ha uno spazio personale per le informazioni private;
3. i voti sono **invisibili** agli utenti e **non modificabili**: solo
   l'amministratore (Francesco) può intervenire.

Script: `scripts/memory-trust.mjs` (solo server) e `scripts/memory-curated.mjs`
(condiviso con la sync). Prompt del giudice: `docs/memory-trust-judge-prompt.md`.
Modifiche alla sync: `docs/memory-trust-sync-change.md`.

## Architettura

```
 PC mario ─┐  memories/sync/mario.json  (solo memorie non personali)
 PC luigi ─┼──────────── git ───────────────►  SERVER
 PC anna  ─┘                                    importa tutto in agentmemory
                                                giudice (agente, notturno)
                                                ~/.kb-trust/ledger.json   ← voti, prove, reputazioni (privato)
                                                ~/.kb-trust/admin.key     ← chiave admin (privata)
 PC *  ◄──── memories/shared/curated.json + .sig ─────┘
             (memorie approvate + id da ritirare, firmato, SENZA voti)
```

- I PC **non importano più i file degli altri PC**: importano solo
  `curated.json`, cioè quello che il server ha approvato. Una memoria
  sbagliata di un collega resta sul suo PC e sul server, ma non arriva agli altri.
- `curated.json` non contiene voti: dice solo "queste sì" e "queste ritirale".
  Gli utenti vedono quali memorie arrivano, non perché né con che voto.
- Il ledger con i voti sta **fuori dal repo**, sul server
  (`~/.kb-trust`, permessi 600). Non passa da git, quindi nessuno lo legge o lo modifica.
- `curated.json` è **firmato** con una chiave ed25519 che esiste solo sul
  server. La chiave pubblica è in `config/trust-admin.pub`. Se qualcuno
  modifica il file in git, la firma non torna e i PC lo rifiutano (testato).
- L'unico intervento umano è `memory-trust.mjs admin …`, che funziona solo
  dove c'è il ledger, cioè sul server.

Limite onesto: chi ha permesso di scrittura sul repo può modificare
`memory-sync.mjs` sul proprio PC e importare quello che vuole. La firma
protegge gli altri PC da una selezione falsificata, non il PC di chi
manomette il proprio script. Per chiudere anche questo serve la protezione
del branch su GitHub (solo Francesco può fare push su `scripts/`, `config/`
e `memories/shared/`), vedi "Prossimi passi".

## 1. Il PC viaggia con la memoria

`kbAuthor` sul record = PC dove è nata la memoria. Lo timbra la sync (PR #2)
e arriva nel DB di ogni PC. Regola applicata dalla sync: un autore reale già
presente resta; altrimenti si adotta quello noto da un altro file; se la
memoria è in un altro file senza autore, o ha origin `import`, diventa
`sconosciuto`; negli altri casi prende il nome del PC.

Sul server `~/.kb-trust/people.json` (facoltativo) raggruppa i PC per persona,
così chi ha due PC ha una reputazione sola:
`{ "pc-ufficio": "francesco", "laptop-fra": "francesco", "pc-mario": "mario" }`.

Sul server: `memory-trust.mjs show --author mario` (memorie di Mario con voto
e stato) e `show ID` (autore, PC, prove, motivazioni).

## 2. Spazio personale per PC

Una memoria è **personale** se ha il concetto `personale` oppure un progetto
che inizia con `personale` (es. `personale`, `personale/casa`). Le memorie
personali:

- **non si sincronizzano**: la sync le esclude dal file del PC, quindi non
  arrivano né al server né agli altri;
- restano nell'agentmemory del PC e il suo agente le usa normalmente per
  rispondere in modo preciso (preferenze, contesto, macchina, persone);
- non vengono giudicate e non hanno voto.

La regola per gli agenti è in `AGENTS.md`: le informazioni personali si
salvano con `memory_save` e concetto `personale`. In più agentmemory già
oscura i segreti (chiavi, token) e il testo tra `<private>…</private>`.

Raccomandazione per la sync: condividere **solo le memorie** (e lezioni),
non sessioni e osservazioni grezze. Le osservazioni contengono il lavoro
quotidiano di ciascuno, comandi e file compresi: sono personali per natura e
non si possono giudicare una per una.

## 3. Il voto

### Cosa offre già agentmemory 0.9.29

Verificato sul sorgente (`src/types.ts`, `functions/`):

| Campo | Dove | Note |
|---|---|---|
| `strength` | `Memory` | 1–10 in pratica; non pesa nel ranking di `memory_smart_search` |
| `confidence`, `reinforcements`, `decayRate` | solo `Lesson` e `Insight` | 0–1 con rinforzo e decay, ma è un altro tipo di record |
| `origin.channel` | `Memory` | non dice chi l'ha scritta |

Nessun campo "affidabilità" o "autore" sulle memorie. L'import salva il
record così com'è, campi extra compresi: per questo `kbAuthor` viaggia.
Il voto invece non lo scriviamo nel record, perché sarebbe visibile a tutti
(viewer, export).

### Il modello

Ogni memoria ha due contatori: `alpha` (prove a favore) e `beta` (contro).
Voto = `alpha / (alpha + beta)` (modello Beta: con poche prove il voto resta
vicino al punto di partenza, con tante prove segue le prove).

**Punto di partenza = reputazione dell'autore**, che pesa come 2 prove. La
reputazione è la media dei voti delle sue memorie giudicate, smussata verso
0.5 quando ne ha poche.

| Prova | Effetto |
|---|---|
| Giudice: corretta | +2 × confidenza |
| Giudice: dubbia | −0.75 × confidenza |
| Giudice: sbagliata | −2 × confidenza |
| Giudice: non verificabile | 0 |
| Confermata da una memoria di **un altro** autore | +1 × confidenza |
| Smentita da un'altra memoria | −1 × confidenza |
| Voto dell'amministratore (`admin ID up/down`) | ±4 |

Le prove dimezzano il loro peso ogni 180 giorni. I voti si ricalcolano da
zero a ogni `rebalance`: cambiare un peso ricalcola tutto.

### Da voto a condivisione

- condivisa se è stata giudicata e il voto è ≥ 0.5;
- già condivisa: ritirata solo se scende sotto 0.35 (così non entra ed esce a ogni giro);
- l'amministratore può forzare: `admin ID publish`, `admin ID retract`,
  `admin ID auto` per tornare al calcolo.

Una memoria nuova arriva agli altri PC dopo il primo giudizio, quindi al
giro notturno successivo.

Ritirare una memoria vuol dire cancellarla dagli altri PC
(`/agentmemory/forget`). Non sul PC dell'autore: lì resta, è sua.

Test con dati finti: "JWT dura 1 ora" (luigi, giudicata sbagliata) → 0.23,
non condivisa; "JWT scade dopo 15 min" (mario, confermata da anna) → 0.79,
condivisa; memoria personale e memoria superata escluse; `curated.json`
manomesso → rifiutato.

## Il giro sul server

Notturno, da cron, con il prompt `docs/memory-trust-judge-prompt.md`:

1. `memory-sync.mjs sync` (il server importa i file di tutti)
2. `memory-trust.mjs queue --out .trust-queue.json`
3. l'agente giudica, scrive `.trust-verdicts.json`
4. `memory-trust.mjs verdict .trust-verdicts.json`
5. `memory-trust.mjs rebalance` e `publish`
6. commit e push di `memories/shared/curated.json` e `.sig`

Prima volta: `memory-trust.mjs keygen` sul server, commit di
`config/trust-admin.pub`, backup di `~/.kb-trust/admin.key`.

## Limiti e rischi

- Il giudice può sbagliare: pesa al massimo 2, l'amministratore 4.
- Il server vede tutto ciò che non è personale; il suo viewer (porta 8313,
  senza autenticazione sulla LAN) mostra anche le memorie non approvate.
  Non mostra i voti.
- Il giudice costa token: massimo 40 memorie a giro (nel prompt).

## Prossimi passi

- Protezione del branch `main` su GitHub e CODEOWNERS su `scripts/`,
  `config/`, `memories/shared/`, così solo Francesco approva modifiche lì.
  Richiede che i PC dei colleghi pushino i loro file su un branch o con un
  token limitato: da decidere quando ci sono i colleghi.
- Segnale d'uso: una memoria richiamata prima di un errore conta come prova contro.
