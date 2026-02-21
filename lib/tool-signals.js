/**
 * OpenTell — Tool Signal Detector
 *
 * Detects high-confidence preference signals directly from tool usage patterns.
 * These bypass the LLM classifier entirely — the evidence is structural, not textual.
 *
 * Called by the Stop hook with the tool events accumulated this turn.
 */

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"];
const TEST_RUNNERS = ["jest", "vitest", "mocha", "pytest", "go test", "cargo test"];

/**
 * Scan a sequence of tool events and return learning candidates.
 * @param {Array} toolEvents - from session buffer, filtered to current turn
 */
function detectToolSignals(toolEvents) {
  if (!toolEvents || toolEvents.length === 0) return [];

  const signals = [];
  const bash = toolEvents.filter((e) => e.tool === "Bash" && e.command);

  // ── Pattern 1: Package manager substitution ─────────────────────────
  // Claude ran "npm install X", then user (or Claude after correction)
  // ran "pnpm install X" in the same turn. Clear preference signal.
  for (let i = 0; i < bash.length - 1; i++) {
    const a = bash[i];
    const b = bash[i + 1];
    const pmA = matchPackageManager(a.command);
    const pmB = matchPackageManager(b.command);
    if (pmA && pmB && pmA !== pmB) {
      signals.push({
        text: `Uses ${pmB} — not ${pmA}`,
        confidence: 0.72,
        classification: "PREFERENCE",
        area: "general",
        scope: "repo",
        certainty: "high",
        detection_method: "tool_pattern",
        evidence: {
          claude_said: `Tool used: ${a.command}`,
          user_said: `Replaced with: ${b.command}`,
          error_context: "",
        },
      });
    }
  }

  // ── Pattern 2: Test runner substitution ─────────────────────────────
  for (let i = 0; i < bash.length - 1; i++) {
    const a = bash[i];
    const b = bash[i + 1];
    const trA = matchTestRunner(a.command);
    const trB = matchTestRunner(b.command);
    if (trA && trB && trA !== trB) {
      signals.push({
        text: `Uses ${trB} — not ${trA}`,
        confidence: 0.72,
        classification: "PREFERENCE",
        area: "testing",
        scope: "repo",
        certainty: "high",
        detection_method: "tool_pattern",
        evidence: {
          claude_said: `Tool used: ${a.command}`,
          user_said: `Replaced with: ${b.command}`,
          error_context: "",
        },
      });
    }
  }

  // ── Pattern 3: File extension substitution ──────────────────────────
  // Claude Wrote/Edited a .ts file, then same path appeared as .js (or vice versa)
  const fileEvents = toolEvents.filter((e) => (e.tool === "Write" || e.tool === "Edit") && e.path);
  const extSubstitutions = findExtSubstitutions(fileEvents);
  for (const sub of extSubstitutions) {
    signals.push({
      text: `Uses ${sub.to} files — not ${sub.from}`,
      confidence: 0.65,
      classification: "PREFERENCE",
      area: "general",
      scope: "repo",
      certainty: "high",
      detection_method: "tool_pattern",
      evidence: {
        claude_said: `Created: ${sub.fromPath}`,
        user_said: `Replaced with: ${sub.toPath}`,
        error_context: "",
      },
    });
  }

  return signals;
}

/**
 * Build a compact, human-readable summary of tool events for the LLM classifier.
 * This gets appended to the classifier prompt as extra context.
 */
function formatToolContext(toolEvents) {
  if (!toolEvents || toolEvents.length === 0) return "";

  const lines = toolEvents.slice(-15).map((e) => {
    switch (e.tool) {
      case "Bash":   return `  bash: ${e.command}`;
      case "Write":  return `  wrote: ${e.path}`;
      case "Edit":   return `  edited: ${e.path}`;
      default:       return `  ${e.tool}`;
    }
  });

  return "Tool uses this turn:\n" + lines.join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchPackageManager(command) {
  if (!command) return null;
  const cmd = command.trim().toLowerCase();
  for (const pm of PACKAGE_MANAGERS) {
    // Match "pnpm install", "npm run", "yarn add", etc.
    if (cmd === pm || cmd.startsWith(pm + " ") || cmd.startsWith(pm + "\t")) {
      return pm;
    }
  }
  return null;
}

function matchTestRunner(command) {
  if (!command) return null;
  const cmd = command.trim().toLowerCase();
  for (const tr of TEST_RUNNERS) {
    if (cmd === tr || cmd.startsWith(tr + " ") || cmd.includes(" " + tr + " ") || cmd.endsWith(" " + tr)) {
      return tr;
    }
  }
  return null;
}

function findExtSubstitutions(fileEvents) {
  const subs = [];
  // Group by base path (without extension)
  const byBase = {};
  for (const e of fileEvents) {
    const base = e.path.replace(/\.[^./\\]+$/, "");
    if (!byBase[base]) byBase[base] = [];
    byBase[base].push(e);
  }
  for (const [base, events] of Object.entries(byBase)) {
    if (events.length < 2) continue;
    const exts = events.map((e) => e.ext).filter(Boolean);
    const unique = [...new Set(exts)];
    if (unique.length >= 2) {
      // First ext → last ext = substitution
      subs.push({
        from: unique[0],
        to: unique[unique.length - 1],
        fromPath: base + unique[0],
        toPath: base + unique[unique.length - 1],
      });
    }
  }
  return subs;
}

module.exports = { detectToolSignals, formatToolContext };
