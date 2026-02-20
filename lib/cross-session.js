const { loadLearnings, saveLearnings } = require("./store");
const { log } = require("./config");

/**
 * Cross-Session Pattern Detector
 * 
 * A correction happening once might be situational.
 * The same TYPE of correction across multiple sessions is a thinking pattern.
 * 
 * If the user corrects error handling in sessions 3, 5, 8, and 12,
 * that's 4 separate moments where they looked at Claude's code and
 * thought "you forgot about failure." That's not a preference — that's
 * how they think.
 * 
 * This module tracks session fingerprints on each learning and detects
 * when a learning is being reinforced across sessions (not just within one).
 * Cross-session reinforcement triggers confidence boosts and can upgrade
 * a PREFERENCE to a THINKING_PATTERN.
 */

/**
 * After each session ends, analyze which learnings were reinforced
 * and whether they show cross-session patterns.
 * 
 * A learning reinforced in 3+ different sessions (not just evidence_count >= 3,
 * but actual different session_ids) suggests a deep, persistent pattern.
 */
function detectCrossSessionPatterns(currentSessionId) {
  const data = loadLearnings();
  let changed = false;

  for (const learning of data.learnings) {
    if (learning.archived || learning.promoted) continue;

    // Count unique sessions where this learning appeared
    const sessions = getUniqueSessions(learning);

    // Add current session if this learning was touched
    if (learning._touched_this_session) {
      if (!sessions.includes(currentSessionId)) {
        sessions.push(currentSessionId);
      }
      delete learning._touched_this_session;
      changed = true;
    }

    // Store session list
    learning.session_ids = sessions;

    // Cross-session threshold: reinforced across 3+ different sessions
    const crossCount = sessions.length;

    if (crossCount >= 3 && !learning.cross_session_boosted) {
      // This is a persistent pattern — boost confidence
      learning.confidence = Math.min(1.0, learning.confidence + 0.10);
      learning.cross_session_boosted = true;
      learning.cross_session_count = crossCount;
      log(`Cross-session boost: "${learning.text}" (${crossCount} sessions, conf → ${learning.confidence.toFixed(2)})`);
      changed = true;
    }

    // Update cross-session count even if already boosted
    if (crossCount >= 3) {
      learning.cross_session_count = crossCount;
    }

    // Classification upgrades (run independently of boost)
    // 4+ sessions: shallow classifications get upgraded
    if (crossCount >= 4 && !learning.classification_upgraded_from) {
      if (learning.classification === "PREFERENCE" || learning.classification === "BEHAVIORAL_GAP") {
        learning.classification_upgraded_from = learning.classification;
        learning.classification = "QUALITY_STANDARD";
        log(`Upgraded "${learning.text}" from ${learning.classification_upgraded_from} → QUALITY_STANDARD (${crossCount} sessions)`);
        changed = true;
      }
    }

    // 5+ sessions: quality standards become thinking patterns
    if (crossCount >= 5 && !learning.deep_pattern_upgrade) {
      if (learning.classification === "QUALITY_STANDARD") {
        learning.deep_pattern_upgrade = true;
        learning.classification_upgraded_from = learning.classification_upgraded_from || learning.classification;
        learning.classification = "THINKING_PATTERN";
        learning.confidence = Math.min(1.0, learning.confidence + 0.05);
        log(`Deep pattern upgrade: "${learning.text}" → THINKING_PATTERN (${crossCount} sessions)`);
        changed = true;
      }
    }
  }

  if (changed) saveLearnings(data);
  return changed;
}

/**
 * Mark a learning as "touched" in the current session.
 * Called by addCandidate when reinforcing an existing learning.
 */
function markSessionTouch(learningId, sessionId) {
  const data = loadLearnings();
  const learning = data.learnings.find((l) => l.id === learningId);
  if (!learning) return;

  // Track unique sessions
  if (!learning.session_ids) learning.session_ids = [];
  if (!learning.session_ids.includes(sessionId)) {
    learning.session_ids.push(sessionId);
  }
  learning._touched_this_session = true;

  saveLearnings(data);
}

/**
 * Get unique session IDs from a learning's evidence history.
 * Falls back to deducing from evidence timestamps if session_ids not tracked.
 */
function getUniqueSessions(learning) {
  if (learning.session_ids && Array.isArray(learning.session_ids)) {
    return [...learning.session_ids];
  }

  // Fallback: estimate from evidence timestamps
  // If evidence entries are > 30 min apart, they're likely different sessions
  const sessions = [];
  let lastTime = 0;
  let sessionIdx = 0;

  for (const ev of learning.evidence || []) {
    const time = new Date(ev.detected_at || 0).getTime();
    if (time - lastTime > 30 * 60 * 1000) {
      sessionIdx++;
    }
    const sessionKey = `estimated_${sessionIdx}`;
    if (!sessions.includes(sessionKey)) {
      sessions.push(sessionKey);
    }
    lastTime = time;
  }

  return sessions;
}

/**
 * Get a summary of cross-session patterns for the CLI.
 */
function getCrossSessionSummary() {
  const data = loadLearnings();
  const patterns = data.learnings.filter(
    (l) => !l.archived && (l.cross_session_boosted || (l.session_ids && l.session_ids.length >= 3))
  );

  if (patterns.length === 0) return null;

  return patterns.map((l) => ({
    text: l.text,
    sessions: l.session_ids?.length || 0,
    classification: l.classification,
    confidence: l.confidence,
    upgraded: !!l.classification_upgraded_from,
    original_classification: l.classification_upgraded_from || null,
  }));
}

module.exports = {
  detectCrossSessionPatterns,
  markSessionTouch,
  getCrossSessionSummary,
};
