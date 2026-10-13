#!/bin/sh
# kb-token.sh - SOSTITUITO da `node scripts/kb.mjs token` (solo Node).
# Resta come scorciatoia (lo usa anche start-kb.sh); sara' tolto in una release successiva.
#
#   node scripts/kb.mjs token            # stampa il token (lo genera se manca)
#   node scripts/kb.mjs token rotate     # nuovo token
#   node scripts/kb.mjs token set VALORE # token scelto da te (echo VALORE | ... set -)
exec node "$(dirname "$0")/kb.mjs" token "$@"
