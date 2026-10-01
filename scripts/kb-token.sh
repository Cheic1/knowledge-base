#!/bin/bash
# ============================================
# kb-token.sh - Token condiviso per il kb-proxy (KB_TOKEN in <repo>/.env)
#
# Uso:
#   ./scripts/kb-token.sh          # stampa il token (lo genera se manca)
#   ./scripts/kb-token.sh rotate   # genera un nuovo token
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
    *)
        echo "Uso: $0 {show|rotate}"
        exit 1
        ;;
esac
