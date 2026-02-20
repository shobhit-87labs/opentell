#!/usr/bin/env node

/**
 * Instinct CLI
 * 
 * Usage:
 *   instinct                 Show status (all learnings, grouped by type)
 *   instinct profile         Show your developer profile (narrative)
 *   instinct profile regen   Force regenerate the profile
 *   instinct promote         Promote high-confidence learnings to CLAUDE.md
 *   instinct promote --dry   Preview what would be promoted
 *   instinct consolidate     Find and merge related learnings into deeper insights
 *   instinct patterns        Show cross-session patterns (signals that persist)
 *   instinct context         Show what Claude sees at session start
 *   instinct remove <n>      Remove learning by number
 *   instinct pause           Pause learning
 *   instinct resume          Resume learning
 *   instinct reset           Clear all learnings
 *   instinct export          Export learnings as JSON
 *   instinct import <file>   Import learnings from JSON
 *   instinct log             Show recent log entries
 */

const fs = require("fs");
const { buildStatus, buildContext } = require("./lib/skill-writer");
const { loadLearnings, saveLearnings, removeLearning, resetAll, getAllLearnings, getPromotable, getInferredLearnings, acceptObservation, rejectObservation } = require("./lib/store");
const { previewPromotion, promoteToClaudeMd } = require("./lib/promoter");
const { loadConfig, paths, ensureDir } = require("./lib/config");

const args = process.argv.slice(2);
const command = args[0] || "status";

async function run() {
  switch (command) {
    case "status":
    case "show":
      console.log(buildStatus());
      break;

    case "profile": {
      if (args[1] === "regen" || args[1] === "regenerate") {
        const { synthesizeProfile } = require("./lib/profiler");
        console.log("Synthesizing developer profile...\n");
        const profile = await synthesizeProfile();
        if (profile) {
          console.log("\u2500".repeat(60));
          console.log(profile.text);
          console.log("\u2500".repeat(60));
          console.log(`\nGenerated from ${profile.learning_count} learnings.`);
        } else {
          console.log("Could not generate profile. Need 3+ active learnings and an API key.");
        }
      } else {
        const { loadProfile, profileNeedsUpdate } = require("./lib/profiler");
        const profile = loadProfile();
        if (profile && profile.text) {
          console.log("Your Developer Profile (what Claude understands about you):\n");
          console.log("\u2500".repeat(60));
          console.log(profile.text);
          console.log("\u2500".repeat(60));
          console.log(`\nGenerated: ${new Date(profile.generated_at).toLocaleDateString()}`);
          console.log(`Based on: ${profile.learning_count} learnings across ${profile.session_count} sessions`);
          if (profileNeedsUpdate()) {
            console.log("\n\u26A1 Profile is stale. Run 'instinct profile regen' to update.");
          }
        } else {
          console.log("No developer profile yet.");
          console.log("Instinct needs 3+ active learnings to build your profile.");
          console.log("Keep using Claude Code \u2014 your profile will be generated automatically.");
        }
      }
      break;
    }

    case "context": {
      const context = buildContext();
      if (context) {
        console.log("This is what Claude sees at the start of every session:\n");
        console.log("\u2500".repeat(60));
        console.log(context);
        console.log("\u2500".repeat(60));
      } else {
        console.log("No active learnings yet. Context injection is empty.");
        console.log("Keep using Claude Code \u2014 Instinct will build your context from corrections.");
      }
      break;
    }

    case "consolidate": {
      const { findClusters, runConsolidation, markConsolidationRun } = require("./lib/consolidator");

      if (args[1] === "--dry" || args[1] === "--preview") {
        const clusters = findClusters();
        if (clusters.length === 0) {
          console.log("No clusters found for consolidation.");
          console.log("Need 2+ related active learnings in the same area.");
        } else {
          console.log(`Found ${clusters.length} cluster(s) that could be consolidated:\n`);
          for (const c of clusters) {
            console.log(`  \uD83D\uDCE6 ${c.group_id} (${c.members.length} learnings):`);
            for (const t of c.texts) console.log(`     - ${t}`);
            console.log("");
          }
          console.log("Run 'instinct consolidate' to synthesize these into deeper insights.");
        }
      } else {
        console.log("Running consolidation...\n");
        const result = await runConsolidation();
        if (result.consolidated === 0) {
          console.log("No clusters found for consolidation.");
        } else {
          markConsolidationRun();
          console.log(`Consolidated ${result.consolidated} insight(s):\n`);
          for (const insight of result.insights) {
            console.log(`  \uD83E\uDDE0 [${insight.group}]`);
            console.log(`     Fragments: ${insight.fragments.length}`);
            for (const f of insight.fragments) console.log(`       - ${f}`);
            console.log(`     \u2192 Insight: "${insight.insight}"`);
            console.log(`     Confidence: ${insight.confidence.toFixed(2)}`);
            console.log("");
          }
        }
      }
      break;
    }

    case "patterns": {
      const { getCrossSessionSummary } = require("./lib/cross-session");
      const patterns = getCrossSessionSummary();
      if (!patterns || patterns.length === 0) {
        console.log("No cross-session patterns detected yet.");
        console.log("Patterns emerge when the same type of correction appears across 3+ sessions.");
      } else {
        console.log("Cross-Session Patterns (signals that persist across sessions):\n");
        for (const p of patterns) {
          const upgraded = p.upgraded ? ` (upgraded from ${p.original_classification})` : "";
          console.log(`  \uD83D\uDD01 ${p.text}`);
          console.log(`     Seen in ${p.sessions} sessions | ${p.classification}${upgraded} | conf: ${p.confidence.toFixed(2)}`);
          console.log("");
        }
      }
      break;
    }

    case "promote": {
      if (args[1] === "--dry" || args[1] === "--preview") {
        const preview = previewPromotion();
        if (preview.promotable.length === 0) {
          console.log("No learnings ready for promotion.");
          console.log("Learnings need confidence \u2265 0.80 and 4+ evidence instances.");
        } else {
          console.log(`${preview.promotable.length} learning(s) ready to promote to ${preview.claudeMdPath}:`);
          console.log(preview.claudeMdExists ? "(will append to existing CLAUDE.md)" : "(will create new CLAUDE.md)");
          console.log("");
          preview.promotable.forEach((l) => {
            const type = l.classification || "PREFERENCE";
            console.log(`  [${type}] ${l.text}  (${l.evidence_count}x, conf: ${l.confidence.toFixed(2)})`);
          });
          console.log("\nRun 'instinct promote' to write these to CLAUDE.md.");
        }
      } else {
        const promotable = getPromotable();
        if (promotable.length === 0) {
          console.log("No learnings ready for promotion yet.");
          console.log("Learnings need confidence \u2265 0.80 and 4+ evidence instances.");
          break;
        }
        console.log(`Promoting ${promotable.length} learning(s) to CLAUDE.md...\n`);
        const result = promoteToClaudeMd();
        console.log(result.message);
        console.log("");
        result.promoted.forEach((l) => { console.log(`  \u2713 ${l.text}`); });
        console.log(`\nThese learnings are now in ${result.claudeMdPath}`);
        console.log("They'll be injected by CLAUDE.md directly, so Instinct won't duplicate them.");
      }
      break;
    }

    case "remove":
    case "rm": {
      const idx = parseInt(args[1], 10);
      if (isNaN(idx) || idx < 1) {
        console.error("Usage: instinct remove <number>");
        console.error("Use 'instinct' to see numbered learnings");
        process.exit(1);
      }
      const removed = removeLearning(idx - 1);
      if (removed) {
        console.log(`Removed: ${removed.text}`);
      } else {
        console.error(`No learning at position ${idx}`);
      }
      break;
    }

    case "observations":
    case "obs": {
      const inferred = getInferredLearnings();
      if (inferred.length === 0) {
        console.log("No unvalidated observations yet.");
        console.log("Instinct captures these when Claude adapts to your codebase");
        console.log("(e.g. \"I'll use pnpm since that's what the project uses\").");
      } else {
        console.log(`${inferred.length} unvalidated observation(s) from Claude:\n`);
        inferred
          .sort((a, b) => b.confidence - a.confidence)
          .forEach((l, i) => {
            const conf = l.confidence.toFixed(2);
            const type = l.observation_type || "observation";
            const area = l.area && l.area !== "general" ? ` [${l.area}]` : "";
            console.log(`  ${i + 1}. ${l.text}`);
            console.log(`     type: ${type} | conf: ${conf}${area}`);
          });
        console.log("\nRun 'instinct accept <n>' to validate or 'instinct reject <n>' to discard.");
      }
      break;
    }

    case "accept": {
      const idx = parseInt(args[1], 10);
      if (isNaN(idx) || idx < 1) {
        console.error("Usage: instinct accept <number>");
        console.error("Use 'instinct observations' to see numbered observations");
        process.exit(1);
      }
      const inferred = getInferredLearnings().sort((a, b) => b.confidence - a.confidence);
      const target = inferred[idx - 1];
      if (!target) {
        console.error(`No observation at position ${idx}`);
        process.exit(1);
      }
      const accepted = acceptObservation(target.id);
      if (accepted) {
        console.log(`Accepted: "${accepted.text}"`);
        console.log(`Confidence: ${accepted.confidence.toFixed(2)} — now active and will be injected.`);
      }
      break;
    }

    case "reject": {
      const idx = parseInt(args[1], 10);
      if (isNaN(idx) || idx < 1) {
        console.error("Usage: instinct reject <number>");
        console.error("Use 'instinct observations' to see numbered observations");
        process.exit(1);
      }
      const inferred = getInferredLearnings().sort((a, b) => b.confidence - a.confidence);
      const target = inferred[idx - 1];
      if (!target) {
        console.error(`No observation at position ${idx}`);
        process.exit(1);
      }
      const rejected = rejectObservation(target.id);
      if (rejected) {
        console.log(`Rejected and archived: "${rejected.text}"`);
      }
      break;
    }

    case "pause":
      updateConfig({ paused: true });
      console.log("Instinct paused. Existing learnings preserved but no new ones captured.");
      console.log("Run 'instinct resume' to start again.");
      break;

    case "resume":
      updateConfig({ paused: false });
      console.log("Instinct resumed. Learning from your corrections again.");
      break;

    case "reset": {
      if (args[1] !== "--confirm") {
        console.log("This will delete ALL learnings permanently.");
        console.log("Run: instinct reset --confirm");
        process.exit(0);
      }
      resetAll();
      const { PROFILE_PATH } = require("./lib/profiler");
      try { fs.unlinkSync(PROFILE_PATH); } catch {}
      console.log("All learnings and profile cleared.");
      break;
    }

    case "export": {
      const data = loadLearnings();
      const out = args[1] || "instinct-export.json";
      fs.writeFileSync(out, JSON.stringify(data, null, 2));
      console.log(`Exported ${data.learnings.length} learnings to ${out}`);
      break;
    }

    case "import": {
      const file = args[1];
      if (!file || !fs.existsSync(file)) {
        console.error("Usage: instinct import <file.json>");
        process.exit(1);
      }
      const imported = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (!imported.learnings || !Array.isArray(imported.learnings)) {
        console.error("Invalid format: expected { learnings: [...] }");
        process.exit(1);
      }
      const current = loadLearnings();
      let added = 0;
      for (const l of imported.learnings) {
        const exists = current.learnings.find((e) => e.text.toLowerCase() === l.text.toLowerCase());
        if (!exists) { current.learnings.push(l); added++; }
      }
      saveLearnings(current);
      console.log(`Imported ${added} new learnings (${imported.learnings.length - added} duplicates skipped)`);
      break;
    }

    case "log": {
      const n = parseInt(args[1], 10) || 30;
      if (fs.existsSync(paths.log)) {
        const lines = fs.readFileSync(paths.log, "utf-8").trim().split("\n");
        console.log(lines.slice(-n).join("\n"));
      } else {
        console.log("No log file yet.");
      }
      break;
    }

    case "config": {
      const config = loadConfig();
      console.log(JSON.stringify(config, null, 2));
      console.log(`\nConfig file: ${paths.config}`);
      break;
    }

    case "help":
    case "--help":
    case "-h":
      console.log(`Instinct \u2014 Claude Code learns how you think

Commands:
  instinct                 Show all learnings grouped by type
  instinct profile         Show your developer profile (narrative)
  instinct profile regen   Force regenerate the profile
  instinct context         Show what Claude sees at session start
  instinct promote         Promote learnings to CLAUDE.md
  instinct promote --dry   Preview what would be promoted
  instinct consolidate     Merge related learnings into deeper insights
  instinct consolidate --dry  Preview clusters
  instinct patterns        Show cross-session patterns
  instinct observations    Show unvalidated observations from Claude
  instinct accept <n>      Accept an observation (makes it active)
  instinct reject <n>      Reject an observation (archives it)
  instinct remove <n>      Remove learning by number
  instinct pause/resume    Pause or resume learning
  instinct reset --confirm Clear all learnings
  instinct export [file]   Export learnings as JSON
  instinct import <file>   Import learnings from JSON
  instinct log [n]         Show last n log entries
  instinct config          Show configuration`);
      break;

    default:
      console.log(`Unknown command: ${command}`);
      console.log("Run 'instinct help' for available commands.");
  }
}

function updateConfig(updates) {
  ensureDir();
  const config = loadConfig();
  Object.assign(config, updates);
  fs.writeFileSync(paths.config, JSON.stringify(config, null, 2));
}

run().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
