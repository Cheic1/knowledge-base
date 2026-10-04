#!/bin/bash
# ============================================
# connect-agent.sh - Cabla un agente AI alla knowledge base
#
# Legge l'endpoint da config/endpoint.env (unico punto di cambio)
# e configura MCP in OpenCode / Hermes / Cursor / VS Code trovati
# su questa macchina. Funziona sia sul server che su un PC client:
# non installa agentmemory (gira solo sul server), cabla solo il client.
#
# Uso:
#   ./scripts/connect-agent.sh              # usa config/endpoint.env
#   KB_API_URL=... ./scripts/connect-agent.sh   # override endpoint
#
# Token: KB_TOKEN da env o da <repo>/.env (sul server: scripts/kb-token.sh;
# sul client copia la riga KB_TOKEN=... nel .env del clone). Viene scritto
# nelle config come AGENTMEMORY_SECRET e LLM_WIKI_API_TOKEN (Bearer).
# ============================================
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# --- Endpoint ---
if [ -f "$REPO_DIR/config/endpoint.env" ]; then
    # shellcheck disable=SC1091
    . "$REPO_DIR/config/endpoint.env"
fi
KB_API_URL="${KB_API_URL:-http://192.168.68.55:8311}"
KB_WIKI_URL="${KB_WIKI_URL:-http://192.168.68.55:8318}"

# --- Token kb-proxy ---
if [ -z "${KB_TOKEN:-}" ] && [ -f "$REPO_DIR/.env" ]; then
    KB_TOKEN="$(sed -n 's/^[[:space:]]*KB_TOKEN[[:space:]]*=[[:space:]]*//p' "$REPO_DIR/.env" | tail -n 1 | tr -d "\"'")"
fi
KB_TOKEN="${KB_TOKEN:-}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; }

echo "=============================================="
echo " Knowledge Base - Cablaggio agenti MCP"
echo "=============================================="
echo "Endpoint API:  $KB_API_URL"
echo "Endpoint Wiki: $KB_WIKI_URL"
echo ""

# --- 1. Verifica raggiungibilita' endpoint ---
echo "--- Verifica endpoint ---"
HEALTH_CODE=$(curl -s -m 8 -o /dev/null -w "%{http_code}" \
    ${KB_TOKEN:+-H "Authorization: Bearer $KB_TOKEN"} \
    "$KB_API_URL/agentmemory/health" 2>/dev/null || true)
if [ "$HEALTH_CODE" = "200" ]; then
    ok "agentmemory raggiungibile su $KB_API_URL"
elif [ "$HEALTH_CODE" = "401" ]; then
    err "kb-proxy risponde 401: KB_TOKEN mancante o errato"
    err "  sul server: $REPO_DIR/scripts/kb-token.sh"
    err "  sul client: aggiungi KB_TOKEN=<token> in $REPO_DIR/.env e riesegui"
    exit 1
else
    err "agentmemory NON raggiungibile su $KB_API_URL"
    err "Controlla che il server sia attivo e kb-proxy in esecuzione:"
    err "  ssh sul server -> $REPO_DIR/scripts/start-kb.sh"
    exit 1
fi

# --- 2. Node 20+ (richiesto da @agentmemory/mcp) ---
echo ""
echo "--- Verifica Node.js ---"
NODE_OK=0
if command -v node > /dev/null 2>&1; then
    NODE_MAJOR=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_MAJOR" -ge 20 ]; then
        ok "Node $(node -v)"
        NODE_OK=1
    else
        warn "Node $(node -v) troppo vecchio (serve 20+)"
    fi
else
    # prova via nvm
    export NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        # shellcheck disable=SC1091
        . "$NVM_DIR/nvm.sh"
        nvm use 20 > /dev/null 2>&1 || true
        NODE_MAJOR=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo 0)
        if [ "$NODE_MAJOR" -ge 20 ]; then
            ok "Node $(node -v) (via nvm)"
            NODE_OK=1
        fi
    fi
fi
if [ "$NODE_OK" -ne 1 ]; then
    err "Node.js 20+ non disponibile. Installa con:"
    err "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
    err "  nvm install 20 && nvm alias default 20"
    exit 1
fi

# --- Python vero (serve per scrivere i config JSON/YAML) ---
# Su Windows "python3" puo' essere lo stub del Microsoft Store che non esegue nulla:
# si prova davvero a lanciarlo, e si accetta anche "python".
PY=""
for cand in python3 python; do
    if "$cand" -c "import json" > /dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
    err "Python 3 non disponibile (su Windows 'python3' e' spesso solo lo stub dello Store)."
    err "Installa Python oppure scrivi a mano il config MCP come in AGENTS.md"
    err "con AGENTMEMORY_URL=$KB_API_URL, poi: npx skills add rohitg00/agentmemory -y"
    exit 1
fi

# --- 3. Installa dipendenze MCP locale (una tantum) ---
if [ ! -d "$REPO_DIR/node_modules" ] || [ ! -d "$REPO_DIR/mcp/llm-wiki-mcp/node_modules" ]; then
    echo ""
    echo "--- Installazione dipendenze MCP ---"
    (cd "$REPO_DIR" && npm install --no-audit --no-fund > /dev/null 2>&1) && ok "dipendenze repo" || warn "npm install repo fallito"
    (cd "$REPO_DIR/mcp/llm-wiki-mcp" && npm install --no-audit --no-fund > /dev/null 2>&1) && ok "dipendenze llm-wiki-mcp" || warn "npm install llm-wiki-mcp fallito"
fi

WIKI_MCP_BIN="$REPO_DIR/mcp/llm-wiki-mcp/dist/src/index.js"
[ -f "$WIKI_MCP_BIN" ] || WIKI_MCP_BIN="$REPO_DIR/mcp/llm-wiki-mcp/dist/index.js"
# Build se il dist manca (clone fresco senza dist committato)
if [ ! -f "$WIKI_MCP_BIN" ]; then
    echo "--- Build llm-wiki-mcp ---"
    (cd "$REPO_DIR/mcp/llm-wiki-mcp" && npm run build > /dev/null 2>&1) && ok "build llm-wiki-mcp" || warn "build llm-wiki-mcp fallita"
    [ -f "$REPO_DIR/mcp/llm-wiki-mcp/dist/src/index.js" ] && WIKI_MCP_BIN="$REPO_DIR/mcp/llm-wiki-mcp/dist/src/index.js"
fi

# Ricerca locale sulla wiki (qmd): solo se installata con scripts/wiki-search.sh setup
WIKI_SEARCH_CMD=""
if WS_LINES="$("$REPO_DIR/scripts/wiki-search.sh" mcp-cmd 2>/dev/null)"; then
    WIKI_SEARCH_CMD="$(printf '%s\n' "$WS_LINES" | "$PY" -c 'import json,sys; print(json.dumps(sys.stdin.read().split("\n")[:-1]))')"
    ok "wiki-search (qmd) trovato: lo cablo come MCP"
else
    warn "wiki-search (qmd) non installato: per la ricerca locale sulla wiki esegui scripts/wiki-search.sh setup"
fi

# ============================================
# OpenCode
# ============================================
wire_opencode() {
    local CFG="$HOME/.config/opencode/opencode.json"
    mkdir -p "$(dirname "$CFG")"
    [ -f "$CFG" ] || echo '{}' > "$CFG"
    "$PY" - "$CFG" "$KB_API_URL" "$WIKI_MCP_BIN" "$KB_WIKI_URL" "$KB_TOKEN" "$WIKI_SEARCH_CMD" <<'PYEOF'
import json, sys, os
cfg_path, api_url, wiki_bin, wiki_url, token = sys.argv[1:6]
ws_cmd = json.loads(sys.argv[6]) if sys.argv[6] else None
with open(cfg_path) as f:
    cfg = json.load(f)
cfg.setdefault("mcp", {})
cfg["mcp"]["agentmemory"] = {
    "type": "local",
    "command": ["npx", "-y", "@agentmemory/mcp"],
    "environment": {"AGENTMEMORY_URL": api_url, **({"AGENTMEMORY_SECRET": token} if token else {})},
    "enabled": True,
    "timeout": 10000,
}
if os.path.isfile(wiki_bin):
    cfg["mcp"]["llm-wiki"] = {
        "type": "local",
        "command": ["node", wiki_bin],
        "environment": {"LLM_WIKI_API_BASE_URL": wiki_url, **({"LLM_WIKI_API_TOKEN": token} if token else {})},
        "enabled": True,
        "timeout": 10000,
    }
if ws_cmd:
    cfg["mcp"]["wiki-search"] = {
        "type": "local",
        "command": ws_cmd,
        "enabled": True,
        "timeout": 30000,
    }
with open(cfg_path, "w") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"mcp.agentmemory -> {cfg_path}")
if "llm-wiki" in cfg["mcp"]:
    print(f"mcp.llm-wiki    -> {cfg_path}")
PYEOF
    ok "OpenCode cablato: $CFG"
    warn "Riavvia OpenCode per caricare i tools MCP"
}

# ============================================
# Hermes (YAML)
# ============================================
wire_hermes() {
    local CFG="$HOME/.hermes/config.yaml"
    if [ ! -f "$CFG" ]; then
        warn "Hermes non trovato (nessuna $CFG) - salto"
        return
    fi
    if ! grep -q "^mcp_servers:" "$CFG"; then
        printf '\nmcp_servers:\n' >> "$CFG"
    fi
    "$PY" - "$CFG" "$KB_API_URL" "$WIKI_MCP_BIN" "$KB_WIKI_URL" "$KB_TOKEN" "$WIKI_SEARCH_CMD" <<'PYEOF'
import sys, re, os, json
cfg_path, api_url, wiki_bin, wiki_url, token = sys.argv[1:6]
ws_cmd = json.loads(sys.argv[6]) if sys.argv[6] else None
with open(cfg_path) as f:
    text = f.read()

def set_env(text, block_name, after_key, key, value):
    """Imposta key: "value" nel blocco env di block_name (dopo after_key)."""
    m = re.search(r"^  " + re.escape(block_name) + r":\n((?:    .*\n|\s*\n)*)", text, re.M)
    if not m:
        return text
    body = m.group(1)
    line = f'      {key}: "{value}"\n'
    if re.search(r"^      " + key + r":.*\n", body, re.M):
        body = re.sub(r"^      " + key + r":.*\n", lambda _: line, body, count=1, flags=re.M)
    else:
        body = re.sub(r"(^      " + after_key + r":.*\n)", lambda mm: mm.group(1) + line, body, count=1, flags=re.M)
    return text[:m.start(1)] + body + text[m.end(1):]

agent_block = f"""mcp_servers:
  agentmemory:
    command: npx
    args: ["-y", "@agentmemory/mcp"]
    env:
      AGENTMEMORY_URL: {api_url}
    enabled: true
"""

if re.search(r"^  agentmemory:", text, re.M):
    # riscrivi l'URL esistente
    text = re.sub(
        r"(^  agentmemory:.*?AGENTMEMORY_URL:\s*)\S+",
        lambda m: m.group(1) + api_url,
        text, count=1, flags=re.S | re.M,
    )
else:
    # inserisci subito dopo 'mcp_servers:'
    text = re.sub(r"^mcp_servers:\n", agent_block, text, count=1, flags=re.M)

wiki_path = wiki_bin
if re.search(r"^  llm-wiki:", text, re.M):
    # path corretto + URL + abilita'
    text = re.sub(r"(^      - )\S*llm-wiki-mcp\S*dist\S*",
                  lambda m: m.group(1) + wiki_path, text, count=1, flags=re.M)
    if wiki_path.endswith("index.js") is False:
        text = re.sub(r"(^      - )\S+/dist/src/index\.js",
                      lambda m: m.group(1) + wiki_path, text, count=1, flags=re.M)
    text = re.sub(r"(^      LLM_WIKI_API_BASE_URL:\s*)\S+",
                  lambda m: m.group(1) + wiki_url, text, count=1, flags=re.M)
    # imposta enabled: true sul blocco llm-wiki
    text = re.sub(r"(^  llm-wiki:.*?enabled:\s*)false",
                  lambda m: m.group(1) + "true",
                  text, count=1, flags=re.S | re.M)
elif os.path.isfile(wiki_path):
    wiki_block = f"""  llm-wiki:
    command: node
    args:
      - {wiki_path}
    env:
      LLM_WIKI_API_BASE_URL: {wiki_url}
    enabled: true
"""
    # inserisci prima di eventuali commenti finali dopo mcp_servers
    text = re.sub(r"(^mcp_servers:\n)", r"\1" + wiki_block, text, count=1, flags=re.M)

if token:
    text = set_env(text, "agentmemory", "AGENTMEMORY_URL", "AGENTMEMORY_SECRET", token)
    text = set_env(text, "llm-wiki", "LLM_WIKI_API_BASE_URL", "LLM_WIKI_API_TOKEN", token)

if ws_cmd:
    ws_block = "  wiki-search:\n    command: " + ws_cmd[0] + "\n    args:\n" + \
        "".join(f"      - {a}\n" for a in ws_cmd[1:]) + "    enabled: true\n"
    if re.search(r"^  wiki-search:", text, re.M):
        # sostituisci il blocco esistente (fino alla prossima chiave a 2 spazi o fine sezione)
        text = re.sub(r"^  wiki-search:\n(?:    .*\n|      .*\n)*", ws_block, text, count=1, flags=re.M)
    else:
        text = re.sub(r"(^mcp_servers:\n)", lambda m: m.group(1) + ws_block, text, count=1, flags=re.M)

with open(cfg_path, "w") as f:
    f.write(text)
print("Hermes mcp_servers aggiornato")
PYEOF
    ok "Hermes cablato: $CFG"
    warn "Riavvia Hermes per caricare i tools MCP"
}

# ============================================
# Cursor (mcp.json)
# ============================================
wire_cursor() {
    local DIR="$HOME/.cursor"
    if [ ! -d "$DIR" ]; then
        warn "Cursor non trovato - salto"
        return
    fi
    local CFG="$DIR/mcp.json"
    [ -f "$CFG" ] || echo '{"mcpServers":{}}' > "$CFG"
    "$PY" - "$CFG" "$KB_API_URL" "$WIKI_MCP_BIN" "$KB_WIKI_URL" "$KB_TOKEN" "$WIKI_SEARCH_CMD" <<'PYEOF'
import json, sys, os
cfg_path, api_url, wiki_bin, wiki_url, token = sys.argv[1:6]
ws_cmd = json.loads(sys.argv[6]) if sys.argv[6] else None
with open(cfg_path) as f:
    cfg = json.load(f)
cfg.setdefault("mcpServers", {})
cfg["mcpServers"]["agentmemory"] = {
    "command": "npx",
    "args": ["-y", "@agentmemory/mcp"],
    "env": {"AGENTMEMORY_URL": api_url, **({"AGENTMEMORY_SECRET": token} if token else {})},
}
if os.path.isfile(wiki_bin):
    cfg["mcpServers"]["llm-wiki"] = {
        "command": "node",
        "args": [wiki_bin],
        "env": {"LLM_WIKI_API_BASE_URL": wiki_url, **({"LLM_WIKI_API_TOKEN": token} if token else {})},
    }
if ws_cmd:
    cfg["mcpServers"]["wiki-search"] = {"command": ws_cmd[0], "args": ws_cmd[1:]}
with open(cfg_path, "w") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"mcpServers -> {cfg_path}")
PYEOF
    ok "Cursor cablato: $CFG"
    warn "Riavvia Cursor per caricare i tools MCP"
}

# ============================================
# VS Code (mcp.json in .vscode del workspace o user)
# ============================================
wire_vscode() {
    local CFG=""
    if [ -d "$PWD/.vscode" ]; then
        CFG="$PWD/.vscode/mcp.json"
    elif [ -d "$HOME/.config/Code/User" ]; then
        CFG="$HOME/.config/Code/User/mcp.json"
    elif [ -d "$HOME/Library/Application Support/Code/User" ]; then
        CFG="$HOME/Library/Application Support/Code/User/mcp.json"
    fi
    if [ -z "$CFG" ]; then
        warn "VS Code non trovato - salto"
        return
    fi
    mkdir -p "$(dirname "$CFG")"
    [ -f "$CFG" ] || echo '{"servers":{}}' > "$CFG"
    "$PY" - "$CFG" "$KB_API_URL" "$WIKI_MCP_BIN" "$KB_WIKI_URL" "$KB_TOKEN" "$WIKI_SEARCH_CMD" <<'PYEOF'
import json, sys, os
cfg_path, api_url, wiki_bin, wiki_url, token = sys.argv[1:6]
ws_cmd = json.loads(sys.argv[6]) if sys.argv[6] else None
with open(cfg_path) as f:
    cfg = json.load(f)
cfg.setdefault("servers", {})
cfg["servers"]["agentmemory"] = {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@agentmemory/mcp"],
    "env": {"AGENTMEMORY_URL": api_url, **({"AGENTMEMORY_SECRET": token} if token else {})},
}
if os.path.isfile(wiki_bin):
    cfg["servers"]["llm-wiki"] = {
        "type": "stdio",
        "command": "node",
        "args": [wiki_bin],
        "env": {"LLM_WIKI_API_BASE_URL": wiki_url, **({"LLM_WIKI_API_TOKEN": token} if token else {})},
    }
if ws_cmd:
    cfg["servers"]["wiki-search"] = {"type": "stdio", "command": ws_cmd[0], "args": ws_cmd[1:]}
with open(cfg_path, "w") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"servers -> {cfg_path}")
PYEOF
    ok "VS Code cablato: $CFG"
    warn "Riavvia VS Code per caricare i tools MCP"
}

echo ""
echo "--- Cablaggio agenti trovati ---"
wire_opencode
wire_hermes
wire_cursor
wire_vscode

# --- Skill native di agentmemory (dicono all'agente quando usare la memoria) ---
# KB_SKIP_SKILLS=1 per saltarle
if [ "${KB_SKIP_SKILLS:-0}" != "1" ]; then
    echo ""
    echo "--- Skill agentmemory ---"
    if npx -y skills add rohitg00/agentmemory -y > /tmp/kb-skills.log 2>&1; then
        ok "skill agentmemory installate negli agenti rilevati"
    else
        warn "installazione skill fallita (log: /tmp/kb-skills.log). A mano: npx skills add rohitg00/agentmemory -y"
    fi
fi

echo ""
echo "=============================================="
ok "Cablaggio completato!"
echo "=============================================="
echo ""
echo "Endpoint (cambiabile in config/endpoint.env):"
echo "  API:   $KB_API_URL"
echo "  Wiki:  $KB_WIKI_URL"
echo "  View:  ${KB_VIEWER_URL:-http://192.168.68.55:8313}"
echo ""
[ -n "$KB_TOKEN" ] || warn "Nessun KB_TOKEN: cablaggio senza token (funziona solo con KB_AUTH=off sul server)"
echo "Prossimo passo: riavvia gli agenti cablati."
echo "Test manuale:"
echo "  curl -X POST $KB_API_URL/agentmemory/search -H \"Authorization: Bearer \$KB_TOKEN\" -H 'Content-Type: application/json' -d '{\"query\":\"test\"}'"
