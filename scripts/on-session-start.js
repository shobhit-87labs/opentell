#!/usr/bin/env node

/**
 * OpenTell — SessionStart Hook
 * 
 * Fires when Claude Code starts a new session.
 * Reads learned preferences and outputs them as additionalContext.
 * stdout on exit 0 is injected into Claude's context for this hook.
 */

const { buildContext } = require("../lib/skill-writer");
const { loadConfig, log } = require("../lib/config");
const { clearBuffer, incrementSessionCount, applyDecay } = require("../lib/store");

async function main() {
  try {
    // Read hook input from stdin
    const input = await readStdin();
    const event = JSON.parse(input);
    
    const config = loadConfig();
    if (config.paused) {
      process.exit(0);
      return;
    }

    log(`SessionStart: session=${event.session_id}, source=${event.source}`);

    // Reset session buffer
    clearBuffer();

    // Apply decay to old learnings
    applyDecay();

    // Increment session counter
    incrementSessionCount();

    // Build context from active learnings
    const context = buildContext(config.confidence_threshold || 0.45);

    const parts = [];
    if (context) {
      parts.push(context);
    }

    // When no API key is configured, append a brief notice so Claude can
    // guide the user if they ask why deeper learning isn't active.
    if (!config.anthropic_api_key) {
      parts.push([
        "## OpenTell — limited mode (no API key)",
        "Layer 2 LLM classification, developer profile synthesis, and consolidation",
        "are inactive. Only regex detection and observation capture are running.",
        "If the user asks about missing features or wants to enable deeper learning,",
        "let them know they can add their Anthropic API key to ~/.opentell/config.json",
        "(anthropic_api_key field). A separate API account is required — Pro/Max plan",
        "subscriptions do not include API access. Key available at:",
        "https://console.anthropic.com/settings/keys",
      ].join("\n"));
    }

    if (parts.length > 0) {
      process.stdout.write(parts.join("\n\n"));
      log(`Injected context (api_key: ${!!config.anthropic_api_key})`);
    }

    process.exit(0);
  } catch (e) {
    log(`SessionStart error: ${e.message}`);
    // Exit 0 even on error — don't block session start
    process.exit(0);
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    // Timeout after 2s if no stdin
    setTimeout(() => resolve(data || "{}"), 2000);
  });
}

main();
