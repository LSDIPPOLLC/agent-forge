import { createOllamaBackend } from "./llm_backend/ollama.js";
import { createOpenAIBackend } from "./llm_backend/openai.js";
import { BaseLLMBackend } from "./llm_backend/base.js";
import { Generator } from "./generator.js";
import { TestGenerator } from "./test_generator.js";
import { Evaluator } from "./evaluator.js";
import { Refiner } from "./refiner.js";
import { QualityGate } from "./quality_gate.js";
import { LoopController } from "./loop_controller.js";
import { ClaudeSkillsAdapter, StandaloneAdapter } from "./output_adapters/index.js";
import {
  createAgent,
  createAgentVersion,
  createEvalRun,
  createTestCase,
  getAgentByName,
  getLatestAgentVersion,
  deleteTestCasesForAgent,
} from "./registry.js";

export type OutputMode = "claude-skills" | "standalone";

export interface RunLoopOptions {
  description: string;
  name?: string;
  tools?: string[];
  threshold?: number;
  maxIterations?: number;
  outputMode?: OutputMode;
  outputDir?: string;
}

function getLLMBackend(): BaseLLMBackend {
  if (process.env["OPENAI_API_KEY"] || process.env["ANTHROPIC_API_KEY"]) {
    return createOpenAIBackend();
  }
  return createOllamaBackend();
}

export async function runLoop(options: RunLoopOptions): Promise<{
  passed: boolean;
  finalScore?: number;
  bestScore?: number;
  iterations: number;
  name: string;
  path: string;
}> {
  const llm = getLLMBackend();
  const generator = new Generator(llm);
  const testGenerator = new TestGenerator(llm);
  const evaluator = new Evaluator(llm);
  const refiner = new Refiner(llm);
  const qualityGate = new QualityGate(options.threshold ?? 0.85);

  const name =
    options.name ??
    options.description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);

  const tools = options.tools ?? [];
  const threshold = options.threshold ?? 0.85;
  const maxIterations = options.maxIterations ?? 5;

  let agentId: string;
  let currentCode = "";

  const existing = getAgentByName(name);
  if (existing) {
    const latest = getLatestAgentVersion(existing.id);
    if (latest) {
      currentCode = latest.code;
      agentId = existing.id;
    } else {
      agentId = existing.id;
    }
  } else {
    const agent = createAgent(name, options.description);
    agentId = agent.id;
  }

  let bestScore = 0;
  let bestCode = "";
  let bestVersionId = "";

  for (let iter = 1; iter <= maxIterations; iter++) {
    let code = currentCode;

    if (!code) {
      const schema = await generator.make({ description: options.description, name, tools });
      code = generator.serialize(schema);
    } else {
      const schema = await generator.make({ description: options.description, name, tools });
      const testCases = await testGenerator.generate({
        description: options.description,
        inputSchema: schema.inputSchema,
        outputSchema: schema.outputSchema,
        tools,
        k: 5,
      });

      const coverage = testGenerator.checkCoverage(testCases, options.description);
      const report = await evaluator.run({
        agentCode: code,
        testCases,
        description: options.description,
        outputSchema: schema.outputSchema,
      });

      for (const tc of testCases) {
        createTestCase({
          agentId,
          input: tc.input,
          expectedSchema: tc.expectedSchema,
          tracedTo: tc.tracedTo,
          diversityScore: tc.diversityScore,
        });
      }

      report.coverageGaps = coverage.gaps;
      const gateResult = qualityGate.check(report);

      const version = createAgentVersion(agentId, iter, code);
      createEvalRun({
        agentVersionId: version.id,
        iteration: iter,
        testPassRate: report.testPassRate,
        judgeScore: report.judgeScore,
        compositeScore: report.composite,
        passed: gateResult.passed,
        failureReport: { warnings: gateResult.warnings, coverageGaps: coverage.gaps },
      });

      if (report.composite > bestScore) {
        bestScore = report.composite;
        bestCode = code;
        bestVersionId = version.id;
      }

      if (gateResult.passed) {
        const outputPath = await writeOutput(code, options, name);
        return {
          passed: true,
          finalScore: report.composite,
          iterations: iter,
          name,
          path: outputPath,
        };
      }

      code = await refiner.refine({ currentCode: code, scoreReport: report, iteration: iter });
    }

    if (iter === maxIterations) {
      break;
    }

    const schema = await generator.make({ description: options.description, name, tools });
    const testCases = await testGenerator.generate({
      description: options.description,
      inputSchema: schema.inputSchema,
      outputSchema: schema.outputSchema,
      tools,
      k: 5,
    });

    const coverage = testGenerator.checkCoverage(testCases, options.description);
    const report = await evaluator.run({
      agentCode: code,
      testCases,
      description: options.description,
      outputSchema: schema.outputSchema,
    });

    report.coverageGaps = coverage.gaps;
    const gateResult = qualityGate.check(report);

    const version = createAgentVersion(agentId, iter, code);
    createEvalRun({
      agentVersionId: version.id,
      iteration: iter,
      testPassRate: report.testPassRate,
      judgeScore: report.judgeScore,
      compositeScore: report.composite,
      passed: gateResult.passed,
      failureReport: { warnings: gateResult.warnings, coverageGaps: coverage.gaps },
    });

    if (report.composite > bestScore) {
      bestScore = report.composite;
      bestCode = code;
      bestVersionId = version.id;
    }

    if (gateResult.passed) {
      const outputPath = await writeOutput(code, options, name);
      return {
        passed: true,
        finalScore: report.composite,
        iterations: iter,
        name,
        path: outputPath,
      };
    }

    code = await refiner.refine({ currentCode: code, scoreReport: report, iteration: iter });
  }

  if (bestCode) {
    const outputPath = await writeOutput(bestCode, options, name);
    return {
      passed: false,
      bestScore,
      iterations: maxIterations,
      name,
      path: outputPath,
    };
  }

  return {
    passed: false,
    iterations: maxIterations,
    name,
    path: "",
  };
}

async function writeOutput(
  code: string,
  options: RunLoopOptions,
  name: string
): Promise<string> {
  if (options.outputMode === "standalone") {
    const adapter = new StandaloneAdapter(options.outputDir ?? "./agents");
    await adapter.write({ name, code, description: options.description });
    return adapter.getPath(name);
  } else {
    const adapter = new ClaudeSkillsAdapter();
    await adapter.write({ name, code, description: options.description });
    return adapter.getPath(name);
  }
}

export async function describe(task: string): Promise<void> {
  console.log("\nAgent description:", task);
  console.log("(use runLoop() programmatically or agent-forge create CLI)\n");
}
