const fs = require("fs");
const path = require("path");
const os = require("os");

const INSTINCT_DIR = path.join(os.homedir(), ".instinct");

const paths = {
  root: INSTINCT_DIR,
  config: path.join(INSTINCT_DIR, "config.json"),
  db: path.join(INSTINCT_DIR, "learnings.json"),
  buffer: path.join(INSTINCT_DIR, "session-buffer.json"),
  wal: path.join(INSTINCT_DIR, "wal.jsonl"),
  log: path.join(INSTINCT_DIR, "instinct.log"),
};

function ensureDir() {
  if (!fs.existsSync(INSTINCT_DIR)) {
    fs.mkdirSync(INSTINCT_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureDir();
  if (!fs.existsSync(paths.config)) {
    const defaults = {
      anthropic_api_key: process.env.ANTHROPIC_API_KEY || "",
      classifier_model: "claude-haiku-4-5-20251001",
      confidence_threshold: 0.45,
      max_learnings: 100,
      paused: false,
    };
    fs.writeFileSync(paths.config, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  const raw = JSON.parse(fs.readFileSync(paths.config, "utf-8"));
  if (!raw.anthropic_api_key && process.env.ANTHROPIC_API_KEY) {
    raw.anthropic_api_key = process.env.ANTHROPIC_API_KEY;
  }
  return raw;
}

function log(msg) {
  ensureDir();
  try {
    fs.appendFileSync(paths.log, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

module.exports = { paths, ensureDir, loadConfig, log };
