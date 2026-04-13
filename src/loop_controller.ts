import { BaseLLMBackend } from "./llm_backend/base.js";
import { Generator } from "./generator.js";
import { TestGenerator } from "./test_generator.js";
import { Evaluator } from "./evaluator.js";
import { Refiner } from "./refiner.js";
import { QualityGate } from "./quality_gate.js";
import {
  createAgent,
  createAgentVersion,
  createEvalRun,
  getAgentByName,
  getLatestAgentVersion,
  getDb,
} from "./registry.js";

export type LoopState =
  | "IDLE"
  | "GENERATING"
  | "EVALUATING"
  | "REFINING"
  | "DONE"
  | "FAILED";

export interface LoopResult {
  state: LoopState;
  passed: boolean;
  finalScore?: number;
  bestScore?: number;
  iterations: number;
  agentId?: string;
  versionId?: string;
}

export interface LoopOptions {
  description: string;
  name: string;
  tools: string[];
  threshold: number;
  maxIterations: number;
}

export class LoopController {
  private llm: BaseLLMBackend;
  private generator: Generator;
  private testGenerator: TestGenerator;
  private evaluator: Evaluator;
  private refiner: Refiner;
  private qualityGate: QualityGate;

  constructor(llm: BaseLLMBackend) {
    this.llm = llm;
    this.generator = new Generator(llm);
    this.testGenerator = new TestGenerator(llm);
    this.evaluator = new Evaluator(llm);
    this.refiner = new Refiner(llm);
    this.qualityGate = new QualityGate();
  }

  async run(options: LoopOptions): Promise<LoopResult> {
    const { description, name, tools, threshold, maxIterations } = options;
    this.qualityGate.setThreshold(threshold);

    let state: LoopState = "IDLE";
    let agentId: string = "";
    let currentCode = "";
    let bestScore = 0;
    let bestCode = "";
    let versionId = "";

    const existing = getAgentByName(name);
    if (existing) {
      const latest = getLatestAgentVersion(existing.id);
      if (latest) {
        currentCode = latest.code;
      }
      agentId = existing.id;
    }

    if (!currentCode) {
      const agent = createAgent(name, description);
      agentId = agent.id;
    }

    for (let iter = 1; iter <= maxIterations; iter++) {
      if (iter === 1 && !currentCode) {
        state = "GENERATING";
        console.log(`[${iter}/${maxIterations}] Generating agent...`);

        const schema = await this.generator.make({ description, name, tools });
        currentCode = this.generator.serialize(schema);

        const version = createAgentVersion(agentId, iter, currentCode);
        versionId = version.id;
      } else if (currentCode) {
        state = "REFINING";
        console.log(`[${iter}/${maxIterations}] Refining agent (attempt ${iter})...`);

        const schema = await this.generator.make({ description, name, tools });
        const testCases = await this.testGenerator.generate({
          description,
          inputSchema: schema.inputSchema,
          outputSchema: schema.outputSchema,
          tools,
          k: 5,
        });

        const coverage = this.testGenerator.checkCoverage(testCases, description);
        const report = await this.evaluator.run({
          agentCode: currentCode,
          testCases,
          description,
          outputSchema: schema.outputSchema,
        });

        const gateResult = this.qualityGate.check(report);

        if (report.coverageGaps.length > 0) {
          report.coverageGaps = coverage.gaps;
        }

        createEvalRun({
          agentVersionId: versionId,
          iteration: iter,
          testPassRate: report.testPassRate,
          judgeScore: report.judgeScore,
          compositeScore: report.composite,
          passed: gateResult.passed,
          failureReport: { failures: report.testResults.map((r) => ({ passed: r.passed, error: r.error })), warnings: gateResult.warnings },
        });

        if (gateResult.passed) {
          state = "DONE";
          console.log(`[${iter}/${maxIterations}] Agent passed quality gate (score: ${report.composite.toFixed(3)})`);
          return {
            state: "DONE",
            passed: true,
            finalScore: report.composite,
            iterations: iter,
            agentId,
            versionId,
          };
        }

        console.log(`[${iter}/${maxIterations}] Score: ${report.composite.toFixed(3)} — refining...`);
        currentCode = await this.refiner.refine({ currentCode, scoreReport: report, iteration: iter });

        const newVersion = createAgentVersion(agentId, iter, currentCode);
        versionId = newVersion.id;

        if (report.composite > bestScore) {
          bestScore = report.composite;
          bestCode = currentCode;
        }
      }

      state = "EVALUATING";
      if (iter < maxIterations) {
        const schema = await this.generator.make({ description, name, tools });
        const testCases = await this.testGenerator.generate({
          description,
          inputSchema: schema.inputSchema,
          outputSchema: schema.outputSchema,
          tools,
          k: 5,
        });

        const coverage = this.testGenerator.checkCoverage(testCases, description);
        const report = await this.evaluator.run({
          agentCode: currentCode,
          testCases,
          description,
          outputSchema: schema.outputSchema,
        });

        if (report.composite > bestScore) {
          bestScore = report.composite;
          bestCode = currentCode;
        }

        report.coverageGaps = coverage.gaps;
        const gateResult = this.qualityGate.check(report);

        createEvalRun({
          agentVersionId: versionId,
          iteration: iter,
          testPassRate: report.testPassRate,
          judgeScore: report.judgeScore,
          compositeScore: report.composite,
          passed: gateResult.passed,
          failureReport: { failures: report.testResults.map((r) => ({ passed: r.passed, error: r.error })), warnings: gateResult.warnings },
        });

        if (gateResult.passed) {
          state = "DONE";
          console.log(`[${iter}/${maxIterations}] Agent passed quality gate (score: ${report.composite.toFixed(3)})`);
          return {
            state: "DONE",
            passed: true,
            finalScore: report.composite,
            iterations: iter,
            agentId,
            versionId,
          };
        }
      }
    }

    state = "FAILED";
    return {
      state: "FAILED",
      passed: false,
      bestScore,
      iterations: maxIterations,
      agentId,
      versionId,
    };
  }
}
