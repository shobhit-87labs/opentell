const fs = require("fs");
const { paths, ensureDir, log } = require("./config");

// ─── Starting confidence matrix ────────────────────────────────────────
// Based on classification type × LLM certainty.
// THINKING_PATTERN and DESIGN_PRINCIPLE start higher because they
// represent deeper signals that are almost always reusable.
// PREFERENCE starts at the standard level.
// BEHAVIORAL_GAP starts lower — needs more evidence.
//
// Regex detections always get high certainty (user was explicit).
//
const START_CONFIDENCE = {
  THINKING_PATTERN:  { high: 0.38, low: 0.28 },
  DESIGN_PRINCIPLE:  { high: 0.38, low: 0.28 },
  QUALITY_STANDARD:  { high: 0.35, low: 0.25 },
  PREFERENCE:        { high: 0.35, low: 0.25 },
  BEHAVIORAL_GAP:    { high: 0.30, low: 0.20 },
};

const ACTIVATION_THRESHOLD = 0.45;
const PROMOTION_THRESHOLD = 0.80;
const PROMOTION_MIN_EVIDENCE = 4;
const ARCHIVE_THRESHOLD = 0.15;

// ─── Core CRUD ─────────────────────────────────────────────────────────

function loadLearnings() {
  ensureDir();
  if (!fs.existsSync(paths.db)) {
    const empty = { learnings: [], meta: { total_sessions: 0 } };
    fs.writeFileSync(paths.db, JSON.stringify(empty, null, 2));
    return empty;
  }
  try {
    return JSON.parse(fs.readFileSync(paths.db, "utf-8"));
  } catch {
    return { learnings: [], meta: { total_sessions: 0 } };
  }
}

function saveLearnings(data) {
  ensureDir();
  fs.writeFileSync(paths.db, JSON.stringify(data, null, 2));
}

// ─── Add / Reinforce / Contradict ──────────────────────────────────────

function addCandidate(learning) {
  const data = loadLearnings();

  const newCore = extractCore(learning.text);
  const newPrefix = extractPrefix(learning.text);

  // If this developer correction aligns with an existing inferred observation,
  // the observation is now validated — promote it to an active candidate.
  const alignedInferred = data.learnings.find(
    (l) => !l.archived && l.inferred && similarity(extractCore(l.text), newCore) > 0.7
  );
  if (alignedInferred) {
    alignedInferred.inferred = false;
    alignedInferred.confidence = Math.max(alignedInferred.confidence + 0.25, ACTIVATION_THRESHOLD);
    alignedInferred.aligned_with = learning.text;
    alignedInferred.aligned_at = new Date().toISOString();
    alignedInferred.detection_method = "claude_observation_validated";
    log(`Inferred validated by correction: "${alignedInferred.text}" → conf ${alignedInferred.confidence.toFixed(2)}`);
  }

  // Check for semantic duplicates → reinforce
  const existing = data.learnings.find((l) => {
    if (l.archived) return false;
    const existingCore = extractCore(l.text);
    const existingPrefix = extractPrefix(l.text);
    const sameCore =
      existingCore === newCore ||
      l.text.toLowerCase() === learning.text.toLowerCase() ||
      similarity(existingCore, newCore) > 0.7;
    if (!sameCore) return false;
    if (prefixContradicts(existingPrefix, newPrefix)) return false;
    return true;
  });

  if (existing) {
    existing.evidence_count += 1;
    existing.last_reinforced = new Date().toISOString();
    existing.confidence = Math.min(1.0, existing.confidence + 0.15);
    existing.decay_weight = 1.0;
    // Upgrade classification if new signal is deeper
    if (isDeeper(learning.classification, existing.classification)) {
      existing.classification = learning.classification;
      if (learning.text.length > existing.text.length) {
        existing.text = learning.text; // keep the richer description
      }
    }
    // Merge area if different
    if (learning.area && !existing.areas?.includes(learning.area)) {
      existing.areas = existing.areas || [existing.area || "general"];
      if (!existing.areas.includes(learning.area)) {
        existing.areas.push(learning.area);
      }
    }
    existing.evidence.push({
      claude_said: learning.evidence?.claude_said || "",
      user_said: learning.evidence?.user_said || "",
      error_context: learning.evidence?.error_context || "",
      detected_at: new Date().toISOString(),
      detection_method: learning.detection_method || "regex",
    });
    if (existing.evidence.length > 10) existing.evidence = existing.evidence.slice(-10);
    log(`Reinforced: "${existing.text}" → conf ${existing.confidence.toFixed(2)}`);
  } else {
    // Check contradictions
    const contradicted = findContradictions(data.learnings, learning.text);
    for (const old of contradicted) {
      old.archived = true;
      old.archived_reason = `Superseded by: "${learning.text}"`;
      old.archived_at = new Date().toISOString();
      log(`Archived (contradicted): "${old.text}" → replaced by "${learning.text}"`);
    }

    // Compute starting confidence
    const cls = learning.classification || "PREFERENCE";
    const certainty = learning.certainty || "high";
    const confMap = START_CONFIDENCE[cls] || START_CONFIDENCE.PREFERENCE;
    const startConf = learning.confidence || confMap[certainty] || confMap.high;

    const entry = {
      id: generateId(),
      text: learning.text,
      confidence: startConf,
      evidence_count: 1,
      scope: learning.scope || "repo",
      scope_key: learning.scope_key || "",
      classification: cls,
      area: learning.area || "general",
      areas: [learning.area || "general"],
      first_seen: new Date().toISOString(),
      last_reinforced: new Date().toISOString(),
      decay_weight: 1.0,
      archived: false,
      promoted: false,
      detection_method: learning.detection_method || "regex",
      evidence: [
        {
          claude_said: learning.evidence?.claude_said || "",
          user_said: learning.evidence?.user_said || "",
          error_context: learning.evidence?.error_context || "",
          detected_at: new Date().toISOString(),
          detection_method: learning.detection_method || "regex",
        },
      ],
    };
    data.learnings.push(entry);
    log(`New candidate [${cls}/${learning.area || "general"}]: "${entry.text}" (start: ${startConf})`);
  }

  saveLearnings(data);
  return data;
}

// ─── Queries ───────────────────────────────────────────────────────────

function getActiveLearnings(threshold = ACTIVATION_THRESHOLD) {
  const data = loadLearnings();
  return data.learnings.filter(
    // inferred learnings are excluded — they haven't been validated yet
    (l) => !l.archived && !l.promoted && !l.inferred && l.confidence >= threshold
  );
}

function getAllLearnings() {
  const data = loadLearnings();
  return data.learnings.filter((l) => !l.archived);
}

// ─── Observation Layer ──────────────────────────────────────────────────────

/**
 * Store a Claude-generated observation as an inferred learning.
 *
 * Inferred learnings start with low confidence (0.15–0.25) and are excluded
 * from context injection until the developer validates them (explicitly via
 * `opentell accept`, implicitly via a matching correction, or passively
 * through repeated sessions without contradiction).
 */
function addObservation(obs) {
  const data = loadLearnings();
  const newCore = extractCore(obs.text);

  // If this observation matches a regular (non-inferred) learning, just
  // add a small corroboration boost — the learning already exists.
  const existingRegular = data.learnings.find(
    (l) => !l.archived && !l.inferred && similarity(extractCore(l.text), newCore) > 0.7
  );
  if (existingRegular) {
    existingRegular.confidence = Math.min(1.0, existingRegular.confidence + 0.03);
    existingRegular.observation_corroborations = (existingRegular.observation_corroborations || 0) + 1;
    log(`Observation corroborates existing: "${existingRegular.text}" → conf ${existingRegular.confidence.toFixed(2)}`);
    saveLearnings(data);
    return;
  }

  // If this matches an existing inferred learning, reinforce it.
  const existingInferred = data.learnings.find(
    (l) => !l.archived && l.inferred && similarity(extractCore(l.text), newCore) > 0.7
  );
  if (existingInferred) {
    existingInferred.confidence = Math.min(existingInferred.confidence + 0.05, 0.44);
    existingInferred.evidence_count += 1;
    existingInferred.last_reinforced = new Date().toISOString();
    log(`Inferred reinforced: "${existingInferred.text}" → conf ${existingInferred.confidence.toFixed(2)}`);
    saveLearnings(data);
    return;
  }

  // New inferred learning.
  const entry = {
    id: generateId(),
    text: obs.text,
    confidence: obs.confidence || 0.20,
    evidence_count: 1,
    scope: obs.scope || "repo",
    classification: obs.classification || "PREFERENCE",
    area: obs.area || "general",
    areas: [obs.area || "general"],
    first_seen: new Date().toISOString(),
    last_reinforced: new Date().toISOString(),
    decay_weight: 1.0,
    archived: false,
    promoted: false,
    inferred: true,
    observation_type: obs.observation_type || "project_observation",
    detection_method: "claude_observation",
    evidence: [
      {
        // Store only the extracted observation snippet, not raw code
        observation: obs.evidence?.observation || "",
        detected_at: new Date().toISOString(),
      },
    ],
  };
  data.learnings.push(entry);
  log(`New inferred [${entry.classification}/${entry.area}]: "${entry.text}" (conf: ${entry.confidence})`);
  saveLearnings(data);
}

/**
 * Return all unvalidated inferred learnings (not archived, not promoted).
 */
function getInferredLearnings() {
  const data = loadLearnings();
  return data.learnings.filter((l) => !l.archived && !l.promoted && l.inferred);
}

/**
 * Accept an inferred learning: promote to active candidate.
 * Clears the inferred flag and boosts confidence to the activation threshold.
 */
function acceptObservation(id) {
  const data = loadLearnings();
  const learning = data.learnings.find((l) => l.id === id);
  if (!learning || !learning.inferred || learning.archived) return null;

  learning.inferred = false;
  learning.confidence = Math.max(learning.confidence + 0.25, ACTIVATION_THRESHOLD);
  learning.accepted_at = new Date().toISOString();
  learning.detection_method = "claude_observation_accepted";
  saveLearnings(data);
  log(`Accepted inferred: "${learning.text}" → conf ${learning.confidence.toFixed(2)}`);
  return learning;
}

/**
 * Reject an inferred learning: archive it immediately.
 */
function rejectObservation(id) {
  const data = loadLearnings();
  const learning = data.learnings.find((l) => l.id === id);
  if (!learning || !learning.inferred || learning.archived) return null;

  learning.archived = true;
  learning.archived_reason = "Rejected by developer";
  learning.archived_at = new Date().toISOString();
  saveLearnings(data);
  log(`Rejected inferred: "${learning.text}"`);
  return learning;
}

/**
 * Apply passive accumulation to inferred learnings at session end.
 * Small confidence bump when no contradiction was detected this session.
 * Capped below the activation threshold — explicit validation still required.
 */
function applyPassiveAccumulation() {
  const data = loadLearnings();
  let changed = false;

  for (const l of data.learnings) {
    if (!l.inferred || l.archived || l.promoted) continue;
    // +0.03 per session, capped at 0.44 (just below the 0.45 activation threshold)
    l.confidence = Math.min(l.confidence + 0.03, 0.44);
    l.last_reinforced = new Date().toISOString();
    changed = true;
  }

  if (changed) {
    saveLearnings(data);
    log("Applied passive accumulation to inferred learnings");
  }
}

function getPromotable() {
  const data = loadLearnings();
  return data.learnings.filter(
    (l) =>
      !l.archived &&
      !l.promoted &&
      l.confidence >= PROMOTION_THRESHOLD &&
      l.evidence_count >= PROMOTION_MIN_EVIDENCE
  );
}

function markPromoted(ids) {
  const data = loadLearnings();
  const idSet = new Set(ids);
  for (const l of data.learnings) {
    if (idSet.has(l.id)) {
      l.promoted = true;
      l.promoted_at = new Date().toISOString();
    }
  }
  saveLearnings(data);
}

function removeLearning(index) {
  const data = loadLearnings();
  const active = data.learnings.filter((l) => !l.archived);
  if (index >= 0 && index < active.length) {
    const target = active[index];
    const realIdx = data.learnings.findIndex((l) => l.id === target.id);
    if (realIdx !== -1) {
      data.learnings[realIdx].archived = true;
      saveLearnings(data);
      return target;
    }
  }
  return null;
}

// ─── Decay ─────────────────────────────────────────────────────────────

function applyDecay() {
  const data = loadLearnings();
  const now = Date.now();
  let changed = false;

  for (const l of data.learnings) {
    if (l.archived || l.promoted) continue;
    const lastReinforced = new Date(l.last_reinforced).getTime();
    const daysSince = (now - lastReinforced) / (1000 * 60 * 60 * 24);

    if (daysSince > 30) {
      l.decay_weight *= 0.90;
      l.confidence *= l.decay_weight;
      changed = true;
    } else if (daysSince > 14) {
      l.decay_weight *= 0.95;
      l.confidence *= l.decay_weight;
      changed = true;
    }

    if (l.confidence < ARCHIVE_THRESHOLD) {
      l.archived = true;
      l.archived_reason = "Decayed below threshold";
      log(`Archived (decayed): "${l.text}"`);
      changed = true;
    }
  }

  if (changed) saveLearnings(data);
}

function incrementSessionCount() {
  const data = loadLearnings();
  data.meta.total_sessions = (data.meta.total_sessions || 0) + 1;
  saveLearnings(data);
}

function resetAll() {
  saveLearnings({ learnings: [], meta: { total_sessions: 0 } });
}

// ─── WAL (Write-Ahead Log) ────────────────────────────────────────────
// Pairs are written to a JSONL file BEFORE the background classifier
// is spawned. If the classifier crashes or machine sleeps, pairs survive.
// The SessionEnd hook drains anything left.

function appendWal(pair) {
  ensureDir();
  const line = JSON.stringify({
    ...pair,
    written_at: new Date().toISOString(),
  });
  fs.appendFileSync(paths.wal, line + "\n");
}

function drainWal() {
  if (!fs.existsSync(paths.wal)) return [];
  try {
    const raw = fs.readFileSync(paths.wal, "utf-8").trim();
    if (!raw) return [];
    const lines = raw.split("\n").filter(Boolean);
    return lines.map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function clearWal() {
  try {
    if (fs.existsSync(paths.wal)) fs.writeFileSync(paths.wal, "");
  } catch {}
}

function removeFromWal(pair) {
  // Remove a specific pair from WAL after successful classification.
  // Match on written_at timestamp.
  const entries = drainWal();
  const remaining = entries.filter((e) => e.written_at !== pair.written_at);
  try {
    fs.writeFileSync(paths.wal, remaining.map((e) => JSON.stringify(e)).join("\n") + (remaining.length ? "\n" : ""));
  } catch {}
}

// ─── Session buffer ────────────────────────────────────────────────────

function loadBuffer() {
  ensureDir();
  if (!fs.existsSync(paths.buffer)) return { session_id: null, signals: [], pairs: [] };
  try {
    return JSON.parse(fs.readFileSync(paths.buffer, "utf-8"));
  } catch {
    return { session_id: null, signals: [], pairs: [] };
  }
}

function saveBuffer(buf) {
  ensureDir();
  fs.writeFileSync(paths.buffer, JSON.stringify(buf, null, 2));
}

function clearBuffer() {
  saveBuffer({ session_id: null, signals: [], pairs: [] });
}

// ─── Helpers ───────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function similarity(a, b) {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function extractCore(text) {
  return text
    .toLowerCase()
    .replace(/^(uses?|prefers?|team uses?|user prefers? to|project convention:|avoids?|files go in|thinks in|designs? |values? |expects? |code isn't done until)\s*/i, "")
    .replace(/\s*—\s*.*$/, "") // strip the explanation after em-dash
    .replace(/\s+/g, " ")
    .trim();
}

function extractPrefix(text) {
  const lower = text.toLowerCase().trim();
  if (lower.startsWith("avoids") || lower.startsWith("avoid")) return "avoids";
  if (lower.startsWith("uses") || lower.startsWith("use")) return "uses";
  if (lower.startsWith("prefers") || lower.startsWith("prefer")) return "prefers";
  return "other";
}

function prefixContradicts(a, b) {
  if (a === b) return false;
  return (a === "avoids" && b === "uses") || (a === "uses" && b === "avoids");
}

/**
 * Determine if classification A is "deeper" than classification B.
 * THINKING_PATTERN > DESIGN_PRINCIPLE > QUALITY_STANDARD > BEHAVIORAL_GAP > PREFERENCE
 */
const DEPTH_ORDER = {
  THINKING_PATTERN: 5,
  DESIGN_PRINCIPLE: 4,
  QUALITY_STANDARD: 3,
  BEHAVIORAL_GAP: 2,
  PREFERENCE: 1,
};

function isDeeper(a, b) {
  return (DEPTH_ORDER[a] || 0) > (DEPTH_ORDER[b] || 0);
}

// ─── Contradiction detection ───────────────────────────────────────────

function findContradictions(learnings, newText) {
  const contradicted = [];
  const newLower = newText.toLowerCase();
  const newCore = extractCore(newText);

  for (const existing of learnings) {
    if (existing.archived) continue;
    const oldCore = extractCore(existing.text);
    const oldLower = existing.text.toLowerCase();

    // 1. "X instead of Y"
    const insteadMatch = newLower.match(/instead of\s+(\S+)/);
    if (insteadMatch) {
      const replaced = insteadMatch[1].replace(/[.,]$/, "");
      // Use word-boundary check to avoid substring matches (pnpm contains npm)
      const wordRegex = new RegExp(`\\b${replaced}\\b`);
      if (wordRegex.test(oldCore) && !oldCore.includes(replaced + " instead")) {
        contradicted.push(existing);
        continue;
      }
    }

    // 2. Same tool category, different tool
    const oldTool = identifyTool(oldCore);
    const newTool = identifyTool(newCore);
    if (oldTool && newTool && oldTool.category === newTool.category && oldTool.name !== newTool.name) {
      contradicted.push(existing);
      continue;
    }

    // 3. Style opposites
    if (areStyleOpposites(oldLower, newLower)) {
      contradicted.push(existing);
      continue;
    }

    // 4. Avoids ↔ Uses flip
    const oldAvoidsMatch = oldLower.match(/avoids?\s+(.+)/);
    if (oldAvoidsMatch && similarity(oldAvoidsMatch[1], newCore) > 0.6) {
      contradicted.push(existing);
      continue;
    }
    const newAvoidsMatch = newLower.match(/avoids?\s+(.+)/);
    if (newAvoidsMatch && similarity(newAvoidsMatch[1], oldCore) > 0.6) {
      contradicted.push(existing);
      continue;
    }
  }

  return contradicted;
}

const TOOL_CATEGORIES = {
  "npm": "package_manager", "pnpm": "package_manager", "yarn": "package_manager", "bun": "package_manager",
  "jest": "test_framework", "vitest": "test_framework", "mocha": "test_framework", "pytest": "test_framework",
  "playwright": "e2e_testing", "cypress": "e2e_testing",
  "eslint": "linter", "biome": "linter", "prettier": "formatter", "ruff": "linter", "black": "formatter",
  "react": "ui_framework", "vue": "ui_framework", "svelte": "ui_framework", "angular": "ui_framework",
  "nextjs": "meta_framework", "next.js": "meta_framework", "nuxt": "meta_framework", "remix": "meta_framework", "astro": "meta_framework",
  "express": "server_framework", "hono": "server_framework", "fastapi": "server_framework", "flask": "server_framework", "django": "server_framework",
  "supabase": "backend_service", "firebase": "backend_service",
  "postgres": "database", "mysql": "database", "sqlite": "database", "mongo": "database",
  "prisma": "orm", "drizzle": "orm", "typeorm": "orm",
  "tailwind": "css_framework", "bootstrap": "css_framework",
};

function identifyTool(text) {
  const words = text.split(/[\s,./]+/);
  for (const word of words) {
    const clean = word.toLowerCase().replace(/[^a-z0-9.]/g, "");
    if (TOOL_CATEGORIES[clean]) return { name: clean, category: TOOL_CATEGORIES[clean] };
  }
  return null;
}

const STYLE_OPPOSITES = [
  [/concise|shorter|brief|less verbose|minimal/, /verbose|detailed|thorough|comprehensive|more explanation/],
  [/code.?first|just.*(the )?code|skip.*(the )?explanation/, /explain|walk.*through|detailed explanation/],
  [/minimal.*comment|no comment|skip.*comment|fewer comment/, /add.*comment|more comment|well.?commented|document/],
  [/functional.*component/, /class.*component|class.?based/],
  [/named.*export/, /default.*export/],
  [/strict.*typ|add.*type/, /avoid.*type|no.*type|skip.*type/],
  [/simplicity|keep.*simple|don't over.?engineer/, /plan.*ahead|design.*scale|future.?proof/],
  [/\bprototypes?\b.*\bfirst\b|rough.*version|\bmvp\b/, /\bplans?\b.*\bfirst\b|\bdesigns?\b.*(?:up ?front|before\b)|\bspec\b.*\bfirst\b/],
];

function areStyleOpposites(a, b) {
  for (const [p1, p2] of STYLE_OPPOSITES) {
    if ((p1.test(a) && p2.test(b)) || (p2.test(a) && p1.test(b))) return true;
  }
  return false;
}

module.exports = {
  loadLearnings, saveLearnings,
  addCandidate, getActiveLearnings, getAllLearnings,
  getPromotable, markPromoted,
  removeLearning, applyDecay, incrementSessionCount, resetAll,
  appendWal, drainWal, clearWal, removeFromWal,
  loadBuffer, saveBuffer, clearBuffer,
  addObservation, getInferredLearnings, acceptObservation, rejectObservation,
  applyPassiveAccumulation,
  ACTIVATION_THRESHOLD, PROMOTION_THRESHOLD,
};
