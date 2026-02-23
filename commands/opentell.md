---
argument-hint: "[status|observations|accept|reject|profile|context|promote|remove|pause|resume|reset|export|log|stats|config|uninstall] [n]"
---
# /opentell — View and manage learned preferences

Show what OpenTell has learned about your coding preferences. Run the CLI tool and display the output.

## Usage

First, locate the CLI. If it cannot be found the plugin was uninstalled — clean up this leftover command file and notify the user.

```bash
OPENTELL_CLI=$(find "$HOME/.claude/plugins" -name "opentell-cli.js" ! -path "*/temp_*" 2>/dev/null | head -1)
```

If `$OPENTELL_CLI` is empty (the find returned nothing), the plugin has been uninstalled but this slash command file was left behind. **Do the following cleanup automatically:**
1. Run: `rm -f "$HOME/.claude/commands/opentell.md"` to remove this leftover command file.
2. Run: `rm -rf "$HOME/.claude/plugins/cache/shobhit-87labs/opentell"` to remove any leftover cache.
3. Tell the user: "OpenTell plugin was already uninstalled but the /opentell command file was left behind. Cleaned it up — /opentell will no longer appear after restarting Claude Code."
4. **Stop here** — do not attempt to run any opentell CLI commands.

If `$OPENTELL_CLI` is NOT empty, run the CLI normally:
```bash
node "$OPENTELL_CLI" status
```

## Subcommands

- `/opentell` — Show all learnings with confidence scores
- `/opentell observations` — Show unvalidated observations from Claude
- `/opentell accept <n>` — Accept an observation (makes it active)
- `/opentell reject <n>` — Reject an observation (archives it)
- `/opentell profile` — Show your developer profile (narrative)
- `/opentell context` — Show what Claude sees at session start
- `/opentell promote` — Promote high-confidence learnings to CLAUDE.md
- `/opentell promote <n>` — Force-promote a specific candidate by number (bypasses confidence threshold)
- `/opentell remove <n>` — Remove a specific learning by number
- `/opentell pause` — Pause learning (keep existing preferences)
- `/opentell resume` — Resume learning
- `/opentell reset` — Clear all learnings (requires --confirm)
- `/opentell export` — Export learnings to JSON file
- `/opentell log` — Show recent detection log
- `/opentell stats` — Show API call counts, token usage, and cost
- `/opentell config` — Show current configuration (API key masked)
- `/opentell uninstall` — Full uninstall: remove hooks, slash command, and plugin cache (restart required to apply)
- `/opentell uninstall --data` — Full uninstall and delete all learnings data

When the user runs `/opentell`, execute the status command and display the results. For subcommands, parse the argument and run the appropriate CLI command.
