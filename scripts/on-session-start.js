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

    // ── One-time migration cleanup ──────────────────────────────────────────
    // Remove the ghost ~/.claude/commands/opentell.md copied by the old model.
    // The plugin system now owns slash command registration (/opentell:opentell).
    try {
      const os = require("os");
      const legacyCmd = path.join(os.homedir(), ".claude", "commands", "opentell.md");
      if (fs.existsSync(legacyCmd)) {
        fs.unlinkSync(legacyCmd);
        log("Migration: removed legacy ~/.claude/commands/opentell.md");
      }
    } catch (e) {
      log(`Migration cleanup error: ${e.message}`);
    }

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
