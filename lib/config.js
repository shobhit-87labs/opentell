const fs = require("fs");
const path = require("path");
const os = require("os");

const OPENTELL_DIR = path.join(os.homedir(), ".opentell");

// ─── Default models ───────────────────────────────────────────────────────────
// Update these constants when Anthropic releases new versions.
// All three LLM call sites (classifier, profiler, consolidator) resolve their
// model through these — there is no other hardcoded model string in the codebase.
//
// classifier_model  → fast, cheap, high-volume (one call per turn pair)
// synthesis_model   → richer reasoning (profile synthesis, consolidation)
//
// Current available models (check https://docs.anthropic.com/en/docs/about-claude/models):
//   claude-haiku-4-5-20251001          ← fast, cheap
//   claude-sonnet-4-5-20251022         ← balanced
//   claude-sonnet-4-6                  ← latest sonnet
const DEFAULT_CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_SYNTHESIS_MODEL  = "claude-haiku-4-5-20251001";

const paths = {
  root:         OPENTELL_DIR,
  config:       path.join(OPENTELL_DIR, "config.json"),
  db:           path.join(OPENTELL_DIR, "learnings.json"),
  buffer:       path.join(OPENTELL_DIR, "session-buffer.json"),
  wal:          path.join(OPENTELL_DIR, "wal.jsonl"),
  log:          path.join(OPENTELL_DIR, "opentell.log"),
  stats:        path.join(OPENTELL_DIR, "stats.json"),
  update_check: path.join(OPENTELL_DIR, "last-update-check"),
};

function ensureDir() {
  if (!fs.existsSync(OPENTELL_DIR)) {
    fs.mkdirSync(OPENTELL_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureDir();
  if (!fs.existsSync(paths.config)) {
    const defaults = {
      anthropic_api_key:  process.env.ANTHROPIC_API_KEY || "",
      // Model for turn-pair classification (Layer 2). Fast + cheap — Haiku recommended.
      classifier_model:   DEFAULT_CLASSIFIER_MODEL,
      // Model for profile synthesis and consolidation. Can be upgraded to Sonnet
      // for a richer developer profile at slightly higher cost (~$0.01/synthesis).
      synthesis_model:    DEFAULT_SYNTHESIS_MODEL,
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
  // Back-fill synthesis_model for existing configs that only have classifier_model
  if (!raw.synthesis_model) {
    raw.synthesis_model = raw.classifier_model || DEFAULT_SYNTHESIS_MODEL;
  }
  return raw;
}

function log(msg) {
  ensureDir();
  try {
    fs.appendFileSync(paths.log, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

module.exports = { paths, ensureDir, loadConfig, log, DEFAULT_CLASSIFIER_MODEL, DEFAULT_SYNTHESIS_MODEL };
