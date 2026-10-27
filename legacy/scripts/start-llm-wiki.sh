#!/bin/bash

# ============================================
# My Knowledge Base - Start LLM Wiki
# ============================================

set -e

# --------------------------------------------
# Configurazione
# --------------------------------------------
KB_DIR="/DATA/AppData/my-knowledge-base"
WIKI_DIR="$KB_DIR/wiki"

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
    
    # Verifica directory
    if [ ! -d "$KB_DIR" ]; then
        log_error "Directory knowledge base non trovata: $KB_DIR"
        exit 1
    fi
    
    # Verifica se LLM Wiki è installato
    if [ ! -d "$WIKI_DIR" ]; then
        log_warning "Directory wiki non trovata"
        log_info "Creo struttura wiki..."
        mkdir -p "$WIKI_DIR"/{raw/sources,wiki/{entities,concepts,sources,queries,synthesis,comparisons}}
    fi
    
    log_success "Prerequisiti OK"
}

# --------------------------------------------
# Verifica se LLM Wiki è installato
# --------------------------------------------
check_llm_wiki_installed() {
    log_info "Verifica installazione LLM Wiki..."
    
    # Verifica se nashsu/llm_wiki è disponibile
    if command -v llm-wiki &> /dev/null; then
        log_success "LLM Wiki trovato: $(which llm-wiki)"
        return 0
    fi
    
    # Verifica se è installato localmente
    if [ -d "$HOME/.claude/skills/wiki" ]; then
        log_success "LLM Wiki trovato in: $HOME/.claude/skills/wiki"
        return 0
    fi
    
    # Verifica se è disponibile come npm package
    if npm list -g @nashsu/llm-wiki &> /dev/null; then
        log_success "LLM Wiki trovato come npm package"
        return 0
    fi
    
    log_warning "LLM Wiki non trovato"
    log_info "Opzioni di installazione:"
    echo "  1. Desktop App: https://github.com/nashsu/llm_wiki/releases"
    echo "  2. Claude Code Skill: git clone https://github.com/read2001/wiki.git ~/.claude/skills/wiki"
    echo "  3. Build from source: git clone https://github.com/nashsu/llm_wiki.git"
    
    return 1
}

# --------------------------------------------
# Avvia LLM Wiki Desktop App
# --------------------------------------------
start_desktop_app() {
    log_info "Avvio LLM Wiki Desktop App..."
    
    # Verifica se è in esecuzione
    if pgrep -f "llm-wiki" > /dev/null; then
        log_warning "LLM Wiki è già in esecuzione"
        return 0
    fi
    
    # Avvia l'app (cross-platform)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        open -a "LLM Wiki" --args --project "$WIKI_DIR"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        llm-wiki --project "$WIKI_DIR" &
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        # Windows
        start "" "LLM Wiki" --project "$WIKI_DIR"
    else
        log_error "Sistema operativo non supportato: $OSTYPE"
        return 1
    fi
    
    log_success "LLM Wiki avviato"
    log_info "Project directory: $WIKI_DIR"
}

# --------------------------------------------
# Avvia LLM Wiki CLI
# --------------------------------------------
start_cli() {
    log_info "Avvio LLM Wiki CLI..."
    
    # Verifica se qmd è installato
    if ! command -v qmd &> /dev/null; then
        log_warning "qmd non installato (opzionale per ricerca semantica)"
        log_info "Installa: npm install -g @tobilu/qmd@2.8.3"
    fi
    
    # Avvia CLI
    cd "$WIKI_DIR"
    
    # Inizializza wiki se necessario
    if [ ! -f "CLAUDE.md" ]; then
        log_info "Inizializzo wiki..."
        if command -v wiki &> /dev/null; then
            wiki init
        else
            log_warning "Comando 'wiki' non trovato"
            log_info "Usa il Desktop App o installa la CLI"
        fi
    fi
    
    log_success "LLM Wiki CLI pronto"
    log_info "Directory: $WIKI_DIR"
    log_info "Comandi disponibili:"
    echo "  /wiki init        - Inizializza wiki"
    echo "  /wiki ingest FILE - Ingesta una fonte"
    echo "  /wiki query Q     - Chiedi alla wiki"
    echo "  /wiki lint        - Controlla integrità"
}

# --------------------------------------------
# Avvia LLM Wiki MCP Server
# --------------------------------------------
start_mcp_server() {
    log_info "Avvio LLM Wiki MCP Server..."
    
    # Verifica se il server MCP è disponibile
    if [ -d "$WIKI_DIR/mcp-server" ]; then
        cd "$WIKI_DIR/mcp-server"
        
        # Installa dipendenze se necessario
        if [ ! -d "node_modules" ]; then
            log_info "Installo dipendenze MCP..."
            npm ci
        fi
        
        # Build
        log_info "Build MCP server..."
        npm run build
        
        # Avvia
        log_info "Avvio MCP server..."
        node dist/index.js &
        
        log_success "MCP server avviato"
        log_info "Porta: 19828"
    else
        log_warning "MCP server non trovato"
        log_info "Il Desktop App include già il MCP server"
    fi
}

# --------------------------------------------
# Mostra status
# --------------------------------------------
show_status() {
    log_info "Status LLM Wiki:"
    
    echo ""
    echo "📁 Directory wiki: $WIKI_DIR"
    echo "📊 Statistiche:"
    echo "   - Pagine wiki: $(find "$WIKI_DIR/wiki" -name "*.md" 2>/dev/null | wc -l)"
    echo "   - Fonti: $(find "$WIKI_DIR/raw" -type f 2>/dev/null | wc -l)"
    echo ""
    
    echo "🔗 Link:"
    echo "   - Desktop App: Apri manualmente"
    echo "   - MCP Server: http://127.0.0.1:19828"
    echo "   - Obsidian: Apri cartella $WIKI_DIR in Obsidian"
    echo ""
    
    echo "📝 File di configurazione:"
    echo "   - purpose.md: $WIKI_DIR/purpose.md"
    echo "   - schema.md: $WIKI_DIR/schema.md"
    echo "   - index.md: $WIKI_DIR/wiki/index.md"
}

# --------------------------------------------
# Main
# --------------------------------------------
main() {
    echo "=========================================="
    echo "  My Knowledge Base - LLM Wiki"
    echo "=========================================="
    echo ""
    
    case "${1:-status}" in
        start)
            check_prerequisites
            if check_llm_wiki_installed; then
                start_desktop_app
            fi
            ;;
        cli)
            check_prerequisites
            start_cli
            ;;
        mcp)
            check_prerequisites
            start_mcp_server
            ;;
        status)
            show_status
            ;;
        *)
            echo "Uso: $0 {start|cli|mcp|status}"
            echo ""
            echo "  start  - Avvia Desktop App (default)"
            echo "  cli    - Avvia CLI"
            echo "  mcp    - Avvia MCP Server"
            echo "  status - Mostra status"
            echo ""
            echo "Nota: Il Desktop App è il metodo consigliato"
            exit 1
            ;;
    esac
}

main "$@"