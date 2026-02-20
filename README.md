# OpenTell

**Claude Code that remembers how you think.**

Stop re-teaching Claude your preferences every session. OpenTell watches how you steer Claude — your corrections, your style, the patterns in your codebase — and injects that understanding into every future session automatically.

---

## What It Does

Every time you correct Claude ("use pnpm, not npm"), redirect it ("shorter responses please"), or it picks up on your project's conventions ("I'll use Vitest since that's what the project uses"), OpenTell learns. Quietly. After enough evidence, it starts injecting those preferences at session start — so Claude gets it right on the first try.

Over time, it builds a **developer profile**: a narrative understanding of how you think, what you care about, and how you like to build. Not just a list of preferences — a picture of the developer.

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

## Installation

### Prerequisites
- Node.js 18+
- Claude Code installed
- Anthropic API key (for LLM classification and profile synthesis)

### Setup

```bash
git clone https://github.com/your-username/opentell ~/opentell

export ANTHROPIC_API_KEY=sk-ant-api03-...

cd ~/opentell
bash setup.sh
```

The setup script creates `~/.opentell/` for data storage, saves your API key, and optionally merges the required hooks into `~/.claude/settings.json`.

### Manual Hook Setup

Add this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node \"/path/to/opentell/scripts/on-session-start.js\"",
        "timeout": 5
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node \"/path/to/opentell/scripts/on-stop.js\"",
        "timeout": 5
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "command": "node \"/path/to/opentell/scripts/on-session-end.js\"",
        "timeout": 10
      }]
    }]
  }
}
```

Restart Claude Code and approve the hooks in the `/hooks` menu.

---

## CLI

```bash
opentell                     # Show all learnings grouped by type
opentell profile              # Show your developer profile (narrative)
opentell profile regen        # Force regenerate the profile
opentell context              # Preview what Claude sees at session start
opentell promote              # Promote high-confidence learnings to CLAUDE.md
opentell promote --dry        # Preview what would be promoted
opentell consolidate          # Merge related learnings into deeper insights
opentell consolidate --dry    # Preview consolidation clusters
opentell patterns             # Show cross-session patterns
opentell observations         # Review unvalidated observations from Claude
opentell accept <n>           # Accept observation #n (makes it active)
opentell reject <n>           # Reject observation #n (archives it)
opentell remove <n>           # Remove a learning by number
opentell pause / resume       # Pause or resume learning
opentell reset --confirm      # Clear everything
opentell export [file]        # Export learnings as JSON
opentell import <file>        # Import learnings from JSON
opentell log [n]              # Show last n log entries
opentell config               # Show configuration
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

**Inferred observations** (from what Claude says) are capped at 0.44 through passive accumulation alone. They can only become active through developer validation — either explicit (`opentell accept`) or implicit (you make a matching correction later).

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
  └── Inject active learnings as context → Claude sees your profile
```

---

## Developer Profile

Once you have 6+ active learnings, OpenTell synthesizes a **narrative profile** using Claude — a paragraph that captures how you think, not just what you prefer. This narrative is injected alongside specific preferences at session start.

```
opentell profile
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

```bash
opentell promote --dry    # Preview
opentell promote          # Write to CLAUDE.md
```

Promoted learnings are marked and no longer injected by OpenTell (no duplication).

---

## Reviewing Observations

When Claude says something like *"I'll use Vitest since that's what the project uses"*, OpenTell captures it as an unvalidated observation. Run:

```bash
opentell observations
```

```
3 unvalidated observation(s) from Claude:

  1. Uses Vitest
     type: self_adaptation | conf: 0.25 [testing]

  2. Convention: service/repository pattern
     type: project_observation | conf: 0.20 [general]

  3. Convention: error handling pattern
     type: pattern_matching | conf: 0.18 [general]

Run 'opentell accept <n>' to validate or 'opentell reject <n>' to discard.
```

You don't need to manually review everything. If Claude observed something correctly and you later make a matching correction, OpenTell validates it automatically.

---

## Cost

| Layer | Cost | When |
|-------|------|------|
| Regex detection | Free | Every turn |
| Observation capture | Free | Every turn |
| LLM classification (Haiku) | ~$0.001/pair | Session end, ambiguous pairs only |
| Profile synthesis (Haiku) | ~$0.01 | When profile is stale (every ~5 sessions) |
| Consolidation (Haiku) | ~$0.02 | When 3+ related learnings exist |

Typical monthly cost for regular usage: **$0.10–$0.50**

---

## Privacy

OpenTell has no server. There is no telemetry, no analytics, and no account.

**Your API key:**
- Stored only in `~/.opentell/config.json` on your local machine
- Sent exclusively to `https://api.anthropic.com` for classification, profile synthesis, and consolidation calls
- Never written to `opentell.log`
- Never included in `opentell export` output
- Masked in `opentell config` terminal output (shows `sk-ant-api03-...xxxx`)

**Your conversation content:**
- The Stop hook extracts the last 1–2 turn pairs from your local Claude Code transcript
- Only up to 500 chars of each side of the conversation are sent to Anthropic for classification (Layer 2)
- Evidence stored per learning is capped at 300 chars — no raw code, no full messages
- Your transcript file itself is never read in full and never leaves your machine

**What goes to Anthropic API:**
- Short excerpts of conversation turns for classification (`classifySingle`)
- Your accumulated learnings (as a list of short text strings) for profile synthesis
- Nothing else

You can verify all network calls yourself — there are exactly three `fetch()` calls in the codebase, all to `https://api.anthropic.com/v1/messages`:
- `lib/classifier.js:175`
- `lib/profiler.js:112`
- `lib/consolidator.js:148`

---

## Data Storage

```
~/.opentell/
├── config.json          # API key, model, thresholds (stays local)
├── learnings.json       # All learnings + evidence (stays local)
├── wal.jsonl            # Write-ahead log (stays local)
├── profile.json         # Synthesized developer profile (stays local)
└── opentell.log         # Detection log — API key never written here
```

---

## Architecture

**Zero npm dependencies.** Uses only Node.js built-ins + native `fetch` (Node 18+). The LLM classifier calls the Anthropic API directly.

```
opentell/
├── scripts/
│   ├── on-session-start.js   # Injects context at session start
│   ├── on-stop.js            # Detects corrections + observations after each turn
│   └── on-session-end.js     # Runs intelligence pipeline at session close
├── lib/
│   ├── detector.js           # Regex correction detection (Layer 1)
│   ├── observer.js           # Observation layer (what Claude says)
│   ├── classifier.js         # LLM classification (Layer 2)
│   ├── store.js              # Learning storage, confidence, WAL
│   ├── skill-writer.js       # Context builder + status display
│   ├── profiler.js           # Developer profile synthesis
│   ├── consolidator.js       # Learning consolidation (merge related)
│   ├── cross-session.js      # Cross-session pattern detection
│   ├── promoter.js           # CLAUDE.md promotion
│   ├── transcript.js         # Parse Claude Code session transcript
│   └── config.js             # Config management
├── opentell-cli.js           # CLI entry point
├── setup.sh                  # Interactive setup
└── test/                     # Test suite (120+ tests)
```

---

## Running Tests

```bash
node test/test-detector.js      # Correction detection tests
node test/test-observer.js      # Observation layer tests
node test/test-store.js         # Store + confidence tests
```

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
