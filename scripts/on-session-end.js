#!/usr/bin/env node

/**
 * OpenTell — SessionEnd Hook
 * 
 * Fires when Claude Code session ends.
 * Runs the full intelligence pipeline:
 * 
 * 1. Drain WAL — reclassify any pairs the background classifier missed
 * 2. Cross-session pattern detection — upgrade learnings seen across sessions
 * 3. Consolidation — merge related learnings into deeper insights
 * 4. Profile synthesis — regenerate developer profile if needed
 * 5. Apply decay to stale learnings
 * 6. Clean up buffers
 */

const { classifySingle, LEARNING_TYPES } = require("../lib/classifier");
const { addCandidate, drainWal, clearWal, clearBuffer, applyDecay, applyPassiveAccumulation } = require("../lib/store");
const { detectCrossSessionPatterns } = require("../lib/cross-session");
const { shouldConsolidate, runConsolidation, markConsolidationRun } = require("../lib/consolidator");
const { profileNeedsUpdate, synthesizeProfile } = require("../lib/profiler");
const { loadConfig, log } = require("../lib/config");

const START_CONFIDENCE = {
  THINKING_PATTERN:  { high: 0.38, low: 0.28 },
  DESIGN_PRINCIPLE:  { high: 0.38, low: 0.28 },
  QUALITY_STANDARD:  { high: 0.35, low: 0.25 },
  PREFERENCE:        { high: 0.35, low: 0.25 },
  BEHAVIORAL_GAP:    { high: 0.30, low: 0.20 },
};

async function main() {
  try {
    const input = await readStdin();
    const event = JSON.parse(input);

    const config = loadConfig();
    if (config.paused) {
      process.exit(0);
      return;
    }

    log(`SessionEnd: session=${event.session_id}, reason=${event.reason}`);

    // ─── 1. Drain WAL ──────────────────────────────────────────
    const walEntries = drainWal();
    if (walEntries.length > 0 && config.anthropic_api_key) {
      log(`SessionEnd: ${walEntries.length} unprocessed pairs in WAL, classifying...`);
      const toProcess = walEntries.slice(0, 10);

      for (const pair of toProcess) {
        try {
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

            log(`WAL recovery [${cls.classification}]: "${cls.learning}"`);
          }
        } catch (e) {
          log(`WAL recovery error: ${e.message}`);
        }
      }
    }

    // ─── 2. Cross-session pattern detection ─────────────────────
    try {
      const upgraded = detectCrossSessionPatterns(event.session_id);
      if (upgraded) {
        log("Cross-session patterns detected and applied");
      }
    } catch (e) {
      log(`Cross-session detection error: ${e.message}`);
    }

    // ─── 3. Consolidation ──────────────────────────────────────
    try {
      if (shouldConsolidate()) {
        log("Running consolidation...");
        const result = await runConsolidation();
        if (result.consolidated > 0) {
          markConsolidationRun();
          log(`Consolidated ${result.consolidated} insight(s)`);
          for (const insight of result.insights) {
            log(`  → [${insight.group}]: "${insight.insight}"`);
          }
        }
      }
    } catch (e) {
      log(`Consolidation error: ${e.message}`);
    }

    // ─── 4. Profile synthesis ──────────────────────────────────
    try {
      if (profileNeedsUpdate()) {
        log("Synthesizing developer profile...");
        const profile = await synthesizeProfile();
        if (profile) {
          log(`Profile synthesized (${profile.learning_count} learnings → ${profile.text.length} chars)`);
        }
      }
    } catch (e) {
      log(`Profile synthesis error: ${e.message}`);
    }

    // ─── 5. Passive accumulation for inferred observations ─────
    // Inferred learnings that weren't contradicted this session
    // get a small confidence bump, rewarding repeated non-contradiction.
    applyPassiveAccumulation();

    // ─── 6. Decay ──────────────────────────────────────────────
    applyDecay();

    // ─── 7. Cleanup ────────────────────────────────────────────
    clearWal();
    clearBuffer();

    process.exit(0);
  } catch (e) {
    log(`SessionEnd error: ${e.message}`);
    clearWal();
    clearBuffer();
    process.exit(0);
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    setTimeout(() => resolve(data || "{}"), 5000);
  });
}

main();
