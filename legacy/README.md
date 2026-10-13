# Legacy

Script e guide del primo setup (prima di `scripts/kb.mjs`). **Non sono più usati** da
nessun flusso automatico e verranno cancellati fra due release. Restano qui solo come
riferimento storico: i percorsi interni (`scripts/...`) si riferiscono alla vecchia posizione.

| File | Sostituito da |
|------|---------------|
| `INSTALL.sh`, `INSTALL.md`, `AGENT-INSTALL.md`, `QUICKSTART.md` | [`PROMPT-INSTALL.md`](../PROMPT-INSTALL.md) (`node scripts/bootstrap.mjs`), passo per passo in [`docs/installazione-manuale.md`](../docs/installazione-manuale.md) |
| `UPDATE_NODEJS.md` | Node 20+ richiesto da `kb.mjs`, che lo controlla da solo |
| `scripts/start-agentmemory.sh` | `node scripts/kb.mjs install` (systemd / Utilità di pianificazione / crontab) |
| `scripts/start-llm-wiki.sh` | app desktop LLM Wiki + `scripts/wiki-search.sh` (qmd) |
| `scripts/sync.sh` | `scripts/memory-sync.mjs` (memorie sul branch `kb-data`), `kb.mjs update` (codice) |
| `scripts/seed-memory.py` | memorie salvate dagli agenti via MCP (`memory_save`) |
| `scripts/connect-agent.sh` (ancora in `scripts/`, ora è un rimando) | `node scripts/kb.mjs connect` |
| `scripts/kb-token.sh` (ancora in `scripts/`, ora è un rimando) | `node scripts/kb.mjs token` |
