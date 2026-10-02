# Modifiche richieste a memory-sync.mjs (PR #2) per il voto di affidabilità

Stato al 2026-10-02:

| Punto | Stato nella PR #2 |
|---|---|
| `kbAuthor` timbrato e propagato | fatto (36071b6); `sconosciuto` = autore ignoto, prior 0.5 |
| 1. memorie personali non esportate | fatto (368e288), stessa regola di `isPersonal`; sessioni e osservazioni per ora restano nell'export |
| 2. PC importano solo la selezione firmata | **non applicato**: da decidere con Francesco, quando il server curatore gira davvero |
| 3. push di `votes/<node>.jsonl` | resta (solo se il file esiste); innocuo, `memory-trust.mjs` non lo legge |

Helper pronto per il punto 2: `scripts/memory-curated.mjs` (PR #7).

## 1. Le memorie personali non escono dal PC (fatto)

In `stepExport`, prima di scrivere `<node>.json`:

```js
import { isPersonal } from './memory-curated.mjs';
data.memories = data.memories.filter((m) => !isPersonal(m));
```

Personale = concetto `personale` o progetto che inizia con `personale`.
Consigliato anche: non esportare `sessions`, `observations`, `summaries`
(restano `REQUIRED` ma vuoti), cioè condividere solo memorie e lezioni.

## 2. I PC importano solo la selezione firmata dal server (proposto)

Ruolo: il server ha `KB_SYNC_ROLE=server` (o `--server`); tutti gli altri
sono PC normali.

- **Server**: come oggi, importa i file di tutti i PC (`memories/sync/*.json`).
- **PC**: non legge più i file degli altri PC. In `stepImport`:

```js
import { loadCurated } from './memory-curated.mjs';

let curated;
try {
  curated = loadCurated(REPO_DIR); // verifica la firma con config/trust-admin.pub
} catch (e) {
  die(`selezione condivisa rifiutata: ${e.message}`); // niente import, niente forget
}
if (!curated) return; // il server non ha ancora pubblicato nulla
// a) memorie approvate: stesso delta() di oggi, con remote = { memories: curated.publish }
// b) ritiri: cancella dal DB locale, ma non le memorie nate su questo PC
for (const id of curated.retract) {
  const m = localById.get(id);
  if (!m || m.kbAuthor === node) continue;
  if (!dryRun) await api('POST', '/agentmemory/forget', { memoryId: id });
  log(`ritirata ${id}`);
}
```

`--dir` (OneDrive/share): stessa logica, `curated.json` e `.sig` nella
cartella invece che nel repo (`loadCurated` va reso parametrico sulla cartella).

## 3. Voti dai PC: non più necessari

Con il requisito "solo l'amministratore interviene", i voti degli utenti
(`memories/trust/votes/<node>.jsonl`) non servono più: si può togliere il
push di quel file da `gitPush`. I voti dell'admin stanno nel ledger sul server.
