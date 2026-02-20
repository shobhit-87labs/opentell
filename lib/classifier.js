const { loadConfig, log } = require("./config");
const { recordCall } = require("./stats");

const CLASSIFIER_PROMPT = `You analyze conversation pairs between an AI coding assistant and a developer. Your goal is to understand how this developer THINKS about building systems — their philosophy, instincts, and standards — not just their tool preferences.

You will receive:
- What the AI assistant said/did
- How the developer responded

Classify the developer's response into ONE of these categories:

## THINKING_PATTERN
The developer reveals how they approach building systems. These are deep, reusable instincts.
Examples:
- User says "you built the page but it doesn't do anything" → they think in complete user flows, not isolated components
- User says "break this into smaller functions" → they think in composable, single-responsibility units
- User says "what happens if the API is down?" → they think defensively, considering failure modes first
- User says "start with the data model" → they approach systems data-first, schema-up
- User says "let's get a rough version working first" → they prototype before polishing
- User says "don't over-engineer this, keep it simple" → they value simplicity over premature abstraction
- User says "we need to think about scale here" → they design for growth upfront

Extract: a principle about HOW this developer approaches building. Frame it as a design instinct, not a rule.
Good: "Thinks in complete user flows — every UI element should have a working interaction behind it"
Good: "Designs defensively — considers failure states, empty states, and edge cases before the happy path"
Bad: "Wire up backends" (too shallow, misses the WHY)

## DESIGN_PRINCIPLE  
The developer reveals an architecture or design value they hold. These shape system structure.
Examples:
- "Don't put business logic in the API route" → separates concerns by layer
- "This should be its own service" → prefers service boundaries and modularity
- "Make this configurable, don't hardcode" → designs for flexibility
- "Keep the state in one place" → prefers centralized state management
- "Let the database handle that constraint" → pushes invariants to the right layer

Extract: an architecture principle. Frame it as a design philosophy.
Good: "Separates concerns — business logic never lives in route handlers or UI components"  
Good: "Prefers explicit over implicit — configuration over convention, named over default exports"

## QUALITY_STANDARD
The developer reveals what "done" means to them. Their bar for shipping.
Examples:
- "Add error handling" → doesn't ship without error paths covered
- "What about accessibility?" → expects a11y as default, not afterthought
- "Write a test for this" → code isn't done until it's tested
- "Add proper logging" → expects observability built in
- "Type this properly" → strict typing is part of quality

Extract: a quality expectation. Frame it as a shipping standard.
Good: "Code isn't done until error states are handled — never ship just the happy path"
Good: "Accessibility is a default, not a feature — semantic HTML, ARIA labels, keyboard navigation always"

## PREFERENCE
A reusable convention, style, tool choice, or workflow preference. The straightforward choices between valid alternatives.
Examples: "use pnpm", "prefer functional components", "code-first responses", "use Tailwind"
These are the WHAT, not the WHY. Only classify as PREFERENCE if the signal is purely about tool/style choice with no deeper thinking pattern behind it.

## BEHAVIORAL_GAP
The developer is correcting a recurring TYPE of oversight. Use this when the correction doesn't cleanly map to a thinking pattern, design principle, or quality standard — it's more about a specific category of miss.
Examples:
- "You forgot to handle the loading state" → consistent gap in UI completeness
- "The copy is wrong, it says 'data' not 'your projects'" → consistent gap in UX writing
- "You didn't update the types after changing the schema" → consistent gap in cross-cutting updates

## SITUATIONAL
A one-time instruction specific to this task only. Not generalizable.
"Put this in the sidebar" or "use the existing auth module at /lib/auth"

## FACTUAL
A bug report, error correction, or factual correction about code/APIs/behavior.

## CONTINUATION
The user is building on the AI's suggestion, not correcting it.

---

For THINKING_PATTERN, DESIGN_PRINCIPLE, QUALITY_STANDARD, PREFERENCE, and BEHAVIORAL_GAP, extract:
- learning: A concise statement capturing the signal. For thinking patterns and design principles, capture the PHILOSOPHY, not just the surface correction.
- scope: "global" | "repo" | "language"
- certainty: "high" if clearly a reusable pattern, "low" if might be situational
- area: "architecture" | "frontend" | "backend" | "testing" | "devops" | "data" | "ux" | "general"

Respond ONLY with valid JSON. No markdown, no backticks.

Examples:

AI: "Here's the new dashboard page with the chart component and filters..."
User: "the filters don't actually do anything, they're not connected to the API"
→ {"classification":"THINKING_PATTERN","learning":"Thinks in complete user flows — every UI element must have a working interaction, API connection, and data pipeline behind it","scope":"global","certainty":"high","area":"architecture"}

AI: "I've added the settings form with all the fields..."
User: "a new user would have no idea what half these fields mean"
→ {"classification":"THINKING_PATTERN","learning":"Designs from the user's perspective — considers what a first-time user sees, not just what the developer knows","scope":"global","certainty":"high","area":"ux"}

AI: "Here's the admin panel with the user table..."
User: "there's no empty state, what does it look like with zero users?"
→ {"classification":"THINKING_PATTERN","learning":"Designs defensively — considers empty states, error states, loading states, and edge cases before the happy path","scope":"global","certainty":"high","area":"ux"}

AI: "I'll create the API endpoint and the frontend form..."
User: "don't put the validation logic in the route handler, that should be in a service"
→ {"classification":"DESIGN_PRINCIPLE","learning":"Separates concerns by layer — validation and business logic live in services, not route handlers","scope":"global","certainty":"high","area":"architecture"}

AI: "Here's the feature with inline styles..."
User: "extract those into components, this is getting hard to read"
→ {"classification":"DESIGN_PRINCIPLE","learning":"Prefers composable, single-responsibility units — extract when complexity grows rather than letting files bloat","scope":"global","certainty":"high","area":"architecture"}

AI: "The endpoint returns the data..."
User: "what if the upstream service is down? There's no error handling"
→ {"classification":"QUALITY_STANDARD","learning":"Code isn't done until failure modes are handled — network failures, timeouts, malformed data, and upstream outages","scope":"global","certainty":"high","area":"backend"}

AI: "I've added the search feature..."
User: "can you add a test for the edge case where the query is empty?"
→ {"classification":"QUALITY_STANDARD","learning":"Expects test coverage for edge cases, not just happy paths","scope":"global","certainty":"high","area":"testing"}

AI: "I'll install the dependencies with npm..."
User: "we use pnpm"
→ {"classification":"PREFERENCE","learning":"Uses pnpm","scope":"repo","certainty":"high","area":"general"}

AI: "Here's the component with class-based syntax..."
User: "we use functional components"
→ {"classification":"PREFERENCE","learning":"Uses functional components","scope":"global","certainty":"high","area":"frontend"}

AI: "Here's the authentication flow..."
User: "great, now also add rate limiting"
→ {"classification":"CONTINUATION","reason":"Building on suggestion, not correcting"}

AI: "I'll create a new utils file at /src/utils/helpers.ts..."
User: "we already have a helpers module in /lib, use that"
→ {"classification":"SITUATIONAL","reason":"Refers to a specific existing file, not a general convention"}`;

// Classification types that carry learnings
const LEARNING_TYPES = new Set([
  "THINKING_PATTERN",
  "DESIGN_PRINCIPLE",
  "QUALITY_STANDARD",
  "PREFERENCE",
  "BEHAVIORAL_GAP",
]);

/**
 * Classify a batch of (claude_said, user_said) pairs using LLM.
 */
async function classifyBatch(pairs) {
  const config = loadConfig();
  const apiKey = config.anthropic_api_key;
  if (!apiKey) {
    log("No API key configured, skipping LLM classification");
    return pairs.map(() => ({ classification: "SKIPPED", reason: "No API key" }));
  }

  const results = [];
  for (const pair of pairs) {
    try {
      const result = await classifySingle(pair, apiKey, config.classifier_model);
      results.push(result);
    } catch (e) {
      log(`Classification error: ${e.message}`);
      results.push({ classification: "ERROR", reason: e.message });
    }
    await sleep(200);
  }
  return results;
}

/**
 * Classify a single turn pair.
 */
const { DEFAULT_CLASSIFIER_MODEL } = require("./config");

async function classifySingle(pair, apiKey, model) {
  let userMessage = `AI assistant said:\n${truncate(pair.claude_said, 500)}\n\nDeveloper responded:\n${truncate(pair.user_said, 500)}`;

  if (pair.error_context) {
    userMessage += `\n\nError context (code the AI wrote produced this error):\n${truncate(pair.error_context, 300)}`;
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || DEFAULT_CLASSIFIER_MODEL,
      max_tokens: 400,
      system: CLASSIFIER_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  recordCall("classification", model || DEFAULT_CLASSIFIER_MODEL, data.usage);

  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const cleaned = text.replace(/```json\s*|```\s*/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    log(`Failed to parse classifier response: ${cleaned.slice(0, 200)}`);
    return { classification: "ERROR", reason: "Parse failure", raw: cleaned.slice(0, 200) };
  }
}

/**
 * Filter pairs that regex already handled, leaving only ambiguous ones for LLM.
 */
function filterForLLM(pairs, regexResults) {
  const ambiguous = [];
  for (let i = 0; i < pairs.length; i++) {
    const regex = regexResults[i];
    if (!regex.detected && !regex.noise) {
      ambiguous.push({ ...pairs[i], index: i });
    }
  }
  return ambiguous;
}

function truncate(str, maxLen) {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { classifyBatch, classifySingle, filterForLLM, LEARNING_TYPES };
