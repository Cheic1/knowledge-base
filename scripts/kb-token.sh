#!/bin/bash
# ============================================
# kb-token.sh - Token condiviso per il kb-proxy (KB_TOKEN in <repo>/.env)
#
# Uso:
#   ./scripts/kb-token.sh          # stampa il token (lo genera se manca)
#   ./scripts/kb-token.sh rotate   # genera un nuovo token
#   ./scripts/kb-token.sh set VALORE   # usa un token scelto da te (lettere, cifre . _ ~ + = -)
#   echo VALORE | ./scripts/kb-token.sh set -   # come sopra, senza lasciarlo negli argomenti
#
# Il token va copiato nel .env di ogni PC client (KB_TOKEN=...)
# e poi va rieseguito scripts/connect-agent.sh.
# ============================================
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_DIR/.env"

gen_token() {
    if command -v openssl > /dev/null 2>&1; then
        openssl rand -hex 32
    else
        head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
}

current_token() {
    [ -f "$ENV_FILE" ] || return 0
    sed -n 's/^[[:space:]]*KB_TOKEN[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | tail -n 1 | tr -d "\"'"
}

write_token() {
    local token="$1"
    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    if grep -q '^[[:space:]]*KB_TOKEN[[:space:]]*=' "$ENV_FILE"; then
        sed -i "s/^[[:space:]]*KB_TOKEN[[:space:]]*=.*/KB_TOKEN=$token/" "$ENV_FILE"
    else
        printf '\n# Token condiviso kb-proxy (scripts/kb-token.sh)\nKB_TOKEN=%s\n' "$token" >> "$ENV_FILE"
    fi
}

case "${1:-show}" in
    show)
        TOKEN="$(current_token)"
        if [ -z "$TOKEN" ]; then
            TOKEN="$(gen_token)"
            write_token "$TOKEN"
            echo "Nuovo KB_TOKEN generato in $ENV_FILE" >&2
        fi
        echo "$TOKEN"
        ;;
    rotate)
        TOKEN="$(gen_token)"
        write_token "$TOKEN"
        echo "KB_TOKEN ruotato in $ENV_FILE: riavvia kb-proxy e ricabla i client" >&2
        echo "$TOKEN"
        ;;
    set)
        TOKEN="${2:-}"
        [ "$TOKEN" = "-" ] && IFS= read -r TOKEN
        if [ -z "$TOKEN" ]; then echo "Uso: $0 set VALORE" >&2; exit 1; fi
        case "$TOKEN" in
            *[!A-Za-z0-9._~+=-]*) echo "Token non valido: usa solo lettere, cifre e . _ ~ + = -" >&2; exit 1 ;;
        esac
        [ "${#TOKEN}" -ge 12 ] || echo "ATTENZIONE: token corto (${#TOKEN} caratteri): facile da indovinare, va bene solo in rete fidata" >&2
        write_token "$TOKEN"
        echo "KB_TOKEN impostato in $ENV_FILE: riavvia kb-proxy (systemctl --user restart kb-proxy)" >&2
        ;;
    *)
        echo "Uso: $0 {show|rotate|set VALORE}"
        exit 1
        ;;
esac
