#!/bin/bash

# Instinct — Setup Script
# Installs hooks directly into your Claude Code settings for private testing.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTINCT_DIR="$HOME/.instinct"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Instinct — Setup"
echo "  Claude Code learns your coding preferences"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Create ~/.instinct directory
mkdir -p "$INSTINCT_DIR"
echo "✓ Created $INSTINCT_DIR"

# 2. Create default config if not exists
if [ ! -f "$INSTINCT_DIR/config.json" ]; then
  cat > "$INSTINCT_DIR/config.json" << 'EOF'
{
  "anthropic_api_key": "",
  "classifier_model": "claude-haiku-4-5-20251001",
  "confidence_threshold": 0.45,
  "max_learnings": 100,
  "paused": false
}
EOF
  echo "✓ Created default config at $INSTINCT_DIR/config.json"
fi

# 3. Check for API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
  EXISTING_KEY=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$INSTINCT_DIR/config.json','utf-8'));console.log(c.anthropic_api_key||'')}catch{console.log('')}" 2>/dev/null)
  if [ -z "$EXISTING_KEY" ]; then
    echo ""
    echo "⚠  No ANTHROPIC_API_KEY found."
    echo "   Layer 2 (LLM classification) requires an API key."
    echo "   Set it via:"
    echo "     export ANTHROPIC_API_KEY=sk-ant-..."
    echo "   Or edit: $INSTINCT_DIR/config.json"
    echo ""
    echo "   Layer 1 (regex detection) works without a key."
    echo ""
  fi
else
  # Write API key to config
  node -e "
    const fs = require('fs');
    const p = '$INSTINCT_DIR/config.json';
    const c = JSON.parse(fs.readFileSync(p, 'utf-8'));
    c.anthropic_api_key = '$ANTHROPIC_API_KEY';
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
  " 2>/dev/null
  echo "✓ API key configured from environment"
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
      const instinctHooks = {
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
      
      for (const [event, hookConfigs] of Object.entries(instinctHooks)) {
        if (!settings.hooks[event]) {
          settings.hooks[event] = hookConfigs;
        } else {
          // Check if already installed
          const existing = JSON.stringify(settings.hooks[event]);
          if (!existing.includes('instinct')) {
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
chmod +x "$SCRIPT_DIR/instinct-cli.js"
echo "✓ CLI ready: node $SCRIPT_DIR/instinct-cli.js"
echo ""

# 7. Create symlink for convenience
if [ -d "$HOME/.local/bin" ]; then
  ln -sf "$SCRIPT_DIR/instinct-cli.js" "$HOME/.local/bin/instinct" 2>/dev/null && \
    echo "✓ Symlinked to ~/.local/bin/instinct" || true
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Restart Claude Code (or start a new session)"
echo "  2. Use Claude Code normally"
echo "  3. Run: node $SCRIPT_DIR/instinct-cli.js"
echo "     to check what Instinct has learned"
echo ""
echo "  Logs: $INSTINCT_DIR/instinct.log"
echo "  Data: $INSTINCT_DIR/learnings.json"
echo "  Config: $INSTINCT_DIR/config.json"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
