#!/bin/bash
# ============================================
# install-systemd.sh - Installa agentmemory + kb-proxy come unit
# systemd utente con riavvio automatico (Restart=always).
#
# Uso:
#   ./scripts/install-systemd.sh             # installa/aggiorna e avvia
#   ./scripts/install-systemd.sh uninstall   # rimuove le unit
#
# Dopo l'installazione start-kb.sh usa systemctl --user.
# Log: journalctl --user -u kb-agentmemory -u kb-proxy -f
# ============================================
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
UNITS="kb-agentmemory.service kb-proxy.service"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; }

if ! systemctl --user show-environment > /dev/null 2>&1; then
    err "systemctl --user non disponibile (manca la sessione utente systemd)."
    err "Su questo host serve una unit di sistema in /etc/systemd/system."
    exit 1
fi

uninstall() {
    for u in $UNITS; do
        systemctl --user disable --now "$u" > /dev/null 2>&1 || true
        rm -f "$UNIT_DIR/$u"
    done
    systemctl --user daemon-reload
    ok "Unit rimosse (start-kb.sh torna alla modalita' nohup)"
}

install() {
    # Node 20+ e agentmemory con path assoluti (nvm non e' nel PATH di systemd)
    export NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        # shellcheck disable=SC1091
        . "$NVM_DIR/nvm.sh"
        nvm use 20 > /dev/null 2>&1 || nvm use --lts > /dev/null 2>&1 || true
    fi
    NODE_BIN="$(command -v node || true)"
    # AGENTMEMORY_BIN: la versione fissata nel repo (la passa scripts/kb.mjs)
    AM_BIN="${AGENTMEMORY_BIN:-$(command -v agentmemory || true)}"
    if [ -z "$NODE_BIN" ] || [ "$("$NODE_BIN" -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 20 ]; then
        err "Node 20+ non trovato"; exit 1
    fi
    if [ -z "$AM_BIN" ]; then
        err "agentmemory non trovato nel PATH (npm install -g @agentmemory/agentmemory)"; exit 1
    fi
    UNIT_PATH="$(dirname "$NODE_BIN"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

    # Token del proxy (lo genera in .env se manca)
    "$REPO_DIR/scripts/kb-token.sh" > /dev/null

    # Ferma eventuali processi avviati a mano (nohup)
    if ! systemctl --user is-enabled kb-proxy.service > /dev/null 2>&1; then
        "$REPO_DIR/scripts/start-kb.sh" stop > /dev/null 2>&1 || true
    fi

    mkdir -p "$UNIT_DIR"
    for u in $UNITS; do
        sed -e "s|@REPO_DIR@|$REPO_DIR|g" \
            -e "s|@NODE_BIN@|$NODE_BIN|g" \
            -e "s|@AGENTMEMORY_BIN@|$AM_BIN|g" \
            -e "s|@PATH@|$UNIT_PATH|g" \
            "$REPO_DIR/systemd/$u" > "$UNIT_DIR/$u"
        ok "$UNIT_DIR/$u"
    done

    systemctl --user daemon-reload
    # shellcheck disable=SC2086
    systemctl --user enable $UNITS > /dev/null
    # shellcheck disable=SC2086
    systemctl --user restart $UNITS
    ok "Unit abilitate e avviate"

    # Senza linger le unit utente partono solo al login, non al boot
    if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
        if loginctl enable-linger "$USER" > /dev/null 2>&1; then
            ok "Linger abilitato: le unit partono al boot"
        else
            warn "Abilita l'avvio al boot con: sudo loginctl enable-linger $USER"
        fi
    fi

    echo ""
    echo "  Stato: $REPO_DIR/scripts/start-kb.sh status"
    echo "  Log:   journalctl --user -u kb-agentmemory -u kb-proxy -f"
}

case "${1:-install}" in
    install)   install ;;
    uninstall) uninstall ;;
    *) echo "Uso: $0 {install|uninstall}"; exit 1 ;;
esac
