import { describe, test, expect } from "bun:test";
import { QualityGate } from "../src/quality_gate.js";
import { ScoreReport } from "../src/evaluator.js";

test("QualityGate passes high-scoring report", () => {
  const gate = new QualityGate(0.85);
  const report: ScoreReport = {
    testPassRate: 1.0,
    judgeScore: 0.9,
    composite: 0.97,
    coverageGaps: [],
    testResults: [],
    passed: true,
  };

  const result = gate.check(report);
  expect(result.passed).toBe(true);
  expect(result.warnings).toHaveLength(0);
});

test("QualityGate fails low-scoring report", () => {
  const gate = new QualityGate(0.85);
  const report: ScoreReport = {
    testPassRate: 0.4,
    judgeScore: 0.3,
    composite: 0.36,
    coverageGaps: [],
    testResults: [],
    passed: false,
  };

  const result = gate.check(report);
  expect(result.passed).toBe(false);
  expect(result.compositeScore).toBe(0.36);
});

test("QualityGate blocks on coverage gaps", () => {
  const gate = new QualityGate(0.85);
  const report: ScoreReport = {
    testPassRate: 0.9,
    judgeScore: 0.9,
    composite: 0.9,
    coverageGaps: ["style violations"],
    testResults: [],
    passed: false,
  };

  const result = gate.check(report);
  expect(result.passed).toBe(false);
  expect(result.blocked).toBe(true);
  expect(result.warnings).toContain("Coverage gaps detected: style violations");
});

test("QualityGate warns on generalization failure", () => {
  const gate = new QualityGate(0.85);
  const report: ScoreReport = {
    testPassRate: 1.0,
    judgeScore: 0.9,
    composite: 0.97,
    generalizationScore: 0.33,
    generalizationWarning: "Agent failed 2/3 generalization holdout tests",
    coverageGaps: [],
    testResults: [],
    passed: true,
  };

  const result = gate.check(report);
  expect(result.passed).toBe(true);
  expect(result.warnings).toContain("Agent failed 2/3 generalization holdout tests");
});

test("QualityGate custom threshold", () => {
  const gate = new QualityGate(0.5);
  const report: ScoreReport = {
    testPassRate: 0.6,
    judgeScore: 0.4,
    composite: 0.52,
    coverageGaps: [],
    testResults: [],
    passed: true,
  };

  const result = gate.check(report);
  expect(result.passed).toBe(true);
});
