#!/bin/sh
# connect-agent.sh - SOSTITUITO da `node scripts/kb.mjs connect` (solo Node, niente
# bash/Python). Resta come scorciatoia per chi lo usa ancora; sara' tolto in una
# release successiva.
#
#   node scripts/kb.mjs connect                    # ruolo dalla installazione
#   node scripts/kb.mjs connect --role client      # agenti sul server centrale
#   KB_API_URL=... node scripts/kb.mjs connect --role client   # override endpoint
#   node scripts/kb.mjs connect --llm-wiki         # anche l'MCP llm-wiki
exec node "$(dirname "$0")/kb.mjs" connect "$@"
