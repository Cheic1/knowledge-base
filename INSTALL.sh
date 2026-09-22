#!/bin/bash

# ============================================
# My Knowledge Base - Installazione Automatica
# ============================================

set -e

# --------------------------------------------
# Colori
# --------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# --------------------------------------------
# Configurazione
# --------------------------------------------
KB_DIR="/DATA/AppData/my-knowledge-base"
REQUIRED_NODE_VERSION=20

# --------------------------------------------
# Funzioni
# --------------------------------------------
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

# --------------------------------------------
# Step 1: Verifica prerequisiti
# --------------------------------------------
step1_prerequisiti() {
    log_step "Step 1: Verifica prerequisiti"
    
    # Verifica Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge "$REQUIRED_NODE_VERSION" ]; then
            log_success "Node.js v$(node -v | cut -d'v' -f2) installato"
        else
            log_warning "Node.js v$(node -v | cut -d'v' -f2) troppo vecchio (serve v${REQUIRED_NODE_VERSION}+)"
            log_info "Aggiorno con nvm..."
            
            # Verifica nvm
            export NVM_DIR="$HOME/.nvm"
            if [ -s "$NVM_DIR/nvm.sh" ]; then
                \. "$NVM_DIR/nvm.sh"
                nvm install $REQUIRED_NODE_VERSION
                nvm use $REQUIRED_NODE_VERSION
                nvm alias default $REQUIRED_NODE_VERSION
                log_success "Node.js aggiornato a v$(node -v)"
            else
                log_error "nvm non installato. Installa con:"
                echo "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
                exit 1
            fi
        fi
    else
        log_error "Node.js non installato"
        exit 1
    fi
    
    # Verifica npm
    if command -v npm &> /dev/null; then
        log_success "npm v$(npm -v) installato"
    else
        log_error "npm non installato"
        exit 1
    fi
    
    # Verifica Git
    if command -v git &> /dev/null; then
        log_success "Git $(git --version | cut -d' ' -f3) installato"
    else
        log_error "Git non installato"
        exit 1
    fi
}

# --------------------------------------------
# Step 2: Configura Node.js via nvm
# --------------------------------------------
step2_configura_nvm() {
    log_step "Step 2: Configura Node.js via nvm"
    
    export NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        \. "$NVM_DIR/nvm.sh"
        
        # Installa Node.js 20 se non presente
        if ! nvm ls $REQUIRED_NODE_VERSION &> /dev/null; then
            log_info "Installo Node.js v${REQUIRED_NODE_VERSION}..."
            nvm install $REQUIRED_NODE_VERSION
        fi
        
        nvm use $REQUIRED_NODE_VERSION
        nvm alias default $REQUIRED_NODE_VERSION
        
        log_success "Node.js v$(node -v) attivo"
    else
        log_error "nvm non trovato"
        exit 1
    fi
}

# --------------------------------------------
# Step 3: Installa dipendenze
# --------------------------------------------
step3_installa_dipendenze() {
    log_step "Step 3: Installa dipendenze"
    
    cd "$KB_DIR"
    
    # Installa agentmemory globalmente
    log_info "Installo agentmemory globalmente..."
    npm install -g @agentmemory/agentmemory
    log_success "agentmemory installato"
    
    # Verifica installazione
    if command -v agentmemory &> /dev/null; then
        log_success "agentmemory disponibile: $(which agentmemory)"
    else
        log_warning "agentmemory non trovato nel PATH, potrebbe servire nvm use"
    fi
}

# --------------------------------------------
# Step 4: Configura environment
# --------------------------------------------
step4_configura_env() {
    log_step "Step 4: Configura environment"
    
    # Crea directory agentmemory nella home
    mkdir -p ~/.agentmemory
    
    # Copia configurazione
    cp "$KB_DIR/.agentmemory/.env" ~/.agentmemory/.env
    log_success "Configurazione copiata in ~/.agentmemory/.env"
    
    # Verifica API key
    if grep -q "OPENAI_API_KEY=" ~/.agentmemory/.env; then
        log_success "API key configurata"
    else
        log_warning "API key non trovata - configura manualmente ~/.agentmemory/.env"
    fi
}

# --------------------------------------------
# Step 5: Avvia kb-proxy (esposizione LAN)
# --------------------------------------------
step5_configura_iii() {
    log_step "Step 5: kb-proxy (esposizione LAN)"
    
    # NOTA: non modificare iii-config.yaml — iii riscrive host:127.0.0.1
    # ad ogni boot. L'esposizione LAN è fatta dal proxy su 8311/8313/8318.
    if [ -f "$KB_DIR/scripts/kb-proxy.js" ]; then
        log_info "kb-proxy disponibile (script/kb-proxy.js, porte 8311/8313/8315/8318)"
        log_success "esposizione LAN tramite kb-proxy"
    else
        log_warning "scripts/kb-proxy.js non trovato"
    fi
}

# --------------------------------------------
# Step 6: Avvia agentmemory + kb-proxy
# --------------------------------------------
step6_avvia_agentmemory() {
    log_step "Step 6: Avvia agentmemory + kb-proxy"
    
    # Usa lo script unificato (agentmemory + proxy LAN)
    if [ -x "$KB_DIR/scripts/start-kb.sh" ]; then
        "$KB_DIR/scripts/start-kb.sh" start || true
    else
        # Fallback: solo agentmemory
        pkill -f "bin/agentmemory" 2>/dev/null || true
        sleep 2
        cd "$KB_DIR"
        nohup agentmemory > /tmp/agentmemory.log 2>&1 &
        sleep 10
    fi
    
    # Attendi che sia pronto
    log_info "Attendo che agentmemory sia pronto..."
    for i in {1..30}; do
        if curl -s http://localhost:3111/agentmemory/health > /dev/null 2>&1; then
            log_success "agentmemory è attivo!"
            IP=$(hostname -I | awk '{print $1}')
            echo ""
            echo "┌─────────────────────────────────────────────┐"
            echo "│  agentmemory - STATO: ATTIVO                │"
            echo "├─────────────────────────────────────────────┤"
            echo "│  API locale:  http://127.0.0.1:3111         │"
            echo "│  API LAN:     http://$IP:8311           │"
            echo "│  Viewer LAN:  http://$IP:8313           │"
            echo "│  Wiki LAN:    http://$IP:8318           │"
            echo "└─────────────────────────────────────────────┘"
            echo ""
            curl -s http://localhost:3111/agentmemory/health | head -c 200
            echo ""
            return 0
        fi
        sleep 1
    done
    
    log_error "agentmemory non si avvia entro 30 secondi"
    log_info "Controlla i log: /tmp/agentmemory.log"
    return 1
}

# --------------------------------------------
# Step 7: Verifica installazione
# --------------------------------------------
step7_verifica() {
    log_step "Step 7: Verifica installazione"
    
    # Verifica agentmemory
    if curl -s http://localhost:3111/agentmemory/health > /dev/null 2>&1; then
        log_success "✅ agentmemory: ATTIVO"
    else
        log_error "❌ agentmemory: NON ATTIVO"
    fi
    
    # Verifica porte
    if ss -tlnp | grep -q ":3111"; then
        log_success "✅ Porta 3111: IN ASCOLTO"
    else
        log_error "❌ Porta 3111: NON IN ASCOLTO"
    fi
    
    if ss -tlnp | grep -q ":3113"; then
        log_success "✅ Porta 3113: IN ASCOLTO (Viewer)"
    else
        log_warning "⚠️ Porta 3113: NON IN ASCOLTO"
    fi
    
    # Verifica kb-proxy (LAN)
    if ss -tlnp | grep -q "0.0.0.0:8311"; then
        log_success "✅ kb-proxy 8311: IN ASCOLTO (API LAN)"
    else
        log_warning "⚠️ kb-proxy 8311: NON IN ASCOLTO (LAN non esposta)"
    fi
    
    if ss -tlnp | grep -q "0.0.0.0:8313"; then
        log_success "✅ kb-proxy 8313: IN ASCOLTO (Viewer LAN)"
    else
        log_warning "⚠️ kb-proxy 8313: NON IN ASCOLTO"
    fi
    
    echo ""
    log_success "Installazione completata!"
    IP=$(hostname -I | awk '{print $1}')
    echo ""
    echo "Prossimi passi:"
    echo "  1. Apri il Viewer: http://$IP:8313"
    echo "  2. Cabla gli agenti: ./scripts/connect-agent.sh"
    echo "  3. Endpoint cambiabile in: config/endpoint.env"
    echo "  4. Sincronizza con Git: ./scripts/sync.sh"
    echo ""
}

# --------------------------------------------
# Main
# --------------------------------------------
main() {
    echo ""
    echo "╔═══════════════════════════════════════════════╗"
    echo "║  🧠 My Knowledge Base - Installazione Auto   ║"
    echo "╚═══════════════════════════════════════════════╝"
    echo ""
    
    step1_prerequisiti
    step2_configura_nvm
    step3_installa_dipendenze
    step4_configura_env
    step5_configura_iii
    step6_avvia_agentmemory
    step7_verifica
}

# Esegui
main "$@"