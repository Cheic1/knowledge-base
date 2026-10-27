#!/usr/bin/env python3
"""Seed iniziale della knowledge base in agentmemory.

Uso: python3 scripts/seed-memory.py
richiede agentmemory healthy su http://127.0.0.1:3111
"""
import json
import urllib.request
import urllib.error

API = "http://127.0.0.1:3111/agentmemory/remember"

ENTRIES = [
    # --- Architettura ---
    ("architecture",
     "ARCHITETTURA: La knowledge base ibrida è composta da 3 layer: "
     "1) LLM Wiki (nashsu/llm_wiki) nella cartella wiki/ con schema wiki/{concepts,entities,comparisons,synthesis,sources}; "
     "2) agentmemory v0.9.29 per la memoria operativa degli agenti, con iii engine v0.11.2; "
     "3) sync Git sul repo privato GitHub Cheic1/knowledge-base. "
     "Root: /DATA/AppData/my-knowledge-base"),
    ("architecture",
     "ARCHITETTURA: Due piani di porte. Piano locale (127.0.0.1): "
     "3111 = REST API agentmemory (worker iii-http), 3112 = streams WS, "
     "3113 = viewer web, 49134 = iii engine WS. "
     "Piano remoto LAN (0.0.0.0, via kb-proxy.js): 8311 -> 3111 API, 8313 -> 3113 viewer, 8315 -> 3115 fallback. "
     "URL viewer remoto: http://192.168.68.55:8313/"),
    ("architecture",
     "VINCOLO III: iii v0.11.2 riscrive iii-config.yaml a host 127.0.0.1 ad ogni boot "
     "e la env var III_HOST NON viene rispettata per iii-http/iii-stream. "
     "Modificare il file config è inutile: va sovrascritto a ogni avvio. "
     "La soluzione è il reverse proxy Node kb-proxy.js (~/.agentmemory/bin/) sulle porte 8311/8313/8315, "
     "perché non si può bindare 0.0.0.0:3111 mentre 127.0.0.1:3111 è occupato (EADDRINUSE) "
     "e servono root per iptables/socat."),

    # --- Troubleshooting / operazioni ---
    ("troubleshooting",
     "TROUBLESHOOTING: Se /agentmemory/health ritorna 404 o status 'unknown', "
     "il worker agentmemory non è registrato sull'engine iii (registrazione stale). "
     "Fix: kill dei processi agentmemory + iii.bin, poi riavviare 'agentmemory' con Node 20 via nvm. "
     "Health vera = status 'healthy', workers=1, function_count ~272. "
     "Attenzione: usare pgrep -f con pattern che matchano il proprio comando uccide il shell corrente."),
    ("operations",
     "AVVIO SERVIZI: agentmemory richiede Node 20 via nvm: "
     "export NVM_DIR=\"$HOME/.nvm\" && . \"$NVM_DIR/nvm.sh\" && nvm use 20. "
     "Poi: cd /DATA/AppData/my-knowledge-base && nohup agentmemory > /tmp/agentmemory.log 2>&1 &. "
     "Proxy di rete: nohup node ~/.agentmemory/bin/kb-proxy.js > /tmp/kb-proxy.log 2>&1 &. "
     "Prima del restart uccidere: iii.bin, agentmemory, e i listener su 3111/3112/3113/49134 via lsof."),
    ("troubleshooting",
     "OPERAZIONI: ~/.local/bin/iii-worker è linked musl (interpreter /lib/ld-musl-x86_64.so.1) "
     "e NON è eseguibile su questo sistema glibc: 'cannot execute: required file not found'. "
     "Non blocca l'engine iii, ma il configuration worker resta fuori uso. "
     "iii-console (static-pie) funziona correttamente."),

    # --- Sicurezza ---
    ("security",
     "SICUREZZA: Il proxy kb espone 0.0.0.0 senza autenticazione. Rischio medio: "
     "chiunque in LAN 192.168.68.0/24 può leggere e scrivere la memoria agenti via 8311 "
     "(CRUD completo, allowed_origins:*, nessun API_TOKEN valorizzato). "
     "Mitigazioni prioritarie: 1) non esporre 8311 in LAN (il viewer 8313 non la usa), "
     "2) middleware token in kb-proxy.js, 3) chmod 600 su .env. "
     "sudo/iptables non disponibili su questo host."),
    ("security",
     "SICUREZZA: .env contiene OPENAI_BASE_URL=https://freellmapi.cheic2.it/v1, OPENAI_MODEL=auto, "
     "OPENAI_API_KEY, GIT_REMOTE=git@github.com:Cheic1/knowledge-base.git. "
     "Non è mai committato (.gitignore lo copre, solo .env.example nel repo) ma ha permessi 664: va messo a 600. "
     "data/ (state_store.db con i contenuti della memoria, iii-config.yaml) è escluso da Git "
     "via .gitignore: è stato runtime, resta solo sul server."),

    # --- Config LLM ---
    ("config",
     "CONFIG LLM: Endpoint personalizzato https://freellmapi.cheic2.it/v1 con modello 'auto' "
     "(OpenAI-compatible). Config in /DATA/AppData/my-knowledge-base/.env e .agentmemory/.env. "
     "EMBEDDING_PROVIDER=local, EMBEDDING_LANG=it, LANGUAGE=it. "
     "GRAPH_EXTRACTION_ENABLED=false e CONSOLIDATION_ENABLED=false: "
     "grafo knowledge e consolidazione automatica disattivati di default."),

    # --- Integrazione agenti ---
    ("agents",
     "INTEGRAZIONE AGENTI: Agenti supportati: OpenCode, Hermes, VS Code, Cursor "
     "(Claude Code e Claude Desktop esclusi esplicitamente). "
     "Integrazione via MCP: npx -y @agentmemory/mcp con env AGENTMEMORY_URL=http://localhost:3111. "
     "Config in AGENTS.md e MCP-CONFIG.json. "
     "Il pacchetto agentmemory include 'agentmemory connect <agent>' che cabla l'agente automaticamente "
     "(supporta opencode, hermes, cursor, e altri)."),
    ("agents",
     "INSTALL AGENTI: PROMPT-INSTALL.md contiene il prompt singolo copy-paste per un agente; "
     "AGENT-INSTALL.md la guida completa; INSTALL.sh lo script automatico. "
     "Da allineare: porte reali 8311/8313/8315 (ora documentano solo 311x) "
     "e step di avvio di kb-proxy.js, assente nei prompt."),

    # --- Stato e TODO ---
    ("state",
     "STATO PROGETTO (2026-09-23): Funzionante. agentmemory healthy, "
     "viewer remoto http://192.168.68.55:8313/ raggiungibile (200), repo pushato. "
     "TODO prioritario: 1) chiudere 8311 in LAN o aggiungere token, "
     "2) git rm --cached su data/ + sync.sh su percorsi espliciti, "
     "3) spostare kb-proxy.js dentro repo/scripts/ e ritargare 8315->3115 (ora 502), "
     "4) docs con porte 8311/8313/8315 e PROMPT-INSTALL self-contained, "
     "5) systemd unit utente con Restart=on-failure."),
    ("state",
     "DOC DA CORREGGERE: Nessun file del repo cita le porte 8311/8313/8315; "
     "README/AGENTS.md dicono ancora 'accesso solo 127.0.0.1' in contrasto con l'accesso remoto; "
     "remote git menzionato sia come Cheic1 che come 'tuo-username'; "
     "il server MCP llm-wiki in AGENTS.md usa @anthropic/mcp-server-fetch che ignora LLM_WIKI_URL; "
     "QUICKSTART ha due passi '3.'."),
]


def remember(category: str, content: str) -> bool:
    body = json.dumps({"content": content, "category": category}).encode()
    req = urllib.request.Request(
        API, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            return True
    except (urllib.error.URLError, OSError) as e:
        print(f"  ! FAILED [{category}]: {e}")
        return False


def main() -> None:
    print("Popolamento memoria agentmemory...")
    ok = 0
    for category, content in ENTRIES:
        if remember(category, content):
            ok += 1
            print(f"  + [{category}] {content[:70]}...")
    print(f"\n{ok}/{len(ENTRIES)} memorie inserite.")
    print('Verifica: curl -s -X POST http://127.0.0.1:3111/agentmemory/search '
          "-H 'Content-Type: application/json' -d '{\"query\":\"architettura\"}'")


if __name__ == "__main__":
    main()
