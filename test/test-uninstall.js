#!/usr/bin/env node
/**
 * test-uninstall.js
 *
 * Integration test for `opentell uninstall`.
 * Creates all the artifacts that a real install produces, runs uninstall,
 * then asserts each one is gone. Restores any pre-existing state afterward.
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { execSync } = require("child_process");

const CLI = path.resolve(__dirname, "..", "opentell-cli.js");

// ── Paths under test ────────────────────────────────────────────────────────
const HOME          = os.homedir();
const SETTINGS      = path.join(HOME, ".claude", "settings.json");
const COMMAND_FILE  = path.join(HOME, ".claude", "commands", "opentell.md");
const PLUGIN_CACHE  = path.join(HOME, ".claude", "plugins", "cache", "shobhit-87labs", "opentell");
const INSTALLED     = path.join(HOME, ".claude", "plugins", "installed_plugins.json");
const SYMLINK       = path.join(HOME, ".local", "bin", "opentell");

// ── Helpers ──────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}`);
    fail++;
  }
}

function backup(filePath) {
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isDirectory()) {
      return { existed: true, isDir: true };
    }
    return { existed: true, content: fs.readFileSync(filePath, "utf-8") };
  }
  return { existed: false };
}

function restore(filePath, saved) {
  if (!saved.existed) {
    try { fs.rmSync(filePath, { recursive: true, force: true }); } catch {}
  } else if (saved.isDir) {
    // directory was there before — nothing to restore (we didn't modify it)
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, saved.content);
  }
}

// ── Save originals ────────────────────────────────────────────────────────────
const origSettings     = backup(SETTINGS);
const origCommandFile  = backup(COMMAND_FILE);
const origPluginCache  = backup(PLUGIN_CACHE);
const origInstalled    = backup(INSTALLED);
const origSymlink      = backup(SYMLINK);

// ── Set up mock artifacts ────────────────────────────────────────────────────
console.log("━━━ Uninstall Test — setting up fixtures ━━━\n");

// 1. settings.json with opentell hooks across all four event types
const mockSettings = {
  hooks: {
    SessionStart: [
      { hooks: [{ type: "command", command: "node \"${CLAUDE_PLUGIN_ROOT}/scripts/on-session-start.js\"", timeout: 5 }] },
      { hooks: [{ type: "command", command: "echo unrelated" }] },
    ],
    Stop: [
      { hooks: [{ type: "command", command: "node \"${CLAUDE_PLUGIN_ROOT}/scripts/on-stop.js\"", timeout: 5 }] },
    ],
    SessionEnd: [
      { hooks: [{ type: "command", command: "node \"${CLAUDE_PLUGIN_ROOT}/scripts/on-session-end.js\"", timeout: 30 }] },
    ],
    PostToolUse: [
      { matcher: "Bash|Write|Edit", hooks: [{ type: "command", command: "node \"${CLAUDE_PLUGIN_ROOT}/scripts/on-post-tool-use.js\"", timeout: 2 }] },
    ],
  },
};
fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
fs.writeFileSync(SETTINGS, JSON.stringify(mockSettings, null, 2));
console.log("  Created mock settings.json with hooks in all 4 events");

// 2. Slash command file
fs.mkdirSync(path.dirname(COMMAND_FILE), { recursive: true });
fs.writeFileSync(COMMAND_FILE, "# /opentell mock command file\n");
console.log("  Created mock ~/.claude/commands/opentell.md");

// 3. Plugin cache directory
fs.mkdirSync(PLUGIN_CACHE, { recursive: true });
fs.writeFileSync(path.join(PLUGIN_CACHE, "opentell-cli.js"), "// mock cli\n");
console.log("  Created mock plugin cache dir");

// 4. installed_plugins.json with opentell entry + an unrelated entry
const mockInstalled = {
  version: 2,
  plugins: {
    "opentell@shobhit-87labs": [{ scope: "user", installPath: PLUGIN_CACHE, version: "0.1.0" }],
    "some-other-plugin@marketplace": [{ scope: "user" }],
  },
};
fs.mkdirSync(path.dirname(INSTALLED), { recursive: true });
fs.writeFileSync(INSTALLED, JSON.stringify(mockInstalled, null, 2));
console.log("  Created mock installed_plugins.json");

// 5. Symlink (create a plain file to simulate it — lstat check is enough)
fs.mkdirSync(path.dirname(SYMLINK), { recursive: true });
try {
  if (fs.existsSync(SYMLINK)) fs.unlinkSync(SYMLINK);
  fs.writeFileSync(SYMLINK, "#!/usr/bin/env node\n// mock\n");
  console.log("  Created mock ~/.local/bin/opentell");
} catch {
  console.log("  Could not create mock symlink (skipping symlink assertion)");
}

// ── Run uninstall ─────────────────────────────────────────────────────────────
console.log("\n━━━ Running: node opentell-cli.js uninstall ━━━\n");
try {
  const out = execSync(`node "${CLI}" uninstall`, { encoding: "utf-8" });
  console.log(out);
} catch (e) {
  console.error("CLI exited with error:\n", e.stderr || e.message);
  process.exit(1);
}

// ── Assertions ────────────────────────────────────────────────────────────────
console.log("━━━ Assertions ━━━\n");

// Hooks removed from settings.json
const settingsAfter = JSON.parse(fs.readFileSync(SETTINGS, "utf-8"));
assert("SessionStart opentell hook removed",
  !(JSON.stringify(settingsAfter.hooks?.SessionStart || []).includes("on-session-start.js")));
assert("Stop opentell hook removed",
  !(JSON.stringify(settingsAfter.hooks?.Stop || []).includes("on-stop.js")));
assert("SessionEnd opentell hook removed",
  !(JSON.stringify(settingsAfter.hooks?.SessionEnd || []).includes("on-session-end.js")));
assert("PostToolUse opentell hook removed",
  !(JSON.stringify(settingsAfter.hooks?.PostToolUse || []).includes("on-post-tool-use.js")));
assert("Unrelated SessionStart hook preserved",
  JSON.stringify(settingsAfter.hooks?.SessionStart || []).includes("echo unrelated"));

// Slash command removed
assert("~/.claude/commands/opentell.md removed",
  !fs.existsSync(COMMAND_FILE));

// Plugin cache removed
assert("Plugin cache directory removed",
  !fs.existsSync(PLUGIN_CACHE));

// installed_plugins.json: opentell entry gone, other entry preserved
const installedAfter = JSON.parse(fs.readFileSync(INSTALLED, "utf-8"));
assert("opentell removed from installed_plugins.json",
  !Object.keys(installedAfter.plugins || {}).some(k => k.includes("opentell")));
assert("Unrelated plugin preserved in installed_plugins.json",
  "some-other-plugin@marketplace" in (installedAfter.plugins || {}));

// Symlink removed
assert("~/.local/bin/opentell removed",
  !fs.existsSync(SYMLINK));

// ── Restore originals ─────────────────────────────────────────────────────────
console.log("\n━━━ Restoring originals ━━━\n");
restore(SETTINGS,     origSettings);
restore(COMMAND_FILE, origCommandFile);
restore(INSTALLED,    origInstalled);
// plugin cache: only restore if it existed before (directory case)
if (!origPluginCache.existed) {
  try { fs.rmSync(PLUGIN_CACHE, { recursive: true, force: true }); } catch {}
}
if (!origSymlink.existed) {
  try { fs.unlinkSync(SYMLINK); } catch {}
} else if (origSymlink.content !== undefined) {
  fs.writeFileSync(SYMLINK, origSymlink.content);
}
console.log("  Originals restored.");

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n━━━ Result: ${pass} passed, ${fail} failed ━━━`);
if (fail > 0) process.exit(1);
