const OpenAI = require("openai");
const env = require("../config/env");
const logger = require("../config/logger");

// Uses an OpenAI-compatible chat completions endpoint (defaults to
// NaraRouter, config/env.js) -- any provider speaking that format works by
// changing LLM_BASE_URL/LLM_MODEL only.
//
// This system prompt is the enforcement point for "AI never decides":
// the model is told a decision already exists and is forbidden from
// changing or contradicting it. Nothing downstream trusts this prompt
// alone though -- decisionEngine.js re-validates any suggestedRewrite
// through the real securityEngine/policyEngine before using it.
const SYSTEM_PROMPT = `You are a security assistant embedded in a SQL gateway.
A decision has already been made by a separate rule engine. Do not change or
contradict the decision; only explain it and optionally suggest a safer
alternative query.

Respond with ONLY a JSON object, no markdown fences, no extra text, in
exactly this shape:
{"explanation": "1-2 sentence plain-language explanation of the risk", "suggestedRewrite": "a safer SQL query, or null if none applies"}`;

let cachedClient;

function getClient() {
  if (!env.LLM_API_KEY) return null;
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL });
  }
  return cachedClient;
}

function buildUserPrompt(parsedQuery, securityResult, policyResult) {
  return JSON.stringify(
    {
      query: parsedQuery.raw,
      operation: parsedQuery.operation,
      tablesReferenced: parsedQuery.tablesReferenced,
      hasWhereClause: parsedQuery.hasWhereClause,
      decisionAlreadyMade: {
        riskLevel: securityResult.riskLevel,
        securityReasons: securityResult.reasons,
        policyAllowed: policyResult.allowed,
        policyRequiresApproval: policyResult.requiresApproval,
        policyReasons: policyResult.reasons,
      },
    },
    null,
    2
  );
}

// Strips ```json fences some models add despite being told not to.
function stripCodeFences(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1] : text;
}

function parseAiResponse(text) {
  try {
    const parsed = JSON.parse(stripCodeFences(text.trim()));
    const explanation = typeof parsed.explanation === "string" ? parsed.explanation.trim() : null;
    const suggestedRewrite =
      typeof parsed.suggestedRewrite === "string" && parsed.suggestedRewrite.trim()
        ? parsed.suggestedRewrite.trim()
        : null;
    return { explanation: explanation || null, suggestedRewrite };
  } catch {
    return { explanation: null, suggestedRewrite: null };
  }
}

// Explanation-only. Returns { explanation, suggestedRewrite, error }, never
// anything resembling allow/block -- there is no field here a caller could
// mistake for a decision. Malformed/missing LLM output degrades to nulls
// rather than throwing, so a flaky AI call never breaks query processing.
async function getAiRiskExplanation(parsedQuery, securityResult, policyResult) {
  const client = getClient();
  if (!client) {
    return { explanation: null, suggestedRewrite: null, error: "AI engine not configured (missing LLM_API_KEY)" };
  }

  logger.info(
    { event: "ai_engine_called", operation: parsedQuery.operation, riskLevel: securityResult.riskLevel },
    "Calling AI engine for risk explanation"
  );

  try {
    const completion = await client.chat.completions.create({
      model: env.LLM_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(parsedQuery, securityResult, policyResult) },
      ],
    });

    const text = completion.choices?.[0]?.message?.content;
    if (!text) {
      logger.warn({ event: "ai_engine_empty_response" }, "AI engine returned an empty response");
      return { explanation: null, suggestedRewrite: null, error: "empty AI response" };
    }

    return { ...parseAiResponse(text), error: null };
  } catch (err) {
    logger.error({ event: "ai_engine_error", err: err.message }, "AI engine call failed");
    return { explanation: null, suggestedRewrite: null, error: err.message };
  }
}

module.exports = { getAiRiskExplanation };
