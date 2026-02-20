const fs = require("fs");
const { loadLearnings, getActiveLearnings, ACTIVATION_THRESHOLD } = require("./store");
const { loadConfig, paths, ensureDir, log, DEFAULT_SYNTHESIS_MODEL } = require("./config");
const { recordCall } = require("./stats");
const path = require("path");

const PROFILE_PATH = path.join(paths.root, "profile.json");

/**
 * Developer Profile Synthesizer
 * 
 * This is the intelligence layer that turns fragmented learnings into a
 * coherent understanding of HOW this developer thinks.
 * 
 * The profile isn't a list. It's a mental model.
 * 
 * Instead of:
 *   "- Uses pnpm
 *    - Prefers functional components  
 *    - Wants error handling"
 * 
 * It produces:
 *   "This developer thinks in complete user flows. When they see a feature,
 *    they immediately consider: what's the empty state? What breaks? What
 *    does a first-time user see? They prototype fast but won't ship without
 *    error handling, tests, and accessibility. They prefer small, composable
 *    units over monolithic files — extract early, extract often. Their
 *    architecture instinct is data-first: start with the schema, let it
 *    shape the API, let the API shape the UI."
 * 
 * That narrative is what gets injected into Claude's context.
 * It tells Claude WHO this developer is, not just what tools they use.
 */

/**
 * Synthesize a developer profile from all active learnings.
 * Uses LLM to generate a narrative understanding.
 */
async function synthesizeProfile() {
  const config = loadConfig();
  if (!config.anthropic_api_key) {
    return null;
  }

  const learnings = getActiveLearnings();
  if (learnings.length < 3) {
    return null; // need enough signal
  }

  // Sort by depth: thinking patterns first, then design, quality, preferences last
  const depthOrder = {
    THINKING_PATTERN: 5,
    DESIGN_PRINCIPLE: 4,
    QUALITY_STANDARD: 3,
    BEHAVIORAL_GAP: 2,
    PREFERENCE: 1,
  };

  const sorted = [...learnings].sort(
    (a, b) => (depthOrder[b.classification] || 0) - (depthOrder[a.classification] || 0)
  );

  // Build the evidence
  const sections = [];

  const thinking = sorted.filter((l) => l.classification === "THINKING_PATTERN");
  const design = sorted.filter((l) => l.classification === "DESIGN_PRINCIPLE");
  const quality = sorted.filter((l) => l.classification === "QUALITY_STANDARD");
  const gaps = sorted.filter((l) => l.classification === "BEHAVIORAL_GAP");
  const prefs = sorted.filter((l) => ["PREFERENCE", undefined].includes(l.classification));

  if (thinking.length > 0) {
    sections.push("HOW THEY THINK:\n" + thinking.map((l) => `- ${l.text} (${l.evidence_count}x)`).join("\n"));
  }
  if (design.length > 0) {
    sections.push("ARCHITECTURE VALUES:\n" + design.map((l) => `- ${l.text} (${l.evidence_count}x)`).join("\n"));
  }
  if (quality.length > 0) {
    sections.push("QUALITY BAR:\n" + quality.map((l) => `- ${l.text} (${l.evidence_count}x)`).join("\n"));
  }
  if (gaps.length > 0) {
    sections.push("RECURRING GAPS TO WATCH:\n" + gaps.map((l) => `- ${l.text} (${l.evidence_count}x)`).join("\n"));
  }
  if (prefs.length > 0) {
    sections.push("TOOL/STYLE PREFERENCES:\n" + prefs.map((l) => `- ${l.text} (${l.evidence_count}x)`).join("\n"));
  }

  const evidenceBlock = sections.join("\n\n");

  const prompt = `You are building a developer profile from observed behavior patterns. These patterns were captured from how this developer corrects and guides an AI coding assistant over multiple sessions.

${evidenceBlock}

Synthesize these into a developer profile that captures:

1. **THINKING STYLE** (2-3 sentences): How does this developer approach building? What do they think about first? What mental model do they use? Are they data-first? User-first? System-first?

2. **ARCHITECTURE INSTINCT** (2-3 sentences): How do they structure systems? Do they prefer composition or inheritance? Small units or comprehensive modules? What's their refactoring trigger?

3. **QUALITY PHILOSOPHY** (2-3 sentences): What does "done" mean to them? What do they check before shipping? Where is their quality bar?

4. **BLIND SPOTS TO COVER** (1-2 sentences): Based on the gaps, what should the AI always double-check for this developer?

5. **WORKING STYLE** (1-2 sentences): Do they like detailed explanations or code-first? Prototyping or planning? Concise or thorough?

Write this as a cohesive narrative, not a list. Write it as instructions to an AI coding assistant: "This developer..." — as if briefing a new team member on how to work with this person.

Be specific. Use the actual patterns observed, not generic advice. If the evidence doesn't support a section, skip it entirely.

Respond with ONLY the profile text, no headers or formatting.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.anthropic_api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.synthesis_model || config.classifier_model || DEFAULT_SYNTHESIS_MODEL,
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const usedModel = config.synthesis_model || config.classifier_model || DEFAULT_SYNTHESIS_MODEL;
    recordCall("synthesis", usedModel, data.usage);

    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // Store the profile
    const profile = {
      text,
      generated_at: new Date().toISOString(),
      learning_count: learnings.length,
      session_count: loadLearnings().meta?.total_sessions || 0,
      checksum: hashLearnings(learnings),
    };

    ensureDir();
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
    log(`Profile synthesized from ${learnings.length} learnings`);

    return profile;
  } catch (e) {
    log(`Profile synthesis error: ${e.message}`);
    return null;
  }
}

/**
 * Load the cached profile. Returns null if no profile exists
 * or if learnings have changed significantly since last synthesis.
 */
function loadProfile() {
  if (!fs.existsSync(PROFILE_PATH)) return null;

  try {
    const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf-8"));
    return profile;
  } catch {
    return null;
  }
}

/**
 * Check if the profile needs regeneration.
 * Triggers:
 * - No profile exists
 * - Learnings have changed (new ones added, old ones promoted/archived)
 * - More than 10 sessions since last synthesis
 */
function profileNeedsUpdate() {
  const profile = loadProfile();
  if (!profile) return true;

  const learnings = getActiveLearnings();
  const currentChecksum = hashLearnings(learnings);

  // Learnings changed
  if (profile.checksum !== currentChecksum) return true;

  // Too many sessions since last synthesis
  const data = loadLearnings();
  const sessionsSince = (data.meta?.total_sessions || 0) - (profile.session_count || 0);
  if (sessionsSince >= 10) return true;

  return false;
}

/**
 * Get the profile text for context injection.
 * Returns cached profile if fresh, or null if no profile exists.
 * Does NOT trigger synthesis (that happens in SessionEnd to avoid blocking).
 */
function getProfileText() {
  const profile = loadProfile();
  if (!profile || !profile.text) return null;
  return profile.text;
}

/**
 * Simple hash of learnings to detect changes.
 */
function hashLearnings(learnings) {
  const str = learnings
    .map((l) => `${l.id}:${l.confidence.toFixed(2)}:${l.text}`)
    .sort()
    .join("|");

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

module.exports = {
  synthesizeProfile,
  loadProfile,
  profileNeedsUpdate,
  getProfileText,
  PROFILE_PATH,
};
