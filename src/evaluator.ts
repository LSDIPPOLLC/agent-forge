import { BaseLLMBackend, LLMMessage } from "./llm_backend/base.js";
import { TestCase } from "./test_generator.js";
import { spawn } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export interface ScoreReport {
  testPassRate: number;
  judgeScore: number;
  composite: number;
  generalizationScore?: number;
  generalizationWarning?: string;
  coverageGaps: string[];
  testResults: TestResult[];
  passed: boolean;
}

export interface TestResult {
  testCase: TestCase;
  passed: boolean;
  output?: unknown;
  error?: string;
  executionTimeMs: number;
}

export interface JudgeResult {
  correctness: number;
  completeness: number;
  quality: number;
  formatCompliance: number;
  reasoning: string;
}

const AGENT_RUNTIME_PACKAGE = `export const tools = {
  read_file: async (input: { path: string }) => {
    const { readFileSync } = await import("fs");
    return { content: readFileSync(input.path, "utf-8") };
  },
  run_command: async (input: { cmd: string; cwd?: string }) => {
    const { exec } = await import("child_process");
    return new Promise((resolve) => {
      exec(input.cmd, { cwd: input.cwd }, (err, stdout, stderr) => {
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", error: err?.message });
      });
    });
  },
  gh_api: async (input: { endpoint: string; method?: string }) => {
    const token = process.env["GITHUB_TOKEN"] ?? "";
    const res = await fetch(\`https://api.github.com\${input.endpoint}\`, {
      headers: { Authorization: \`Bearer \${token}\`, Accept: "application/vnd.github+json" },
      method: input.method ?? "GET",
    });
    return res.json();
  },
  grep: async (input: { pattern: string; path: string }) => {
    const { exec } = await import("child_process");
    return new Promise((resolve) => {
      exec(\`grep -r "\${input.pattern}" "\${input.path}"\`, (err, stdout) => {
        resolve(stdout.split("\\n").filter(Boolean));
      });
    }) as Promise<string[]>;
  },
  write_file: async (input: { path: string; content: string }) => {
    const { writeFileSync } = await import("fs");
    writeFileSync(input.path, input.content, "utf-8");
  },
  search_web: async (input: { query: string }) => {
    return \`Search results for: \${input.query} (mocked)\`;
  },
};

export async function handle(input: unknown): Promise<unknown> {
  return { error: "Not implemented" };
}`;

export class Evaluator {
  private llm: BaseLLMBackend;
  private tempDir: string;

  constructor(llm: BaseLLMBackend) {
    this.llm = llm;
    this.tempDir = join(process.env["TMPDIR"] ?? "/tmp", "agent-forge-evals");
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async run(params: {
    agentCode: string;
    testCases: TestCase[];
    description: string;
    outputSchema: Record<string, string>;
  }): Promise<ScoreReport> {
    const testResults: TestResult[] = [];

    for (const tc of params.testCases) {
      const result = await this.runSingleTest(params.agentCode, tc);
      testResults.push(result);
    }

    const passedCount = testResults.filter((r) => r.passed).length;
    const testPassRate = passedCount / testResults.length;

    const judgeResults = await Promise.all(
      testResults
        .filter((r) => r.output)
        .slice(0, 3)
        .map((r) =>
          this.judgeOutput({
            description: params.description,
            output: r.output,
            expectedKeys: (r.testCase.expectedSchema.keys as string[]) ?? [],
          })
        )
    );

    const judgeScore =
      judgeResults.length > 0
        ? judgeResults.reduce((sum, j) => sum + (j.correctness + j.completeness + j.quality + j.formatCompliance) / 4, 0) /
          judgeResults.length /
          25
        : 0;

    const composite = testPassRate * 0.6 + judgeScore * 0.4;

    const shadowCases = this.generateShadowCases(params.description);
    const genResults = await Promise.all(
      shadowCases.map((tc) => this.runSingleTest(params.agentCode, tc))
    );
    const generalizationScore = genResults.filter((r) => r.passed).length / genResults.length;
    const generalizationWarning =
      generalizationScore < 0.5
        ? `Agent failed ${genResults.filter((r) => !r.passed).length}/${genResults.length} generalization holdout tests`
        : undefined;

    return {
      testPassRate,
      judgeScore,
      composite,
      generalizationScore,
      generalizationWarning,
      coverageGaps: [],
      testResults,
      passed: composite >= 0.85,
    };
  }

  private async runSingleTest(agentCode: string, testCase: TestCase): Promise<TestResult> {
    const start = Date.now();
    const runId = randomUUID().slice(0, 8);
    const agentFile = join(this.tempDir, `agent_${runId}.ts`);
    const runtimeFile = join(this.tempDir, `runtime_${runId}.ts`);

    try {
      writeFileSync(runtimeFile, AGENT_RUNTIME_PACKAGE);

      const fullCode = `import { tools, handle } from "./${runtimeFile.replace(/.*\//, "")}";
${agentCode}
const input = ${JSON.stringify(testCase.input)};
const result = await handle(input);
console.log(JSON.stringify(result));`;

      writeFileSync(agentFile, fullCode);

      const output = await this.execAgent(agentFile);
      const parsed = JSON.parse(output);
      const expectedKeys = (testCase.expectedSchema.keys as string[]) ?? [];
      const hasKeys = expectedKeys.every((k: string) => k in (parsed as Record<string, unknown>));

      return {
        testCase,
        passed: hasKeys,
        output: parsed,
        executionTimeMs: Date.now() - start,
      };
    } catch (e) {
      return {
        testCase,
        passed: false,
        error: String(e),
        executionTimeMs: Date.now() - start,
      };
    } finally {
      try {
        const { unlinkSync } = await import("fs");
        unlinkSync(agentFile);
        unlinkSync(runtimeFile);
      } catch {}
    }
  }

  private execAgent(agentFile: string, timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("bun", [agentFile], {
        cwd: this.tempDir,
        timeout: timeoutMs,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (d) => (stdout += d.toString()));
      proc.stderr?.on("data", (d) => (stderr += d.toString()));

      proc.on("close", (code) => {
        if (code === 0 || stdout) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `Process exited with code ${code}`));
        }
      });

      proc.on("error", reject);
    });
  }

  private async judgeOutput(params: {
    description: string;
    output: unknown;
    expectedKeys: string[];
  }): Promise<JudgeResult> {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: `You are a senior software engineer acting as an impartial judge. Evaluate the following agent output.

Score each criterion 0-25 (max 100 total):
1. Correctness — Does the output correctly address the task?
2. Completeness — Are all required fields present and populated?
3. Quality — Is the output insightful, well-reasoned, and actionable?
4. Format Compliance — Does the output match the expected schema keys: ${params.expectedKeys.join(", ")}?

Return JSON: {"correctness": int, "completeness": int, "quality": int, "formatCompliance": int, "reasoning": str}`,
      },
      {
        role: "user",
        content: `Task: ${params.description}\nOutput: ${JSON.stringify(params.output)}`,
      },
    ];

    try {
      const response = await this.llm.complete(messages, {
        temperature: 0.3,
        maxTokens: 512,
      });
      return JSON.parse(response.content);
    } catch {
      return { correctness: 0, completeness: 0, quality: 0, formatCompliance: 0, reasoning: "Judge failed" };
    }
  }

  private generateShadowCases(description: string): TestCase[] {
    return [
      {
        id: "shadow-1",
        input: { __shadow: "unseen_test_case_1" },
        expectedSchema: { keys: ["issues", "score", "summary"] },
        tracedTo: ["generalization"],
        diversityScore: 1,
      },
      {
        id: "shadow-2",
        input: { __shadow: "unseen_test_case_2" },
        expectedSchema: { keys: ["issues", "score", "summary"] },
        tracedTo: ["generalization"],
        diversityScore: 1,
      },
      {
        id: "shadow-3",
        input: { __shadow: "unseen_test_case_3" },
        expectedSchema: { keys: ["issues", "score", "summary"] },
        tracedTo: ["generalization"],
        diversityScore: 1,
      },
    ];
  }
}
