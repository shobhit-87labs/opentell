#!/usr/bin/env node

const { detectSignals } = require("../lib/detector");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function assertDetected(result) { assert(result.detected, "Expected detection"); }
function assertNotDetected(result) { assert(!result.detected, "Expected no detection"); }
function assertSignalContains(result, text) {
  assert(result.signals.some(s => s.text.toLowerCase().includes(text.toLowerCase())),
    `No signal containing "${text}". Got: ${result.signals.map(s => s.text).join(", ")}`);
}
function assertClassification(result, cls) {
  assert(result.signals.some(s => s.classification === cls),
    `No signal with classification "${cls}". Got: ${result.signals.map(s => s.classification).join(", ")}`);
}

console.log("━━━ OpenTell Detector Tests ━━━\n");

// --- Corrections ---
console.log("--- Corrections ---");

test("Direct: no, use pnpm", () => {
  const r = detectSignals("I'll install with npm...", "no, use pnpm");
  assertDetected(r); assertSignalContains(r, "pnpm");
});

test("Direct: actually, use biome", () => {
  const r = detectSignals("I'll set up eslint...", "actually, use biome for linting");
  assertDetected(r); assertSignalContains(r, "biome");
});

test("Direct: use X instead", () => {
  const r = detectSignals("I'll use jest...", "use vitest instead");
  assertDetected(r); assertSignalContains(r, "vitest");
});

test("Direct: X not Y", () => {
  const r = detectSignals("Setting up firebase...", "use supabase not firebase");
  assertDetected(r); assertSignalContains(r, "supabase");
});

test("Direct: don't use X", () => {
  const r = detectSignals("I'll create barrel exports...", "don't use barrel exports");
  assertDetected(r); assertSignalContains(r, "barrel");
});

// --- Conventions ---
console.log("\n--- Conventions ---");

test("Convention: we use X", () => {
  const r = detectSignals("I'll set up...", "we use pnpm and vitest in all our projects");
  assertDetected(r); assertSignalContains(r, "pnpm");
});

test("Convention: I always X", () => {
  const r = detectSignals("Here's the code...", "I always prefer early returns over nested ifs");
  assertDetected(r);
});

test("Convention: in this project", () => {
  const r = detectSignals("Setting up auth...", "in this project we use Supabase for auth");
  assertDetected(r); assertSignalContains(r, "supabase");
});

// --- Style ---
console.log("\n--- Style ---");

test("Style: shorter responses", () => {
  const r = detectSignals("Here's a detailed explanation...", "shorter please, too verbose");
  assertDetected(r); assertSignalContains(r, "concise");
  assertClassification(r, "PREFERENCE");
});

test("Style: code first", () => {
  const r = detectSignals("Let me explain...", "just the code please");
  assertDetected(r); assertSignalContains(r, "code-first");
});

// --- Thinking Patterns ---
console.log("\n--- Thinking Patterns ---");

test("Thinking: keep it simple", () => {
  const r = detectSignals("I've added an abstract factory...", "this is overkill, keep it simple");
  assertDetected(r);
  assertClassification(r, "THINKING_PATTERN");
  assertSignalContains(r, "simplicity");
});

test("Thinking: scale concerns", () => {
  const r = detectSignals("Here's the query...", "this won't scale, think about performance");
  assertDetected(r);
  assertClassification(r, "THINKING_PATTERN");
  assertSignalContains(r, "scale");
});

test("Thinking: prototype first", () => {
  const r = detectSignals("I'll start with the architecture...", "let's get a rough version working first");
  assertDetected(r);
  assertClassification(r, "THINKING_PATTERN");
  assertSignalContains(r, "prototype");
});

test("Thinking: data model first", () => {
  const r = detectSignals("I'll build the UI...", "start with the data model first");
  assertDetected(r);
  assertClassification(r, "THINKING_PATTERN");
  assertSignalContains(r, "data-first");
});

test("Thinking: user perspective", () => {
  const r = detectSignals("Here's the form...", "from the user's perspective this is confusing");
  assertDetected(r);
  assertClassification(r, "THINKING_PATTERN");
  assertSignalContains(r, "user");
});

// --- Design Principles ---
console.log("\n--- Design Principles ---");

test("Design: separate concerns", () => {
  const r = detectSignals("I put the logic in the route...", "that shouldn't be in the route handler");
  assertDetected(r);
  assertClassification(r, "DESIGN_PRINCIPLE");
  assertSignalContains(r, "concern");
});

test("Design: single responsibility", () => {
  const r = detectSignals("Here's the component...", "this is doing too much, break it up");
  assertDetected(r);
  assertClassification(r, "DESIGN_PRINCIPLE");
  assertSignalContains(r, "single-responsibility");
});

test("Design: don't hardcode", () => {
  const r = detectSignals("I set the URL to...", "don't hardcode that, make it configurable");
  assertDetected(r);
  assertClassification(r, "DESIGN_PRINCIPLE");
  assertSignalContains(r, "configuration");
});

test("Design: DRY", () => {
  const r = detectSignals("I created a new helper...", "we already have that, reuse the existing one");
  assertDetected(r);
  assertClassification(r, "DESIGN_PRINCIPLE");
  assertSignalContains(r, "DRY");
});

// --- Quality Standards ---
console.log("\n--- Quality Standards ---");

test("Quality: error handling", () => {
  const r = detectSignals("Here's the API call...", "what happens if this fails? Add error handling");
  assertDetected(r);
  assertClassification(r, "QUALITY_STANDARD");
  assertSignalContains(r, "failure");
});

test("Quality: needs tests", () => {
  const r = detectSignals("Here's the feature...", "write a test for this");
  assertDetected(r);
  assertClassification(r, "QUALITY_STANDARD");
  assertSignalContains(r, "test");
});

test("Quality: accessibility", () => {
  const r = detectSignals("Here's the button...", "what about accessibility? Add aria labels");
  assertDetected(r);
  assertClassification(r, "QUALITY_STANDARD");
  assertSignalContains(r, "ccessib");
});

test("Quality: validation", () => {
  const r = detectSignals("Here's the endpoint...", "validate the input, don't trust user data");
  assertDetected(r);
  assertClassification(r, "QUALITY_STANDARD");
  assertSignalContains(r, "validat");
});

// --- Tools ---
console.log("\n--- Tools ---");

test("Tool: package manager", () => {
  const r = detectSignals("I'll set up...", "we use yarn in this project");
  assertDetected(r); assertSignalContains(r, "yarn");
  assertClassification(r, "PREFERENCE");
});

test("Tool: framework", () => {
  const r = detectSignals("Setting up the server...", "use hono");
  assertDetected(r); assertSignalContains(r, "hono");
});

// --- Noise ---
console.log("\n--- Noise (should NOT detect) ---");

test("Noise: simple yes", () => { assertNotDetected(detectSignals("Done.", "yes")); });
test("Noise: continuation", () => { assertNotDetected(detectSignals("Done.", "now also add auth")); });
test("Noise: approval", () => { assertNotDetected(detectSignals("Done.", "looks good")); });
test("Noise: question", () => { assertNotDetected(detectSignals("Done.", "what does this do?")); });
test("Noise: factual bug report", () => { assertNotDetected(detectSignals("Done.", "that's wrong, the API returns XML")); });
test("Noise: simple thanks", () => { assertNotDetected(detectSignals("Done.", "thanks")); });
test("Noise: great + continuation", () => { assertNotDetected(detectSignals("Done.", "great, now add a sidebar")); });

// --- Summary ---
console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━`);
process.exit(failed > 0 ? 1 : 0);
