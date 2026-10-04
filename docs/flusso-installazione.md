# Flusso di installazione

```mermaid
flowchart TD
    A[Prompt incollato nell'agente] --> B{Node 20+ e git presenti?}
    B -- no --> B1[Chiede conferma e li installa]
    B1 --> C
    B -- si --> C{Il repo e' gia' clonato?}
    C -- no --> C1[git clone in ~/knowledge-base] --> D
    C -- si --> C2[git fetch + legge bootstrap.mjs da origin/main] --> D
    D[bootstrap.mjs] --> E{Modifiche locali a file tracciati fuori da data/?}
    E -- si --> E1[STOP: le elenca e aspetta]
    E -- no --> F{Il branch traccia data/ ?}
    F -- si --> F1[Copia di data/ in ~/.agentmemory/data-backup-DATA\ngit rm --cached data, commit locale\nI file sul disco non si toccano] --> G
    F -- no --> G{Sul branch main?}
    G -- no --> G1[Allinea main locale al remote\ncheckout main, unisce i commit locali] --> H
    G -- si --> H[git pull --rebase --autostash]
    H --> H1{data/ modificato da git?}
    H1 -- si --> H2[Ripristina dalla copia] --> I
    H1 -- no --> I[kb.mjs install]
    I --> J{Ruolo}
    J -- server Linux --> J1[systemd: agentmemory + kb-proxy con token]
    J -- PC Windows --> J2[Attivita' KB agentmemory all'accesso]
    J -- PC Linux/macOS --> J3[crontab @reboot]
    J1 --> K
    J2 --> K
    J3 --> K[Cabla agenti trovati: Claude Code, OpenCode, Hermes]
    K --> L[Sync memorie ogni 15 min + hook Claude Code]
    L --> M[Prima sync: import, pull, push]
    M --> N[Aggiornamento automatico: kb.mjs update a ogni giro]
```

Errori e cosa fare:

| Dove | Sintomo | Cosa fare |
|------|---------|-----------|
| fetch/pull/push | timeout o `CONNECT tunnel failed` | `git config http.proxy ""` solo per il repo |
| bootstrap | modifiche locali fuori da data/ | `git stash` o scartarle a mano, rilanciare |
| bootstrap | merge/rebase in corso | `git merge --abort` o `git rebase --abort`, rilanciare |
| install | Node < 20 | installare Node 20+ |
| install | agentmemory non risponde | log in `~/.agentmemory/agentmemory.log` |
| sync | push chiede la password | Git Credential Manager o chiave SSH, rilanciare |
