#!/bin/bash

# ============================================
# My Knowledge Base - Sync Script
# ============================================

set -e

# --------------------------------------------
# Configurazione
# --------------------------------------------
KB_DIR="/DATA/AppData/my-knowledge-base"
REMOTE="origin"
BRANCH="main"

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
    
    # Verifica Git
    if ! command -v git &> /dev/null; then
        log_error "Git non installato"
        exit 1
    fi
    
    # Verifica directory
    if [ ! -d "$KB_DIR/.git" ]; then
        log_warning "Repository Git non inizializzato"
        log_info "Inizializzo repository..."
        cd "$KB_DIR"
        git init
        git remote add $REMOTE git@github.com:Cheic1/knowledge-base.git
        log_success "Repository inizializzato"
    fi
    
    log_success "Prerequisiti OK"
}

# --------------------------------------------
# Pull (scarica modifiche remote)
# --------------------------------------------
pull_changes() {
    log_info "Pulling changes from remote..."
    cd "$KB_DIR"
    
    # Verifica se ci sono modifiche remote
    if git ls-remote $REMOTE &> /dev/null; then
        git pull --rebase $REMOTE $BRANCH || {
            log_warning "Conflict durante pull. Risolvi manualmente."
            return 1
        }
        log_success "Pull completato"
    else
        log_warning "Remote non configurato o non raggiungibile"
    fi
}

# --------------------------------------------
# Push (invia modifiche locali)
# --------------------------------------------
push_changes() {
    log_info "Pushing changes to remote..."
    cd "$KB_DIR"
    
    # Aggiungi tutte le modifiche
    git add -A
    
    # Verifica se ci sono modifiche da committare
    if git diff --cached --quiet; then
        log_info "Nessuna modifica da committare"
        return 0
    fi
    
    # Crea commit con timestamp
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    git commit -m "Auto-sync: $TIMESTAMP"
    
    # Push
    git push $REMOTE $BRANCH || {
        log_error "Errore durante push"
        return 1
    }
    
    log_success "Push completato"
}

# --------------------------------------------
# Status
# --------------------------------------------
show_status() {
    log_info "Status della knowledge base:"
    cd "$KB_DIR"
    
    echo ""
    echo "📁 Directory: $KB_DIR"
    echo "📊 Statistiche:"
    echo "   - File wiki: $(find wiki/wiki -name "*.md" 2>/dev/null | wc -l)"
    echo "   - File raw: $(find wiki/raw -type f 2>/dev/null | wc -l)"
    echo "   - Memory: $(find .agentmemory -name "*.json" 2>/dev/null | wc -l)"
    echo ""
    
    echo "🔄 Git Status:"
    git status --short
    echo ""
    
    echo "📝 Ultimi 5 commit:"
    git log --oneline -5
    echo ""
}

# --------------------------------------------
# Backup
# --------------------------------------------
backup() {
    log_info "Backup knowledge base..."
    cd "$KB_DIR"
    
    BACKUP_DIR="$KB_DIR/backups"
    TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
    BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.tar.gz"
    
    mkdir -p "$BACKUP_DIR"
    
    # Escludi .git e backup precedenti
    tar -czf "$BACKUP_FILE" \
        --exclude='.git' \
        --exclude='backups' \
        --exclude='node_modules' \
        .
    
    log_success "Backup creato: $BACKUP_FILE"
    
    # Mantieni solo gli ultimi 10 backup
    cd "$BACKUP_DIR"
    ls -t backup_*.tar.gz | tail -n +11 | xargs -r rm
    log_info "Backup vecchi eliminati"
}

# --------------------------------------------
# Main
# --------------------------------------------
main() {
    echo "=========================================="
    echo "  My Knowledge Base - Sync Script"
    echo "=========================================="
    echo ""
    
    case "${1:-sync}" in
        pull)
            check_prerequisites
            pull_changes
            ;;
        push)
            check_prerequisites
            push_changes
            ;;
        sync)
            check_prerequisites
            pull_changes
            push_changes
            ;;
        status)
            show_status
            ;;
        backup)
            backup
            ;;
        *)
            echo "Uso: $0 {pull|push|sync|status|backup}"
            echo ""
            echo "  pull    - Scarica modifiche dal remote"
            echo "  push    - Invia modifiche al remote"
            echo "  sync    - Pull + Push (default)"
            echo "  status  - Mostra status"
            echo "  backup  - Crea backup"
            exit 1
            ;;
    esac
}

main "$@"