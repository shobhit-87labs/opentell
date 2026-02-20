/**
 * Instinct — Observation Layer
 *
 * Learns from what Claude says, not just what the developer corrects.
 *
 * Two detection modes:
 *
 * 1. Passive discovery — detects Claude's self-adaptation and observation
 *    statements in claude_said. Stored as low-confidence inferred learnings
 *    until validated by the developer.
 *
 * 2. Validated observations — Claude made an observation AND the developer
 *    explicitly confirmed it. Stored at active confidence immediately.
 */

const { log } = require("./config");

// ─── Observation patterns (in claude_said) ──────────────────────────────────
//
// These fire on Claude's own narration. Since transcript.js strips all
// tool_use/tool_result blocks, claude_said is always short commentary —
// typically 1–3 sentences describing what Claude did or is about to do.
//
const OBSERVATION_PATTERNS = [
  {
    name: "self_adaptation",
    // "I'll use pnpm since that's what the project uses"
    // "I'll follow the same error handling since the team uses it"
    // Highest signal — Claude explicitly adapting to a discovered convention.
    regex: /i'?(?:ll| will|'?m going to) (?:use|follow|match|stick with|go with) ([^,.]{3,80}?) (?:since|because|as) (?:that'?s? )?(?:what )?(?:the |this )?(project|codebase|team|repo|existing code|you)(?: already)? (?:use[sd]?|follow[sd]?|show[sd]?|ha[sd]|prefer[sd]?)/i,
    extract: (m) => `Uses ${m[1].trim()}`,
    confidence: 0.25,
    type: "self_adaptation",
  },
  {
    name: "since_project_uses",
    // "using pnpm since the project already has a lockfile"
    regex: /using ([^,.]{3,60}?) (?:since|because) (?:the |this )?(project|codebase|repo)(?: already)? (?:use[sd]?|ha[sd]|prefer[sd]?)/i,
    extract: (m) => `Uses ${m[1].trim()}`,
    confidence: 0.22,
    type: "self_adaptation",
  },
  {
    name: "project_observation",
    // "I notice the project uses TypeScript strict mode"
    // "I see the codebase follows a service/repository pattern"
    regex: /i (?:notice|see|found|observe|can see) (?:that )?(?:the |this |your )?(project|codebase|repo|code) (?:use[sd]?|follow[sd]?|ha[sd]|employ[sd]?) ([^,.]{3,80})/i,
    extract: (m) => `Uses ${m[2].trim()}`,
    confidence: 0.20,
    type: "project_observation",
  },
  {
    name: "follow_same",
    // "I'll follow the same error handling pattern as the existing routes"
    // "I'll follow the same structure used in the other modules"
    // Extracts up to "as" so we don't capture the comparison target.
    regex: /follow(?:ing)? (?:the )?same ([^,.]{3,60}?)(?:\s+(?:as|in|used)\b|[,.]|$)/i,
    extract: (m) => `Convention: ${m[1].trim()}`,
    confidence: 0.18,
    type: "pattern_matching",
  },
  {
    name: "matching_existing",
    // "matching the existing auth structure"
    // "consistent with the existing patterns"
    regex: /(?:matching|keeping (?:it )?consistent with) (?:the |your |existing )([^,.]{3,70})/i,
    extract: (m) => `Convention: ${m[1].trim()}`,
    confidence: 0.16,
    type: "pattern_matching",
  },
  {
    name: "based_on_existing",
    // "Based on how you've structured the other services..."
    // "Based on the existing patterns, I'll put this in /lib"
    regex: /based on (?:how you'?ve? |your )?(?:existing |current )?([^,.]{3,80})/i,
    extract: (m) => `Convention: ${m[1].trim()}`,
    confidence: 0.15,
    type: "structural_inference",
  },
];

// ─── Developer validation patterns (in user_said) ───────────────────────────
const VALIDATION_PATTERNS = [
  /^(yes|yeah|yep|exactly|correct|right|spot on|precisely|that'?s right|you'?re right)\b/i,
  /^(yes[,.]?\s+(?:and|but|also|fix|please|can you|do that|exactly))/i,
  /\b(good (?:catch|observation|point|call|find|notice))\b/i,
  /\b(that'?s (?:the|a) (?:problem|issue|point|reason))\b/i,
];

// ─── Developer rejection patterns (in user_said) ────────────────────────────
const REJECTION_PATTERNS = [
  /^(no[,.]?\s|nope\b|not (?:quite|exactly|right|correct)\b|that'?s not)/i,
  /\b(actually[,\s]|instead[,\s]|rather than)\b/i,
];

// ─── Generic phrases to filter out — too vague to be useful learnings ───────
const GENERIC_PHRASES = [
  "the same approach", "existing code", "your code", "the code",
  "this pattern", "the pattern", "the structure", "the existing",
  "existing patterns", "the existing patterns",
];

// ─── Main detection functions ────────────────────────────────────────────────

/**
 * Scan claude_said for self-adaptation and observation statements.
 * Returns array of raw observation objects (not yet validated).
 *
 * Called on every (claude_said, user_said) pair in the Stop hook.
 * Zero API cost — pure regex.
 */
function detectClaudeObservations(claudeSaid) {
  if (!claudeSaid || claudeSaid.trim().length < 10) return [];

  // Check more of claude_said than we do for corrections — observations
  // often appear later in a multi-sentence commentary.
  const text = claudeSaid.slice(0, 1000);
  const observations = [];

  for (const pattern of OBSERVATION_PATTERNS) {
    const match = text.match(pattern.regex);
    if (!match) continue;

    const extracted = pattern.extract(match, text);
    if (!extracted) continue;

    const cleaned = extracted
      .replace(/\s+/g, " ")
      .replace(/[.,;:]$/, "")
      .trim();

    // Skip if too short, too long, or too generic
    if (cleaned.length < 5 || cleaned.length > 150) continue;
    if (GENERIC_PHRASES.some((p) => cleaned.toLowerCase() === p)) continue;

    observations.push({
      text: cleaned,
      confidence: pattern.confidence,
      observation_type: pattern.type,
      pattern_name: pattern.name,
      classification: inferClassification(cleaned, pattern.type),
      area: inferArea(cleaned),
      raw_match: match[0].slice(0, 120),
    });
  }

  return observations;
}

/**
 * Detect when Claude made an observation AND the developer validated it.
 * Returns a learning ready for addCandidate(), or null.
 *
 * Validation requires:
 * 1. claude_said contains at least one observation pattern
 * 2. user_said is short (< 120 chars) — longer replies are corrections, not validations
 * 3. user_said matches a validation pattern
 * 4. user_said does NOT match a rejection pattern
 */
function detectValidatedObservation(claudeSaid, userSaid) {
  if (!claudeSaid || !userSaid) return null;

  const userTrimmed = userSaid.trim();
  // Long replies are corrections or task descriptions, not simple validations.
  // Real validations ("yes exactly", "good catch", "correct") are always short.
  if (userTrimmed.length > 80) return null;

  const userLower = userTrimmed.toLowerCase();
  if (REJECTION_PATTERNS.some((p) => p.test(userLower))) return null;
  if (!VALIDATION_PATTERNS.some((p) => p.test(userTrimmed))) return null;

  const observations = detectClaudeObservations(claudeSaid);
  if (observations.length === 0) return null;

  // Use the highest-confidence observation
  const best = observations.sort((a, b) => b.confidence - a.confidence)[0];

  log(`Validated observation: "${best.text}" (validated: "${userTrimmed.slice(0, 50)}")`);

  return {
    text: best.text,
    // Validated by developer → immediately active (at threshold)
    confidence: 0.45,
    classification: best.classification,
    area: best.area,
    scope: "repo",
    observation_type: best.observation_type,
    detection_method: "validated_observation",
    evidence: {
      // Store only the extracted observation, not raw code
      observation: best.raw_match,
      validation: userTrimmed.slice(0, 100),
    },
  };
}

// ─── Classification helpers ──────────────────────────────────────────────────

/**
 * Infer classification from text content and observation type.
 * Conservative — defaults to PREFERENCE when ambiguous.
 */
function inferClassification(text, observationType) {
  const lower = text.toLowerCase();

  // Specific tools → PREFERENCE
  if (/\b(pnpm|yarn|npm|bun|vitest|jest|mocha|pytest|playwright|cypress|biome|eslint|prettier|ruff|black|tailwind|prisma|drizzle|typeorm|supabase|firebase|next\.?js|react|vue|svelte|angular|express|hono|fastapi|django|flask)\b/.test(lower))
    return "PREFERENCE";

  // Architecture/structural patterns → DESIGN_PRINCIPLE
  if (/\b(service|repository|pattern|layer|concern|separation|module|architecture|boundary|domain)\b/.test(lower))
    return "DESIGN_PRINCIPLE";

  // Quality patterns → QUALITY_STANDARD
  if (/\b(test|error.handl|validat|logging|monitor|strict|coverage|type)\b/.test(lower))
    return "QUALITY_STANDARD";

  // Pattern matching inference → likely DESIGN_PRINCIPLE
  if (observationType === "pattern_matching" || observationType === "structural_inference")
    return "DESIGN_PRINCIPLE";

  // Default for self-adaptation
  return "PREFERENCE";
}

/**
 * Infer area tag from text content.
 */
function inferArea(text) {
  const lower = text.toLowerCase();
  if (/\b(test|spec|coverage|vitest|jest|pytest|mocha|playwright|cypress)\b/.test(lower)) return "testing";
  if (/\b(react|vue|svelte|angular|component|css|tailwind|style|frontend|ui|ux|a11y)\b/.test(lower)) return "frontend";
  if (/\b(api|route|endpoint|server|express|hono|fastapi|django|flask|backend|database|prisma|drizzle|postgres|mysql|mongo)\b/.test(lower)) return "backend";
  if (/\b(docker|deploy|ci|cd|pipeline|devops|monitor|log|observ)\b/.test(lower)) return "devops";
  if (/\b(schema|model|data|migration|query|orm)\b/.test(lower)) return "data";
  return "general";
}

module.exports = {
  detectClaudeObservations,
  detectValidatedObservation,
};
