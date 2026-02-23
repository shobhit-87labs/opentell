#!/bin/bash
# Resolve the opentell CLI path and run it with provided arguments.
# Called from the /opentell slash command !-block to avoid $() in inline commands.
OPENTELL_CLI=$(find "$HOME/.claude/plugins" -name "opentell-cli.js" ! -path "*/temp_*" 2>/dev/null | head -1)
if [ -z "$OPENTELL_CLI" ]; then
  echo "Error: opentell-cli.js not found. Is opentell installed?"
  exit 1
fi
node "$OPENTELL_CLI" ${1:-status} "${@:2}"
