import { BaseLLMBackend, LLMMessage } from "./llm_backend/base.js";

export interface TestCase {
  id: string;
  input: unknown;
  expectedSchema: Record<string, unknown>;
  tracedTo: string[];
  diversityScore: number;
}

export interface CoverageReport {
  aspects: string[];
  coveredAspects: string[];
  gaps: string[];
}

const TEST_GENERATOR_SYSTEM_PROMPT = `You are TestForge, an expert test engineer. Your job is to generate diverse, high-quality test cases for a software engineering agent.

## Your Task
Given an agent description and its input/output schemas, generate k test cases that:
1. Cover all aspects of the intended use case
2. Are structurally and semantically diverse
3. Test edge cases, normal cases, and error conditions
4. Each test traces to a clause in the original description

## Output Format
Return a JSON array of test cases. Each test case must have:
- "input": an object matching the INPUT_SCHEMA
- "expectedKeys": array of keys that MUST be present in output
- "tracedTo": array of description clauses this test covers
- "category": one of "normal", "edge", "error"

Example:
[
  {
    "input": { "pr_url": "https://github.com/org/repo/pull/123", "repo": "org/repo" },
    "expectedKeys": ["issues", "score", "summary"],
    "tracedTo": ["logic errors", "style violations"],
    "category": "normal"
  }
]

## Diversity Requirement
- Do NOT generate multiple tests with similar inputs
- Vary the input structures and edge cases
- Each test should test a meaningfully different scenario
- If the agent handles N aspects, spread tests across all N aspects`;

const TEST_GENERATOR_USER_PROMPT = `Generate {k} test cases for this agent:

Description: {description}
INPUT_SCHEMA: {inputSchema}
OUTPUT_SCHEMA: {outputSchema}
Tools used: {tools}

Return a JSON array of {k} test cases:`;

function generateId(): string {
  return `tc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function jaccardSimilarity(a: unknown, b: unknown): number {
  const aStr = JSON.stringify(a);
  const bStr = JSON.stringify(b);
  if (aStr === bStr) return 1;
  const aSet = new Set(aStr.split(""));
  const bSet = new Set(bStr.split(""));
  const intersection = [...aSet].filter((c) => bSet.has(c)).length;
  const union = new Set([...aSet, ...bSet]).size;
  return union > 0 ? intersection / union : 0;
}

export class TestGenerator {
  private llm: BaseLLMBackend;

  constructor(llm: BaseLLMBackend) {
    this.llm = llm;
  }

  async generate(params: {
    description: string;
    inputSchema: Record<string, string>;
    outputSchema: Record<string, string>;
    tools: string[];
    k?: number;
  }): Promise<TestCase[]> {
    const k = params.k ?? 5;
    const messages: LLMMessage[] = [
      { role: "system", content: TEST_GENERATOR_SYSTEM_PROMPT },
      {
        role: "user",
        content: TEST_GENERATOR_USER_PROMPT
          .replace("{k}", String(k))
          .replace("{description}", params.description)
          .replace("{inputSchema}", JSON.stringify(params.inputSchema))
          .replace("{outputSchema}", JSON.stringify(params.outputSchema))
          .replace("{tools}", params.tools.join(", ")),
      },
    ];

    const response = await this.llm.complete(messages, {
      temperature: 0.9,
      maxTokens: 2048,
    });

    let parsed: unknown[];
    try {
      const cleaned = response.content.replace(/```json\n?/g, "").replace(/```\n?$/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("TestGenerator: failed to parse LLM output", response.content.slice(0, 200));
      return this.fallbackTestCases(params);
    }

    if (!Array.isArray(parsed)) {
      return this.fallbackTestCases(params);
    }

    const testCases: TestCase[] = [];
    for (const item of parsed) {
      const typedItem = item as Record<string, unknown>;
      if (!typedItem.input || !typedItem.expectedKeys) continue;

      const diversityScore = testCases.length === 0
        ? 1
        : Math.max(...testCases.map((tc) => jaccardSimilarity(tc.input, typedItem.input)));

      testCases.push({
        id: generateId(),
        input: typedItem.input,
        expectedSchema: { keys: typedItem.expectedKeys as string[] },
        tracedTo: (typedItem.tracedTo as string[]) ?? [],
        diversityScore,
      });
    }

    return this.ensureDiversity(testCases, params);
  }

  private ensureDiversity(testCases: TestCase[], params: {
    description: string;
    inputSchema: Record<string, string>;
    outputSchema: Record<string, string>;
    k?: number;
  }): TestCase[] {
    const k = params.k ?? 5;
    if (testCases.length < k) {
      return [...testCases, ...this.fallbackTestCases({ ...params, k: k - testCases.length })];
    }
    return testCases.slice(0, k);
  }

  private fallbackTestCases(params: {
    description: string;
    inputSchema: Record<string, string>;
    outputSchema: Record<string, string>;
    k?: number;
  }): TestCase[] {
    const k = params.k ?? 5;
    const cases: TestCase[] = [];
    const inputs = [
      { __placeholder: "primary_test_case" },
      { __placeholder: "edge_case_null_input" },
      { __placeholder: "error_case_invalid_input" },
      { __placeholder: "empty_input_case" },
      { __placeholder: "large_input_case" },
    ];

    for (let i = 0; i < Math.min(k, inputs.length); i++) {
      const inputKeys = Object.keys(params.inputSchema);
      const input: Record<string, unknown> = {};
      for (const key of inputKeys) {
        input[key] = inputs[i % inputs.length].__placeholder;
      }

      cases.push({
        id: generateId(),
        input,
        expectedSchema: { keys: Object.keys(params.outputSchema) },
        tracedTo: ["general behavior"],
        diversityScore: 1 - (i * 0.15),
      });
    }
    return cases;
  }

  checkCoverage(testCases: TestCase[], description: string): CoverageReport {
    const descriptionLower = description.toLowerCase();
    const aspectPatterns = [
      { pattern: /logic\s*errors?/gi, aspect: "logic errors" },
      { pattern: /style\s*violations?/gi, aspect: "style violations" },
      { pattern: /test\s*coverage/gi, aspect: "test coverage" },
      { pattern: /bugs?/gi, aspect: "bugs" },
      { pattern: /security/gi, aspect: "security" },
      { pattern: /performance/gi, aspect: "performance" },
      { pattern: /review/gi, aspect: "review" },
      { pattern: /refactor/gi, aspect: "refactoring" },
    ];

    const aspects = aspectPatterns
      .filter((ap) => ap.pattern.test(descriptionLower))
      .map((ap) => ap.aspect);

    const coveredAspects = [...new Set(testCases.flatMap((tc) => tc.tracedTo))];
    const allAspects = aspects.length > 0 ? aspects : ["general behavior"];
    const gaps = allAspects.filter((a) => !coveredAspects.includes(a));

    return { aspects: allAspects, coveredAspects, gaps };
  }
}
