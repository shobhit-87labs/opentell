const { log } = require("./config");

/**
 * Layer 1: Regex-based signal detection.
 * Analyzes a (claude_said, user_said) pair and returns detected signals.
 * 
 * Returns: { detected: bool, signals: [{ text, confidence, type }], noise: bool }
 */
function detectSignals(claudeSaid, userSaid) {
  const input = userSaid.trim();
  const inputLower = input.toLowerCase();

  // First check if this is noise (not a preference signal)
  if (isNoise(inputLower, input)) {
    return { detected: false, signals: [], noise: true };
  }

  const signals = [];

  // --- Direct correction patterns ---
  // "no, use X" / "actually, use X" / "use X instead" / "switch to X"
  for (const pattern of CORRECTION_PATTERNS) {
    const match = input.match(pattern.regex);
    if (match) {
      const extracted = pattern.extract(match, input);
      if (extracted && extracted.length > 2 && extracted.length < 200) {
        signals.push({
          text: extracted,
          confidence: 0.35,
          type: "correction",
          classification: "PREFERENCE",
          area: "general",
          pattern: pattern.name,
        });
      }
    }
  }

  // --- Convention statements ---
  // "we use X" / "I always X" / "in this project we X"
  for (const pattern of CONVENTION_PATTERNS) {
    const match = input.match(pattern.regex);
    if (match) {
      const extracted = pattern.extract(match, input);
      if (extracted && extracted.length > 2 && extracted.length < 200) {
        signals.push({
          text: extracted,
          confidence: 0.35,
          type: "convention",
          classification: "PREFERENCE",
          area: "general",
          pattern: pattern.name,
        });
      }
    }
  }

  // --- Style/communication preferences ---
  for (const pattern of STYLE_PATTERNS) {
    const match = inputLower.match(pattern.regex);
    if (match) {
      signals.push({
        text: pattern.learning,
        confidence: 0.35,
        type: "style",
        classification: "PREFERENCE",
        area: "general",
        pattern: pattern.name,
      });
    }
  }

  // --- Thinking patterns (deep signals about how user builds systems) ---
  for (const pattern of THINKING_PATTERNS) {
    const match = inputLower.match(pattern.regex);
    if (match) {
      signals.push({
        text: pattern.learning,
        confidence: 0.38, // higher start — thinking patterns are reusable
        type: "thinking",
        classification: pattern.classification,
        area: pattern.area,
        pattern: pattern.name,
      });
    }
  }

  // --- Design principles (architecture values) ---
  for (const pattern of DESIGN_PATTERNS) {
    const match = inputLower.match(pattern.regex);
    if (match) {
      signals.push({
        text: pattern.learning,
        confidence: 0.38,
        type: "design",
        classification: pattern.classification,
        area: pattern.area,
        pattern: pattern.name,
      });
    }
  }

  // --- Quality standards (what "done" means) ---
  for (const pattern of QUALITY_PATTERNS) {
    const match = inputLower.match(pattern.regex);
    if (match) {
      signals.push({
        text: pattern.learning,
        confidence: 0.35,
        type: "quality",
        classification: pattern.classification,
        area: pattern.area,
        pattern: pattern.name,
      });
    }
  }

  // --- Tool/framework preferences ---
  for (const pattern of TOOL_PATTERNS) {
    const match = inputLower.match(pattern.regex);
    if (match) {
      const tool = match[1] || match[2] || pattern.tool;
      if (tool) {
        signals.push({
          text: `Uses ${tool}`,
          confidence: 0.35,
          type: "tool",
          classification: "PREFERENCE",
          area: "general",
          pattern: pattern.name,
        });
      }
    }
  }

  // Dedupe signals by extracting core concept
  const unique = dedupeSignals(signals);

  return {
    detected: unique.length > 0,
    signals: unique,
    noise: false,
  };
}

/**
 * Deduplicate signals by extracting core concepts.
 * "Uses pnpm", "Prefers pnpm", "Team uses pnpm" → keep highest confidence one.
 */
function dedupeSignals(signals) {
  const groups = new Map();

  for (const s of signals) {
    const core = extractCore(s.text);
    if (groups.has(core)) {
      const existing = groups.get(core);
      // Keep the one with higher confidence, or the more descriptive one
      if (s.confidence > existing.confidence || s.text.length > existing.text.length) {
        groups.set(core, s);
      }
    } else {
      groups.set(core, s);
    }
  }

  return [...groups.values()];
}

/**
 * Extract the core concept from a learning text.
 * Strips prefixes like "Uses", "Prefers", "Team uses", "Project convention:"
 */
function extractCore(text) {
  return text
    .toLowerCase()
    .replace(/^(uses?|prefers?|team uses?|user prefers? to|project convention:|avoids?|files go in)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if user message is noise (continuation, approval, factual correction, etc.)
 */
function isNoise(lower, original) {
  // Very short affirmatives / continuations
  if (lower.length < 15) {
    const shortNoise = [
      /^(yes|yep|yeah|yup|ok|okay|sure|thanks|thank you|perfect|great|good|nice|cool|awesome|lgtm|looks good|go ahead|continue|next|done|fine|right|correct|exactly|proceed|ship it)\.?!?$/i
    ];
    for (const p of shortNoise) {
      if (p.test(lower.trim())) return true;
    }
  }

  // "now do X" / "now also" / "also add" / "next," - continuations, not corrections
  if (/^(now |also |next[,.]|and also |then |after that)/.test(lower)) return true;

  // Pure questions (user asking, not correcting)
  // Exclude "what happens if" (defensive thinking) and "what about" (quality concern)
  if (/^(what|why|how|when|where|can you|could you|would you|is there|are there|do you)\b/.test(lower) &&
      !lower.includes("instead") && !lower.includes("rather") &&
      !/^what (?:happens|about|if)/.test(lower)) return true;

  // Bug/error reports (factual, not preference)
  if (/^(that('s| is) (wrong|incorrect|broken|buggy)|there('s| is) (a bug|an error|an issue)|it('s| is) (not working|broken|crashing|failing))/.test(lower)) return true;

  // Very long messages are likely full task descriptions, not corrections
  if (original.length > 1500) return true;

  return false;
}

// === PATTERN DEFINITIONS ===

const CORRECTION_PATTERNS = [
  {
    name: "no_use_x",
    regex: /(?:^|\.\s*)(?:no|nah|nope)[,.]?\s*(?:use|try|switch to|go with)\s+(.+?)(?:\.|$)/i,
    extract: (m) => `Prefers ${m[1].trim()}`,
  },
  {
    name: "actually_use_x",
    regex: /(?:^|\.\s*)actually[,.]?\s*(?:use|let's use|we use|switch to|go with)\s+(.+?)(?:\.|$)/i,
    extract: (m) => `Prefers ${m[1].trim()}`,
  },
  {
    name: "use_x_instead",
    regex: /(?:use|try|switch to|go with)\s+(.+?)\s+instead/i,
    extract: (m) => `Prefers ${m[1].trim()}`,
  },
  {
    name: "x_not_y",
    regex: /(?:use|prefer|want)\s+(\S+)\s+(?:not|instead of|rather than|over)\s+(\S+)/i,
    extract: (m) => `Uses ${m[1].trim().replace(/,$/,"")} instead of ${m[2].trim().replace(/,$/,"")}`,
  },
  {
    name: "dont_use_x",
    regex: /(?:don't|do not|never|stop)\s+(?:use|using|add|adding|include|including)\s+(.+?)(?:\.|,|$)/i,
    extract: (m) => `Avoids ${m[1].trim()}`,
  },
  {
    name: "change_to_x",
    regex: /(?:change|rename|move|refactor)\s+(?:this|that|it)\s+to\s+(.+?)(?:\.|$)/i,
    extract: (m) => `Prefers ${m[1].trim()}`,
  },
  {
    name: "should_be_x",
    regex: /(?:this|that|it)\s+should\s+(?:be|use|go in)\s+(.+?)(?:\.|$)/i,
    extract: (m) => `Prefers ${m[1].trim()}`,
  },
];

const CONVENTION_PATTERNS = [
  {
    name: "we_use_x",
    regex: /(?:we|our team|our project|our codebase)\s+(?:use|uses|prefer|prefers|always)\s+(.+?)(?:\.|,|$)/i,
    extract: (m) => `Team uses ${m[1].trim()}`,
  },
  {
    name: "i_always_x",
    regex: /I\s+(?:always|usually|prefer to|like to|tend to)\s+(.+?)(?:\.|,|$)/i,
    extract: (m) => `User prefers to ${m[1].trim()}`,
  },
  {
    name: "in_this_project",
    regex: /(?:in this (?:project|repo|codebase)|for this (?:project|repo))[,.]?\s*(?:we |I )?\s*(?:use|prefer|have|keep)\s+(.+?)(?:\.|,|$)/i,
    extract: (m) => `Project convention: ${m[1].trim()}`,
  },
  {
    name: "put_x_in_y",
    regex: /(?:put|place|keep|store)\s+(?:those|these|that|it|the \w+|all \w+)\s+(?:in|under|inside|at)\s+(.+?)(?:\.|,|$)/i,
    extract: (m) => `Files go in ${m[1].trim()}`,
  },
  {
    name: "follow_convention",
    regex: /(?:follow|match|stick to|use the same)\s+(?:the |our )?\s*(?:convention|pattern|style|approach|structure)\s*(?:as|from|in)?\s*(.+?)(?:\.|,|$)/i,
    extract: (m) => `Follow convention: ${m[1].trim()}`,
  },
];

const STYLE_PATTERNS = [
  {
    name: "shorter_responses",
    regex: /(?:shorter|more concise|less verbose|too (?:long|verbose|wordy)|brief(?:er)?|cut the (?:fluff|explanation))/i,
    learning: "Prefers concise responses",
  },
  {
    name: "code_first",
    regex: /(?:just (?:the |show (?:me )?)?code|code first|skip the explanation|show me the (?:code|implementation)|less (?:talk|explanation))/i,
    learning: "Prefers code-first, minimal explanation",
  },
  {
    name: "more_explanation",
    regex: /(?:explain (?:more|that|this|why)|more (?:detail|explanation|context)|walk me through|why did you|what does this do)/i,
    learning: "Prefers detailed explanations",
  },
  {
    name: "no_comments",
    regex: /(?:remove (?:the )?comments|no comments|don't add comments|skip (?:the )?comments|fewer comments)/i,
    learning: "Prefers minimal code comments",
  },
  {
    name: "more_comments",
    regex: /(?:add (?:more )?comments|needs? comments|comment (?:this|the code)|document (?:this|it))/i,
    learning: "Prefers well-commented code",
  },
  {
    name: "type_safety",
    regex: /(?:add (?:proper )?types?|type this|needs? (?:types?|typing)|use (?:strict )?type)/i,
    learning: "Prefers strict typing",
  },
];

// --- Thinking pattern detectors (deeper signals) ---
const THINKING_PATTERNS = [
  {
    name: "keep_simple",
    regex: /(?:don't over.?engineer|keep (?:it |this )?simple|too (?:complex|complicated)|this is overkill|we don't need (?:all )?th(?:at|is)|YAGNI|simpler)/i,
    learning: "Values simplicity — avoids premature abstraction, prefers straightforward solutions over clever ones",
    classification: "THINKING_PATTERN",
    area: "architecture",
  },
  {
    name: "think_about_scale",
    regex: /(?:think about scale|won't scale|needs? to scale|at scale|when (?:this|we) grow|performance|this will be slow)/i,
    learning: "Designs for scale — considers performance and growth implications upfront",
    classification: "THINKING_PATTERN",
    area: "architecture",
  },
  {
    name: "prototype_first",
    regex: /(?:rough (?:version|draft)|mvp|prototype|get (?:it|something) working|quick (?:and dirty|version)|iterate|spike|proof of concept)/i,
    learning: "Prototypes first — gets a working version before polishing, iterates toward quality",
    classification: "THINKING_PATTERN",
    area: "general",
  },
  {
    name: "data_first",
    regex: /(?:start with (?:the )?(?:data|schema|model)|data model first|schema first|what(?:'s| is) the (?:data )?(?:model|structure|shape))/i,
    learning: "Thinks data-first — starts with the schema and data model before building features on top",
    classification: "THINKING_PATTERN",
    area: "data",
  },
  {
    name: "user_perspective",
    regex: /(?:from the user(?:'s)? (?:perspective|point of view|pov)|what (?:does |would )?(?:a |the )?user (?:see|think|expect|experience)|put yourself in|user wouldn't)/i,
    learning: "Designs from the user's perspective — considers what a first-time user sees and experiences",
    classification: "THINKING_PATTERN",
    area: "ux",
  },
];

// --- Design principle detectors ---
const DESIGN_PATTERNS = [
  {
    name: "separate_concerns",
    regex: /(?:separate (?:the |this )?concerns?|(?:shouldn't|should not|don't) (?:be |go )in (?:the )?(?:route|handler|component|controller)|belongs? in (?:a )?(?:service|module|util|lib)|extract (?:this|that) (?:into|to))/i,
    learning: "Separates concerns — logic belongs in the right layer, not wherever it's convenient",
    classification: "DESIGN_PRINCIPLE",
    area: "architecture",
  },
  {
    name: "single_responsibility",
    regex: /(?:doing too (?:much|many)|break (?:this|it) (?:up|apart|down|into)|split (?:this|it)|too many responsibilities|single responsibility|one (?:thing|job))/i,
    learning: "Prefers single-responsibility units — breaks apart files and functions that do too much",
    classification: "DESIGN_PRINCIPLE",
    area: "architecture",
  },
  {
    name: "dont_hardcode",
    regex: /(?:don't hardcode|shouldn't be hardcoded|make (?:this|it|that) configurable|put (?:this|that|it) in (?:a )?(?:config|env|constant)|magic (?:number|string))/i,
    learning: "Designs for flexibility — extracts magic values into configuration, avoids hardcoding",
    classification: "DESIGN_PRINCIPLE",
    area: "architecture",
  },
  {
    name: "dry_principle",
    regex: /(?:(?:this|that)(?:'s| is) (?:duplicat|repeat)|DRY|don't repeat|already (?:have|wrote|exists?)|reuse (?:the|that|this)|shared (?:util|helper|component))/i,
    learning: "Values DRY — reuses existing code rather than duplicating logic across the codebase",
    classification: "DESIGN_PRINCIPLE",
    area: "architecture",
  },
];

// --- Quality standard detectors ---
const QUALITY_PATTERNS = [
  {
    name: "needs_error_handling",
    regex: /(?:(?:add|need|what about|where(?:'s| is)(?: the)?) (?:error|exception) handl|what (?:happens )?if (?:it|this|that) fails|no error|unhandled|catch (?:the |this )?error|try.?catch)/i,
    learning: "Code isn't done until failure modes are handled — network errors, invalid input, edge cases",
    classification: "QUALITY_STANDARD",
    area: "backend",
  },
  {
    name: "needs_tests",
    regex: /(?:(?:add|write|need|where(?:'s| is|are)(?: the)?) (?:a )?tests?|test (?:this|that|it|the)|untested|no tests?|test coverage)/i,
    learning: "Expects tests alongside implementation — code isn't shipped without test coverage",
    classification: "QUALITY_STANDARD",
    area: "testing",
  },
  {
    name: "needs_accessibility",
    regex: /(?:accessib|a11y|aria|screen reader|keyboard (?:nav|support|accessible)|semantic (?:html|markup)|alt (?:text|tag))/i,
    learning: "Accessibility is a default, not a feature — semantic HTML, ARIA labels, keyboard navigation always",
    classification: "QUALITY_STANDARD",
    area: "frontend",
  },
  {
    name: "needs_logging",
    regex: /(?:add (?:proper )?logg|need.* logg|where(?:'s| is|are) the logs?|no logg|observab|monitoring|instrument)/i,
    learning: "Expects observability built in — structured logging and monitoring for production readiness",
    classification: "QUALITY_STANDARD",
    area: "devops",
  },
  {
    name: "needs_validation",
    regex: /(?:valid(?:at|e) (?:the |this )?input|input validation|sanitiz|untrusted (?:input|data)|don't trust)/i,
    learning: "Validates inputs at boundaries — never trusts external data without sanitization",
    classification: "QUALITY_STANDARD",
    area: "backend",
  },
];

const TOOL_PATTERNS = [
  {
    name: "package_manager",
    regex: /(?:use |switch to |we use )(pnpm|yarn|bun|npm|deno)\b/i,
    tool: null, // extracted from match
  },
  {
    name: "test_framework",
    regex: /(?:use |switch to |we use )(vitest|jest|mocha|pytest|playwright|cypress)\b/i,
    tool: null,
  },
  {
    name: "linter_formatter",
    regex: /(?:use |switch to |we use )(biome|eslint|prettier|ruff|black|rubocop)\b/i,
    tool: null,
  },
  {
    name: "framework",
    regex: /(?:use |switch to |we use |this is a )(next\.?js|nuxt|remix|astro|svelte|vue|react|angular|fastapi|express|hono|django|flask|rails)\b/i,
    tool: null,
  },
  {
    name: "database",
    regex: /(?:use |switch to |we use )(supabase|firebase|postgres|mysql|sqlite|mongo|dynamo|prisma|drizzle|typeorm)\b/i,
    tool: null,
  },
];

module.exports = { detectSignals, isNoise };
