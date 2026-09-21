#!/bin/bash

# ============================================
# My Knowledge Base - Start agentmemory
# ============================================

set -e

# --------------------------------------------
# Configurazione
# --------------------------------------------
KB_DIR="/DATA/AppData/my-knowledge-base"
AGENTMEMORY_DIR="$KB_DIR/.agentmemory"

# --------------------------------------------
# Colori
# --------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# --------------------------------------------
# Funzioni
# --------------------------------------------
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# --------------------------------------------
# Verifica prerequisiti
# --------------------------------------------
check_prerequisites() {
    log_info "Verifica prerequisiti..."
    
    # Verifica Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js non installato"
        log_info "Installa Node.js: https://nodejs.org/"
        exit 1
    fi
    
    # Verifica npm
    if ! command -v npm &> /dev/null; then
        log_error "npm non installato"
        exit 1
    fi
    
    # Verifica directory
    if [ ! -d "$KB_DIR" ]; then
        log_error "Directory knowledge base non trovata: $KB_DIR"
        exit 1
    fi
    
    log_success "Prerequisiti OK"
}

# --------------------------------------------
# Ferma agentmemory se in esecuzione
# --------------------------------------------
stop_agentmemory() {
    log_info "Fermando agentmemory esistente..."
    
    # Trova PID
    PID=$(lsof -ti :3111 2>/dev/null || true)
    
    if [ -n "$PID" ]; then
        log_info "Trovato agentmemory con PID $PID"
        kill $PID 2>/dev/null || true
        sleep 2
        log_success "agentmemory fermato"
    else
        log_info "Nessun agentmemory in esecuzione"
    fi
}

# --------------------------------------------
# Avvia agentmemory
# --------------------------------------------
start_agentmemory() {
    log_info "Avvio agentmemory..."
    
    # Vai nella directory knowledge base
    cd "$KB_DIR"
    
    # Avvia agentmemory in background
    cd "$KB_DIR"
    AGENTMEMORY_DATA_DIR="$AGENTMEMORY_DIR" npx @agentmemory/agentmemory &
    
    # Attendi che sia pronto
    log_info "Attendo che agentmemory sia pronto..."
    for i in {1..30}; do
        if curl -s http://localhost:3111/agentmemory/health > /dev/null 2>&1; then
            log_success "agentmemory avviato con successo!"
            log_info "Health check: http://localhost:3111/agentmemory/health"
            log_info "Viewer: http://localhost:3113"
            return 0
        fi
        sleep 1
    done
    
    log_error "agentmemory non si avvia entro 30 secondi"
    return 1
}

# --------------------------------------------
# Mostra status
# --------------------------------------------
show_status() {
    log_info "Status agentmemory:"
    
    # Verifica se in esecuzione
    if curl -s http://localhost:3111/agentmemory/health > /dev/null 2>&1; then
        log_success "agentmemory è in esecuzione"
        
        echo ""
        echo "📊 Statistiche:"
        curl -s http://localhost:3111/agentmemory/health | jq . 2>/dev/null || echo "   (jq non installato per formattazione)"
        
        echo ""
        echo "🔗 Link:"
        echo "   - Health: http://localhost:3111/agentmemory/health"
        echo "   - Viewer: http://localhost:3113"
        echo "   - API: http://localhost:3111"
    else
        log_warning "agentmemory NON è in esecuzione"
        echo ""
        echo "Per avviarlo: $0 start"
    fi
}

# --------------------------------------------
# Main
# --------------------------------------------
main() {
    echo "=========================================="
    echo "  My Knowledge Base - agentmemory"
    echo "=========================================="
    echo ""
    
    case "${1:-start}" in
        start)
            check_prerequisites
            stop_agentmemory
            start_agentmemory
            ;;
        stop)
            stop_agentmemory
            ;;
        status)
            show_status
            ;;
        restart)
            check_prerequisites
            stop_agentmemory
            start_agentmemory
            ;;
        *)
            echo "Uso: $0 {start|stop|status|restart}"
            echo ""
            echo "  start   - Avvia agentmemory (default)"
            echo "  stop    - Ferma agentmemory"
            echo "  status  - Mostra status"
            echo "  restart - Riavvia agentmemory"
            exit 1
            ;;
    esac
}

main "$@"