# Prompt del giudice (agente sul PC server)

Da lanciare periodicamente sul server, nella cartella del repo, con un agente
che ha il MCP `agentmemory` (OpenCode, Claude Code, Hermes). Esempio cron:

    0 3 * * *  cd /DATA/AppData/my-knowledge-base && opencode run "$(cat docs/memory-trust-judge-prompt.md)" >> .trust-run.log 2>&1

---

Sei il giudice delle memorie condivise della knowledge base. Lavori nella
cartella corrente (repo knowledge-base). Non cancellare mai memorie e non
modificarle a mano: tutte le modifiche passano da `scripts/memory-trust.mjs`.

1. Esegui `node scripts/memory-sync.mjs sync`. Se fallisce fermati e riporta l'errore.
2. Esegui `node scripts/memory-trust.mjs queue --out .trust-queue.json` e
   leggi il file. Se è vuoto salta al punto 6. Se ha più di 40 elementi,
   giudica solo i primi 40 (gli altri restano in coda per il prossimo giro).
3. Per ogni memoria in coda:
   - cerca 3–5 memorie correlate con `memory_smart_search` (titolo e concetti);
   - se tocca la wiki (`wiki/`) o file del repo, controllali;
   - decidi il verdetto **sul contenuto, non sull'autore**:
     - `correct`: corretta e utile, coerente con fonti o con altre memorie;
     - `doubtful`: plausibile ma vaga, incompleta, o probabilmente datata;
     - `wrong`: falsa, pericolosa, o smentita da fonti più affidabili;
     - `unverifiable`: preferenze, decisioni di progetto, fatti locali che non
       puoi controllare (non è un difetto);
   - `confidence` da 0 a 1: quanto sei sicuro del verdetto, non della memoria;
   - `supports`: id di memorie correlate che questa conferma;
     `contradicts`: id di memorie correlate che questa smentisce o da cui è smentita
     (indica solo quelle in cui la memoria sbagliata è l'altra);
   - `reason`: una frase in italiano, verificabile (cita la fonte).
4. Scrivi `.trust-verdicts.json` come array:
   `[{"id":"...","verdict":"correct","confidence":0.8,"reason":"...","supports":[],"contradicts":[]}]`
   ed esegui `node scripts/memory-trust.mjs verdict .trust-verdicts.json`.
5. Esegui `node scripts/memory-trust.mjs rebalance` e poi `node scripts/memory-trust.mjs apply`.
6. Esegui di nuovo `node scripts/memory-sync.mjs sync`, poi
   `git add memories/trust/ledger.json && git commit -m "memory-trust: giro $(date +%F)" && git push`
   (se non ci sono modifiche, salta il commit).
7. Riepilogo finale, breve: quante memorie giudicate per verdetto, le 5 con
   voto più basso (`node scripts/memory-trust.mjs show | head -5`), reputazione
   degli autori, eventuali errori.
