# 📁 Projects - My Knowledge Base

## 🎯 Scopo

Questa cartella contiene progetti specifici che beneficiano della knowledge base.

## 📁 Struttura

```
projects/
├── README.md              # Questo file
├── frontend-app/          # Esempio: app frontend
├── backend-api/           # Esempio: API backend
└── library-common/        # Esempio: libreria condivisa
```

## 🚀 Come creare un nuovo progetto

### 1. Crea la directory
```bash
mkdir -p projects/my-new-project
cd projects/my-new-project
```

### 2. Inizializza Git
```bash
git init
```

### 3. Crea README.md
```markdown
# My New Project

## Descrizione
Breve descrizione del progetto

## Tecnologie
- React
- Node.js
- PostgreSQL

## Struttura
├── src/
├── tests/
├── docs/
└── README.md

## Collegamenti con Knowledge Base
- [[concept-react]] - Concept React
- [[entity-nodejs]] - Node.js
- [[source-documentation]] - Documentazione
```

### 4. Collega alla knowledge base
```bash
# Aggiungi symlink (opzionale)
ln -s ../../wiki/wiki/entities entities
ln -s ../../wiki/wiki/concepts concepts
```

## 📝 Esempio di progetto

### projects/frontend-app/
```
frontend-app/
├── README.md
├── package.json
├── src/
│   ├── components/
│   ├── hooks/
│   └── utils/
├── tests/
└── docs/
```

### projects/backend-api/
```
backend-api/
├── README.md
├── package.json
├── src/
│   ├── controllers/
│   ├── models/
│   └── routes/
├── tests/
└── docs/
```

### projects/library-common/
```
library-common/
├── README.md
├── package.json
├── src/
│   ├── utils/
│   └── types/
├── tests/
└── docs/
```

## 🔗 Integrazione con Knowledge Base

### In qualsiasi agente AI
```
# Cerca informazioni per il progetto
memory_smart_search "react hooks patterns"

# Salva decisioni architetturali
memory_save "Scelto PostgreSQL per il progetto X perché..."
```

### In LLM Wiki
```
# Importa documentazione del progetto
cp projects/my-project/docs/*.pdf wiki/raw/sources/

# Processa con LLM Wiki
/wiki ingest docs.pdf
```

## 📊 Vantaggi

1. **Contesto persistente**: le decisioni del progetto sono sempre accessibili
2. **Riuso**: soluzioni trovate in un progetto possono essere riutilizzate
3. **Documentazione**: automatica con agentmemory
4. **Sincronizzazione**: tra dispositivi con Git

---

*Ultimo aggiornamento: 2026-09-21*