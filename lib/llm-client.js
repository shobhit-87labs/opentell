/**
 * Provider-agnostic LLM client for OpenTell.
 * Supports Anthropic and any OpenAI-compatible endpoint (Gemini, Groq, OpenAI, etc.).
 */

const { log } = require("./config");

/**
 * Check whether LLM calls can be made with the given config.
 */
function isLLMAvailable(config) {
  const provider = config.llm_provider || "anthropic";
  if (provider === "anthropic") {
    return !!(config.anthropic_api_key);
  }
  // openai_compatible
  return !!(config.llm_api_key && config.llm_base_url);
}

/**
 * Make a single LLM call, abstracting over provider differences.
 *
 * @param {object} opts
 * @param {string} opts.callType   - e.g. "classification", "dedup", "consolidation", "synthesis"
 * @param {string} opts.model      - model identifier
 * @param {string} [opts.system]   - system prompt (optional)
 * @param {Array}  opts.messages   - array of { role, content } objects
 * @param {number} opts.maxTokens  - max tokens to generate
 * @param {object} opts.config     - loaded config object
 * @returns {Promise<{ text: string, usage: { input_tokens: number, output_tokens: number } }>}
 */
async function callLLM({ callType, model, system, messages, maxTokens, config }) {
  const provider = config.llm_provider || "anthropic";

  if (provider === "anthropic") {
    return callAnthropic({ model, system, messages, maxTokens, config });
  } else {
    return callOpenAICompatible({ model, system, messages, maxTokens, config });
  }
}

async function callAnthropic({ model, system, messages, maxTokens, config }) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages,
  };
  if (system) body.system = system;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.anthropic_api_key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return {
    text,
    usage: {
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    },
  };
}

async function callOpenAICompatible({ model, system, messages, maxTokens, config }) {
  const baseUrl = config.llm_base_url.replace(/\/$/, "");

  // Prepend system message if provided
  const allMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : [...messages];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.llm_api_key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: allMessages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI-compatible API ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content?.trim() || "";

  return {
    text,
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
  };
}

module.exports = { callLLM, isLLMAvailable };
