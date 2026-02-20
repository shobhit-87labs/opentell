const fs = require("fs");
const { log } = require("./config");

/**
 * Parse a Claude Code JSONL transcript file into structured messages.
 * Returns array of { role, text } objects with only human-readable content.
 */
function parseTranscript(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) {
    log(`Transcript not found: ${transcriptPath}`);
    return [];
  }

  const raw = fs.readFileSync(transcriptPath, "utf-8").trim();
  if (!raw) return [];

  const messages = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const parsed = extractMessage(entry);
      if (parsed) messages.push(parsed);
    } catch (e) {
      // Skip malformed lines
    }
  }

  return messages;
}

/**
 * Extract a readable message from a transcript entry.
 * Filters out tool_use, tool_result, and system messages.
 */
function extractMessage(entry) {
  const role = entry.role || entry.type;
  if (!role) return null;

  // Normalize role names
  const normalizedRole =
    role === "human" || role === "user" ? "user" :
    role === "assistant" ? "assistant" : null;

  if (!normalizedRole) return null;

  // Extract text content
  let text = "";

  if (typeof entry.content === "string") {
    text = entry.content;
  } else if (Array.isArray(entry.content)) {
    // Filter to only text blocks (skip tool_use, tool_result, images, etc.)
    const textBlocks = entry.content.filter(
      (block) => block.type === "text" && block.text
    );
    text = textBlocks.map((b) => b.text).join("\n");
  } else if (entry.message && typeof entry.message.content === "string") {
    text = entry.message.content;
  } else if (entry.message && Array.isArray(entry.message.content)) {
    const textBlocks = entry.message.content.filter(
      (block) => block.type === "text" && block.text
    );
    text = textBlocks.map((b) => b.text).join("\n");
  }

  // Skip empty or very short messages (likely tool results)
  if (!text || text.trim().length < 3) return null;

  return { role: normalizedRole, text: text.trim() };
}

/**
 * Extract (assistant, user) turn pairs for analysis.
 * We want pairs where the user responded to something Claude said.
 * Returns: [{ claude_said, user_said, turn_index }]
 */
function extractTurnPairs(messages) {
  const pairs = [];

  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === "assistant" && messages[i + 1].role === "user") {
      pairs.push({
        claude_said: messages[i].text,
        user_said: messages[i + 1].text,
        turn_index: i,
      });
    }
  }

  return pairs;
}

/**
 * Get the last N turn pairs from a transcript.
 */
function getLastPairs(transcriptPath, n = 1) {
  const messages = parseTranscript(transcriptPath);
  const pairs = extractTurnPairs(messages);
  return pairs.slice(-n);
}

/**
 * Get all turn pairs from a transcript.
 */
function getAllPairs(transcriptPath) {
  const messages = parseTranscript(transcriptPath);
  return extractTurnPairs(messages);
}

module.exports = { parseTranscript, extractTurnPairs, getLastPairs, getAllPairs };
