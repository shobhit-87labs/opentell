#!/usr/bin/env node

/**
 * OpenTell — Background Auto-Updater
 *
 * Runs detached from the session. Pulls latest from origin/main
 * in the plugin directory. All output is suppressed — failures are
 * logged to ~/.opentell/opentell.log but never surfaced to the user.
 */

const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PLUGIN_ROOT = path.join(__dirname, "..");
const LOG_FILE = path.join(os.homedir(), ".opentell", "opentell.log");

function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

// Verify this is actually a git repo before trying to pull
if (!fs.existsSync(path.join(PLUGIN_ROOT, ".git"))) {
  log("Auto-update: not a git repo, skipping");
  process.exit(0);
}

execFile("git", ["-C", PLUGIN_ROOT, "pull", "--ff-only", "--quiet"], {
  timeout: 15000,
}, (err, stdout, stderr) => {
  if (err) {
    log(`Auto-update failed: ${err.message}`);
  } else {
    const output = (stdout + stderr).trim();
    if (output && output !== "Already up to date.") {
      log(`Auto-update: ${output}`);
    } else {
      log("Auto-update: already up to date");
    }
  }
});
