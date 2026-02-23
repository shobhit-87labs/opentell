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

    // First-run detection: if no LLM is configured at all, inject a setup wizard
    // that instructs Claude to guide the user interactively via AskUserQuestion.
    const { isLLMAvailable } = require("../lib/llm-client");
    if (!isLLMAvailable(config)) {
      const pluginPath = path.resolve(__dirname, "..");
      parts.push([
        "⚠️ OPENTELL SETUP REQUIRED — Run this setup NOW before anything else.",
        "",
        "Ask the user: \"OpenTell (your AI preference-learning tool) needs a one-time setup.",
        "Which LLM provider would you like to use?\"",
        "",
        "Present these options with pricing (input/output per million tokens):",
        "  1. Anthropic Claude Haiku   — $1.00 / $5.00   (default, best quality)",
        "  2. Google Gemini 2.0 Flash  — $0.10 / $0.40   ✨ best value",
        "  3. Groq llama-3.1-8b-instant — $0.05 / $0.08  (fastest)",
        "  4. OpenAI gpt-4o-mini       — $0.15 / $0.60",
        "  5. Custom OpenAI-compatible endpoint",
        "",
        "After they choose:",
        "  - Ask for their API key",
        `  - Save config using Bash tool: node ${pluginPath}/opentell-cli.js config set <key> <value>`,
        "    Keys to set per provider:",
        "      Anthropic:  config set anthropic_api_key <key>",
        "      Others:     config set llm_provider openai_compatible",
        "                  config set llm_base_url <url>   (see presets below)",
        "                  config set llm_api_key <key>",
        "                  config set classifier_model <model>",
        "                  config set synthesis_model <model>",
        "",
        "  Provider presets:",
        "    Gemini:  llm_base_url=https://generativelanguage.googleapis.com/v1beta/openai  model=gemini-2.0-flash",
        "    Groq:    llm_base_url=https://api.groq.com/openai/v1  model=llama-3.1-8b-instant",
        "    OpenAI:  llm_base_url=https://api.openai.com/v1  model=gpt-4o-mini",
        "    Custom:  ask user for base_url, api_key, model name",
        "",
        "- Confirm: \"OpenTell is now configured with [provider / model]. It will learn your preferences silently.\"",
        "- Do NOT continue with any other task until setup is complete.",
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
