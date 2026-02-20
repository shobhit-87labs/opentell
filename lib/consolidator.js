const { loadLearnings, saveLearnings, ACTIVATION_THRESHOLD } = require("./store");
const { loadConfig, log, DEFAULT_SYNTHESIS_MODEL } = require("./config");
const { recordCall } = require("./stats");

/**
 * Consolidation engine — The Core Intelligence Layer
 * 
 * Individual learnings are fragments. A developer's thinking style is a system.
 * The consolidator finds clusters of related learnings and synthesizes them
 * into deeper, richer insights about HOW this developer builds.
 *
 * Example:
 *   Fragment: "Prefers functional components"
 *   Fragment: "Break this into smaller functions"
 *   Fragment: "Extract that into a component"
 *   Fragment: "Prefers composition over inheritance"
 *   ↓
 *   Consolidated: "Thinks in composable units — prefers small, single-purpose
 *   functions and components that can be combined, not monolithic files"
 *
 * This is what separates OpenTell from a preference list.
 * A preference list says: "uses pnpm"
 * OpenTell says: "this developer designs systems data-first, prototypes
 * before polishing, and won't ship without error handling"
 */

// ─── Affinity groups ──────────────────────────────────────────────────
// Learnings whose extractCore text matches ANY pattern in a group
// are candidates for consolidation into that group's insight.
//
// These aren't rigid categories — the LLM does the real synthesis.
// These just identify WHICH learnings to cluster together.

const AFFINITY_GROUPS = [
  {
    id: "composability",
    keywords: ["small", "function", "component", "extract", "single", "responsib", "break", "split", "modular", "composab", "reuse", "composition", "separate"],
    minCluster: 2,
  },
  {
    id: "user_empathy",
    keywords: ["user", "perspective", "experience", "empty state", "loading", "onboarding", "first-time", "confus", "label", "copy", "ux", "accessible", "a11y"],
    minCluster: 2,
  },
  {
    id: "defensive_design",
    keywords: ["error", "fail", "edge case", "what if", "what happens", "timeout", "retry", "fallback", "null", "undefined", "empty", "invalid", "validat"],
    minCluster: 2,
  },
  {
    id: "data_architecture",
    keywords: ["schema", "data model", "data first", "database", "migration", "type", "struct", "interface", "contract", "api", "endpoint"],
    minCluster: 2,
  },
  {
    id: "shipping_standards",
    keywords: ["test", "logging", "monitor", "observ", "coverage", "ci", "deploy", "done", "ship", "production", "ready"],
    minCluster: 2,
  },
  {
    id: "simplicity_pragmatism",
    keywords: ["simple", "yagni", "over-engineer", "premature", "prototype", "mvp", "iterate", "working version", "rough", "practical", "pragmat"],
    minCluster: 2,
  },
  {
    id: "system_thinking",
    keywords: ["scale", "performance", "growth", "distributed", "cache", "queue", "async", "concurren", "load", "bottleneck", "architect"],
    minCluster: 2,
  },
  {
    id: "code_clarity",
    keywords: ["readable", "naming", "convention", "consistent", "explicit", "implicit", "verbose", "concise", "comment", "document", "self-document"],
    minCluster: 2,
  },
];

/**
 * Find clusters of related learnings that could be consolidated.
 * Returns groups with 2+ members.
 */
function findClusters() {
  const data = loadLearnings();
  const active = data.learnings.filter(
    (l) => !l.archived && !l.promoted && l.confidence >= ACTIVATION_THRESHOLD
  );

  const clusters = [];

  for (const group of AFFINITY_GROUPS) {
    const members = active.filter((l) => {
      const lower = l.text.toLowerCase();
      return group.keywords.some((kw) => lower.includes(kw));
    });

    // Only cluster if multiple learnings and they haven't already been consolidated
    if (members.length >= group.minCluster) {
      // Check if there's already a consolidated learning for this group
      const alreadyConsolidated = active.some(
        (l) => l.consolidated_from_group === group.id
      );
      if (!alreadyConsolidated) {
        clusters.push({
          group_id: group.id,
          members,
          texts: members.map((l) => l.text),
        });
      }
    }
  }

  return clusters;
}

/**
 * Consolidate a cluster into a single, deeper insight using LLM.
 * The LLM sees the fragments and synthesizes the underlying thinking pattern.
 */
async function consolidateCluster(cluster) {
  const config = loadConfig();
  if (!config.anthropic_api_key) {
    return null;
  }

  const fragmentList = cluster.texts.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const prompt = `You are analyzing fragments of a developer's behavior to understand their THINKING STYLE.

These are individual signals captured from how this developer corrects an AI coding assistant:

${fragmentList}

These fragments all relate to the same aspect of how this developer builds systems. Your job is to synthesize them into a SINGLE insight that captures the UNDERLYING PHILOSOPHY — the "why" behind these corrections.

Rules:
- The insight should be about HOW they think, not WHAT tools they use
- Frame it as a design instinct or mental model, not a rule
- Use "—" to separate the principle from its implication
- Be specific enough that an AI assistant could change its behavior based on this
- 1-2 sentences max

Examples of good synthesis:
- "Thinks in complete user flows — every screen needs working interactions, proper states, and real data flowing through it"
- "Designs defensively by default — considers what breaks, what's empty, and what fails before building the happy path"
- "Values composability over completeness — prefers small reusable units over comprehensive monolithic implementations"

Respond with ONLY the synthesized insight, nothing else.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.anthropic_api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.synthesis_model || config.classifier_model || DEFAULT_SYNTHESIS_MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const usedModel = config.synthesis_model || config.classifier_model || DEFAULT_SYNTHESIS_MODEL;
    recordCall("consolidation", usedModel, data.usage);

    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // Clean up any quotes or markdown
    return text.replace(/^["']|["']$/g, "").trim();
  } catch (e) {
    log(`Consolidation error: ${e.message}`);
    return null;
  }
}

/**
 * Run consolidation: find clusters, synthesize, store consolidated learnings.
 * 
 * Consolidated learnings:
 * - Start at the AVERAGE confidence of their members (they're already proven)
 * - Classified as THINKING_PATTERN (they represent deep understanding)
 * - Track which member IDs they were consolidated from
 * - Members continue to exist but are marked as consolidated
 */
async function runConsolidation() {
  const clusters = findClusters();
  if (clusters.length === 0) {
    return { consolidated: 0, insights: [] };
  }

  const data = loadLearnings();
  const results = [];

  for (const cluster of clusters) {
    const insight = await consolidateCluster(cluster);
    if (!insight) continue;

    // Calculate starting confidence as average of members
    const avgConf = cluster.members.reduce((s, m) => s + m.confidence, 0) / cluster.members.length;
    const totalEvidence = cluster.members.reduce((s, m) => s + m.evidence_count, 0);

    // Collect unique areas from members
    const areas = [...new Set(cluster.members.flatMap((m) => m.areas || [m.area || "general"]))];

    // Create the consolidated learning
    const consolidated = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      text: insight,
      confidence: Math.min(0.95, avgConf + 0.05), // slight boost — consolidation = validation
      evidence_count: totalEvidence,
      scope: "global", // consolidated insights are always global
      classification: "THINKING_PATTERN",
      area: areas[0] || "architecture",
      areas,
      first_seen: new Date().toISOString(),
      last_reinforced: new Date().toISOString(),
      decay_weight: 1.0,
      archived: false,
      promoted: false,
      detection_method: "consolidation",
      consolidated_from_group: cluster.group_id,
      consolidated_from_ids: cluster.members.map((m) => m.id),
      evidence: cluster.members.flatMap((m) => m.evidence || []).slice(-10),
    };

    data.learnings.push(consolidated);

    // Mark members as having been consolidated (they still exist, still active,
    // but won't trigger another consolidation for this group)
    for (const member of cluster.members) {
      const found = data.learnings.find((l) => l.id === member.id);
      if (found) {
        found.consolidated_into = consolidated.id;
      }
    }

    results.push({
      group: cluster.group_id,
      fragments: cluster.texts,
      insight,
      confidence: consolidated.confidence,
    });

    log(`Consolidated [${cluster.group_id}]: "${insight}" from ${cluster.members.length} fragments`);
  }

  if (results.length > 0) {
    saveLearnings(data);
  }

  return { consolidated: results.length, insights: results };
}

/**
 * Check if consolidation should run.
 * Conditions:
 * - At least 6 active learnings (enough to have clusters)
 * - Haven't consolidated in the last 5 sessions
 */
function shouldConsolidate() {
  const data = loadLearnings();
  const active = data.learnings.filter((l) => !l.archived && !l.promoted);

  if (active.length < 6) return false;

  const lastConsolidation = data.meta?.last_consolidation;
  if (lastConsolidation) {
    const sessionsSince = (data.meta.total_sessions || 0) - (data.meta.consolidation_session || 0);
    if (sessionsSince < 5) return false;
  }

  // Check if there are any unclustered groups
  const clusters = findClusters();
  return clusters.length > 0;
}

function markConsolidationRun() {
  const data = loadLearnings();
  data.meta.last_consolidation = new Date().toISOString();
  data.meta.consolidation_session = data.meta.total_sessions || 0;
  saveLearnings(data);
}

module.exports = { findClusters, consolidateCluster, runConsolidation, shouldConsolidate, markConsolidationRun };
