const { getActiveLearnings, getAllLearnings, getPromotable, getInferredLearnings, ACTIVATION_THRESHOLD, PROMOTION_THRESHOLD } = require("./store");
const { getProfileText } = require("./profiler");
const { log } = require("./config");

/**
 * Build the context string to inject into Claude Code via SessionStart hook.
 * 
 * Two modes:
 * 
 * 1. PROFILE MODE (preferred): When a synthesized developer profile exists,
 *    inject the narrative understanding + specific preferences. The narrative
 *    tells Claude WHO this developer is. The preferences are the specifics.
 * 
 * 2. STRUCTURED MODE (fallback): When no profile exists yet (early sessions),
 *    inject learnings grouped by depth: thinking → design → quality → preferences.
 * 
 * Both modes apply area filtering when there are 15+ learnings.
 */
function buildContext(threshold = ACTIVATION_THRESHOLD, activeAreas = null) {
  const learnings = getActiveLearnings(threshold);
  if (learnings.length === 0) return "";

  // Try profile-based context first
  const profileText = getProfileText();
  if (profileText && learnings.length >= 6) {
    return buildProfileContext(profileText, learnings, activeAreas);
  }

  // Fallback to structured context
  return buildStructuredContext(learnings, activeAreas);
}

/**
 * Profile-based context: narrative understanding + specific preferences.
 * The profile captures the THINKING. The preferences capture the SPECIFICS.
 */
function buildProfileContext(profileText, learnings, activeAreas) {
  const filtered = activeAreas ? filterByArea(learnings, activeAreas) : learnings;
  const prefs = filtered.filter(
    (l) => l.classification === "PREFERENCE" || !l.classification
  );

  let lines = [];
  lines.push("# Developer Profile (learned from past corrections)");
  lines.push("Apply these silently. Do not mention them unless asked.");
  lines.push("");
  lines.push(profileText);

  if (prefs.length > 0) {
    lines.push("");
    lines.push("## Specific Conventions");
    for (const l of prefs.sort((a, b) => b.confidence - a.confidence)) {
      lines.push(`- ${l.text}`);
    }
  }

  return lines.join("\n");
}

/**
 * Structured context: grouped by depth.
 * Used when no profile exists (early sessions, < 6 learnings).
 */
function buildStructuredContext(learnings, activeAreas) {
  const filtered = activeAreas ? filterByArea(learnings, activeAreas) : learnings;
  const sorted = filtered.sort((a, b) => b.confidence - a.confidence);

  // Group by classification type (deepest first)
  const thinking = sorted.filter((l) => l.classification === "THINKING_PATTERN");
  const design = sorted.filter((l) => l.classification === "DESIGN_PRINCIPLE");
  const quality = sorted.filter((l) => l.classification === "QUALITY_STANDARD");
  const gaps = sorted.filter((l) => l.classification === "BEHAVIORAL_GAP");
  const prefs = sorted.filter((l) => l.classification === "PREFERENCE" || !l.classification);

  // Sub-group preferences by scope
  const globalPrefs = prefs.filter((l) => l.scope === "global");
  const repoPrefs = prefs.filter((l) => l.scope === "repo");
  const langPrefs = prefs.filter((l) => l.scope === "language");

  let lines = [];
  lines.push("# How This Developer Builds (learned from past corrections)");
  lines.push("Apply these silently. Do not mention them unless asked.");
  lines.push("");

  if (thinking.length > 0) {
    lines.push("## How They Think");
    for (const l of thinking) lines.push(`- ${l.text}`);
    lines.push("");
  }

  if (design.length > 0) {
    lines.push("## Architecture Values");
    for (const l of design) lines.push(`- ${l.text}`);
    lines.push("");
  }

  if (quality.length > 0) {
    lines.push("## Quality Bar");
    for (const l of quality) lines.push(`- ${l.text}`);
    lines.push("");
  }

  if (gaps.length > 0) {
    lines.push("## Watch For (recurring gaps)");
    for (const l of gaps) lines.push(`- ${l.text}`);
    lines.push("");
  }

  if (globalPrefs.length > 0) {
    lines.push("## General Preferences");
    for (const l of globalPrefs) lines.push(`- ${l.text}`);
    lines.push("");
  }

  if (repoPrefs.length > 0) {
    lines.push("## This Project");
    for (const l of repoPrefs) lines.push(`- ${l.text}`);
    lines.push("");
  }

  if (langPrefs.length > 0) {
    lines.push("## Language-Specific");
    for (const l of langPrefs) lines.push(`- ${l.text}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Area-filtered injection: when there are many learnings, only inject
 * the ones relevant to what Claude is currently working on.
 * 
 * ALWAYS included (regardless of area):
 * - THINKING_PATTERN (how they think applies everywhere)
 * - DESIGN_PRINCIPLE (architecture values are cross-cutting)
 * - Global scope preferences
 * 
 * Area-filtered:
 * - QUALITY_STANDARD, BEHAVIORAL_GAP, PREFERENCE with specific areas
 */
function filterByArea(learnings, activeAreas) {
  if (!activeAreas || activeAreas.length === 0) return learnings;
  if (learnings.length < 15) return learnings; // not enough to need filtering

  const areaSet = new Set(activeAreas.map((a) => a.toLowerCase()));
  // Always include "general" area
  areaSet.add("general");

  return learnings.filter((l) => {
    // Deep learnings always included
    if (l.classification === "THINKING_PATTERN") return true;
    if (l.classification === "DESIGN_PRINCIPLE") return true;
    if (l.scope === "global" && l.classification === "PREFERENCE") return true;

    // For others, check area match
    const areas = l.areas || [l.area || "general"];
    return areas.some((a) => areaSet.has(a.toLowerCase()));
  });
}

/**
 * Build a status display for the CLI / slash command.
 */
function buildStatus() {
  const all = getAllLearnings();
  const active = all.filter((l) => !l.inferred && l.confidence >= ACTIVATION_THRESHOLD && !l.promoted);
  const candidates = all.filter((l) => !l.inferred && l.confidence < ACTIVATION_THRESHOLD && !l.promoted);
  const promoted = all.filter((l) => l.promoted);
  const inferred = getInferredLearnings();
  const promotable = getPromotable();

  let lines = [];
  const inferredNote = inferred.length > 0 ? `, ${inferred.length} unvalidated` : "";
  lines.push(`OpenTell — ${all.length} learnings (${active.length} active, ${candidates.length} candidates, ${promoted.length} promoted${inferredNote})\n`);

  if (active.length > 0) {
    // Group active learnings by type
    const byType = groupByType(active);

    if (byType.THINKING_PATTERN.length > 0) {
      lines.push("🧠 How You Think:");
      for (const l of byType.THINKING_PATTERN) {
        lines.push(`  ${fmtLearning(l)}`);
      }
    }

    if (byType.DESIGN_PRINCIPLE.length > 0) {
      lines.push("📐 Architecture Values:");
      for (const l of byType.DESIGN_PRINCIPLE) {
        lines.push(`  ${fmtLearning(l)}`);
      }
    }

    if (byType.QUALITY_STANDARD.length > 0) {
      lines.push("✅ Quality Bar:");
      for (const l of byType.QUALITY_STANDARD) {
        lines.push(`  ${fmtLearning(l)}`);
      }
    }

    if (byType.PREFERENCE.length > 0) {
      lines.push("⚙️  Preferences:");
      for (const l of byType.PREFERENCE) {
        lines.push(`  ${fmtLearning(l)}`);
      }
    }

    if (byType.BEHAVIORAL_GAP.length > 0) {
      lines.push("⚠️  Watch For:");
      for (const l of byType.BEHAVIORAL_GAP) {
        lines.push(`  ${fmtLearning(l)}`);
      }
    }
    lines.push("");
  }

  if (candidates.length > 0) {
    lines.push("Candidates (need more evidence):");
    candidates
      .sort((a, b) => b.confidence - a.confidence)
      .forEach((l) => {
        const conf = l.confidence.toFixed(2);
        const area = l.area && l.area !== "general" ? ` [${l.area}]` : "";
        lines.push(`  ○ ${l.text}  (${l.evidence_count}x, conf: ${conf}${area})`);
      });
    lines.push("");
  }

  if (promoted.length > 0) {
    lines.push("Promoted to CLAUDE.md:");
    promoted.forEach((l) => {
      lines.push(`  ✓ ${l.text}`);
    });
    lines.push("");
  }

  if (inferred.length > 0) {
    lines.push("👁  Observed (unvalidated — Claude inferred these from your codebase):");
    inferred
      .sort((a, b) => b.confidence - a.confidence)
      .forEach((l) => {
        const conf = l.confidence.toFixed(2);
        const area = l.area && l.area !== "general" ? ` [${l.area}]` : "";
        lines.push(`  ? ${l.text}  (conf: ${conf}${area})`);
      });
    lines.push("  Run: opentell observations   (to accept or reject)");
    lines.push("");
  }

  if (promotable.length > 0) {
    lines.push(`📋 ${promotable.length} learning(s) ready to promote to CLAUDE.md:`);
    promotable.forEach((l) => {
      lines.push(`  → ${l.text}  (${l.evidence_count}x, conf: ${l.confidence.toFixed(2)})`);
    });
    lines.push(`\nRun: opentell promote`);
    lines.push("");
  }

  if (all.length === 0) {
    lines.push("No learnings yet. Keep using Claude Code — OpenTell will learn from your corrections.");
  }

  return lines.join("\n");
}

function groupByType(learnings) {
  const groups = {
    THINKING_PATTERN: [],
    DESIGN_PRINCIPLE: [],
    QUALITY_STANDARD: [],
    PREFERENCE: [],
    BEHAVIORAL_GAP: [],
  };
  for (const l of learnings) {
    const key = l.classification || "PREFERENCE";
    if (groups[key]) groups[key].push(l);
    else groups.PREFERENCE.push(l);
  }
  // Sort each group by confidence desc
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => b.confidence - a.confidence);
  }
  return groups;
}

function fmtLearning(l) {
  const conf = l.confidence.toFixed(2);
  const count = l.evidence_count;
  const area = l.area && l.area !== "general" ? ` [${l.area}]` : "";
  const method = l.detection_method === "llm" ? "🤖" : "📐";
  return `${method} ${l.text}  (${count}x, conf: ${conf}${area})`;
}

module.exports = { buildContext, buildStatus };
