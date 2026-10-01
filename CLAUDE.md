# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A personal hybrid knowledge base (docs and comments are in Italian) that runs on a home server at `/DATA/AppData/my-knowledge-base` (LAN IP `192.168.68.55`) and is synced across machines via Git. It is mostly configuration, shell scripts and Markdown content; the only real code package is `mcp/llm-wiki-mcp`. `AGENTS.md` is the detailed per-agent MCP wiring reference.

Three layers:
1. **LLM Wiki** (`wiki/`) — content managed by the external desktop app nashsu/llm_wiki. `wiki/raw/sources/` holds originals, `wiki/wiki/{concepts,entities,comparisons,synthesis,sources,queries}` holds LLM-generated pages. Page format (YAML frontmatter with `type`, `tags`, `sources`, `related`; `[[wiki-link]]` links) is defined in `wiki/schema.md`; scope in `wiki/purpose.md`.
2. **agentmemory** (`@agentmemory/agentmemory`, root `package.json`) — operational memory for agents, runs on the iii engine. Runtime state lives in `data/` (`iii-config.yaml`, `state_store.db/`).
3. **Git sync** — `scripts/sync.sh {pull|push|sync|status|backup}` auto-commits everything with `Auto-sync: <timestamp>` and pushes to `main`.

## Network architecture (the non-obvious part)

iii v0.11.2 rewrites `data/iii-config.yaml` to `host: 127.0.0.1` on every boot and ignores `III_HOST`, so services can only listen locally. `scripts/kb-proxy.js` (plain Node `http`/`net`, no deps) re-exposes them on the LAN. Don't try to fix binding by editing `iii-config.yaml`.

| LAN port | Local port | Service |
|---|---|---|
| 8311 | 3111 | agentmemory REST API (`/agentmemory/health`, `/agentmemory/remember`, …) |
| 8313 | 3113 | agentmemory web viewer |
| 8315 | 3115 | viewer fallback |
| 8318 | 19828 | LLM Wiki desktop app API (`/api/v1/...`), only when the app is running |

No auth on these ports; it relies on a trusted home LAN.

**Single source of truth for endpoints:** `config/endpoint.env` (`KB_API_URL`, `KB_VIEWER_URL`, `KB_WIKI_URL`). `scripts/connect-agent.sh` sources it (env vars override) and writes MCP config into whichever of OpenCode (`~/.config/opencode/opencode.json`, env key is `environment`), Hermes (`~/.hermes/config.yaml`, `mcp_servers:`), Cursor (`~/.cursor/mcp.json`) and VS Code (`.vscode/mcp.json`) it finds. When changing an endpoint, update `config/endpoint.env` and keep `AGENTS.md`, `MCP-CONFIG.json` and the fallbacks hardcoded in the scripts consistent.

Agents get two MCP servers: `agentmemory` via `npx -y @agentmemory/mcp` (`AGENTMEMORY_URL`) and `llm-wiki` via `node <REPO>/mcp/llm-wiki-mcp/dist/src/index.js` (`LLM_WIKI_API_BASE_URL`).

## Server commands

All require Node 20+ (scripts try `nvm use 20`).

```bash
./scripts/start-kb.sh            # start agentmemory + kb-proxy (logs: /tmp/agentmemory.log, /tmp/kb-proxy.log)
./scripts/start-kb.sh status|stop
./scripts/connect-agent.sh       # wire MCP into local agents (server or client PC)
python3 scripts/seed-memory.py   # seed agentmemory with project facts (needs 127.0.0.1:3111 healthy)
curl http://127.0.0.1:3111/agentmemory/health
```

`INSTALL.sh`, `INSTALL.md`, `AGENT-INSTALL.md`, `PROMPT-INSTALL.md` and `QUICKSTART.md` are setup guides; `PROMPT-INSTALL.md` is a copy-paste prompt for agents and its "step 0" is meant to be idempotent (check whether already installed first).

## mcp/llm-wiki-mcp

TypeScript MCP server (stdio) that is a thin wrapper over the LLM Wiki desktop app's local HTTP API; it never reads wiki files directly. `src/api-client.ts` (`LlmWikiApiClient`, injectable `fetchImpl` for tests) does the HTTP calls; `src/index.ts` declares the `llm_wiki_*` tools and maps them to client methods. Env: `LLM_WIKI_API_BASE_URL` (default `http://127.0.0.1:19828`), optional `LLM_WIKI_API_TOKEN` (Bearer).

```bash
cd mcp/llm-wiki-mcp
npm install
npm run build        # tsc -> dist/
npm run typecheck
npm test             # builds, then node --test dist/test/*.test.js
node --test --test-name-pattern="normalizeBaseUrl" dist/test/*.test.js   # single test (after build)
```

`dist/` is intentionally committed (whitelisted in `.gitignore`) because agents' MCP configs point at `dist/src/index.js` and clients don't build. Always rebuild and commit `dist/` together with `src/` changes.

## Repo conventions

- `.env` holds API keys (template: `.env.example`) and is gitignored.
- `.gitignore` excludes binaries/media (`*.pdf`, images, archives), so PDFs dropped in `wiki/raw/sources/` are not synced by Git.
- Docs say `data/` is excluded from Git, but `data/iii-config.yaml` and `data/state_store.db/` are currently tracked; be careful not to commit churn from a running agentmemory instance unintentionally.
