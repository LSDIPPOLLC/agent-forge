import { ScoreReport } from "./evaluator.js";

export interface QualityGateResult {
  passed: boolean;
  warnings: string[];
  blocked: boolean;
  compositeScore: number;
}

export class QualityGate {
  private threshold: number;

  constructor(threshold: number = 0.85) {
    this.threshold = threshold;
  }

  check(report: ScoreReport): QualityGateResult {
    const warnings: string[] = [];
    const blocked = report.coverageGaps.length > 0;

    if (report.generalizationWarning) {
      warnings.push(report.generalizationWarning);
    }

    if (report.testPassRate < 0.5) {
      warnings.push(`Low test pass rate: ${(report.testPassRate * 100).toFixed(0)}%`);
    }

    if (report.judgeScore < 0.5) {
      warnings.push(`Low LLM judge score: ${(report.judgeScore * 100).toFixed(0)}%`);
    }

    if (blocked) {
      warnings.push(`Coverage gaps detected: ${report.coverageGaps.join(", ")}`);
    }

    return {
      passed: report.composite >= this.threshold && !blocked,
      warnings,
      blocked,
      compositeScore: report.composite,
    };
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }
}
