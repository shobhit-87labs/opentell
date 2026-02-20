#!/usr/bin/env node

const { addCandidate, getAllLearnings, resetAll, clearBuffer, getPromotable, markPromoted } = require("../lib/store");

let passed = 0;
let failed = 0;

function test(name, fn) {
  resetAll();
  clearBuffer();
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

function assert(condition, msg) { if (!condition) throw new Error(msg); }

console.log("━━━ Contradiction & Promotion Tests ━━━\n");

// --- Tool contradictions ---

test("npm → pnpm: old gets archived", () => {
  addCandidate({ text: "Uses npm", confidence: 0.65, classification: "PREFERENCE" });
  addCandidate({ text: "Uses pnpm", confidence: 0.35, classification: "PREFERENCE" });
  const all = getAllLearnings();
  assert(all.length === 1, `Expected 1, got ${all.length}`);
  assert(all[0].text === "Uses pnpm", `Expected pnpm, got "${all[0].text}"`);
});

test("jest → vitest: old gets archived", () => {
  addCandidate({ text: "Uses jest", confidence: 0.70, classification: "PREFERENCE" });
  addCandidate({ text: "Uses vitest", confidence: 0.35, classification: "PREFERENCE" });
  const all = getAllLearnings();
  assert(all.length === 1 && all[0].text === "Uses vitest");
});

test("eslint → biome: old gets archived", () => {
  addCandidate({ text: "Team uses eslint", confidence: 0.60, classification: "PREFERENCE" });
  addCandidate({ text: "Uses biome", confidence: 0.35, classification: "PREFERENCE" });
  const all = getAllLearnings();
  assert(all.length === 1 && all[0].text === "Uses biome");
});

// --- Style opposites ---

test("verbose → concise: old gets archived", () => {
  addCandidate({ text: "Prefers detailed explanations", confidence: 0.60 });
  addCandidate({ text: "Prefers concise responses", confidence: 0.35 });
  const all = getAllLearnings();
  assert(all.length === 1 && all[0].text.includes("concise"));
});

test("code-first → explain more: old gets archived", () => {
  addCandidate({ text: "Prefers code-first, minimal explanation", confidence: 0.70 });
  addCandidate({ text: "Prefers detailed explanations", confidence: 0.35 });
  const all = getAllLearnings();
  assert(all.length === 1 && all[0].text.includes("detailed"));
});

// --- Thinking pattern opposites ---

test("simplicity → scale: thinking pattern contradiction", () => {
  addCandidate({
    text: "Values simplicity — avoids premature abstraction",
    confidence: 0.60,
    classification: "THINKING_PATTERN",
  });
  addCandidate({
    text: "Designs for scale — future-proof architecture",
    confidence: 0.38,
    classification: "THINKING_PATTERN",
  });
  const all = getAllLearnings();
  assert(all.length === 1, `Expected 1, got ${all.length}`);
  assert(all[0].text.includes("scale"), `Expected scale, got "${all[0].text}"`);
});

test("prototype first → plan first: thinking pattern contradiction", () => {
  addCandidate({
    text: "Prototypes first — gets a rough version working",
    confidence: 0.60,
    classification: "THINKING_PATTERN",
  });
  addCandidate({
    text: "Plans first — designs the spec before coding",
    confidence: 0.38,
    classification: "THINKING_PATTERN",
  });
  const all = getAllLearnings();
  assert(all.length === 1, `Expected 1, got ${all.length}`);
  assert(all[0].text.toLowerCase().includes("plan"), `Expected plan, got "${all[0].text}"`);
});

// --- Avoids ↔ Uses flip ---

test("'Avoids X' → 'Uses X': old gets archived", () => {
  addCandidate({ text: "Avoids barrel exports", confidence: 0.55, classification: "PREFERENCE" });
  addCandidate({ text: "Uses barrel exports", confidence: 0.35, classification: "PREFERENCE" });
  const all = getAllLearnings();
  assert(all.length === 1 && all[0].text.includes("Uses barrel"));
});

// --- Non-contradictions ---

test("pnpm + supabase: different categories, both survive", () => {
  addCandidate({ text: "Uses pnpm", confidence: 0.65, classification: "PREFERENCE" });
  addCandidate({ text: "Uses supabase", confidence: 0.50, classification: "PREFERENCE" });
  assert(getAllLearnings().length === 2);
});

test("thinking pattern + preference: unrelated, both survive", () => {
  addCandidate({ text: "Values simplicity", confidence: 0.50, classification: "THINKING_PATTERN" });
  addCandidate({ text: "Uses pnpm", confidence: 0.65, classification: "PREFERENCE" });
  assert(getAllLearnings().length === 2);
});

test("design principle + quality standard: unrelated, both survive", () => {
  addCandidate({ text: "Separates concerns by layer", confidence: 0.50, classification: "DESIGN_PRINCIPLE" });
  addCandidate({ text: "Expects test coverage for edge cases", confidence: 0.50, classification: "QUALITY_STANDARD" });
  assert(getAllLearnings().length === 2);
});

// --- Area tagging ---

test("area tags are stored correctly", () => {
  addCandidate({ text: "Uses pnpm", confidence: 0.35, classification: "PREFERENCE", area: "general" });
  addCandidate({ text: "Separates concerns", confidence: 0.38, classification: "DESIGN_PRINCIPLE", area: "architecture" });
  const all = getAllLearnings();
  assert(all[0].area === "general", `Expected general, got ${all[0].area}`);
  assert(all[1].area === "architecture", `Expected architecture, got ${all[1].area}`);
});

test("areas merge on reinforcement", () => {
  addCandidate({ text: "Error handling required", confidence: 0.35, classification: "QUALITY_STANDARD", area: "backend" });
  addCandidate({ text: "Error handling required", confidence: 0.35, classification: "QUALITY_STANDARD", area: "frontend" });
  const all = getAllLearnings();
  assert(all.length === 1);
  assert(all[0].areas.includes("backend") && all[0].areas.includes("frontend"),
    `Expected both areas, got ${JSON.stringify(all[0].areas)}`);
});

// --- Classification upgrade on reinforcement ---

test("PREFERENCE → THINKING_PATTERN: deeper classification upgrades on reinforce", () => {
  addCandidate({ text: "Values simplicity", confidence: 0.35, classification: "PREFERENCE" });
  addCandidate({ text: "Values simplicity — avoids premature abstraction", confidence: 0.38, classification: "THINKING_PATTERN" });
  const all = getAllLearnings();
  assert(all.length === 1, `Expected 1, got ${all.length}`);
  assert(all[0].classification === "THINKING_PATTERN", `Expected THINKING_PATTERN, got ${all[0].classification}`);
  assert(all[0].text.includes("premature"), "Expected richer text to be kept");
});

// --- Promotion ---

test("promotion: learnings become promotable at high confidence", () => {
  addCandidate({ text: "Uses pnpm", confidence: 0.35, classification: "PREFERENCE" });
  // Reinforce 5 times to get above 0.80
  for (let i = 0; i < 5; i++) {
    addCandidate({ text: "Uses pnpm", confidence: 0.35, classification: "PREFERENCE" });
  }
  const all = getAllLearnings();
  assert(all[0].confidence >= 0.80, `Expected >= 0.80, got ${all[0].confidence}`);
  assert(all[0].evidence_count >= 4, `Expected >= 4 evidence, got ${all[0].evidence_count}`);

  const promotable = getPromotable();
  assert(promotable.length === 1, `Expected 1 promotable, got ${promotable.length}`);
});

test("marking promoted removes from active", () => {
  addCandidate({ text: "Uses pnpm", confidence: 0.35, classification: "PREFERENCE" });
  for (let i = 0; i < 5; i++) {
    addCandidate({ text: "Uses pnpm", confidence: 0.35, classification: "PREFERENCE" });
  }
  
  const promotable = getPromotable();
  markPromoted(promotable.map(l => l.id));
  
  const all = getAllLearnings();
  assert(all[0].promoted === true, "Expected promoted flag");
  
  // getActiveLearnings should exclude promoted
  const { getActiveLearnings } = require("../lib/store");
  const active = getActiveLearnings();
  assert(active.length === 0, `Expected 0 active after promotion, got ${active.length}`);
});

// --- Summary ---

resetAll();
clearBuffer();
console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━`);
process.exit(failed > 0 ? 1 : 0);
