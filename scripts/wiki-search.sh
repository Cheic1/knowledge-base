#!/bin/bash
# ============================================
# wiki-search.sh - Ricerca locale sulla wiki con qmd (MCP)
#
# Schema: UNA macchina fa l'ingestion (llm_wiki o llm-wiki-agent) e fa
# push di wiki/ su git. Gli altri PC fanno pull e cercano in locale con
# qmd (BM25 + vettori + rerank, modelli locali), senza l'app llm_wiki aperta.
# L'indice sta in ~/.cache/qmd/kb.sqlite: e' per-PC e NON va in git.
#
# Uso:
#   ./scripts/wiki-search.sh setup        # installa qmd, crea l'indice, hook git
#   ./scripts/wiki-search.sh update       # git pull + reindicizza + embedding
#   ./scripts/wiki-search.sh update --no-pull
#   ./scripts/wiki-search.sh status
#   ./scripts/wiki-search.sh search "testo"   # prova veloce da terminale
#   ./scripts/wiki-search.sh mcp-cmd      # stampa il comando MCP (per connect-agent.sh)
#
# Dopo `setup`, gli hook git post-merge/post-rewrite rilanciano
# `update --no-pull` in background a ogni pull: l'indice resta allineato.
# ============================================
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QMD_VERSION="${QMD_VERSION:-^2.8.3}"
QMD_PREFIX="${QMD_PREFIX:-$HOME/.local/share/kb-qmd}"
QMD_INDEX="${QMD_INDEX:-kb}"
QMD_BIN="$QMD_PREFIX/node_modules/@tobilu/qmd/bin/qmd"
NODE22_FILE="$QMD_PREFIX/node-path"
LOG_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/qmd/$QMD_INDEX-update.log"

# Cartelle indicizzate: nome collezione -> path (solo markdown)
COLLECTIONS=(
    "wiki|$REPO_DIR/wiki/wiki|Pagine della wiki KB (entita', concetti, fonti, sintesi), generate dall'ingestion"
    "projects|$REPO_DIR/projects|Note e documentazione dei progetti"
)

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1" >&2; }

# --- Node 22+ (qmd lo richiede; agentmemory va con 20, quindi lo cerchiamo a parte) ---
find_node22() {
    local cand major
    if [ -f "$NODE22_FILE" ] && [ -x "$(cat "$NODE22_FILE")" ]; then
        cat "$NODE22_FILE"; return 0
    fi
    for cand in "$(command -v node 2>/dev/null)"; do
        [ -n "$cand" ] || continue
        major=$("$cand" -v | cut -d'v' -f2 | cut -d'.' -f1)
        [ "$major" -ge 22 ] && { echo "$cand"; return 0; }
    done
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        # shellcheck disable=SC1091
        . "$NVM_DIR/nvm.sh"
        for cand in $(nvm ls --no-colors --no-alias 2>/dev/null | grep -oE 'v(2[2-9]|[3-9][0-9])\.[0-9]+\.[0-9]+' | sort -Vr); do
            [ -x "$NVM_DIR/versions/node/$cand/bin/node" ] && { echo "$NVM_DIR/versions/node/$cand/bin/node"; return 0; }
        done
    fi
    return 1
}

require_node22() {
    NODE22="$(find_node22)" || {
        err "Serve Node.js 22+ per qmd. Con nvm:  nvm install 22   (agentmemory puo' restare su 20)"
        exit 1
    }
}

qmd() {
    "$NODE22" "$QMD_BIN" "$@" --index "$QMD_INDEX"
}

require_qmd() {
    require_node22
    [ -f "$QMD_BIN" ] || { err "qmd non installato: esegui prima $0 setup"; exit 1; }
}

# --- setup ---
cmd_setup() {
    require_node22
    ok "Node $("$NODE22" -v) ($NODE22)"

    echo "--- Installazione qmd in $QMD_PREFIX ---"
    mkdir -p "$QMD_PREFIX"
    [ -f "$QMD_PREFIX/package.json" ] || echo '{"private":true}' > "$QMD_PREFIX/package.json"
    PATH="$(dirname "$NODE22"):$PATH" npm install --prefix "$QMD_PREFIX" --no-audit --no-fund \
        "@tobilu/qmd@$QMD_VERSION" > /dev/null
    echo "$NODE22" > "$NODE22_FILE"
    ok "$("$NODE22" "$QMD_BIN" --version 2>/dev/null | head -1)"

    echo "--- Collezioni (indice '$QMD_INDEX') ---"
    local entry name path ctx existing
    existing="$(qmd collection list 2>/dev/null || true)"
    for entry in "${COLLECTIONS[@]}"; do
        IFS='|' read -r name path ctx <<< "$entry"
        [ -d "$path" ] || { warn "$path non esiste, salto '$name'"; continue; }
        if echo "$existing" | grep -qE "^$name( |$|:)|qmd://$name/"; then
            ok "collezione '$name' gia' presente"
        else
            qmd collection add "$path" --name "$name" > /dev/null
            qmd context add "qmd://$name" "$ctx" > /dev/null
            ok "collezione '$name' -> $path"
        fi
    done

    install_hooks

    echo "--- Primo indice + embedding (al primo giro scarica ~2 GB di modelli) ---"
    cmd_update --no-pull
    echo ""
    ok "Fatto. Ora esegui ./scripts/connect-agent.sh per cablare il MCP 'wiki-search' negli agenti."
}

install_hooks() {
    local hooks_dir hook
    hooks_dir="$(git -C "$REPO_DIR" rev-parse --git-path hooks)"
    case "$hooks_dir" in /*) ;; *) hooks_dir="$REPO_DIR/$hooks_dir" ;; esac
    mkdir -p "$hooks_dir"
    # post-merge: git pull (merge/ff) - post-rewrite: git pull --rebase (sync.sh)
    for hook in post-merge post-rewrite; do
        if [ -f "$hooks_dir/$hook" ] && ! grep -q "wiki-search.sh" "$hooks_dir/$hook"; then
            warn "hook $hook esistente non nostro: aggiungi a mano 'scripts/wiki-search.sh update --no-pull --background'"
            continue
        fi
        cat > "$hooks_dir/$hook" <<'EOF'
#!/bin/sh
# Installato da scripts/wiki-search.sh: riallinea l'indice qmd dopo il pull
[ "$(basename "$0")" = "post-rewrite" ] && [ "$1" != "rebase" ] && exit 0
"$(git rev-parse --show-toplevel)/scripts/wiki-search.sh" update --no-pull --background || true
EOF
        chmod +x "$hooks_dir/$hook"
    done
    ok "hook git post-merge/post-rewrite installati"
}

# --- update ---
cmd_update() {
    local pull=1 bg=0 arg
    for arg in "$@"; do
        case "$arg" in
            --no-pull) pull=0 ;;
            --background) bg=1 ;;
        esac
    done
    require_qmd

    if [ "$bg" -eq 1 ]; then
        mkdir -p "$(dirname "$LOG_FILE")"
        nohup "$0" update --no-pull >> "$LOG_FILE" 2>&1 &
        echo "wiki-search: aggiornamento indice in background (log: $LOG_FILE)"
        return 0
    fi

    # Un solo update alla volta (hook + comando manuale)
    local lock="${XDG_CACHE_HOME:-$HOME/.cache}/qmd/$QMD_INDEX-update.lock"
    mkdir -p "$(dirname "$lock")"
    if command -v flock > /dev/null 2>&1; then
        exec 9> "$lock"
        flock -n 9 || { warn "update gia' in corso, salto"; return 0; }
    fi

    echo "[$(date '+%F %T')] wiki-search update"
    if [ "$pull" -eq 1 ]; then
        git -C "$REPO_DIR" pull --ff-only || warn "git pull fallito: indicizzo la copia locale"
    fi
    qmd update
    # Gli embedding servono per la ricerca semantica; senza, resta la ricerca per parole (BM25)
    if qmd embed; then
        ok "indice ed embedding aggiornati"
    else
        warn "embedding falliti (modelli non scaricabili?): la ricerca per parole funziona comunque"
    fi
}

cmd_status() { require_qmd; qmd status; }

cmd_search() { require_qmd; qmd search "$@"; }

# Comando MCP stdio, una parola per riga (letto da connect-agent.sh)
cmd_mcp_cmd() {
    require_qmd
    printf '%s\n' "$NODE22" "$QMD_BIN" mcp --index "$QMD_INDEX"
}

case "${1:-}" in
    setup)   shift; cmd_setup "$@" ;;
    update)  shift; cmd_update "$@" ;;
    status)  cmd_status ;;
    search)  shift; cmd_search "$@" ;;
    mcp-cmd) cmd_mcp_cmd ;;
    *)
        echo "Uso: $0 {setup|update [--no-pull]|status|search \"testo\"|mcp-cmd}"
        exit 1
        ;;
esac
