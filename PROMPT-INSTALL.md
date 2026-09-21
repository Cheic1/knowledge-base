# 📋 Prompt Copia e Incolla

Copia il blocco sottostante e incollalo in un agente AI (OpenCode, Hermes, VS Code, ecc.).

---

```
Installa la "My Knowledge Base" seguendo questi passaggi:

1. CLONA la repo:
   cd /DATA/AppData && git clone https://github.com/Cheic1/knowledge-base.git my-knowledge-base

2. VERIFICA Node.js 20+ (se mancano, installa nvm e node 20)

3. INSTALLA agentmemory:
   cd /DATA/AppData/my-knowledge-base
   npm install -g @agentmemory/agentmemory

4. CONFIGURA environment:
   mkdir -p ~/.agentmemory && cp .agentmemory/.env ~/.agentmemory/.env

5. MODIFICA data/iii-config.yaml: cambia "host: 127.0.0.1" in "host: 0.0.0.0" per iii-http e iii-stream, e metti allowed_origins: ["*"]

6. AVVIA agentmemory:
   cd /DATA/AppData/my-knowledge-base
   nohup agentmemory > /tmp/agentmemory.log 2>&1 &
   sleep 10
   curl http://localhost:3111/agentmemory/health

7. CREA script ~/start-kb.sh per riavvio rapido

8. VERIFICA che funzioni e mostra gli indirizzi di accesso
```
