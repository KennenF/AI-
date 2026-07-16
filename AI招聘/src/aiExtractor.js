const { extractCandidatesByRules } = require("./ruleExtractor");
const { extractCandidatesByLlm } = require("./llmExtractor");

async function extractCandidates(text, config = {}) {
  const aiConfig = config.ai || {};
  const mode = aiConfig.mode || "rule";

  if (mode === "llm") {
    try {
      const candidates = await extractCandidatesByLlm(text, aiConfig);
      return {
        provider: "llm",
        fallback: false,
        candidates
      };
    } catch (error) {
      const candidates = extractCandidatesByRules(text);
      return {
        provider: "rule",
        requestedProvider: "llm",
        fallback: true,
        fallbackReason: error.message,
        candidates
      };
    }
  }

  return {
    provider: "rule",
    fallback: false,
    candidates: extractCandidatesByRules(text)
  };
}

module.exports = {
  extractCandidates
};
