#!/usr/bin/env node

/**
 * Instinct — SessionStart Hook
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

    if (context) {
      // Output context to stdout — Claude Code injects this into the session
      process.stdout.write(context);
      log(`Injected ${context.split("\n").length} lines of preference context`);
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
