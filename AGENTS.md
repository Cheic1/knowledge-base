# 🤖 Configurazione Agenti AI

## 📋 Panoramica

Questa knowledge base si integra con diversi agenti AI tramite **MCP (Model Context Protocol)**. Ogni agente può accedere alla stessa memoria e conoscenza.

## 🔌 Configurazione per agente

### OpenCode
Aggiungi al file `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "agentmemory": {
      "type": "local",
      "command": ["npx", "-y", "@agentmemory/mcp"],
      "env": {
        "AGENTMEMORY_URL": "http://localhost:3111",
        "AGENTMEMORY_DATA_DIR": "/DATA/AppData/my-knowledge-base/.agentmemory"
      }
    },
    "llm-wiki": {
      "type": "local",
      "command": ["npx", "-y", "@anthropic/mcp-server-fetch"],
      "env": {
        "LLM_WIKI_URL": "http://127.0.0.1:19828"
      }
    }
  }
}
```

### VS Code / Cursor
Aggiungi al file `.vscode/settings.json` o alle impostazioni di Cursor:

```json
{
  "mcpServers": {
    "agentmemory": {
      "command": "npx",
      "args": ["-y", "@agentmemory/mcp"],
      "env": {
        "AGENTMEMORY_URL": "http://localhost:3111",
        "AGENTMEMORY_DATA_DIR": "/DATA/AppData/my-knowledge-base/.agentmemory"
      }
    },
    "llm-wiki": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-fetch"],
      "env": {
        "LLM_WIKI_URL": "http://127.0.0.1:19828"
      }
    }
  }
}
```

### Claude Desktop
Aggiungi al file `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) o `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "agentmemory": {
      "command": "npx",
      "args": ["-y", "@agentmemory/mcp"],
      "env": {
        "AGENTMEMORY_URL": "http://localhost:3111",
        "AGENTMEMORY_DATA_DIR": "/DATA/AppData/my-knowledge-base/.agentmemory"
      }
    },
    "llm-wiki": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-fetch"],
      "env": {
        "LLM_WIKI_URL": "http://127.0.0.1:19828"
      }
    }
  }
}
```

### Hermes
Aggiungi al file di configurazione di Hermes (formato MCP standard):

```json
{
  "mcpServers": {
    "agentmemory": {
      "command": "npx",
      "args": ["-y", "@agentmemory/mcp"],
      "env": {
        "AGENTMEMORY_URL": "http://localhost:3111",
        "AGENTMEMORY_DATA_DIR": "/DATA/AppData/my-knowledge-base/.agentmemory"
      }
    }
  }
}
```

## 🛠️ Strumenti disponibili

### agentmemory (54 tools)
- `memory_save`: Salva un insight, decisione o pattern
- `memory_recall`: Cerca nelle osservazioni passate
- `memory_smart_search`: Ricerca ibrida (BM25 + vettori + grafo)
- `memory_sessions`: Lista sessioni recenti
- `memory_timeline`: Cronologia osservazioni
- `memory_export`: Esporta tutti i dati
- `memory_graph_query`: Interroga il grafo della conoscenza
- `memory_consolidate`: Esegui consolidamento a 4 livelli
- ... e altri 46 tools

### LLM Wiki (via HTTP API)
- `GET /api/v1/health`: Stato del server
- `GET /api/v1/projects`: Lista progetti
- `POST /api/v1/projects/{id}/search`: Ricerca ibrida
- `POST /api/v1/projects/{id}/chat`: Chat con la wiki
- `GET /api/v1/projects/{id}/graph`: Grafo della conoscenza
- `POST /api/v1/projects/{id}/sources/rescan`: Ris scanning fonti

## 🚀 Avvio servizi

### 1. Avvia agentmemory
```bash
cd /DATA/AppData/my-knowledge-base
npx agentmemory &
```

### 2. Avvia LLM Wiki
```bash
# Avvia l'app desktop nashsu/llm_wiki
# Punto alla cartella: /DATA/AppData/my-knowledge-base/wiki
```

### 3. Verifica servizi
```bash
# Verifica agentmemory
curl http://localhost:3111/agentmemory/health

# Verifica LLM Wiki
curl http://127.0.0.1:19828/api/v1/health
```

## 📝 Utilizzo

### In qualsiasi agente
```
# Cerca nella knowledge base
memory_smart_search "come implementare JWT"

# Salva una scoperta
memory_save "Ho trovato un bug in React 18 con StrictMode"

# Cerca nella wiki
"Cosa dice la mia wiki su Docker?"
```

### Workflow tipico
1. **Lavora** con il tuo agente preferito
2. **Cattura** automaticamente le osservazioni (agentmemory)
3. **Cerca** quando hai bisogno di contesto
4. **Sincronizza** tra dispositivi con Git

## 🔒 Sicurezza

- **Accesso locale**: solo 127.0.0.1
- **API keys**: mai committate (usa .env)
- **Git privato**: usa repo privato su GitHub/GitLab
- **Backup**: automatico con Git