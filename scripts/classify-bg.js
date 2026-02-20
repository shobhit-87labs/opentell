#!/usr/bin/env node

/**
 * Instinct — Background Classifier
 * 
 * Spawned as a detached process by the Stop hook.
 * Receives a single (claude_said, user_said) pair as base64-encoded argv,
 * classifies it via Haiku, stores the result, removes from WAL, then exits.
 */

const { classifySingle, LEARNING_TYPES } = require("../lib/classifier");
const { addCandidate, removeFromWal } = require("../lib/store");
const { loadConfig, log } = require("../lib/config");

// Starting confidence based on classification type + certainty
const START_CONFIDENCE = {
  THINKING_PATTERN:  { high: 0.38, low: 0.28 },
  DESIGN_PRINCIPLE:  { high: 0.38, low: 0.28 },
  QUALITY_STANDARD:  { high: 0.35, low: 0.25 },
  PREFERENCE:        { high: 0.35, low: 0.25 },
  BEHAVIORAL_GAP:    { high: 0.30, low: 0.20 },
};

async function main() {
  try {
    const encoded = process.argv[2];
    if (!encoded) process.exit(0);

    const pair = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
    const config = loadConfig();

    if (!config.anthropic_api_key) process.exit(0);

    const cls = await classifySingle(pair, config.anthropic_api_key, config.classifier_model);

    if (LEARNING_TYPES.has(cls.classification) && cls.learning) {
      const certainty = cls.certainty || "high";
      const confMap = START_CONFIDENCE[cls.classification] || START_CONFIDENCE.PREFERENCE;
      const startConf = confMap[certainty] || confMap.high;

      addCandidate({
        text: cls.learning,
        confidence: startConf,
        scope: cls.scope || "global",
        classification: cls.classification,
        area: cls.area || "general",
        certainty: certainty,
        detection_method: "llm",
        evidence: {
          claude_said: pair.claude_said?.slice(0, 300) || "",
          user_said: pair.user_said?.slice(0, 300) || "",
          error_context: pair.error_context?.slice(0, 200) || "",
        },
      });

      log(`BG [${cls.classification}/${cls.area || "general"}/${certainty}]: "${cls.learning}" (start: ${startConf})`);
    }

    // Remove from WAL — this pair has been successfully processed
    if (pair.written_at) {
      removeFromWal(pair);
    }
  } catch (e) {
    try { log(`BG classify error: ${e.message}`); } catch {}
  }

  process.exit(0);
}

main();
