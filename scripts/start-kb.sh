#!/bin/bash
# ============================================
# start-kb.sh - Avvia knowledge base completa (agentmemory + kb-proxy)
#
# Se le unit systemd sono installate (scripts/install-systemd.sh)
# delega a systemctl --user, altrimenti avvia i processi con nohup.
#
# Uso:
#   ./scripts/start-kb.sh          # avvia tutto
#   ./scripts/start-kb.sh stop     # ferma tutto
#   ./scripts/start-kb.sh status   # stato
# ============================================
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_AM="/tmp/agentmemory.log"
LOG_PROXY="/tmp/kb-proxy.log"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; }

load_node() {
    export NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        # shellcheck disable=SC1091
        . "$NVM_DIR/nvm.sh"
        nvm use 20 > /dev/null 2>&1 || nvm use --lts > /dev/null 2>&1 || true
    fi
    if ! command -v node > /dev/null 2>&1 || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 20 ]; then
        err "Node 20+ non disponibile (node: $(node -v 2>/dev/null || echo assente))"
        exit 1
    fi
}

UNITS="kb-agentmemory.service kb-proxy.service"

# true se le unit systemd utente sono installate e abilitate
use_systemd() {
    systemctl --user is-enabled kb-proxy.service > /dev/null 2>&1
}

kb_token() {
    "$REPO_DIR/scripts/kb-token.sh" 2>/dev/null
}

start_all() {
    if use_systemd; then
        # shellcheck disable=SC2086
        systemctl --user start $UNITS
        ok "Knowledge Base avviata via systemd (riavvio automatico attivo)"
        return
    fi
    load_node
    cd "$REPO_DIR"

    # Ferma i vecchi processi (PIDs specifici, non pkill -f 'iii' che rischia kill indesiderati)
    stop_all quiet

    echo "--- Avvio agentmemory ---"
    nohup agentmemory > "$LOG_AM" 2>&1 &
    AM_PID=$!
    for i in $(seq 1 30); do
        if curl -sf -m 3 http://127.0.0.1:3111/agentmemory/health > /dev/null 2>&1; then
            ok "agentmemory healthy (PID $AM_PID)"
            break
        fi
        [ "$i" -eq 30 ] && { err "agentmemory non pronto entro 30s (log: $LOG_AM)"; exit 1; }
        sleep 1
    done

    echo "--- Avvio kb-proxy (LAN 8311/8313/8318) ---"
    kb_token > /dev/null   # genera KB_TOKEN in .env se manca
    nohup node "$REPO_DIR/scripts/kb-proxy.js" > "$LOG_PROXY" 2>&1 &
    PROXY_PID=$!
    sleep 1

    IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "IP-SERVER")
    echo ""
    echo "=============================================="
    ok "Knowledge Base avviata!"
    echo "=============================================="
    echo "  API:      http://$IP:8311  (agentmemory)"
    echo "  Viewer:   http://$IP:8313"
    echo "  Wiki API: http://$IP:8318  (serve l'app llm_wiki attiva)"
    echo "  Locale:   http://127.0.0.1:3111/agentmemory/health"
    echo ""
    echo "  Token:    $REPO_DIR/scripts/kb-token.sh  (Bearer per i client)"
    echo "  Log: $LOG_AM / $LOG_PROXY"
    echo "  Cabla agenti: $REPO_DIR/scripts/connect-agent.sh"
    echo "=============================================="
}

stop_all() {
    local MODE="${1:-}"
    if use_systemd; then
        # shellcheck disable=SC2086
        systemctl --user stop $UNITS
        [ "$MODE" = "quiet" ] || ok "Knowledge Base fermata (systemd)"
        return
    fi
    [ "$MODE" = "quiet" ] && exec 3>&1 1>/dev/null 2>&1

    # kb-proxy (node kb-proxy.js)
    for pid in $(pgrep -f "kb-proxy.js" 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
    # agentmemory (processo node agentmemory)
    if command -v agentmemory > /dev/null 2>&1; then
        agentmemory stop --force > /dev/null 2>&1 || true
    fi
    for pid in $(pgrep -x "agentmemory" 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
    # iii engine
    for pid in $(pgrep -f "iii.bin --config" 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
    # listener residui sulle porte KB
    for port in 3111 3112 3113 49134 8311 8313 8318; do
        for pid in $(lsof -ti ":$port" 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
    done
    sleep 2
    [ "$MODE" = "quiet" ] && exec 1>&3 3>&-
    [ "$MODE" = "quiet" ] || ok "Knowledge Base fermata"
}

show_status() {
    echo "--- Stato ---"
    if use_systemd; then
        for u in $UNITS; do
            echo "    systemd $u: $(systemctl --user is-active "$u" 2>/dev/null || true)"
        done
    fi
    if curl -sf -m 3 http://127.0.0.1:3111/agentmemory/health > /dev/null 2>&1; then
        ok "agentmemory: healthy (127.0.0.1:3111)"
    else
        err "agentmemory: NON attivo"
    fi
    if pgrep -f "kb-proxy.js" > /dev/null 2>&1; then
        ok "kb-proxy: attivo"
        TOKEN="$(kb_token)"
        for port in 8311 8313 8318; do
            code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$port/" 2>/dev/null || echo "down")
            echo "    :$port -> HTTP $code"
        done
    else
        err "kb-proxy: NON attivo"
    fi
    IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "IP-SERVER")
    echo ""
    echo "  Viewer LAN: http://$IP:8313"
}

case "${1:-start}" in
    start)  start_all ;;
    stop)   stop_all ;;
    restart) stop_all; sleep 1; start_all ;;
    status) show_status ;;
    *)
        echo "Uso: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
