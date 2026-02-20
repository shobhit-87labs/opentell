# /instinct — View and manage learned preferences

Show what Instinct has learned about your coding preferences. Run the CLI tool and display the output.

## Usage

Run this command to see current learnings:
```bash
node "${CLAUDE_PLUGIN_ROOT}/instinct-cli.js" status
```

## Subcommands

- `/instinct` — Show all learnings with confidence scores
- `/instinct remove <n>` — Remove a specific learning by number
- `/instinct pause` — Pause learning (keep existing preferences)
- `/instinct resume` — Resume learning
- `/instinct reset` — Clear all learnings (requires --confirm)
- `/instinct export` — Export learnings to JSON file
- `/instinct log` — Show recent detection log

When the user runs `/instinct`, execute the status command and display the results. For subcommands, parse the argument and run the appropriate CLI command.
