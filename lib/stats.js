const fs = require("fs");
const { paths, ensureDir } = require("./config");

// ─── Pricing (USD per million tokens) ─────────────────────────────────────────
// Source: https://platform.claude.com/docs/en/about-claude/pricing
// Last updated: 2026-02
// Update here when Anthropic changes pricing — this is the only pricing table
// in the codebase. Patterns are checked top-to-bottom; first match wins.
const PRICING_TABLE = [
  // Haiku 4.x (e.g. claude-haiku-4-5-20251001) — $1.00/$5.00
  { pattern: /haiku-4/,      input: 1.00,  output: 5.00  },
  // Haiku 3.5 (e.g. claude-haiku-3-5-20241022) — $0.80/$4.00
  { pattern: /haiku-3-5/,    input: 0.80,  output: 4.00  },
  // Haiku 3 (e.g. claude-haiku-3-20240307) — $0.25/$1.25
  { pattern: /haiku/,        input: 0.25,  output: 1.25  },
  // Opus 4.5, 4.6 (e.g. claude-opus-4-5, claude-opus-4-6) — $5.00/$25.00
  { pattern: /opus-4-[56]/,  input: 5.00,  output: 25.00 },
  // Opus 4.1 and older Opus (e.g. claude-opus-4-1, claude-opus-4, claude-opus-3) — $15.00/$75.00
  { pattern: /opus/,         input: 15.00, output: 75.00 },
  // Sonnet any version (e.g. claude-sonnet-4-6, claude-sonnet-4-5) — $3.00/$15.00
  { pattern: /sonnet/,       input: 3.00,  output: 15.00 },
  // Unknown / future models — default to Sonnet pricing (conservative)
  { pattern: /.*/,           input: 3.00,  output: 15.00 },
];

// Flat reference used by formatStats() for the pricing footer line
const PRICING = PRICING_TABLE;

function getPricing(model) {
  const m = (model || "").toLowerCase();
  return PRICING_TABLE.find((row) => row.pattern.test(m)) || PRICING_TABLE.at(-1);
}

function computeCost(model, inputTokens, outputTokens) {
  const p = getPricing(model);
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

function emptyStats() {
  return {
    total_calls: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cost_usd: 0,
    by_type: {},
    by_month: {},
  };
}

function loadStats() {
  ensureDir();
  if (!fs.existsSync(paths.stats)) return emptyStats();
  try {
    return JSON.parse(fs.readFileSync(paths.stats, "utf-8"));
  } catch {
    return emptyStats();
  }
}

function saveStats(data) {
  ensureDir();
  fs.writeFileSync(paths.stats, JSON.stringify(data, null, 2));
}

/**
 * Record an API call. Called from classifier, profiler, and consolidator
 * after each successful Anthropic API response.
 *
 * @param {"classification"|"synthesis"|"consolidation"} type
 * @param {string} model — model ID used for the call
 * @param {{ input_tokens: number, output_tokens: number }} usage — from API response body
 */
function recordCall(type, model, usage) {
  try {
    const inputTokens  = usage?.input_tokens  || 0;
    const outputTokens = usage?.output_tokens || 0;
    const cost  = computeCost(model, inputTokens, outputTokens);
    const month = new Date().toISOString().slice(0, 7); // "2024-01"

    const data = loadStats();

    data.total_calls         = (data.total_calls         || 0) + 1;
    data.total_input_tokens  = (data.total_input_tokens  || 0) + inputTokens;
    data.total_output_tokens = (data.total_output_tokens || 0) + outputTokens;
    data.total_cost_usd      = (data.total_cost_usd      || 0) + cost;

    if (!data.by_type[type]) {
      data.by_type[type] = { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    }
    data.by_type[type].calls         += 1;
    data.by_type[type].input_tokens  += inputTokens;
    data.by_type[type].output_tokens += outputTokens;
    data.by_type[type].cost_usd      += cost;

    if (!data.by_month[month]) {
      data.by_month[month] = { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    }
    data.by_month[month].calls         += 1;
    data.by_month[month].input_tokens  += inputTokens;
    data.by_month[month].output_tokens += outputTokens;
    data.by_month[month].cost_usd      += cost;

    saveStats(data);
  } catch {
    // Stats recording is best-effort — never break the main pipeline
  }
}

/**
 * Format stats for terminal display.
 */
function formatStats() {
  const data = loadStats();
  const lines = [];
  const bar = "─".repeat(58);

  lines.push("OpenTell — API Usage Stats");
  lines.push(bar);

  if (data.total_calls === 0) {
    lines.push("");
    lines.push("  No API calls recorded yet.");
    lines.push("  Stats are tracked once an Anthropic API key is configured");
    lines.push("  and Layer 2 classification has run (end of first session).");
    lines.push("");
    lines.push(bar);
    return lines.join("\n");
  }

  // ── All time ─────────────────────────────────────────────────────
  lines.push("");
  lines.push("All time:");
  lines.push(`  Calls:          ${fmt(data.total_calls)}`);
  lines.push(`  Input tokens:   ${fmt(data.total_input_tokens)}`);
  lines.push(`  Output tokens:  ${fmt(data.total_output_tokens)}`);
  lines.push(`  Total cost:     $${data.total_cost_usd.toFixed(4)}`);

  // ── By call type ──────────────────────────────────────────────────
  const TYPE_LABELS = {
    classification: "Classification  (Layer 2, per turn)",
    synthesis:      "Synthesis       (developer profile)",
    consolidation:  "Consolidation   (learning merges)  ",
  };

  const hasTypes = Object.keys(data.by_type).length > 0;
  if (hasTypes) {
    lines.push("");
    lines.push("By call type:");
    for (const [type, t] of Object.entries(data.by_type)) {
      const label = TYPE_LABELS[type] || type;
      lines.push(
        `  ${label}` +
        `   ${String(t.calls).padStart(4)} calls` +
        `   $${t.cost_usd.toFixed(4)}`
      );
    }
  }

  // ── Monthly breakdown ─────────────────────────────────────────────
  const months = Object.keys(data.by_month).sort().reverse().slice(0, 3);
  if (months.length > 0) {
    lines.push("");
    lines.push("Monthly:");
    for (const month of months) {
      const m = data.by_month[month];
      const label = month === new Date().toISOString().slice(0, 7)
        ? `${month} (this month)`
        : month;
      lines.push(
        `  ${label}  ` +
        `${fmt(m.calls)} calls  ·  ` +
        `${fmt(m.input_tokens + m.output_tokens)} tokens  ·  ` +
        `$${m.cost_usd.toFixed(4)}`
      );
    }
  }

  lines.push("");
  lines.push(bar);
  lines.push("Pricing (per MTok in/out): Haiku 4.5 $1.00/$5.00 · Haiku 3.5 $0.80/$4.00 · Sonnet $3.00/$15.00 · Opus 4.5/4.6 $5.00/$25.00");
  lines.push(`Stats file: ${paths.stats}`);

  return lines.join("\n");
}

function fmt(n) {
  return (n || 0).toLocaleString();
}

module.exports = { recordCall, loadStats, formatStats, PRICING, computeCost, getPricing };
