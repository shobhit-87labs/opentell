# Instinct

**Claude Code learns your coding preferences from corrections.**

Stop re-teaching Claude your style every session. Instinct watches how you steer Claude — "use pnpm", "we use Supabase", "just the code" — and injects those preferences into future sessions automatically.

## How It Works

1. You use Claude Code normally
2. When you correct Claude ("no, use pnpm" / "shorter" / "we use Supabase"), Instinct detects it
3. After a few reinforcements, the preference gets injected into every new session
4. Claude starts getting things right on the first try

**Two detection layers:**
- **Layer 1 (Regex):** Catches explicit corrections like "use X instead", "we use Y", "don't do Z". Runs on every turn, <1ms, zero cost.
- **Layer 2 (LLM):** Catches implicit corrections — when you redirect without saying "no". Runs at session end via Anthropic API (Haiku). Requires API key.

## Quick Setup (Private Testing)

### Prerequisites
- Node.js 18+
- Claude Code installed
- Anthropic API key (for Layer 2)

### Install

```bash
# Clone/copy this directory somewhere permanent
git clone <repo> ~/instinct   # or copy it wherever

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-api03-...

# Run setup
cd ~/instinct
bash setup.sh
```

The setup script will:
1. Create `~/.instinct/` for config and data
2. Save your API key
3. Show you the hooks config to add to Claude Code
4. Optionally auto-merge hooks into `~/.claude/settings.json`

### Manual Hook Setup

If you prefer to add hooks manually, add this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/instinct/scripts/on-session-start.js\"",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/instinct/scripts/on-stop.js\"",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/instinct/scripts/on-session-end.js\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/instinct` with the actual path.

### Restart Claude Code

After adding hooks, restart Claude Code. You'll need to approve the new hooks in the `/hooks` menu.

## Usage

Just use Claude Code. Instinct runs silently in the background.

### Check What It Learned

```bash
node ~/instinct/instinct-cli.js

# Output:
# Instinct — 12 learnings (8 active, 4 candidates)
#
# Active (injected into sessions):
#   1. 📐 Uses pnpm  (4x, conf: 0.78)
#   2. 📐 Prefers concise responses  (3x, conf: 0.65)
#   3. 🤖 Prefers functional components  (2x, conf: 0.55)
#   ...
```

📐 = detected by regex, 🤖 = detected by LLM

### Commands

```bash
node ~/instinct/instinct-cli.js                # Show learnings
node ~/instinct/instinct-cli.js remove 3       # Remove learning #3
node ~/instinct/instinct-cli.js pause           # Pause learning
node ~/instinct/instinct-cli.js resume          # Resume learning
node ~/instinct/instinct-cli.js reset --confirm # Clear everything
node ~/instinct/instinct-cli.js export          # Export to JSON
node ~/instinct/instinct-cli.js import file.json# Import from JSON
node ~/instinct/instinct-cli.js log             # View detection log
node ~/instinct/instinct-cli.js config          # View config
```

## How Preferences Flow

```
Confidence Lifecycle:

0.30  ○ Candidate     — Stored, not injected
0.45  ✦ Tentative     — Injected, low priority
0.65  ✅ Confident    — Always injected
0.85  ★ Established   — Core preference

Each new-session reinforcement: +0.15
Same-session reinforcement:     +0.08
14 days without reinforcement:  ×0.95 decay
30 days:                        ×0.90 decay
Below 0.15:                     Archived
```

A preference needs ~2-3 session reinforcements to become active (injected).
This prevents one-off corrections from polluting your preference profile.

## Files

```
~/.instinct/
├── config.json       # API key, model, thresholds
├── learnings.json    # All learned preferences + evidence
├── session-buffer.json # Current session state (temporary)
└── instinct.log      # Detection log
```

## Cost

- **Layer 1 (regex):** Free. Always. No API calls.
- **Layer 2 (LLM):** ~$0.001 per classification. Capped at 20 per session.
  - Typical session: 5-15 ambiguous pairs → $0.005-$0.015
  - Heavy session: 20 pairs (cap) → $0.02
  - Monthly estimate (20 sessions): $0.10-$0.40

## Architecture

```
SessionStart hook
  → Read learnings from ~/.instinct/learnings.json
  → Output as context text (stdout → Claude sees it)

Stop hook (after each Claude response)
  → Parse last turn pair from transcript
  → Run regex detection — if match, store candidate immediately
  → If ambiguous (no regex match, not noise), spawn a background
    process that calls Haiku to classify it. Claude doesn't wait.

SessionEnd hook (session closes)
  → Apply decay to stale learnings
  → Clean up session buffer
```

## Zero Dependencies

No npm install needed. Uses only Node.js built-ins + native `fetch` (Node 18+).
The LLM classifier calls the Anthropic API directly via fetch.

## Running Tests

```bash
node test/test-detector.js
```

## Config Options

Edit `~/.instinct/config.json`:

```json
{
  "anthropic_api_key": "sk-ant-...",    // Your API key
  "classifier_model": "claude-haiku-4-5-20251001", // LLM model for Layer 2
  "confidence_threshold": 0.45,          // Min confidence to inject
  "max_learnings": 100,                  // Max active learnings
  "paused": false                        // Pause all detection
}
```
