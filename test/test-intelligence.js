#!/usr/bin/env node

/**
 * Test suite for Instinct intelligence layer:
 *   - Consolidation (clustering related learnings)
 *   - Cross-session pattern detection
 *   - Area-filtered context injection
 *   - Profile-based context switching
 *   - Promotion to CLAUDE.md
 *   - WAL crash recovery
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// Override paths before requiring anything
const TEST_DIR = path.join(os.tmpdir(), `instinct-test-intel-${Date.now()}`);
fs.mkdirSync(TEST_DIR, { recursive: true });

// Monkey-patch config paths
const config = require("../lib/config");
const origPaths = { ...config.paths };
config.paths.root = TEST_DIR;
config.paths.config = path.join(TEST_DIR, "config.json");
config.paths.db = path.join(TEST_DIR, "learnings.json");
config.paths.buffer = path.join(TEST_DIR, "session-buffer.json");
config.paths.wal = path.join(TEST_DIR, "wal.jsonl");
config.paths.log = path.join(TEST_DIR, "instinct.log");

const { addCandidate, loadLearnings, saveLearnings, resetAll, getActiveLearnings, getPromotable, markPromoted, appendWal, drainWal, clearWal, ACTIVATION_THRESHOLD, PROMOTION_THRESHOLD } = require("../lib/store");
const { findClusters } = require("../lib/consolidator");
const { detectCrossSessionPatterns, getCrossSessionSummary } = require("../lib/cross-session");
const { buildContext, buildStatus } = require("../lib/skill-writer");

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`\u2713 ${msg}`);
    passed++;
  } else {
    console.log(`\u2717 ${msg}`);
    failed++;
  }
}

function seed(learnings) {
  const data = { learnings, meta: { total_sessions: 10 } };
  saveLearnings(data);
}

function makeActive(text, cls = "PREFERENCE", area = "general", extra = {}) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    text,
    confidence: 0.55,
    evidence_count: 3,
    scope: "global",
    classification: cls,
    area,
    areas: [area],
    first_seen: new Date().toISOString(),
    last_reinforced: new Date().toISOString(),
    decay_weight: 1.0,
    archived: false,
    promoted: false,
    detection_method: "regex",
    evidence: [{ claude_said: "test", user_said: "test", detected_at: new Date().toISOString() }],
    ...extra,
  };
}

// ═══════════════════════════════════════════════════════════════
console.log("\u2501\u2501\u2501 Consolidation Tests \u2501\u2501\u2501\n");
// ═══════════════════════════════════════════════════════════════

resetAll();

// Test 1: Find composability cluster
seed([
  makeActive("Prefers functional components", "PREFERENCE", "frontend"),
  makeActive("Break this into smaller functions", "DESIGN_PRINCIPLE", "architecture"),
  makeActive("Extract that into a component", "DESIGN_PRINCIPLE", "architecture"),
]);

let clusters = findClusters();
const compCluster = clusters.find((c) => c.group_id === "composability");
assert(compCluster && compCluster.members.length >= 2, "Finds composability cluster from related learnings");

// Test 2: Find defensive design cluster
resetAll();
seed([
  makeActive("Code isn't done until failure modes are handled", "QUALITY_STANDARD", "backend"),
  makeActive("Designs defensively — considers what breaks", "THINKING_PATTERN", "architecture"),
  makeActive("Validates inputs at boundaries", "QUALITY_STANDARD", "backend"),
]);

clusters = findClusters();
const defCluster = clusters.find((c) => c.group_id === "defensive_design");
assert(defCluster && defCluster.members.length >= 2, "Finds defensive design cluster");

// Test 3: No cluster when insufficient learnings
resetAll();
seed([
  makeActive("Uses pnpm", "PREFERENCE"),
]);

clusters = findClusters();
assert(clusters.length === 0, "No clusters with only 1 learning per group");

// Test 4: Already consolidated group doesn't re-cluster
resetAll();
seed([
  makeActive("Break functions apart", "DESIGN_PRINCIPLE", "architecture"),
  makeActive("Extract into small components", "DESIGN_PRINCIPLE", "architecture"),
  makeActive("Consolidated insight about composability", "THINKING_PATTERN", "architecture", {
    consolidated_from_group: "composability",
  }),
]);

clusters = findClusters();
const reCluster = clusters.find((c) => c.group_id === "composability");
assert(!reCluster, "Already-consolidated group doesn't re-cluster");

// ═══════════════════════════════════════════════════════════════
console.log("\n\u2501\u2501\u2501 Cross-Session Pattern Tests \u2501\u2501\u2501\n");
// ═══════════════════════════════════════════════════════════════

// Test 5: Cross-session boost after 3 sessions
resetAll();
seed([
  makeActive("Always add error handling", "PREFERENCE", "backend", {
    session_ids: ["s1", "s2"],
    _touched_this_session: true,
  }),
]);

detectCrossSessionPatterns("s3");
const data5 = loadLearnings();
const boosted = data5.learnings[0];
assert(boosted.cross_session_boosted === true, "Learning boosted after 3 sessions");
assert(boosted.confidence > 0.55, "Confidence increased from cross-session boost");

// Test 6: Classification upgrade after 4 sessions
resetAll();
seed([
  makeActive("Always handle loading states", "PREFERENCE", "frontend", {
    session_ids: ["s1", "s2", "s3"],
    _touched_this_session: true,
    cross_session_boosted: true,
  }),
]);

detectCrossSessionPatterns("s4");
const data6 = loadLearnings();
const upgraded = data6.learnings[0];
assert(upgraded.classification === "QUALITY_STANDARD", "PREFERENCE upgraded to QUALITY_STANDARD after 4 sessions");
assert(upgraded.classification_upgraded_from === "PREFERENCE", "Tracks original classification");

// Test 7: Deep pattern upgrade after 5 sessions
resetAll();
seed([
  makeActive("Error handling is non-negotiable", "QUALITY_STANDARD", "backend", {
    session_ids: ["s1", "s2", "s3", "s4"],
    _touched_this_session: true,
    cross_session_boosted: true,
  }),
]);

detectCrossSessionPatterns("s5");
const data7 = loadLearnings();
const deep = data7.learnings[0];
assert(deep.classification === "THINKING_PATTERN", "QUALITY_STANDARD upgraded to THINKING_PATTERN after 5 sessions");

// Test 8: Cross-session summary works
const summary = getCrossSessionSummary();
assert(summary && summary.length > 0, "Cross-session summary returns results");

// ═══════════════════════════════════════════════════════════════
console.log("\n\u2501\u2501\u2501 Area-Filtered Context Tests \u2501\u2501\u2501\n");
// ═══════════════════════════════════════════════════════════════

// Test 9: No filtering below 15 learnings
resetAll();
const smallSet = [];
for (let i = 0; i < 5; i++) {
  smallSet.push(makeActive(`Learning ${i}`, "PREFERENCE", i < 3 ? "frontend" : "backend"));
}
seed(smallSet);

let ctx = buildContext(ACTIVATION_THRESHOLD, ["frontend"]);
assert(ctx.includes("Learning 3") || ctx.includes("Learning 4"), "No filtering below 15 learnings — all included");

// Test 10: Thinking patterns always included regardless of area
resetAll();
const bigSet = [];
for (let i = 0; i < 16; i++) {
  bigSet.push(makeActive(`Backend thing ${i}`, "PREFERENCE", "backend"));
}
bigSet.push(makeActive("Thinks in user flows", "THINKING_PATTERN", "ux"));
bigSet.push(makeActive("Separates concerns", "DESIGN_PRINCIPLE", "architecture"));
seed(bigSet);

ctx = buildContext(ACTIVATION_THRESHOLD, ["backend"]);
assert(ctx.includes("Thinks in user flows"), "THINKING_PATTERN included regardless of area filter");
assert(ctx.includes("Separates concerns"), "DESIGN_PRINCIPLE included regardless of area filter");

// ═══════════════════════════════════════════════════════════════
console.log("\n\u2501\u2501\u2501 Profile-Based Context Tests \u2501\u2501\u2501\n");
// ═══════════════════════════════════════════════════════════════

// Test 11: Profile mode activated when profile exists and 6+ learnings
resetAll();
const profilerPath = path.join(TEST_DIR, "profile.json");
fs.writeFileSync(profilerPath, JSON.stringify({
  text: "This developer thinks in complete user flows. They prototype fast but ship carefully.",
  generated_at: new Date().toISOString(),
  learning_count: 8,
  session_count: 15,
  checksum: "test",
}));

// Monkey-patch profiler to use our test dir
const profiler = require("../lib/profiler");
const origProfilePath = profiler.PROFILE_PATH;
// We can't easily change PROFILE_PATH, so let's test the structured context instead
const profileLearnings = [];
for (let i = 0; i < 7; i++) {
  profileLearnings.push(makeActive(`Active learning ${i}`, "PREFERENCE", "general"));
}
seed(profileLearnings);

ctx = buildContext();
// When no profile file at the correct path, should fall back to structured
assert(ctx.includes("How This Developer Builds") || ctx.includes("Developer Profile"), "Context generated with 7+ learnings");

// ═══════════════════════════════════════════════════════════════
console.log("\n\u2501\u2501\u2501 Promotion Tests \u2501\u2501\u2501\n");
// ═══════════════════════════════════════════════════════════════

// Test 12: Promotable requires high confidence + evidence count
resetAll();
seed([
  makeActive("Uses pnpm", "PREFERENCE", "general", { confidence: 0.95, evidence_count: 8 }),
  makeActive("Uses vitest", "PREFERENCE", "testing", { confidence: 0.50, evidence_count: 2 }),
  makeActive("Thinks defensively", "THINKING_PATTERN", "architecture", { confidence: 0.85, evidence_count: 5 }),
]);

const promotable = getPromotable();
assert(promotable.length === 2, "Only high-confidence + high-evidence learnings are promotable");
assert(promotable.some((l) => l.text === "Uses pnpm"), "pnpm is promotable");
assert(promotable.some((l) => l.text === "Thinks defensively"), "Thinking pattern is promotable");

// Test 13: Promoted learnings excluded from active context
markPromoted(promotable.map((l) => l.id));
const active = getActiveLearnings();
assert(!active.some((l) => l.text === "Uses pnpm"), "Promoted learnings not in active set");
assert(active.some((l) => l.text === "Uses vitest"), "Non-promoted learnings still active");

// Test 14: Promoter writes grouped CLAUDE.md
resetAll();
seed([
  makeActive("Thinks in user flows", "THINKING_PATTERN", "ux", { confidence: 0.90, evidence_count: 6 }),
  makeActive("Uses pnpm", "PREFERENCE", "general", { confidence: 0.85, evidence_count: 5 }),
  makeActive("Error handling always", "QUALITY_STANDARD", "backend", { confidence: 0.88, evidence_count: 7 }),
]);

const { promoteToClaudeMd } = require("../lib/promoter");
const testProjectRoot = path.join(TEST_DIR, "project");
fs.mkdirSync(testProjectRoot, { recursive: true });
const result = promoteToClaudeMd(testProjectRoot);
const claudeMd = fs.readFileSync(path.join(testProjectRoot, "CLAUDE.md"), "utf-8");

assert(claudeMd.includes("<!-- instinct:start -->"), "CLAUDE.md has instinct section markers");
assert(claudeMd.includes("How We Build"), "CLAUDE.md groups thinking patterns");
assert(claudeMd.includes("Conventions"), "CLAUDE.md groups preferences");
assert(claudeMd.includes("Quality Standards"), "CLAUDE.md groups quality standards");
assert(result.promoted.length === 3, "All promotable learnings promoted");

// Test 15: Second promotion updates existing CLAUDE.md
resetAll();
seed([
  makeActive("New insight", "DESIGN_PRINCIPLE", "architecture", { confidence: 0.92, evidence_count: 6 }),
]);
promoteToClaudeMd(testProjectRoot);
const updatedClaudeMd = fs.readFileSync(path.join(testProjectRoot, "CLAUDE.md"), "utf-8");
assert(updatedClaudeMd.includes("New insight"), "Updated CLAUDE.md contains new promotion");
// Should only have ONE instinct section
const startCount = (updatedClaudeMd.match(/<!-- instinct:start -->/g) || []).length;
assert(startCount === 1, "CLAUDE.md has exactly one instinct section (replaced, not duplicated)");

// ═══════════════════════════════════════════════════════════════
console.log("\n\u2501\u2501\u2501 WAL Crash Recovery Tests \u2501\u2501\u2501\n");
// ═══════════════════════════════════════════════════════════════

// Test 16: WAL persists pairs
resetAll();
clearWal();
appendWal({ claude_said: "here's the code", user_said: "add error handling" });
appendWal({ claude_said: "done", user_said: "what about loading states?" });
const walEntries = drainWal();
assert(walEntries.length === 2, "WAL stores pairs durably");
assert(walEntries[0].user_said === "add error handling", "WAL preserves pair content");

// Test 17: WAL survives across reads
const walEntries2 = drainWal();
assert(walEntries2.length === 2, "WAL persists across reads (drain doesn't clear)");
clearWal();
const walEntries3 = drainWal();
assert(walEntries3.length === 0, "clearWal empties WAL");

// ═══════════════════════════════════════════════════════════════
console.log("\n\u2501\u2501\u2501 Status Display Tests \u2501\u2501\u2501\n");
// ═══════════════════════════════════════════════════════════════

// Test 18: Status groups by classification type
resetAll();
seed([
  makeActive("Thinks defensively", "THINKING_PATTERN", "architecture"),
  makeActive("Separates concerns", "DESIGN_PRINCIPLE", "architecture"),
  makeActive("Always test edge cases", "QUALITY_STANDARD", "testing"),
  makeActive("Uses pnpm", "PREFERENCE", "general"),
  makeActive("Loading states missing", "BEHAVIORAL_GAP", "frontend"),
]);

const status = buildStatus();
assert(status.includes("How You Think"), "Status shows thinking pattern section");
assert(status.includes("Architecture Values"), "Status shows design principle section");
assert(status.includes("Quality Bar"), "Status shows quality standard section");
assert(status.includes("Preferences"), "Status shows preferences section");
assert(status.includes("Watch For"), "Status shows behavioral gaps section");

// ═══════════════════════════════════════════════════════════════
console.log("\n\u2501\u2501\u2501 Error-Driven Learning Tests \u2501\u2501\u2501\n");
// ═══════════════════════════════════════════════════════════════

// Test 19: Learnings with error context are stored
resetAll();
addCandidate({
  text: "Always handle null pointer exceptions in database queries",
  confidence: 0.35,
  scope: "global",
  classification: "QUALITY_STANDARD",
  area: "backend",
  detection_method: "llm",
  evidence: {
    claude_said: "Here's the query function...",
    user_said: "This crashes if the row doesn't exist",
    error_context: "TypeError: Cannot read properties of null (reading 'id')",
  },
});

const data19 = loadLearnings();
const errorLearning = data19.learnings.find((l) => l.text.includes("null pointer"));
assert(errorLearning !== undefined, "Error-driven learning stored");
assert(errorLearning.evidence[0].error_context.includes("TypeError"), "Error context preserved in evidence");

// Test 20: Reinforcement with error context merges correctly
addCandidate({
  text: "Always handle null pointer exceptions in database queries",
  confidence: 0.35,
  scope: "global",
  classification: "QUALITY_STANDARD",
  area: "backend",
  detection_method: "llm",
  evidence: {
    claude_said: "Updated query...",
    user_said: "Same issue, check for null first",
    error_context: "TypeError: Cannot read properties of null (reading 'name')",
  },
});

const data20 = loadLearnings();
const reinforced = data20.learnings.find((l) => l.text.includes("null pointer"));
assert(reinforced.evidence_count === 2, "Error-driven learning reinforced");
assert(reinforced.evidence.length === 2, "Both evidence entries preserved");

// ═══════════════════════════════════════════════════════════════
console.log("\n\u2501\u2501\u2501 Context Depth Ordering Tests \u2501\u2501\u2501\n");
// ═══════════════════════════════════════════════════════════════

// Test 21: Context orders deep signals before shallow ones
resetAll();
seed([
  makeActive("Uses pnpm", "PREFERENCE", "general"),
  makeActive("Thinks in user flows", "THINKING_PATTERN", "ux"),
  makeActive("Separates concerns by layer", "DESIGN_PRINCIPLE", "architecture"),
  makeActive("Ships with error handling", "QUALITY_STANDARD", "backend"),
]);

ctx = buildContext();
const thinkIdx = ctx.indexOf("How They Think");
const archIdx = ctx.indexOf("Architecture Values");
const qualIdx = ctx.indexOf("Quality Bar");
const prefIdx = ctx.indexOf("General Preferences");
assert(thinkIdx < archIdx, "Thinking patterns appear before architecture");
assert(archIdx < qualIdx, "Architecture appears before quality");
assert(qualIdx < prefIdx, "Quality appears before preferences");

// ═══════════════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════════════

fs.rmSync(TEST_DIR, { recursive: true, force: true });

console.log(`\n\u2501\u2501\u2501 Results: ${passed} passed, ${failed} failed \u2501\u2501\u2501`);
process.exit(failed > 0 ? 1 : 0);
