# 🔄 Aggiornamento Node.js

## ⚠️ Problema attuale
La tua versione di Node.js (v18.19.1) non è compatibile con `@agentmemory/agentmemory` che richiede **Node.js >= 20**.

## 🚀 Soluzione: Aggiorna Node.js

### Opzione 1: nvm (consigliata)
```bash
# Installa nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Riavvia il terminale, poi:
nvm install 20
nvm use 20
nvm alias default 20

# Verifica
node --version  # dovrebbe mostrare v20.x.x
```

### Opzione 2: Package manager del sistema
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# macOS (Homebrew)
brew install node@20

# Windows
# Scarica da https://nodejs.org/ e installa LTS (v20.x)
```

### Opzione 3: Node.js LTS
Vai su https://nodejs.org/ e scarica la versione **LTS** (attualmente v20.x).

## ✅ Dopo l'aggiornamento
```bash
# Verifica versione
node --version  # dovrebbe essere >= 20.0.0

# Riavvia agentmemory
cd /DATA/AppData/my-knowledge-base
./scripts/start-agentmemory.sh start
```

## 📝 Note
- agentmemory funziona meglio con Node.js 20+
- La knowledge base è già configurata
- Dopo l'aggiornamento, tutto funzionerà automaticamente