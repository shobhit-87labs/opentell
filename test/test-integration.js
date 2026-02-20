#!/usr/bin/env node

const { detectSignals } = require("../lib/detector");
const { addCandidate, getActiveLearnings, getAllLearnings, getPromotable, markPromoted, resetAll, clearBuffer, applyDecay } = require("../lib/store");
const { buildContext, buildStatus } = require("../lib/skill-writer");

console.log("━━━ Integration Test ━━━\n");

// Reset
resetAll();
clearBuffer();
console.log("✓ Reset store and buffer");

// Simulate sessions with different signal types

console.log("\n--- Session 1: Tool preferences + thinking pattern ---");

const s1_pairs = [
  { claude: "I'll install with npm...", user: "no, use pnpm" },
  { claude: "Here's the page with forms...", user: "this is overkill, keep it simple" },
  { claude: "Built the dashboard...", user: "looks good, thanks" }, // noise
];

for (const p of s1_pairs) {
  const result = detectSignals(p.claude, p.user);
  if (result.detected) {
    for (const s of result.signals) {
      addCandidate({
        text: s.text, confidence: s.confidence,
        classification: s.classification || "PREFERENCE",
        area: s.area || "general",
        detection_method: "regex",
      });
      console.log(`  Detected [${s.classification || "PREFERENCE"}]: "${s.text}"`);
    }
  } else if (result.noise) {
    console.log(`  Noise: "${p.user.slice(0, 40)}"`);
  } else {
    console.log(`  Ambiguous: "${p.user.slice(0, 40)}" (would go to LLM)`);
  }
}

console.log("\n--- Session 2: Reinforce + design principles ---");

const s2_pairs = [
  { claude: "Installing with npm...", user: "use pnpm instead of npm" },
  { claude: "I put validation in the route...", user: "that shouldn't be in the route handler, separate concerns" },
  { claude: "Here's the feature...", user: "write a test for this" },
];

for (const p of s2_pairs) {
  const result = detectSignals(p.claude, p.user);
  if (result.detected) {
    for (const s of result.signals) {
      addCandidate({
        text: s.text, confidence: s.confidence,
        classification: s.classification || "PREFERENCE",
        area: s.area || "general",
        detection_method: "regex",
      });
      console.log(`  Detected [${s.classification || "PREFERENCE"}]: "${s.text}"`);
    }
  }
}

console.log("\n--- Session 3: Reinforce thinking + quality ---");

const s3_pairs = [
  { claude: "Set up with npm...", user: "we use pnpm" },
  { claude: "Here's an abstract factory pattern...", user: "don't over-engineer this, keep it simple" },
  { claude: "Here's the API call...", user: "what happens if this fails? Add error handling" },
  { claude: "Here's the form...", user: "add a test for the edge cases" },
];

for (const p of s3_pairs) {
  const result = detectSignals(p.claude, p.user);
  if (result.detected) {
    for (const s of result.signals) {
      addCandidate({
        text: s.text, confidence: s.confidence,
        classification: s.classification || "PREFERENCE",
        area: s.area || "general",
        detection_method: "regex",
      });
      console.log(`  Detected [${s.classification || "PREFERENCE"}]: "${s.text}"`);
    }
  }
}

// --- Check status ---

console.log("\n━━━ Status After 3 Sessions ━━━\n");
console.log(buildStatus());

// --- Context injection preview ---

console.log("\n━━━ Context Injection Preview ━━━\n");
console.log(buildContext());

// --- Active learnings ---

const active = getActiveLearnings();
console.log(`\n━━━ Active at threshold 0.45: ${active.length} learnings ━━━`);
for (const l of active) {
  console.log(`  [${l.classification}] ${l.text} (conf: ${l.confidence.toFixed(2)}, seen ${l.evidence_count}x, area: ${l.area})`);
}

// --- Check type distribution ---

const all = getAllLearnings();
const types = {};
for (const l of all) {
  const t = l.classification || "PREFERENCE";
  types[t] = (types[t] || 0) + 1;
}
console.log(`\nType distribution: ${JSON.stringify(types)}`);
console.log(`Total learnings: ${all.length}`);

// --- Promotion check ---

const promotable = getPromotable();
console.log(`\nPromotable (conf >= 0.80, evidence >= 4): ${promotable.length}`);

// --- Decay ---

console.log("\n━━━ Testing Decay ━━━");
applyDecay();
const afterDecay = getAllLearnings();
console.log(`After decay: ${afterDecay.length} learnings (should be same — all fresh)`);

// Cleanup
resetAll();
clearBuffer();
console.log("\n✓ Cleaned up test data");

console.log("\n━━━ Integration Test Complete ━━━");
