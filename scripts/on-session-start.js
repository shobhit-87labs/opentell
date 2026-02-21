#!/usr/bin/env node

/**
 * OpenTell — SessionStart Hook
 * 
 * Fires when Claude Code starts a new session.
 * Reads learned preferences and outputs them as additionalContext.
 * stdout on exit 0 is injected into Claude's context for this hook.
 */

const { buildContext } = require("../lib/skill-writer");
const { loadConfig, log, paths } = require("../lib/config");
const { clearBuffer, incrementSessionCount, applyDecay } = require("../lib/store");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

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

    // ── Background auto-update (once per 24h) ──────────────────────────
    // Spawned after stdout is flushed — never delays session start.
    tryBackgroundUpdate();

    // ── Install /opentell slash command ─────────────────────────────────
    // On first session after install (any method), copies the command file to
    // ~/.claude/commands/ so /opentell works without a plugin namespace prefix.
    // Also removes the plugin-level command to prevent /opentell:opentell
    // from appearing as a duplicate. Runs every session because auto-update
    // restores the plugin command file every 24h.
    deduplicatePluginCommand();

    process.exit(0);
  } catch (e) {
    log(`SessionStart error: ${e.message}`);
    // Exit 0 even on error — don't block session start
    process.exit(0);
  }
}

function tryBackgroundUpdate() {
  try {
    const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
    const checkFile = paths.update_check;
    const now = Date.now();

    if (fs.existsSync(checkFile)) {
      const last = parseInt(fs.readFileSync(checkFile, "utf-8").trim(), 10) || 0;
      if (now - last < UPDATE_INTERVAL_MS) return; // too soon
    }

    // Write timestamp before spawning so concurrent sessions don't double-pull
    fs.writeFileSync(checkFile, String(now));

    const scriptPath = path.join(__dirname, "update-bg.js");
    const child = spawn("node", [scriptPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    log("Auto-update: spawned background pull");
  } catch (e) {
    log(`Auto-update spawn error: ${e.message}`);
  }
}

function deduplicatePluginCommand() {
  try {
    const os = require("os");
    const claudeCommandsDir = path.join(os.homedir(), ".claude", "commands");
    const userCommand = path.join(claudeCommandsDir, "opentell.md");
    const pluginCommand = path.join(__dirname, "..", "commands", "opentell.md");

    // Ensure ~/.claude/commands/ exists and install the unnamespaced /opentell
    // command if it isn't there yet. This runs for both marketplace and setup.sh
    // installs, so all users get /opentell regardless of install method.
    if (!fs.existsSync(userCommand) && fs.existsSync(pluginCommand)) {
      fs.mkdirSync(claudeCommandsDir, { recursive: true });
      fs.copyFileSync(pluginCommand, userCommand);
      log("Installed /opentell command to ~/.claude/commands/");
    }

    // Remove the plugin-level command so /opentell:opentell doesn't appear
    // as a duplicate alongside /opentell.
    if (fs.existsSync(pluginCommand)) {
      fs.unlinkSync(pluginCommand);
      log("Removed plugin-level command (user-level /opentell takes precedence)");
    }
  } catch (e) {
    log(`deduplicatePluginCommand error: ${e.message}`);
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
