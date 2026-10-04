# Banco di prova per sistemi di memoria (MCP)

Confronta agentmemory e le alternative (vedi [docs/memory-alternatives.md](../../docs/memory-alternatives.md))
con lo **stesso** test: 20 fatti finti salvati via MCP, 30 domande.

- `mcp_bench.py`: client MCP minimale (stdio o HTTP), solo libreria standard Python 3.
- `dataset.json`: fatti (progetti finti `bench-*`) e domande. `kind`: `paraphrase`
  (parole diverse dal fatto, misura la ricerca semantica), `keyword`, `cross` (domanda posta
  da un altro progetto).
- `adapters.json`: per ogni sistema, comando di avvio e tool/argomenti per salvare e cercare.
- `results/`: un JSON per esecuzione (`<sistema>-<host>-<data>.json`).

## Uso

```bash
python3 bench/memory/mcp_bench.py list-tools engram       # nomi e parametri dei tool
python3 bench/memory/mcp_bench.py run engram              # seed + domande
python3 bench/memory/mcp_bench.py run engram --skip-seed  # solo domande (PC B dopo la sync)
python3 bench/memory/mcp_bench.py compare                 # tabella di tutti i risultati
```

Un hit conta se **tutte** le `keywords` del fatto atteso compaiono nella risposta; le keyword
non compaiono mai nelle domande, così un server che ripete la query non bara.
`rumore` = quanti altri fatti compaiono in media nella risposta.

**Usa sempre una data dir di test** (gli adapter puntano a `~/.kb-bench/`). Per agentmemory
avvia un'istanza separata: il test scrive 20 memorie finte.

## Installazione rapida dei candidati

| Sistema | Installazione |
|---|---|
| engram | `go install github.com/Gentleman-Programming/engram/cmd/engram@latest` |
| basic-memory | `uv tool install basic-memory` (o `uvx basic-memory`) |
| mcp-memory-service | `uv tool install mcp-memory-service` (o `uvx --from mcp-memory-service memory server`) |
| mempalace | `pip install mempalace` |
| codemem | vedi README del progetto |
| hindsight | Docker, vedi README del progetto (serve un LLM, anche Ollama) |

Gli adapter con `_verified` sono stati provati; per gli altri i nomi dei tool sono da
confermare con `list-tools`.
