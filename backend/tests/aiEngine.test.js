process.env.LLM_API_KEY = "test-key";

const mockCreate = jest.fn();
jest.mock("openai", () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
});

const { getAiRiskExplanation } = require("../src/engines/aiEngine");

const parsedQuery = { raw: "SELECT * FROM orders", operation: "SELECT", tablesReferenced: ["orders"], hasWhereClause: false };
const securityResult = { riskLevel: "MEDIUM", reasons: ["Query touches 4 tables"] };
const policyResult = { allowed: true, requiresApproval: false, reasons: [] };

afterEach(() => jest.clearAllMocks());

describe("getAiRiskExplanation", () => {
  it("returns the parsed explanation and rewrite on a well-formed JSON response", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              explanation: "This touches many tables without narrowing filters.",
              suggestedRewrite: "SELECT id FROM orders WHERE status = 'open'",
            }),
          },
        },
      ],
    });

    const result = await getAiRiskExplanation(parsedQuery, securityResult, policyResult);

    expect(result.error).toBeNull();
    expect(result.explanation).toMatch(/touches many tables/);
    expect(result.suggestedRewrite).toBe("SELECT id FROM orders WHERE status = 'open'");
  });

  it("strips ```json code fences before parsing", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '```json\n{"explanation": "risky", "suggestedRewrite": null}\n```' } }],
    });

    const result = await getAiRiskExplanation(parsedQuery, securityResult, policyResult);

    expect(result.explanation).toBe("risky");
    expect(result.suggestedRewrite).toBeNull();
  });

  it("degrades gracefully on malformed JSON instead of throwing", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not json at all" } }],
    });

    const result = await getAiRiskExplanation(parsedQuery, securityResult, policyResult);

    expect(result.explanation).toBeNull();
    expect(result.suggestedRewrite).toBeNull();
  });

  it("degrades gracefully when the LLM call itself throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("network down"));

    const result = await getAiRiskExplanation(parsedQuery, securityResult, policyResult);

    expect(result.explanation).toBeNull();
    expect(result.error).toBe("network down");
  });

  it("never calls the LLM client when no API key is configured", async () => {
    // Mock config/env directly rather than process.env -- dotenv would
    // otherwise repopulate LLM_API_KEY from the real .env file on reload.
    jest.resetModules();
    jest.doMock("../src/config/env", () => ({
      LLM_API_KEY: undefined,
      LLM_BASE_URL: "https://openrouter.ai/api/v1",
      LLM_MODEL: "google/gemini-2.0-flash-001",
    }));
    jest.doMock("openai", () =>
      jest.fn().mockImplementation(() => ({ chat: { completions: { create: mockCreate } } }))
    );
    const { getAiRiskExplanation: getAiRiskExplanationNoKey } = require("../src/engines/aiEngine");

    const result = await getAiRiskExplanationNoKey(parsedQuery, securityResult, policyResult);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.explanation).toBeNull();
    expect(result.error).toMatch(/not configured/);
  });
});
