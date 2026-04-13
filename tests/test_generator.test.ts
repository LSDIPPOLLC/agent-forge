import { describe, test, expect } from "bun:test";
import { TestGenerator } from "../src/test_generator.js";
import { BaseLLMBackend, LLMMessage, LLMResponse } from "../src/llm_backend/base.js";

class MockLLMBackend implements BaseLLMBackend {
  response: LLMResponse;

  constructor(response: LLMResponse) {
    this.response = response;
  }

  async complete(_messages: LLMMessage[], _options?: {}): Promise<LLMResponse> {
    return this.response;
  }
}

describe("TestGenerator", () => {
  test("generates test cases from LLM response", async () => {
    const llmResponse: LLMResponse = {
      content: JSON.stringify([
        {
          input: { pr_url: "https://github.com/org/repo/pull/1", repo: "org/repo" },
          expectedKeys: ["issues", "score", "summary"],
          tracedTo: ["logic errors"],
          category: "normal",
        },
        {
          input: { pr_url: "https://github.com/org/repo/pull/2", repo: "org/repo" },
          expectedKeys: ["issues", "score", "summary"],
          tracedTo: ["style violations"],
          category: "edge",
        },
      ]),
      finishReason: "stop",
    };

    const llm = new MockLLMBackend(llmResponse);
    const tg = new TestGenerator(llm);

    const cases = await tg.generate({
      description: "review PRs for logic errors, style violations, and test coverage",
      inputSchema: { pr_url: "string", repo: "string" },
      outputSchema: { issues: "array", score: "number", summary: "string" },
      tools: ["gh_api"],
      k: 2,
    });

    expect(cases.length).toBeGreaterThanOrEqual(1);
    expect(cases[0].expectedSchema.keys).toContain("issues");
    expect(cases[0].tracedTo.length).toBeGreaterThan(0);
  });

  test("checkCoverage detects gaps", () => {
    const llm = new MockLLMBackend({ content: "[]", finishReason: "stop" });
    const tg = new TestGenerator(llm);

    const cases = [
      {
        id: "tc1",
        input: { pr_url: "https://github.com/org/repo/pull/1", repo: "org/repo" },
        expectedSchema: { keys: ["issues", "score", "summary"] },
        tracedTo: ["logic errors"],
        diversityScore: 1,
      },
    ];

    const report = tg.checkCoverage(
      cases as any,
      "review PRs for logic errors, style violations, and test coverage"
    );

    expect(report.aspects).toContain("logic errors");
    expect(report.aspects).toContain("style violations");
    expect(report.aspects).toContain("test coverage");
    expect(report.gaps).toContain("style violations");
    expect(report.gaps).toContain("test coverage");
  });

  test("fallback test cases on parse failure", async () => {
    const llm = new MockLLMBackend({ content: "not valid json {{{", finishReason: "stop" });
    const tg = new TestGenerator(llm);

    const cases = await tg.generate({
      description: "test agent",
      inputSchema: { path: "string" },
      outputSchema: { content: "string" },
      tools: [],
      k: 3,
    });

    expect(cases.length).toBeGreaterThanOrEqual(1);
    expect(cases[0].id).toMatch(/^tc-/);
  });
});
