# OpenTell

**Claude Code that remembers how you think.**

Stop re-teaching Claude your preferences every session. OpenTell watches how you steer Claude — your corrections, your style, the patterns in your codebase — and injects that understanding into every future session automatically.

---

## What It Does

Every time you correct Claude ("use pnpm, not npm"), redirect it ("shorter responses please"), or it picks up on your project's conventions ("I'll use Vitest since that's what the project uses"), OpenTell learns. Quietly. After enough evidence, it starts injecting those preferences at session start — so Claude gets it right on the first try.

Over time, it builds a **developer profile**: a narrative understanding of how you think, what you care about, and how you like to build. Not just a list of preferences — a picture of the developer.

---

## Installation

```
/plugin marketplace add shobhit-87labs/opentell
/plugin install opentell@shobhit-87labs/opentell
```

That's it. Restart Claude Code and OpenTell starts learning.

**Optional — add an API key for deeper learning:**

LLM classification, developer profile synthesis, and consolidation require an Anthropic API key. Without one, OpenTell runs in Layer 1 mode (regex detection + observation capture), which is free and still useful.

To enable Layer 2:
```bash
# Edit ~/.opentell/config.json and add your key:
{
  "anthropic_api_key": "sk-ant-..."
}
```

> Note: Pro and Max Claude plans do not include API access. The API is a separate product. Get a key at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys). Typical cost: under $1/month.

---

## Two Ways It Learns

### 1. From Your Corrections (active)
When you redirect Claude — explicitly or implicitly — OpenTell detects it:

- **Explicit:** "use pnpm", "we use Supabase", "shorter responses", "just the code"
- **Implicit:** Task redirects, style redirects, tool substitutions

**Detection is two-layered:**
- **Regex (Layer 1):** Catches explicit corrections in <1ms. Zero cost. Always on.
- **LLM (Layer 2):** Catches implicit redirects using Claude Haiku. Runs at session end. Requires API key. ~$0.001/pair.

### 2. From What Claude Observes (passive)
Claude constantly narrates what it's doing. Sentences like:

> *"I'll use pnpm since that's what the project uses"*
> *"I notice the codebase follows a service/repository pattern"*
> *"I'll follow the same error handling as the existing routes"*

OpenTell captures these as **unvalidated observations** — low-confidence inferences about your codebase. They're stored separately and never injected until you confirm them (or they're validated by a matching correction you make later).

---

## CLI

Use the `/opentell` slash command inside Claude Code, or run the CLI directly:

```bash
node ~/.claude/plugins/cache/shobhit-87labs/opentell/0.1.0/opentell-cli.js <command>
```

```
/opentell                    # Show all learnings grouped by type
/opentell profile            # Show your developer profile (narrative)
/opentell profile regen      # Force-regenerate the developer profile
/opentell context            # Preview what Claude sees at session start
/opentell promote            # Promote high-confidence learnings to CLAUDE.md
/opentell promote <n>        # Force-promote a specific candidate by number
/opentell promote --dry      # Preview what would be promoted
/opentell consolidate        # Merge related learnings into deeper insights
/opentell consolidate --dry  # Preview consolidation clusters
/opentell patterns           # Show cross-session patterns
/opentell observations       # Review unvalidated observations from Claude
/opentell accept <n>         # Accept observation #n (makes it active)
/opentell reject <n>         # Reject observation #n (archives it)
/opentell remove <n>         # Remove a learning by number
/opentell pause / resume     # Pause or resume learning
/opentell reset --confirm    # Clear everything
/opentell export [file]      # Export learnings as JSON
/opentell import <file>      # Import learnings from JSON
/opentell stats              # Show API call counts, token usage, and cost
/opentell log [n]            # Show last n log entries
/opentell config             # Show configuration
/opentell uninstall          # Remove hooks from Claude Code (keeps data)
/opentell uninstall --data   # Remove hooks and delete all data
```

---

## How Confidence Works

Every learning has a confidence score. It starts low and builds through reinforcement:

```
Confidence lifecycle:

below 0.45   ○  Candidate / Unvalidated    — stored, not injected
0.45+        ✦  Active                     — injected at session start
0.80+        ★  Promotable                 — ready for CLAUDE.md

Each new-session reinforcement:    +0.15
Same-session reinforcement:        +0.08
Corroborated by observation:       +0.03
14 days without reinforcement:     ×0.95 decay
30 days:                           ×0.90 decay
Below 0.15:                        Archived
```

A learning typically needs 2–3 session reinforcements to become active. One-off corrections don't stick — that's intentional.

**Inferred observations** (from what Claude says) are capped at 0.44 through passive accumulation alone. They can only become active through developer validation — either explicit (`/opentell accept`) or implicit (you make a matching correction later).

---

## What Gets Learned

OpenTell classifies learnings into five types:

| Type | Description | Example |
|------|-------------|---------|
| `THINKING_PATTERN` | How you reason and approach problems | "Prefers to understand root cause before fixing" |
| `DESIGN_PRINCIPLE` | Architecture and structure values | "Separates business logic from route handlers" |
| `QUALITY_STANDARD` | Quality bar and non-negotiables | "Always adds error handling to async functions" |
| `PREFERENCE` | Tools, libraries, conventions | "Uses pnpm", "Uses Vitest", "Prefers functional components" |
| `BEHAVIORAL_GAP` | Things Claude keeps getting wrong | "Don't add docstrings unless asked" |

---

## The Intelligence Pipeline

```
Each Claude response (Stop hook)
  ├── Extract last turn pair from transcript
  ├── Run regex detection → immediate store if matched
  ├── Detect tool-pattern signals → package manager, test runner substitutions
  ├── Run observation layer → capture Claude's inferred observations
  └── Queue ambiguous pairs in WAL for end-of-session LLM classification

Session end (SessionEnd hook)
  ├── Drain WAL → classify queued pairs with Haiku
  ├── Cross-session pattern detection → upgrade recurring learnings
  ├── Consolidation → merge related learnings into deeper insights
  ├── Profile synthesis → regenerate developer narrative if stale
  ├── Passive accumulation → small confidence bump for uncontradicted observations
  └── Decay → reduce confidence on stale learnings

Session start (SessionStart hook)
  ├── Inject active learnings as context → Claude sees your profile
  └── Background auto-update → pull latest plugin version (once per 24h)
```

---

## Developer Profile

Once you have 6+ active learnings, OpenTell synthesizes a **narrative profile** using Claude — a paragraph that captures how you think, not just what you prefer. This narrative is injected alongside specific preferences at session start.

```
/opentell profile
```

```
Your Developer Profile:

This developer prioritizes clarity and minimal surface area. They prefer
explicit over implicit, avoid premature abstraction, and want Claude to
match the project's existing conventions rather than introduce new patterns.
They use pnpm, Vitest, and Supabase, and expect short, direct responses
without unsolicited explanation.

Specific Conventions:
- Uses pnpm
- Uses Vitest for testing
- Uses Supabase for auth and database
- Prefers functional components over class components
```

---

## Promoting to CLAUDE.md

When a learning reaches high confidence (0.80+, 4+ evidence instances), you can promote it to `CLAUDE.md`. This makes it a permanent project instruction — Claude reads it directly without needing OpenTell to inject it.

```
/opentell promote --dry    # Preview
/opentell promote          # Write to CLAUDE.md
/opentell promote <n>      # Force-promote a specific candidate
```

Promoted learnings are marked and no longer injected by OpenTell (no duplication).

---

## Cost

| Layer | Cost | When |
|-------|------|------|
| Regex detection | Free | Every turn |
| Observation capture | Free | Every turn |
| LLM classification (Haiku 4.5) | ~$0.002/pair | Session end, ambiguous pairs only |
| Profile synthesis (Haiku 4.5) | ~$0.02 | When profile is stale (every ~5 sessions) |
| Consolidation (Haiku 4.5) | ~$0.03 | When 3+ related learnings exist |

Typical monthly cost for regular usage: **$0.20–$1.00**

> Prices based on Haiku 4.5 ($1.00/$5.00 per MTok in/out). Run `/opentell stats` to see your exact usage and cost.

---

## Privacy

OpenTell has no server. There is no telemetry, no analytics, and no account.

**Your API key:**
- Stored only in `~/.opentell/config.json` on your local machine
- Sent exclusively to `https://api.anthropic.com` for classification, profile synthesis, and consolidation calls
- Never written to `opentell.log`
- Never included in `opentell export` output
- Masked in `/opentell config` terminal output

**Your conversation content:**
- The Stop hook extracts the last 1–2 turn pairs from your local Claude Code transcript
- Only up to 500 chars of each side of the conversation are sent to Anthropic for classification (Layer 2)
- Evidence stored per learning is capped at 300 chars — no raw code, no full messages
- Your transcript file itself is never read in full and never leaves your machine

**What goes to Anthropic API:**
- Short excerpts of conversation turns for classification
- Your accumulated learnings (as a list of short text strings) for profile synthesis
- Nothing else

You can verify all network calls yourself — there are exactly three `fetch()` calls in the codebase, all to `https://api.anthropic.com/v1/messages`:
- `lib/classifier.js`
- `lib/profiler.js`
- `lib/consolidator.js`

---

## Data Storage

```
~/.opentell/
├── config.json          # API key, model, thresholds (stays local)
├── learnings.json       # All learnings + evidence (stays local)
├── wal.jsonl            # Write-ahead log (stays local)
├── profile.json         # Synthesized developer profile (stays local)
├── stats.json           # API call counts, token usage, cost totals (stays local)
└── opentell.log         # Detection log — API key never written here
```

---

## Configuration

Edit `~/.opentell/config.json` to customise behaviour:

```json
{
  "anthropic_api_key": "sk-ant-...",

  "classifier_model": "claude-haiku-4-5-20251001",
  "synthesis_model":  "claude-haiku-4-5-20251001",

  "confidence_threshold": 0.45,
  "max_learnings": 100,
  "paused": false
}
```

| Field | Default | Purpose |
|---|---|---|
| `classifier_model` | `claude-haiku-4-5-20251001` | Turn-pair classification (Layer 2). Called once per ambiguous turn — keep this Haiku for cost. |
| `synthesis_model` | `claude-haiku-4-5-20251001` | Developer profile synthesis and consolidation. Low-volume — upgrade to Sonnet for richer profiles. |
| `confidence_threshold` | `0.45` | Minimum confidence for a learning to be injected at session start. |
| `max_learnings` | `100` | Cap on stored learnings. |
| `paused` | `false` | Set to `true` to suspend all detection without uninstalling. |

**Upgrading the synthesis model** for a better developer profile:
```json
"synthesis_model": "claude-sonnet-4-6"
```

---

## Architecture

**Zero npm dependencies.** Uses only Node.js built-ins + native `fetch` (Node 18+).

```
opentell/
├── scripts/
│   ├── on-session-start.js   # Injects context at session start + auto-update
│   ├── on-stop.js            # Detects corrections + observations after each turn
│   ├── on-session-end.js     # Runs intelligence pipeline at session close
│   ├── on-post-tool-use.js   # Buffers tool events (Bash/Write/Edit)
│   ├── classify-bg.js        # Background LLM classification worker
│   └── update-bg.js          # Background git pull (runs detached)
├── lib/
│   ├── detector.js           # Regex correction detection (Layer 1)
│   ├── observer.js           # Observation layer (what Claude says)
│   ├── classifier.js         # LLM classification (Layer 2)
│   ├── tool-signals.js       # Tool-pattern signal detection
│   ├── store.js              # Learning storage, confidence, WAL
│   ├── skill-writer.js       # Context builder + status display
│   ├── profiler.js           # Developer profile synthesis
│   ├── consolidator.js       # Learning consolidation (merge related)
│   ├── cross-session.js      # Cross-session pattern detection
│   ├── promoter.js           # CLAUDE.md promotion
│   ├── transcript.js         # Parse Claude Code session transcript
│   └── config.js             # Config management
├── opentell-cli.js           # CLI entry point
└── test/                     # Test suite
```

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
