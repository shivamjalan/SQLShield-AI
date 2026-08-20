const { runSecurityChecks } = require("./securityEngine");
const { checkPolicy } = require("./policyEngine");
const { getAiRiskExplanation } = require("./aiEngine");
const { parseQuery } = require("./parser");

// The single place that combines securityEngine + policyEngine +
// (conditionally) aiEngine into one final decision.
//
// AI's place in this function, precisely:
//  - CRITICAL (from securityEngine alone) -> BLOCK, function returns before
//    aiEngine is even required/imported-from at runtime.
//  - policy-blocked -> BLOCK, also returns before any AI call.
//  - LOW risk + policy allows + no approval needed -> ALLOW, also returns
//    before any AI call.
//  - Only the remaining case (MEDIUM/HIGH risk, or requiresApproval) calls
//    getAiRiskExplanation. Its `explanation` is stored as-is for the audit
//    log -- it never participates in `decision`. Its `suggestedRewrite` is
//    NOT trusted directly: it is re-parsed and re-run through
//    runSecurityChecks + checkPolicy (rewritePassesChecks below) exactly
//    like a fresh incoming query, and only flips decision to REWRITE if it
//    independently passes both. So even the one place AI output touches
//    `decision` at all, it does so only by satisfying the same
//    deterministic rules any human-submitted query would have to satisfy.
async function makeDecision(parsedQuery, userRole) {
  const security = runSecurityChecks(parsedQuery);

  if (security.riskLevel === "CRITICAL") {
    return blockResult(security.riskLevel, security.reasons);
  }

  const policy = await checkPolicy(userRole, parsedQuery);
  const reasons = [...security.reasons, ...policy.reasons];

  if (!policy.allowed) {
    return blockResult(security.riskLevel, reasons);
  }

  const needsAi = security.riskLevel !== "LOW" || policy.requiresApproval;

  if (!needsAi) {
    return {
      decision: "ALLOW",
      riskLevel: security.riskLevel,
      reasons,
      pendingApproval: false,
      aiExplanation: null,
      suggestedRewrite: null,
      rewrittenQuery: null,
    };
  }

  const ai = await getAiRiskExplanation(parsedQuery, security, policy);

  let decision = "ALLOW";
  let rewrittenQuery = null;

  if (ai.suggestedRewrite && (await rewritePassesChecks(ai.suggestedRewrite, userRole))) {
    decision = "REWRITE";
    rewrittenQuery = ai.suggestedRewrite;
  }

  return {
    decision,
    riskLevel: security.riskLevel,
    reasons,
    pendingApproval: decision === "ALLOW" && policy.requiresApproval,
    aiExplanation: ai.explanation,
    suggestedRewrite: ai.suggestedRewrite,
    rewrittenQuery,
  };
}

function blockResult(riskLevel, reasons) {
  return {
    decision: "BLOCK",
    riskLevel,
    reasons,
    pendingApproval: false,
    aiExplanation: null,
    suggestedRewrite: null,
    rewrittenQuery: null,
  };
}

// The AI's own claim that its rewrite is safe is never trusted -- the
// rewrite is treated as a brand new query and must independently pass the
// same deterministic engines the original query did.
async function rewritePassesChecks(rewriteSql, userRole) {
  const rewriteParsed = parseQuery(rewriteSql);
  const rewriteSecurity = runSecurityChecks(rewriteParsed);
  if (rewriteSecurity.riskLevel === "CRITICAL") return false;

  const rewritePolicy = await checkPolicy(userRole, rewriteParsed);
  return rewritePolicy.allowed && !rewritePolicy.requiresApproval;
}

module.exports = { makeDecision };
