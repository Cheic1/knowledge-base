# 🚀 Example Project

## Descrizione
Progetto di esempio per dimostrare come utilizzare la knowledge base.

## Tecnologie
- **Frontend**: React, TypeScript, Tailwind CSS
- **Backend**: Node.js, Express, PostgreSQL
- **DevOps**: Docker, GitHub Actions

## Struttura
```
example-project/
├── README.md              # Questo file
├── package.json           # Dipendenze
├── docker-compose.yml     # Configurazione Docker
├── src/
│   ├── frontend/          # Applicazione React
│   ├── backend/           # API Express
│   └── shared/            # Codice condiviso
├── tests/
│   ├── unit/
│   └── integration/
├── docs/
│   ├── architecture.md    # Architettura
│   └── api.md             # Documentazione API
└── scripts/
    ├── setup.sh           # Setup iniziale
    └── deploy.sh          # Deploy
```

## Setup

### Prerequisiti
- Node.js >= 20
- Docker
- PostgreSQL

### Installazione
```bash
# 1. Clone
git clone git@github.com:tuo-username/example-project.git
cd example-project

# 2. Installa dipendenze
npm install

# 3. Configura database
cp .env.example .env
# Modifica .env con le tue credenziali

# 4. Avvia
docker-compose up -d
npm run dev
```

## Collegamenti con Knowledge Base

### Decisioni architetturali
- [[concept-microservices]] - Scelto microservices per scalabilità
- [[concept-cqrs]] - Implementato CQRS per separation of concerns
- [[entity-postgresql]] - PostgreSQL per ACID compliance

### Pattern utilizzati
- [[concept-clean-architecture]] - Architettura pulita
- [[concept-unit-of-work]] - Unit of Work pattern
- [[concept-repository]] - Repository pattern

### Strumenti
- [[entity-react]] - Frontend
- [[entity-nodejs]] - Backend
- [[entity-docker]] - Containerizzazione
- [[entity-github-actions]] - CI/CD

### Documentazione
- [[source-react-docs]] - Documentazione React
- [[source-nodejs-docs]] - Documentazione Node.js
- [[source-docker-docs]] - Documentazione Docker

## Note per sviluppatori

### Architettura
Il progetto segue Clean Architecture con:
- **Presentation Layer**: React components
- **Application Layer**: Use cases
- **Domain Layer**: Entities e business logic
- **Infrastructure Layer**: Database, external services

### Testing
- **Unit test**: Jest + React Testing Library
- **Integration test**: Supertest
- **E2E test**: Playwright

### Deploy
- **CI/CD**: GitHub Actions
- **Container**: Docker + Docker Compose
- **Cloud**: AWS / GCP / Azure (a scelta)

## Risorse utili
- [[query-react-vs-vue]] - Perché React
- [[query-typescript-vs-javascript]] - Perché TypeScript
- [[query-postgresql-vs-mongodb]] - Perché PostgreSQL

---

*Ultimo aggiornamento: 2026-09-21*