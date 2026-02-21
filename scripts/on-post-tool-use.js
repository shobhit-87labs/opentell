#!/usr/bin/env node

/**
 * OpenTell — PostToolUse Hook
 *
 * Fires after each Bash, Write, or Edit tool call.
 * Extracts a compact signal from the tool event and appends it to the
 * session buffer. No API calls — just a fast in-memory accumulation.
 *
 * The Stop hook then reads these accumulated events to:
 *   1. Detect direct tool-pattern signals (e.g. npm → pnpm substitution)
 *   2. Enrich the WAL payload sent to the LLM classifier
 */

const { loadBuffer, saveBuffer } = require("../lib/store");
const { loadConfig, log } = require("../lib/config");

const HIGH_SIGNAL_TOOLS = new Set(["Bash", "Write", "Edit"]);
const MAX_TOOL_EVENTS = 100; // per session

async function main() {
  try {
    const input = await readStdin();
    const event = JSON.parse(input);

    const config = loadConfig();
    if (config.paused) {
      process.exit(0);
      return;
    }

    const toolName = event.tool_name;
    if (!HIGH_SIGNAL_TOOLS.has(toolName)) {
      process.exit(0);
      return;
    }

    const toolInput = event.tool_input || {};
    const compact = extractCompact(toolName, toolInput);
    if (!compact) {
      process.exit(0);
      return;
    }

    const buf = loadBuffer();
    buf.tool_events = buf.tool_events || [];
    buf.tool_events.push({ ...compact, ts: Date.now() });

    // Cap buffer size
    if (buf.tool_events.length > MAX_TOOL_EVENTS) {
      buf.tool_events = buf.tool_events.slice(-MAX_TOOL_EVENTS);
    }

    saveBuffer(buf);
    process.exit(0);
  } catch (e) {
    log(`PostToolUse error: ${e.message}`);
    process.exit(0);
  }
}

/**
 * Extract only what matters from each tool — discard content/output.
 */
function extractCompact(toolName, input) {
  switch (toolName) {
    case "Bash": {
      const command = (input.command || "").trim();
      if (!command) return null;
      return { tool: "Bash", command: command.slice(0, 300) };
    }
    case "Write": {
      const p = input.file_path || "";
      if (!p) return null;
      return { tool: "Write", path: p, ext: extOf(p) };
    }
    case "Edit": {
      const p = input.file_path || "";
      if (!p) return null;
      return { tool: "Edit", path: p, ext: extOf(p) };
    }
    default:
      return null;
  }
}

function extOf(filePath) {
  const m = filePath.match(/(\.[^./\\]+)$/);
  return m ? m[1].toLowerCase() : "";
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    setTimeout(() => resolve(data || "{}"), 2000);
  });
}

main();
