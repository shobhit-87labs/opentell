# /opentell — View and manage learned preferences

Show what OpenTell has learned about your coding preferences. Run the CLI tool and display the output.

## Usage

Run this command to see current learnings:
```bash
node "${CLAUDE_PLUGIN_ROOT}/opentell-cli.js" status
```

## Subcommands

- `/opentell` — Show all learnings with confidence scores
- `/opentell observations` — Show unvalidated observations from Claude
- `/opentell accept <n>` — Accept an observation (makes it active)
- `/opentell reject <n>` — Reject an observation (archives it)
- `/opentell profile` — Show your developer profile (narrative)
- `/opentell context` — Show what Claude sees at session start
- `/opentell promote` — Promote high-confidence learnings to CLAUDE.md
- `/opentell remove <n>` — Remove a specific learning by number
- `/opentell pause` — Pause learning (keep existing preferences)
- `/opentell resume` — Resume learning
- `/opentell reset` — Clear all learnings (requires --confirm)
- `/opentell export` — Export learnings to JSON file
- `/opentell log` — Show recent detection log
- `/opentell stats` — Show API call counts, token usage, and cost
- `/opentell config` — Show current configuration (API key masked)
- `/opentell uninstall` — Remove hooks from Claude Code (restart required to apply)

When the user runs `/opentell`, execute the status command and display the results. For subcommands, parse the argument and run the appropriate CLI command.
