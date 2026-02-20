const fs = require("fs");
const path = require("path");
const { getPromotable, markPromoted } = require("./store");
const { log } = require("./config");

const INSTINCT_HEADER = "# OpenTell — Learned Preferences";
const INSTINCT_START = "<!-- opentell:start -->";
const INSTINCT_END = "<!-- opentell:end -->";

/**
 * Find the project root by looking for common markers.
 * Walks up from cwd until it finds one.
 */
function findProjectRoot() {
  const markers = [
    "package.json", ".git", "Cargo.toml", "pyproject.toml",
    "go.mod", "Makefile", "Gemfile", "pom.xml", "build.gradle",
  ];

  let dir = process.cwd();
  const root = path.parse(dir).root;

  while (dir !== root) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(dir, marker))) {
        return dir;
      }
    }
    dir = path.dirname(dir);
  }

  // Fallback to cwd
  return process.cwd();
}

/**
 * Promote high-confidence learnings to CLAUDE.md.
 * 
 * Inserts them in a fenced section so OpenTell can update without
 * touching user-written content.
 * 
 * Returns { promoted: [...], claudeMdPath: string }
 */
function promoteToClaudeMd(projectRoot = null, learningsOverride = null) {
  const root = projectRoot || findProjectRoot();
  const claudeMdPath = path.join(root, "CLAUDE.md");
  const promotable = learningsOverride || getPromotable();

  if (promotable.length === 0) {
    return { promoted: [], claudeMdPath, message: "No learnings ready for promotion." };
  }

  // Build the opentell section content
  const sectionLines = [];
  sectionLines.push(INSTINCT_HEADER);
  sectionLines.push("");
  sectionLines.push("These preferences were automatically discovered by OpenTell from your corrections.");
  sectionLines.push("Edit or remove as needed — this section is yours.");
  sectionLines.push("");

  // Group by classification
  const thinking = promotable.filter((l) => l.classification === "THINKING_PATTERN");
  const design = promotable.filter((l) => l.classification === "DESIGN_PRINCIPLE");
  const quality = promotable.filter((l) => l.classification === "QUALITY_STANDARD");
  const prefs = promotable.filter((l) => l.classification === "PREFERENCE" || !l.classification);
  const gaps = promotable.filter((l) => l.classification === "BEHAVIORAL_GAP");

  if (thinking.length > 0) {
    sectionLines.push("## How We Build");
    for (const l of thinking) sectionLines.push(`- ${l.text}`);
    sectionLines.push("");
  }

  if (design.length > 0) {
    sectionLines.push("## Architecture");
    for (const l of design) sectionLines.push(`- ${l.text}`);
    sectionLines.push("");
  }

  if (quality.length > 0) {
    sectionLines.push("## Quality Standards");
    for (const l of quality) sectionLines.push(`- ${l.text}`);
    sectionLines.push("");
  }

  if (prefs.length > 0) {
    sectionLines.push("## Conventions");
    for (const l of prefs) sectionLines.push(`- ${l.text}`);
    sectionLines.push("");
  }

  if (gaps.length > 0) {
    sectionLines.push("## Common Gaps to Watch");
    for (const l of gaps) sectionLines.push(`- ${l.text}`);
    sectionLines.push("");
  }

  const instinctBlock = `${INSTINCT_START}\n${sectionLines.join("\n")}${INSTINCT_END}`;

  // Read existing CLAUDE.md or create new
  let existing = "";
  if (fs.existsSync(claudeMdPath)) {
    existing = fs.readFileSync(claudeMdPath, "utf-8");
  }

  let newContent;

  if (existing.includes(INSTINCT_START) && existing.includes(INSTINCT_END)) {
    // Replace existing opentell section
    const startIdx = existing.indexOf(INSTINCT_START);
    const endIdx = existing.indexOf(INSTINCT_END) + INSTINCT_END.length;
    newContent = existing.slice(0, startIdx) + instinctBlock + existing.slice(endIdx);
  } else if (existing.trim()) {
    // Append to existing CLAUDE.md
    newContent = existing.trimEnd() + "\n\n" + instinctBlock + "\n";
  } else {
    // Create new CLAUDE.md
    newContent = instinctBlock + "\n";
  }

  fs.writeFileSync(claudeMdPath, newContent);

  // Mark as promoted in the store
  const promotedIds = promotable.map((l) => l.id);
  markPromoted(promotedIds);

  log(`Promoted ${promotable.length} learnings to ${claudeMdPath}`);

  return {
    promoted: promotable,
    claudeMdPath,
    message: `Promoted ${promotable.length} learning(s) to ${claudeMdPath}`,
  };
}

/**
 * Preview what would be promoted without writing anything.
 */
function previewPromotion() {
  const promotable = getPromotable();
  const root = findProjectRoot();
  const claudeMdPath = path.join(root, "CLAUDE.md");
  const exists = fs.existsSync(claudeMdPath);

  return {
    promotable,
    claudeMdPath,
    claudeMdExists: exists,
  };
}

module.exports = { promoteToClaudeMd, previewPromotion, findProjectRoot };
