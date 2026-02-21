#!/usr/bin/env node

/**
 * OpenTell — Stop Hook
 * 
 * Fires when Claude finishes responding.
 * 1. Reads transcript, finds last (assistant, user) pair
 * 2. Runs regex detection (Layer 1) — stores immediately
 * 3. For ambiguous pairs: writes to WAL, then spawns background classifier
 * 4. Detects error-driven patterns (code failed → user explained fix)
 */

const { getLastPairs } = require("../lib/transcript");
const { detectSignals } = require("../lib/detector");
const { detectClaudeObservations, detectValidatedObservation } = require("../lib/observer");
const { detectToolSignals, formatToolContext } = require("../lib/tool-signals");
const { addCandidate, addObservation, loadBuffer, saveBuffer, appendWal } = require("../lib/store");
const { loadConfig, log } = require("../lib/config");
const { spawn } = require("child_process");
const path = require("path");

async function main() {
  try {
    const input = await readStdin();
    const event = JSON.parse(input);

    const config = loadConfig();
    if (config.paused) {
      process.exit(0);
      return;
    }

    if (event.stop_hook_active) {
      process.exit(0);
      return;
    }

    const transcriptPath = event.transcript_path;
    if (!transcriptPath) {
      process.exit(0);
      return;
    }

    const pairs = getLastPairs(transcriptPath, 3);
    if (pairs.length === 0) {
      process.exit(0);
      return;
    }

    const buf = loadBuffer();
    buf.session_id = event.session_id;

    // ── Tool signal detection ────────────────────────────────────────────
    // Get tool events accumulated since the last Stop (current turn only).
    const lastStopTs = buf.last_stop_ts || 0;
    const turnToolEvents = (buf.tool_events || []).filter((e) => e.ts > lastStopTs);

    if (turnToolEvents.length > 0) {
      const toolCandidates = detectToolSignals(turnToolEvents);
      for (const candidate of toolCandidates) {
        addCandidate(candidate);
        log(`Tool signal [${candidate.classification}]: "${candidate.text}"`);
      }
    }

    // Mark current timestamp so next Stop knows where this turn ended
    buf.last_stop_ts = Date.now();

    // Tool context string for enriching LLM classifier payloads
    const toolContext = formatToolContext(turnToolEvents);

    for (const pair of pairs.slice(-2)) {
      const pairKey = hashPair(pair);
      if (buf.analyzed && buf.analyzed.includes(pairKey)) continue;

      // Check for error context in the transcript
      // Pattern: Claude wrote code → error occurred → user explains fix
      const errorContext = extractErrorContext(pair.claude_said);

      const result = detectSignals(pair.claude_said, pair.user_said);

      if (result.detected) {
        for (const signal of result.signals) {
          addCandidate({
            text: signal.text,
            confidence: signal.confidence,
            scope: "repo",
            classification: signal.classification || "PREFERENCE",
            area: signal.area || "general",
            detection_method: "regex",
            certainty: "high",
            evidence: {
              claude_said: truncate(pair.claude_said, 300),
              user_said: truncate(pair.user_said, 300),
              error_context: errorContext ? truncate(errorContext, 200) : "",
            },
          });
        }
      } else if (!result.noise) {
        // Ambiguous pair — write to WAL first (crash-safe), then spawn classifier
        const payload = {
          claude_said: truncate(pair.claude_said, 500),
          user_said: truncate(pair.user_said, 500),
          error_context: errorContext ? truncate(errorContext, 300) : "",
          tool_context: toolContext,
        };

        // WAL: durable record survives if bg classifier crashes
        appendWal(payload);

        const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
        const scriptPath = path.join(__dirname, "classify-bg.js");

        try {
          const child = spawn("node", [scriptPath, encoded], {
            detached: true,
            stdio: "ignore",
          });
          child.unref();
        } catch (e) {
          log(`Failed to spawn bg classifier: ${e.message}`);
        }
      }

      // ── Observation Layer ────────────────────────────────────────────────
      // Run independently of correction detection — both can fire on same pair.

      // 1. Check if Claude made an observation that the developer validated.
      //    A validated observation skips the inferred queue and goes active.
      const validated = detectValidatedObservation(pair.claude_said, pair.user_said);
      if (validated) {
        addCandidate({
          text: validated.text,
          confidence: validated.confidence,
          scope: validated.scope || "repo",
          classification: validated.classification,
          area: validated.area,
          detection_method: validated.detection_method,
          certainty: "high",
          evidence: {
            claude_said: validated.evidence.observation,
            user_said: validated.evidence.validation,
            error_context: "",
          },
        });
      }

      // 2. Scan claude_said for self-adaptation and observation statements.
      //    Store as low-confidence inferred learnings pending validation.
      //    Skip if we already captured this as a validated observation.
      if (!validated) {
        const observations = detectClaudeObservations(pair.claude_said);
        for (const obs of observations) {
          addObservation({
            text: obs.text,
            confidence: obs.confidence,
            classification: obs.classification,
            area: obs.area,
            observation_type: obs.observation_type,
            evidence: { observation: obs.raw_match },
          });
        }
      }

      buf.analyzed = buf.analyzed || [];
      buf.analyzed.push(pairKey);
      if (buf.analyzed.length > 200) buf.analyzed = buf.analyzed.slice(-200);
    }

    saveBuffer(buf);
    process.exit(0);
  } catch (e) {
    log(`Stop hook error: ${e.message}`);
    process.exit(0);
  }
}

/**
 * Extract error context from Claude's response.
 * Looks for stack traces, error messages, command failures.
 */
function extractErrorContext(claudeSaid) {
  if (!claudeSaid) return null;

  const errorIndicators = [
    /Error:\s*.+/i,
    /TypeError:\s*.+/i,
    /ReferenceError:\s*.+/i,
    /SyntaxError:\s*.+/i,
    /ENOENT|EACCES|ECONNREFUSED/,
    /command failed|exit code [1-9]/i,
    /Cannot find module/i,
    /is not defined/i,
    /Unexpected token/i,
    /compilation failed|build failed/i,
    /FAIL\s+\w/,
    /assertion failed|expect.*to/i,
  ];

  for (const pattern of errorIndicators) {
    const match = claudeSaid.match(pattern);
    if (match) {
      // Grab surrounding context (100 chars before and after)
      const idx = match.index;
      const start = Math.max(0, idx - 100);
      const end = Math.min(claudeSaid.length, idx + match[0].length + 200);
      return claudeSaid.slice(start, end);
    }
  }

  return null;
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

function hashPair(pair) {
  const str = (pair.claude_said || "").slice(0, 100) + "|" + (pair.user_said || "").slice(0, 100);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

main();
