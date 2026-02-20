#!/bin/bash

# OpenTell — Setup Script
# Installs hooks directly into your Claude Code settings for private testing.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENTELL_DIR="$HOME/.opentell"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  OpenTell — Setup"
echo "  Claude Code learns your coding preferences"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Create ~/.opentell directory
mkdir -p "$OPENTELL_DIR"
echo "✓ Created $OPENTELL_DIR"

# 2. Create default config if not exists
if [ ! -f "$OPENTELL_DIR/config.json" ]; then
  cat > "$OPENTELL_DIR/config.json" << 'EOF'
{
  "anthropic_api_key": "",
  "classifier_model": "claude-haiku-4-5-20251001",
  "confidence_threshold": 0.45,
  "max_learnings": 100,
  "paused": false
}
EOF
  echo "✓ Created default config at $OPENTELL_DIR/config.json"
fi

# 3. API key setup
echo ""
echo "━━━ API Key Setup ━━━"
echo ""
echo "  OpenTell works in two modes:"
echo ""
echo "  WITHOUT an API key (free, zero setup):"
echo "    ✓ Regex detection  — catches explicit corrections instantly"
echo "    ✓ Observation layer — learns from what Claude says"
echo "    ✓ Confidence tracking and context injection at session start"
echo ""
echo "  WITH an Anthropic API key (deeper learning):"
echo "    ✓ Everything above, plus:"
echo "    + Layer 2 LLM classification — catches implicit corrections"
echo "    + Developer profile synthesis — narrative understanding of you"
echo "    + Consolidation — merges related learnings into insights"
echo ""
echo "  ⚠  Note: Pro and Max Claude plans do NOT include API access."
echo "     The API is a separate product. Cost: ~\$0.001/pair, typically"
echo "     under \$0.50/month for normal usage."
echo "     Get a key: https://console.anthropic.com/settings/keys"
echo ""
echo "  🔒 Privacy: your key is stored only in ~/.opentell/config.json"
echo "     on this machine. OpenTell has no server — the key is sent"
echo "     exclusively to api.anthropic.com for classification calls."
echo "     It is never logged, never exported, and goes nowhere else."
echo ""

# Check if a key is already available
EXISTING_KEY=""
if [ -n "$ANTHROPIC_API_KEY" ]; then
  EXISTING_KEY="$ANTHROPIC_API_KEY"
else
  EXISTING_KEY=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$OPENTELL_DIR/config.json','utf-8'));console.log(c.anthropic_api_key||'')}catch{console.log('')}" 2>/dev/null)
fi

if [ -n "$EXISTING_KEY" ]; then
  node -e "
    const fs = require('fs');
    const p = '$OPENTELL_DIR/config.json';
    const c = JSON.parse(fs.readFileSync(p, 'utf-8'));
    c.anthropic_api_key = '$EXISTING_KEY';
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
  " 2>/dev/null
  echo "✓ API key configured"
else
  read -p "  Paste your Anthropic API key (or press Enter to skip): " -r INPUT_KEY
  echo ""
  if [ -n "$INPUT_KEY" ]; then
    if [[ "$INPUT_KEY" == sk-ant-* ]]; then
      node -e "
        const fs = require('fs');
        const p = '$OPENTELL_DIR/config.json';
        const c = JSON.parse(fs.readFileSync(p, 'utf-8'));
        c.anthropic_api_key = process.argv[1];
        fs.writeFileSync(p, JSON.stringify(c, null, 2));
      " "$INPUT_KEY" 2>/dev/null
      echo "  ✓ API key saved — Layer 2 + profile synthesis enabled"
    else
      echo "  ⚠  Doesn't look like a valid key (should start with sk-ant-)."
      echo "     Add it later: edit $OPENTELL_DIR/config.json"
      echo "     OpenTell will run in Layer 1 + observation mode until then."
    fi
  else
    echo "  Skipped — running in Layer 1 + observation mode."
    echo "  To enable Layer 2 later, add your key to:"
    echo "    $OPENTELL_DIR/config.json  (anthropic_api_key field)"
  fi
fi

# 4. Generate hooks config for Claude Code settings
echo ""
echo "━━━ Hook Configuration ━━━"
echo ""
echo "Add the following to your Claude Code settings."
echo "File: $CLAUDE_SETTINGS"
echo "(Or .claude/settings.json in your project)"
echo ""

cat << EOF
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$SCRIPT_DIR/scripts/on-session-start.js\"",
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
            "command": "node \"$SCRIPT_DIR/scripts/on-stop.js\"",
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
            "command": "node \"$SCRIPT_DIR/scripts/on-session-end.js\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
EOF

echo ""

# 5. Offer to auto-install hooks
if [ -f "$CLAUDE_SETTINGS" ]; then
  echo "Existing settings found at $CLAUDE_SETTINGS"
  read -p "Auto-merge hooks into settings? (y/n) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    node -e "
      const fs = require('fs');
      const settingsPath = '$CLAUDE_SETTINGS';
      let settings = {};
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
      
      if (!settings.hooks) settings.hooks = {};
      
      const scriptDir = '$SCRIPT_DIR';
      
      // Merge — don't overwrite existing hooks, append
      const opentellHooks = {
        SessionStart: [{
          hooks: [{ type: 'command', command: 'node \"' + scriptDir + '/scripts/on-session-start.js\"', timeout: 5 }]
        }],
        Stop: [{
          hooks: [{ type: 'command', command: 'node \"' + scriptDir + '/scripts/on-stop.js\"', timeout: 5 }]
        }],
        SessionEnd: [{
          hooks: [{ type: 'command', command: 'node \"' + scriptDir + '/scripts/on-session-end.js\"', timeout: 10 }]
        }]
      };

      for (const [event, hookConfigs] of Object.entries(opentellHooks)) {
        if (!settings.hooks[event]) {
          settings.hooks[event] = hookConfigs;
        } else {
          // Check if already installed
          const existing = JSON.stringify(settings.hooks[event]);
          if (!existing.includes('opentell')) {
            settings.hooks[event].push(...hookConfigs);
          }
        }
      }
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log('✓ Hooks merged into ' + settingsPath);
    " 2>/dev/null || echo "⚠  Auto-merge failed. Please add hooks manually."
  fi
else
  echo "No existing settings file found."
  echo "Create $CLAUDE_SETTINGS with the hooks config above."
fi

# 6. Make CLI available
echo ""
chmod +x "$SCRIPT_DIR/opentell-cli.js"
echo "✓ CLI ready: node $SCRIPT_DIR/opentell-cli.js"
echo ""

# 7. Create symlink for convenience
if [ -d "$HOME/.local/bin" ]; then
  ln -sf "$SCRIPT_DIR/opentell-cli.js" "$HOME/.local/bin/opentell" 2>/dev/null && \
    echo "✓ Symlinked to ~/.local/bin/opentell" || true
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Restart Claude Code (or start a new session)"
echo "  2. Use Claude Code normally"
echo "  3. Run: node $SCRIPT_DIR/opentell-cli.js"
echo "     to check what OpenTell has learned"
echo ""
echo "  Logs: $OPENTELL_DIR/opentell.log"
echo "  Data: $OPENTELL_DIR/learnings.json"
echo "  Config: $OPENTELL_DIR/config.json"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
