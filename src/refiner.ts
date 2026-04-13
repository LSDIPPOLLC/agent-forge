import { BaseLLMBackend, LLMMessage } from "./llm_backend/base.js";
import { ScoreReport, TestResult } from "./evaluator.js";

const REFINER_SYSTEM_PROMPT = `You are AgentForge Refiner. An agent failed evaluation. Your job is to rewrite the agent to fix specific failures.

## Failure Analysis Process
1. Read the failure report carefully
2. Identify the root cause of each failure (not just the symptom)
3. Focus on the parts that need fixing — do NOT rewrite everything
4. Keep what works, fix what doesn't
5. Ensure the agent still handles cases that were previously passing

## Common Failure Patterns
- Missing output fields → check OUTPUT_SCHEMA and return all required keys
- Schema mismatch → ensure returned object keys match expected schema exactly
- Error handling → wrap operations in try/catch, return error info gracefully
- Tool misuse → verify tool is imported and called correctly
- Edge cases → add null/undefined checks

## Important
- Keep the same header comment block (// agent:, // description:, etc.)
- Keep the same INPUT_SCHEMA and OUTPUT_SCHEMA
- Keep the same tool imports
- Only modify the handler code, not the structure`;

const REFINER_USER_PROMPT = `You are AgentForge Refiner. An agent failed evaluation. Rewrite it to fix the failures.

## Current Agent Code
\`\`\`typescript
{currentCode}
\`\`\`

## Failure Report
- Test Pass Rate: {testPassRate}%
- Judge Score: {judgeScore}%
- Composite Score: {compositeScore}%

## Specific Failures
{failures}

## Instructions
1. Analyze the failures above
2. Rewrite ONLY the parts of the agent that need fixing
3. Keep what works
4. Return the complete updated TypeScript file (no markdown code fences)`;

export class Refiner {
  private llm: BaseLLMBackend;

  constructor(llm: BaseLLMBackend) {
    this.llm = llm;
  }

  async refine(params: {
    currentCode: string;
    scoreReport: ScoreReport;
    iteration: number;
  }): Promise<string> {
    const failures = this.buildFailureList(params.scoreReport);

    const messages: LLMMessage[] = [
      { role: "system", content: REFINER_SYSTEM_PROMPT },
      {
        role: "user",
        content: REFINER_USER_PROMPT
          .replace("{currentCode}", params.currentCode)
          .replace("{testPassRate}", (params.scoreReport.testPassRate * 100).toFixed(0))
          .replace("{judgeScore}", (params.scoreReport.judgeScore * 100).toFixed(0))
          .replace("{compositeScore}", params.scoreReport.composite.toFixed(3))
          .replace("{failures}", failures),
      },
    ];

    const response = await this.llm.complete(messages, {
      temperature: 0.5,
      maxTokens: 2048,
    });

    return this.extractCode(response.content, params.currentCode);
  }

  private buildFailureList(report: ScoreReport): string {
    const lines: string[] = [];

    const failedTests = report.testResults.filter((r) => !r.passed);
    if (failedTests.length > 0) {
      lines.push(`Failed Tests (${failedTests.length}/${report.testResults.length}):`);
      for (const ft of failedTests) {
        const inputPreview = JSON.stringify(ft.testCase.input).slice(0, 80);
        lines.push(`  - Input: ${inputPreview} — ${ft.error ?? "Missing required output fields"}`);
      }
    }

    if (report.generalizationWarning) {
      lines.push(`Generalization Warning: ${report.generalizationWarning}`);
    }

    if (report.coverageGaps.length > 0) {
      lines.push(`Coverage Gaps: ${report.coverageGaps.join(", ")}`);
    }

    return lines.length > 0 ? lines.join("\n") : "No specific failures identified. Review the score report and improve the agent.";
  }

  private extractCode(content: string, fallback: string): string {
    const cleaned = content
      .replace(/^```typescript\n?/, "")
      .replace(/^```\n?$/, "")
      .replace(/^```json\n?/, "")
      .trim();

    if (cleaned.includes("// agent:") && cleaned.includes("handle")) {
      return cleaned;
    }

    const agentStart = cleaned.indexOf("// agent:");
    if (agentStart !== -1) {
      return cleaned.slice(agentStart);
    }

    console.warn("Refiner: could not extract agent code, using original with fixes appended");
    return fallback;
  }
}
