# 📐 Schema - My Knowledge Base

## Struttura delle Pagine

### Frontmatter (YAML)
```yaml
---
title: "Nome della Pagina"
type: entity|concept|source|query|synthesis|comparison
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [tag1, tag2, tag3]
sources: [source1.md, source2.md]
related: [page1.md, page2.md]
---
```

### Tipi di Pagina

#### 🏢 Entity (Entità)
- **Definizione**: Persone, organizzazioni, prodotti, strumenti
- **Esempi**: "React", "Docker", "Andrej Karpathy", "OpenAI"
- **Contenuto**: Descrizione, storia, caratteristiche, uso

#### 💡 Concept (Concetto)
- **Definizione**: Teorie, metodi, pattern, principi
- **Esempi**: "Microservices", "SOLID", "RAG", "TDD"
- **Contenuto**: Definizione, esempi, pro/contro, casi d'uso

#### 📄 Source (Fonte)
- **Definizione**: Riassunti di documenti originali
- **Esempi**: "paper-transformers.pdf", "articolo-react-hooks.md"
- **Contenuto**: Riassunto, punti chiave, citazioni, collegamenti

#### ❓ Query (Domanda)
- **Definizione**: Risposte a domande frequenti
- **Esempi**: "Come implementare JWT?", "Docker vs Podman?"
- **Contenuto**: Domanda, risposta, fonti, esempi

#### 🔗 Synthesis (Sintesi)
- **Definizione**: Analisi che collegano più fonti
- **Esempi**: "Confronto framework frontend", "Best practices DevOps"
- **Contenuto**: Analisi, pattern, raccomandazioni

#### ⚖️ Comparison (Confronto)
- **Definizione**: Confronti diretti tra opzioni
- **Esempi**: "React vs Vue", "PostgreSQL vs MongoDB"
- **Contenuto**: Tabella confronto, pro/contro, raccomandazione

## Regole di Scrittura

### 1. Formato
- Usa Markdown puro
- Max 2000 parole per pagina
- Titoli: H2 (##) per sezioni principali
- Code blocks: specifica il linguaggio

### 2. Collegamenti
- Usa `[[wiki-link]]` per collegamenti interni
- Minimo 2 collegamenti per pagina
- Aggiorna i collegamenti quando modifichi

### 3. Fonti
- Cita sempre le fonti
- Usa formato: `[1] Nome Fonte`
- Collega alla source page corrispondente

### 4. Aggiornamento
- Aggiorna `updated` nel frontmatter
- Verifica collegamenti quando modifichi
- Segna pagine obsolete con `deprecated: true`

## Indicizzazione

### Cartelle
```
wiki/
├── entities/        # Entità (prodotti, persone, org)
├── concepts/        # Concetti (metodi, pattern)
├── sources/         # Riassunti fonti
├── queries/         # Domande frequenti
├── synthesis/       # Sintesi e analisi
├── comparisons/     # Confronti
└── index.md         # Catalogo principale
```

### Tag Consigliati
- **Tecnologia**: `#react`, `#docker`, `#python`, `#llm`
- **Categoria**: `#frontend`, `#backend`, `#devops`, `#ai`
- **Livello**: `#basics`, `#advanced`, `#expert`
- **Stato**: `#draft`, `#review`, `#final`, `#deprecated`

## Ricerca

### Ricerca Testuale
- BM25 con stemming
- Bigrammi per CJK
- Bonus per match nei titoli

### Ricerca Semantica (opzionale)
- Embedding con OpenAI/LOCAL
- Cosine similarity
- Top-K risultati

### Ragrafo della Conoscenza
- Nodi: pagine
- Archi: collegamenti wikilink
- Relevanza: 4 segnali (direct, source, adamic-ada, type)

## Manutenzione

### Lint Settimanale
- Verifica collegamenti rotti
- Aggiorna pagine obsolete
- Elimina pagine orfane

### Review Mensile
- Aggiorna purpose.md
- Elimina conoscenza obsoleta
- Aggiorna tag e metadati