#!/usr/bin/env node

/**
 * OpenTell — Live Simulation
 *
 * Simulates 10 Claude Code sessions with realistic correction patterns.
 * Shows the full lifecycle: detection → reinforcement → cross-session
 * upgrades → consolidation → profile synthesis → promotion.
 *
 * Usage:
 *   node test/simulate.js                  # regex-only (no API key needed)
 *   ANTHROPIC_API_KEY=sk-... node test/simulate.js   # full LLM + profile
 *
 * This doesn't touch your real ~/.opentell data — runs in a temp directory.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// ─── Isolated test environment ────────────────────────────────────────
const SIM_DIR = path.join(os.tmpdir(), `opentell-sim-${Date.now()}`);
fs.mkdirSync(SIM_DIR, { recursive: true });

// Patch config paths BEFORE requiring anything else
const config = require("../lib/config");
config.paths.root = SIM_DIR;
config.paths.config = path.join(SIM_DIR, "config.json");
config.paths.db = path.join(SIM_DIR, "learnings.json");
config.paths.buffer = path.join(SIM_DIR, "session-buffer.json");
config.paths.wal = path.join(SIM_DIR, "wal.jsonl");
config.paths.log = path.join(SIM_DIR, "opentell.log");

// Patch profiler path
const profiler = require("../lib/profiler");
const origProfilePath = profiler.PROFILE_PATH;
// We override by writing to the sim dir
const simProfilePath = path.join(SIM_DIR, "profile.json");

const { detectSignals } = require("../lib/detector");
const { addCandidate, getActiveLearnings, getPromotable, resetAll, loadLearnings, clearBuffer, applyDecay, incrementSessionCount, appendWal, clearWal } = require("../lib/store");
const { buildContext, buildStatus } = require("../lib/skill-writer");
const { detectCrossSessionPatterns } = require("../lib/cross-session");
const { findClusters, runConsolidation, markConsolidationRun, shouldConsolidate } = require("../lib/consolidator");
const { promoteToClaudeMd, previewPromotion } = require("../lib/promoter");

const HAS_API_KEY = !!(process.env.ANTHROPIC_API_KEY);

// Write config
fs.writeFileSync(config.paths.config, JSON.stringify({
  anthropic_api_key: process.env.ANTHROPIC_API_KEY || "",
  classifier_model: "claude-haiku-4-5-20251001",
  confidence_threshold: 0.45,
  max_learnings: 100,
  paused: false,
}, null, 2));

// ─── Simulated sessions ──────────────────────────────────────────────
// Each session has realistic (claude_said, user_said) pairs

const SESSIONS = [
  {
    name: "Session 1: First contact",
    pairs: [
      { claude: "I'll install the dependencies with npm install...", user: "no, use pnpm" },
      { claude: "Here's the component with the form fields...", user: "looks good, thanks" },
      { claude: "I've added the dashboard with the data table...", user: "what does it look like when there's no data? add an empty state" },
    ],
  },
  {
    name: "Session 2: Style and structure",
    pairs: [
      { claude: "Here's the class-based component for the sidebar...", user: "we use functional components" },
      { claude: "I've created the endpoint with the validation logic in the route handler...", user: "don't put validation in the route handler, that should be in a service layer" },
      { claude: "Done! The feature is ready.", user: "what about error handling? what happens if the API is down?" },
    ],
  },
  {
    name: "Session 3: Reinforcement begins",
    pairs: [
      { claude: "Let me set up the project with npm...", user: "we use pnpm, not npm" },
      { claude: "Here's the settings page with all the fields...", user: "a new user would have no idea what half these fields mean. add labels and helper text" },
      { claude: "I'll add the tests later...", user: "write the tests now, code isn't shipped without tests" },
    ],
  },
  {
    name: "Session 4: Deeper patterns emerge",
    pairs: [
      { claude: "Here's the full feature with the UI, API endpoint, and database query...", user: "the filters don't actually do anything, they're not connected to the API" },
      { claude: "I've added error handling for the main endpoint...", user: "what about the webhook handler? and the cron job? everything needs error handling" },
      { claude: "Here's the config with the API URL hardcoded...", user: "don't hardcode that, make it configurable via env vars" },
    ],
  },
  {
    name: "Session 5: Quality standards solidify",
    pairs: [
      { claude: "The feature is complete with the happy path working...", user: "what about when the user has no permissions? or when the session expires?" },
      { claude: "I've created a new utils file at /src/utils/helpers.ts...", user: "break this into smaller functions, each one should do one thing" },
      { claude: "Here are the test cases for the main flow...", user: "add tests for edge cases too — empty input, special characters, concurrent access" },
    ],
  },
  {
    name: "Session 6: Architecture instincts",
    pairs: [
      { claude: "I'll start building the page UI...", user: "start with the data model. what's the schema? let the schema shape the API" },
      { claude: "Here's the monolith endpoint handling auth, validation, business logic, and response formatting...", user: "this is doing too much. break it apart — auth middleware, validation service, business logic, response formatter" },
      { claude: "Added type: any for the response...", user: "type this properly, no 'any' types" },
    ],
  },
  {
    name: "Session 7: UX thinking",
    pairs: [
      { claude: "Here's the onboarding flow with all 5 steps on one page...", user: "that's overwhelming. break it into a step-by-step wizard. what does a first-time user see?" },
      { claude: "I've added the search feature with instant results...", user: "what about loading state? and what happens when there are zero results?" },
      { claude: "Done with the form, here it is...", user: "add proper validation messages. 'Invalid input' isn't helpful — tell the user what's wrong specifically" },
    ],
  },
  {
    name: "Session 8: Tool evolution",
    pairs: [
      { claude: "I'll run the tests with Jest...", user: "we switched to vitest" },
      { claude: "Here's the component with inline styles...", user: "use Tailwind classes, that's what we use in this project" },
      { claude: "I've set up ESLint with the standard config...", user: "we use Biome now, not ESLint" },
    ],
  },
  {
    name: "Session 9: Everything clicks",
    pairs: [
      { claude: "Let me build the user profile page...", user: "think about this from the user's perspective — what do they see first time? what's the empty state? what errors can happen?" },
      { claude: "Here's the API endpoint...", user: "add proper logging. when this breaks in production we need to know what happened" },
      { claude: "The feature is ready to ship...", user: "where are the tests? and have you checked accessibility? screen reader, keyboard nav?" },
    ],
  },
  {
    name: "Session 10: Mastery",
    pairs: [
      { claude: "I'll create the dashboard feature with...", user: "let's get a rough version working first. prototype, don't polish. we can iterate" },
      { claude: "Here's a comprehensive abstraction layer for all data access...", user: "don't over-engineer this. keep it simple. we don't need that abstraction yet, YAGNI" },
      { claude: "I've duplicated the auth logic from the other endpoint...", user: "that's already in the auth service. reuse it, don't duplicate" },
    ],
  },
];

// ─── Run simulation ──────────────────────────────────────────────────

async function simulate() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║          OpenTell — Live Simulation (10 Sessions)           ║");
  console.log("║                                                              ║");
  if (HAS_API_KEY) {
    console.log("║  Mode: FULL (regex + LLM classification + profile)          ║");
  } else {
    console.log("║  Mode: REGEX ONLY (set ANTHROPIC_API_KEY for full mode)     ║");
  }
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  resetAll();

  for (let i = 0; i < SESSIONS.length; i++) {
    const session = SESSIONS[i];
    const sessionId = `sim_session_${i + 1}`;

    console.log(`\n${"━".repeat(60)}`);
    console.log(`  ${session.name}`);
    console.log(`${"━".repeat(60)}`);

    // --- SessionStart: inject context ---
    clearBuffer();
    incrementSessionCount();

    const contextBefore = buildContext();
    const activeCount = getActiveLearnings().length;
    if (activeCount > 0) {
      console.log(`\n  📖 Claude starts this session knowing ${activeCount} thing(s) about you`);
    }

    // --- Process each pair (Stop hook equivalent) ---
    for (const pair of session.pairs) {
      const result = detectSignals(pair.claude, pair.user);

      if (result.detected) {
        for (const signal of result.signals) {
          addCandidate({
            text: signal.text,
            confidence: signal.confidence,
            scope: "repo",
            scope_key: "sim-project",
            classification: signal.classification || "PREFERENCE",
            area: signal.area || "general",
            detection_method: "regex",
            certainty: "high",
            evidence: {
              claude_said: pair.claude.slice(0, 300),
              user_said: pair.user.slice(0, 300),
            },
          });
          const icon = {
            THINKING_PATTERN: "🧠",
            DESIGN_PRINCIPLE: "📐",
            QUALITY_STANDARD: "✅",
            PREFERENCE: "⚙️ ",
            BEHAVIORAL_GAP: "⚠️ ",
          }[signal.classification] || "📌";
          console.log(`  ${icon} [${signal.classification || "PREFERENCE"}] "${signal.text}"`);
        }
      } else if (!result.noise) {
        console.log(`  💭 Ambiguous: "${pair.user.slice(0, 60)}..." → would send to Haiku`);
        // In full mode, we'd spawn the bg classifier here
        // For simulation, we'll note these as missed by regex
      }
    }

    // --- SessionEnd: intelligence pipeline ---

    // Cross-session detection
    detectCrossSessionPatterns(sessionId);

    // Check for consolidation (every ~5 sessions)
    if (i > 0 && i % 4 === 0 && shouldConsolidate()) {
      if (HAS_API_KEY) {
        console.log(`\n  🔗 Running consolidation...`);
        const result = await runConsolidation();
        if (result.consolidated > 0) {
          markConsolidationRun();
          for (const insight of result.insights) {
            console.log(`     → Merged ${insight.fragments.length} fragments into: "${insight.insight}"`);
          }
        }
      } else {
        const clusters = findClusters();
        if (clusters.length > 0) {
          console.log(`\n  🔗 ${clusters.length} cluster(s) ready for consolidation (needs API key)`);
          for (const c of clusters) {
            console.log(`     → ${c.group_id}: ${c.members.length} related learnings`);
          }
        }
      }
    }

    // Decay (no-op since everything is fresh, but shows the pipeline)
    applyDecay();

    // Show status after key sessions
    if (i === 2 || i === 5 || i === 9) {
      const active = getActiveLearnings();
      const data = loadLearnings();
      const all = data.learnings.filter((l) => !l.archived);

      console.log(`\n  ── Status: ${all.length} total, ${active.length} active ──`);
      if (active.length > 0) {
        for (const l of active.sort((a, b) => b.confidence - a.confidence).slice(0, 8)) {
          const icon = {
            THINKING_PATTERN: "🧠",
            DESIGN_PRINCIPLE: "📐",
            QUALITY_STANDARD: "✅",
            PREFERENCE: "⚙️ ",
            BEHAVIORAL_GAP: "⚠️ ",
          }[l.classification] || "📌";
          console.log(`     ${icon} ${l.text}  (${l.evidence_count}x, conf: ${l.confidence.toFixed(2)})`);
        }
        if (active.length > 8) {
          console.log(`     ... and ${active.length - 8} more`);
        }
      }
    }
  }

  // ─── Final report ──────────────────────────────────────────────────

  console.log(`\n\n${"═".repeat(60)}`);
  console.log("  FINAL STATE — After 10 Sessions");
  console.log(`${"═".repeat(60)}\n`);

  console.log(buildStatus());

  // Show what Claude would see
  console.log(`\n${"─".repeat(60)}`);
  console.log("  What Claude sees at the start of every session:");
  console.log(`${"─".repeat(60)}\n`);
  console.log(buildContext());

  // Show promotable
  const promotable = getPromotable();
  if (promotable.length > 0) {
    console.log(`\n${"─".repeat(60)}`);
    console.log("  Ready for promotion to CLAUDE.md:");
    console.log(`${"─".repeat(60)}\n`);
    for (const l of promotable) {
      console.log(`  → [${l.classification}] ${l.text}  (${l.evidence_count}x, conf: ${l.confidence.toFixed(2)})`);
    }

    // Actually promote to show the output
    const projectDir = path.join(SIM_DIR, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    const result = promoteToClaudeMd(projectDir);
    const claudeMd = fs.readFileSync(path.join(projectDir, "CLAUDE.md"), "utf-8");
    console.log(`\n  Generated CLAUDE.md:\n`);
    console.log(claudeMd.split("\n").map((l) => `  ${l}`).join("\n"));
  }

  // Show consolidation clusters
  const clusters = findClusters();
  if (clusters.length > 0) {
    console.log(`\n${"─".repeat(60)}`);
    console.log("  Consolidation clusters (related learnings to merge):");
    console.log(`${"─".repeat(60)}\n`);
    for (const c of clusters) {
      console.log(`  📦 ${c.group_id} (${c.members.length} learnings):`);
      for (const t of c.texts) console.log(`     - ${t}`);
    }
    if (!HAS_API_KEY) {
      console.log(`\n  Run with ANTHROPIC_API_KEY to synthesize these into deeper insights.`);
    }
  }

  // Show cross-session patterns
  const { getCrossSessionSummary } = require("../lib/cross-session");
  const patterns = getCrossSessionSummary();
  if (patterns && patterns.length > 0) {
    console.log(`\n${"─".repeat(60)}`);
    console.log("  Cross-session patterns:");
    console.log(`${"─".repeat(60)}\n`);
    for (const p of patterns) {
      const upgraded = p.upgraded ? ` ← was ${p.original_classification}` : "";
      console.log(`  🔁 ${p.text}  (${p.sessions} sessions, ${p.classification}${upgraded})`);
    }
  }

  // Profile synthesis (if API key available)
  if (HAS_API_KEY) {
    console.log(`\n${"─".repeat(60)}`);
    console.log("  Synthesizing developer profile...");
    console.log(`${"─".repeat(60)}\n`);
    const { synthesizeProfile } = require("../lib/profiler");
    const profile = await synthesizeProfile();
    if (profile) {
      console.log(profile.text);
    }
  }

  // Contradiction demo
  console.log(`\n${"─".repeat(60)}`);
  console.log("  Contradiction detection in action:");
  console.log(`${"─".repeat(60)}\n`);
  const data = loadLearnings();
  const archived = data.learnings.filter((l) => l.archived && l.archived_reason);
  if (archived.length > 0) {
    for (const a of archived) {
      console.log(`  ❌ "${a.text}" → ${a.archived_reason}`);
    }
  } else {
    console.log("  (No contradictions in this simulation — try Session 8 for Jest→Vitest)");
  }

  // Cleanup
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Simulation data: ${SIM_DIR}`);
  console.log(`  View learnings: cat ${path.join(SIM_DIR, "learnings.json")} | jq .`);
  console.log(`  View log: cat ${path.join(SIM_DIR, "opentell.log")}`);
  console.log(`${"─".repeat(60)}`);
  console.log("\n  To test with real Claude Code:");
  console.log("    1. Install via Claude Code: /plugin marketplace add shobhit-87labs/opentell");
  console.log("    2. Set ANTHROPIC_API_KEY in ~/.opentell/config.json");
  console.log("    3. Start a Claude Code session and correct it naturally");
  console.log("    4. Run: /opentell");
  console.log("");
}

simulate().catch(console.error);
