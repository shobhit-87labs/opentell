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

// Fetch latest from origin, then reset hard to match it exactly.
// Using fetch + reset instead of pull so local modifications (e.g. files
// copied during dev) never block the update.
execFile("git", ["-C", PLUGIN_ROOT, "fetch", "origin", "--quiet"], {
  timeout: 15000,
}, (fetchErr, fetchOut, fetchStderr) => {
  if (fetchErr) {
    log(`Auto-update fetch failed: ${fetchErr.message}`);
    return;
  }

  execFile("git", ["-C", PLUGIN_ROOT, "reset", "--hard", "origin/main", "--quiet"], {
    timeout: 5000,
  }, (resetErr, resetOut, resetStderr) => {
    if (resetErr) {
      log(`Auto-update reset failed: ${resetErr.message}`);
    } else {
      const output = (resetOut + resetStderr).trim();
      log(`Auto-update: ${output || "up to date"}`);
    }
  });
});
