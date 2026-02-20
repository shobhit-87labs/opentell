#!/usr/bin/env node

/**
 * Tests for the Observation Layer:
 * - detectClaudeObservations()
 * - detectValidatedObservation()
 * - addObservation() / getInferredLearnings()
 * - acceptObservation() / rejectObservation()
 * - applyPassiveAccumulation()
 * - Alignment: inferred observation validated by subsequent correction
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

// ─── Test isolation ──────────────────────────────────────────────────────────
const TEST_DIR = path.join(os.tmpdir(), `instinct-observer-test-${Date.now()}`);
fs.mkdirSync(TEST_DIR, { recursive: true });

// Monkey-patch paths before requiring modules
const config = require("../lib/config");
const origPaths = config.paths;
config.paths = {
  ...origPaths,
  db:     path.join(TEST_DIR, "learnings.json"),
  wal:    path.join(TEST_DIR, "wal.jsonl"),
  buffer: path.join(TEST_DIR, "buffer.json"),
  log:    path.join(TEST_DIR, "instinct.log"),
};

const { detectClaudeObservations, detectValidatedObservation } = require("../lib/observer");
const {
  addObservation, getInferredLearnings, acceptObservation, rejectObservation,
  applyPassiveAccumulation, addCandidate, getActiveLearnings, resetAll,
  ACTIVATION_THRESHOLD,
} = require("../lib/store");

// ─── Test runner ─────────────────────────────────────────────────────────────
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

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ─── detectClaudeObservations ────────────────────────────────────────────────

console.log("\n── detectClaudeObservations ─────────────────────────────────────\n");

test("self_adaptation: detects 'I'll use X since the project uses X'", () => {
  const r = detectClaudeObservations("I'll use pnpm since that's what the project uses");
  assert(r.length > 0, "should detect observation");
  assertEqual(r[0].text, "Uses pnpm");
  assertEqual(r[0].observation_type, "self_adaptation");
  assert(r[0].confidence >= 0.20, "confidence should be at least 0.20");
});

test("self_adaptation: detects 'I'll follow X since the team uses X'", () => {
  const r = detectClaudeObservations("I'll follow the same error handling since the team uses it");
  assert(r.length > 0, "should detect observation");
  assertEqual(r[0].observation_type, "self_adaptation");
});

test("since_project_uses: detects 'using X since the project already has X'", () => {
  const r = detectClaudeObservations("using TypeScript since the project already has strict mode configured");
  assert(r.length > 0, "should detect observation");
  assert(r[0].text.toLowerCase().includes("typescript"), "should mention TypeScript");
});

test("project_observation: detects 'I notice the project uses X'", () => {
  const r = detectClaudeObservations("I notice the codebase follows a service/repository pattern");
  assert(r.length > 0, "should detect observation");
  assert(r[0].text.toLowerCase().includes("service"), "should mention service");
  assertEqual(r[0].observation_type, "project_observation");
});

test("project_observation: detects 'I see the project uses X'", () => {
  const r = detectClaudeObservations("I see the project uses Vitest for testing");
  assert(r.length > 0, "should detect observation");
  assert(r[0].text.toLowerCase().includes("vitest"), "should mention vitest");
});

test("follow_same: detects 'follow the same X as the existing Y'", () => {
  const r = detectClaudeObservations("I'll follow the same error handling pattern as the existing routes");
  assert(r.length > 0, "should detect observation");
  assertEqual(r[0].observation_type, "pattern_matching");
  assert(r[0].text.toLowerCase().includes("error handling"), "should extract error handling");
});

test("based_on_existing: detects 'based on how you've structured X'", () => {
  const r = detectClaudeObservations("Based on how you've structured the other services, I'll put this in /lib");
  assert(r.length > 0, "should detect observation");
  assertEqual(r[0].observation_type, "structural_inference");
});

test("no observation: generic claude commentary returns empty", () => {
  const r = detectClaudeObservations("I've updated the component to add the loading state.");
  assertEqual(r.length, 0, "should not detect spurious observations");
});

test("no observation: empty input returns empty", () => {
  assertEqual(detectClaudeObservations("").length, 0);
  assertEqual(detectClaudeObservations(null).length, 0);
});

test("no observation: filters out generic phrases", () => {
  const r = detectClaudeObservations("I'll follow the same approach as the existing code");
  // "the same approach" by itself is too generic — should be filtered or low-value
  // It might still match but text should not be just the generic phrase
  if (r.length > 0) {
    assert(r[0].text !== "Convention: the same approach", "should filter generic 'same approach'");
  }
});

test("classification: tool names → PREFERENCE", () => {
  const r = detectClaudeObservations("I'll use vitest since that's what the project uses");
  assert(r.length > 0);
  assertEqual(r[0].classification, "PREFERENCE");
});

test("classification: architectural patterns → DESIGN_PRINCIPLE", () => {
  const r = detectClaudeObservations("I notice the codebase follows a service/repository pattern");
  assert(r.length > 0);
  assertEqual(r[0].classification, "DESIGN_PRINCIPLE");
});

test("area: testing tools → testing area", () => {
  const r = detectClaudeObservations("I'll use vitest since that's what the project uses");
  assert(r.length > 0);
  assertEqual(r[0].area, "testing");
});

test("area: frontend tools → frontend area", () => {
  const r = detectClaudeObservations("I'll use React since that's what the project uses");
  assert(r.length > 0);
  assertEqual(r[0].area, "frontend");
});

// ─── detectValidatedObservation ──────────────────────────────────────────────

console.log("\n── detectValidatedObservation ───────────────────────────────────\n");

test("validated: 'yes exactly' validates observation", () => {
  const r = detectValidatedObservation(
    "I'll use pnpm since that's what the project uses",
    "yes exactly"
  );
  assert(r !== null, "should return a validated observation");
  assertEqual(r.text, "Uses pnpm");
  assertEqual(r.confidence, 0.45);
  assertEqual(r.detection_method, "validated_observation");
});

test("validated: 'good catch' validates observation", () => {
  const r = detectValidatedObservation(
    "I notice the codebase uses Biome for linting",
    "good catch, yes"
  );
  assert(r !== null);
  assert(r.text.toLowerCase().includes("biome"));
});

test("validated: 'correct' validates observation", () => {
  const r = detectValidatedObservation(
    "I'll use vitest since that's what the project uses",
    "correct"
  );
  assert(r !== null);
});

test("not validated: rejection returns null", () => {
  const r = detectValidatedObservation(
    "I'll use npm since the project uses it",
    "no, we use pnpm actually"
  );
  assertEqual(r, null, "rejection should return null");
});

test("not validated: long user message returns null (correction, not validation)", () => {
  const r = detectValidatedObservation(
    "I'll use pnpm since the project uses it",
    "yes but also make sure to add error handling to every endpoint and use the correct import paths"
  );
  assertEqual(r, null, "long message should not be treated as a simple validation");
});

test("not validated: no observation in claude_said returns null", () => {
  const r = detectValidatedObservation(
    "Here's the updated component",
    "yes exactly"
  );
  assertEqual(r, null, "no observation pattern means nothing to validate");
});

test("not validated: null inputs return null", () => {
  assertEqual(detectValidatedObservation(null, "yes"), null);
  assertEqual(detectValidatedObservation("hello", null), null);
});

// ─── addObservation / getInferredLearnings ───────────────────────────────────

console.log("\n── addObservation / getInferredLearnings ────────────────────────\n");

test("addObservation: stores as inferred learning", () => {
  resetAll();
  addObservation({
    text: "Uses pnpm",
    confidence: 0.25,
    classification: "PREFERENCE",
    area: "general",
    observation_type: "self_adaptation",
    evidence: { observation: "I'll use pnpm since the project uses it" },
  });
  const inferred = getInferredLearnings();
  assertEqual(inferred.length, 1);
  assertEqual(inferred[0].text, "Uses pnpm");
  assert(inferred[0].inferred === true, "should be marked inferred");
  assert(inferred[0].confidence < ACTIVATION_THRESHOLD, "should be below activation threshold");
});

test("addObservation: inferred learning NOT included in active learnings", () => {
  resetAll();
  addObservation({
    text: "Uses pnpm",
    confidence: 0.25,
    classification: "PREFERENCE",
    area: "general",
    observation_type: "self_adaptation",
    evidence: { observation: "test" },
  });
  const active = getActiveLearnings();
  assertEqual(active.length, 0, "inferred should not appear in active learnings");
});

test("addObservation: corroborates existing regular learning instead of duplicating", () => {
  resetAll();
  // Add a regular learning first
  addCandidate({
    text: "Uses pnpm",
    confidence: 0.50,
    classification: "PREFERENCE",
    area: "general",
    detection_method: "regex",
    evidence: {},
  });
  const beforeConf = getActiveLearnings()[0].confidence;

  // Observation should corroborate, not duplicate
  addObservation({
    text: "Uses pnpm",
    confidence: 0.20,
    classification: "PREFERENCE",
    area: "general",
    observation_type: "self_adaptation",
    evidence: { observation: "test" },
  });

  const active = getActiveLearnings();
  assertEqual(active.length, 1, "should still be only one learning");
  assert(active[0].confidence > beforeConf, "corroboration should boost confidence slightly");
  assertEqual(getInferredLearnings().length, 0, "no inferred should be created");
});

test("addObservation: reinforces duplicate inferred instead of creating new", () => {
  resetAll();
  addObservation({ text: "Uses Vitest", confidence: 0.20, classification: "PREFERENCE", area: "testing", observation_type: "self_adaptation", evidence: { observation: "test" } });
  addObservation({ text: "Uses Vitest", confidence: 0.20, classification: "PREFERENCE", area: "testing", observation_type: "self_adaptation", evidence: { observation: "test2" } });
  const inferred = getInferredLearnings();
  assertEqual(inferred.length, 1, "should merge duplicate inferred");
  assert(inferred[0].confidence > 0.20, "confidence should increase on reinforce");
});

// ─── acceptObservation / rejectObservation ───────────────────────────────────

console.log("\n── acceptObservation / rejectObservation ────────────────────────\n");

test("acceptObservation: promotes inferred to active", () => {
  resetAll();
  addObservation({ text: "Uses pnpm", confidence: 0.25, classification: "PREFERENCE", area: "general", observation_type: "self_adaptation", evidence: { observation: "test" } });
  const inferred = getInferredLearnings();
  const accepted = acceptObservation(inferred[0].id);
  assert(accepted !== null, "should return accepted learning");
  assert(accepted.inferred === false, "inferred flag should be cleared");
  assert(accepted.confidence >= ACTIVATION_THRESHOLD, "confidence should reach activation threshold");
  assertEqual(getInferredLearnings().length, 0, "no more inferred");
  assertEqual(getActiveLearnings().length, 1, "should be active now");
});

test("rejectObservation: archives the inferred learning", () => {
  resetAll();
  addObservation({ text: "Uses npm", confidence: 0.20, classification: "PREFERENCE", area: "general", observation_type: "self_adaptation", evidence: { observation: "test" } });
  const inferred = getInferredLearnings();
  const rejected = rejectObservation(inferred[0].id);
  assert(rejected !== null, "should return rejected learning");
  assertEqual(getInferredLearnings().length, 0, "no more inferred");
  assertEqual(getActiveLearnings().length, 0, "not in active either");
});

test("acceptObservation: returns null for unknown id", () => {
  resetAll();
  const result = acceptObservation("nonexistent-id");
  assertEqual(result, null);
});

// ─── applyPassiveAccumulation ─────────────────────────────────────────────────

console.log("\n── applyPassiveAccumulation ─────────────────────────────────────\n");

test("passive accumulation: bumps inferred confidence by 0.03", () => {
  resetAll();
  addObservation({ text: "Uses Biome", confidence: 0.20, classification: "PREFERENCE", area: "general", observation_type: "self_adaptation", evidence: { observation: "test" } });
  applyPassiveAccumulation();
  const inferred = getInferredLearnings();
  assert(Math.abs(inferred[0].confidence - 0.23) < 0.001, `expected ~0.23, got ${inferred[0].confidence}`);
});

test("passive accumulation: capped at 0.44 (below activation threshold)", () => {
  resetAll();
  addObservation({ text: "Uses Biome", confidence: 0.43, classification: "PREFERENCE", area: "general", observation_type: "self_adaptation", evidence: { observation: "test" } });
  applyPassiveAccumulation();
  applyPassiveAccumulation();
  applyPassiveAccumulation();
  const inferred = getInferredLearnings();
  assert(inferred[0].confidence <= 0.44, `should be capped at 0.44, got ${inferred[0].confidence}`);
  assert(inferred[0].inferred === true, "should still be inferred");
  assertEqual(getActiveLearnings().length, 0, "should not become active through passive accumulation alone");
});

test("passive accumulation: does not affect regular learnings", () => {
  resetAll();
  addCandidate({ text: "Uses pnpm", confidence: 0.60, classification: "PREFERENCE", area: "general", detection_method: "regex", evidence: {} });
  const before = getActiveLearnings()[0].confidence;
  applyPassiveAccumulation();
  const after = getActiveLearnings()[0].confidence;
  assertEqual(before, after, "regular learnings should not be affected");
});

// ─── Alignment: correction validates inferred observation ────────────────────

console.log("\n── Alignment detection ──────────────────────────────────────────\n");

test("alignment: developer correction promotes matching inferred observation", () => {
  resetAll();
  // Claude observed "project uses pnpm" — stored as inferred
  addObservation({ text: "Uses pnpm", confidence: 0.20, classification: "PREFERENCE", area: "general", observation_type: "self_adaptation", evidence: { observation: "I'll use pnpm since the project uses it" } });
  assertEqual(getInferredLearnings().length, 1, "should be inferred");

  // Developer later says "use pnpm" explicitly — this validates the observation
  addCandidate({ text: "Uses pnpm", confidence: 0.35, classification: "PREFERENCE", area: "general", detection_method: "regex", evidence: {} });

  // The inferred observation should now be validated and active
  assertEqual(getInferredLearnings().length, 0, "inferred should be promoted");
  const active = getActiveLearnings();
  assert(active.some(l => l.text === "Uses pnpm"), "validated observation should be active");
});

test("alignment: unrelated correction does not affect inferred observation", () => {
  resetAll();
  addObservation({ text: "Uses Vitest", confidence: 0.20, classification: "PREFERENCE", area: "testing", observation_type: "self_adaptation", evidence: { observation: "test" } });
  // Unrelated correction
  addCandidate({ text: "Uses pnpm", confidence: 0.35, classification: "PREFERENCE", area: "general", detection_method: "regex", evidence: {} });
  assertEqual(getInferredLearnings().length, 1, "unrelated inferred should remain");
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────
resetAll();
fs.rmSync(TEST_DIR, { recursive: true, force: true });

// ─── Results ─────────────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
