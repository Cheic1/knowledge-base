# Modifica richiesta a memory-sync.mjs (PR #2): autore delle memorie

Il voto di affidabilità parte dalla reputazione di chi ha scritto la memoria
(`docs/memory-trust.md`). agentmemory non salva l'autore, e dopo la sync
`origin.channel` vale `import` quasi ovunque. Serve che la sync timbri
l'autore una volta, al primo export, e che il timbro viaggi col record.

## Cosa cambiare

In `normalize()` (o subito prima, in `stepExport`), per ogni elemento di
`memories`:

```js
// Autore della memoria: la timbra il primo PC che la esporta.
// Un record importato da un altro PC ha gia' kbAuthor (arriva dal suo file);
// uno senza kbAuthor e senza origin "import" e' nato qui.
for (const m of exp.memories || []) {
  if (m.kbAuthor) continue;
  m.kbAuthor = m.origin?.channel === 'import' ? 'sconosciuto' : node;
}
```

`normalize` deve quindi ricevere `node` (oggi non lo riceve), oppure il ciclo
va in `stepExport` prima di `normalize(await fetchExport())`.

Perché funziona:

- il timbro è solo nel file JSON del PC autore; quando un altro PC importa,
  `mem::import` salva il record intero, `kbAuthor` compreso, e da lì in poi
  lo riesporta uguale;
- sul PC autore il record nel DB resta senza `kbAuthor`, ma ogni export lo
  ritimbra con lo stesso nome: il file non cambia, nessun diff;
- le memorie già importate prima della modifica risultano `sconosciuto`
  (partono da 0.5): accettabile, nessuna attribuzione sbagliata.

Effetto collaterale da controllare: `newer()` confronta l'intero record,
quindi al primo giro dopo la modifica i PC vedono i record degli altri come
"diversi" (ora hanno `kbAuthor`) ma con lo stesso `updatedAt`: `newer()`
restituisce false e non reimporta. Quindi chi aveva già importato quei record
li tiene senza autore finché l'autore non li aggiorna. Se si vuole
l'attribuzione anche sul pregresso, in `newer()` aggiungere: a parità di
timestamp, importa se `remote.kbAuthor && !local.kbAuthor`.

## Cosa NON serve cambiare

- I voti aggiornati dal server viaggiano già: `apply` avanza `updatedAt`, e la
  regola "vince il più recente" li porta sugli altri PC.
- `memories/trust/` è nel repo, quindi `git pull` della sync porta ledger e
  voti; i file di voto (`votes/<pc>.jsonl`) vanno committati: basta che
  `gitPush` aggiunga anche `memories/trust/votes/<node>.jsonl` se esiste.
