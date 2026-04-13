#!/usr/bin/env bun

import { text, select, outro, intro } from "@clack/prompts";
import { getAllAgents, getAgentByName, getLatestAgentVersion, getEvalRunsForVersion, getAllAgentVersions } from "./registry.js";
import { createOllamaBackend } from "./llm_backend/ollama.js";
import { createOpenAIBackend } from "./llm_backend/openai.js";
import { BaseLLMBackend } from "./llm_backend/base.js";
import { LoopController } from "./loop_controller.js";

function getLLMBackend(): BaseLLMBackend {
  if (process.env["OPENAI_API_KEY"] || process.env["ANTHROPIC_API_KEY"]) {
    return createOpenAIBackend();
  }
  return createOllamaBackend();
}

async function cmdCreate(args: string[]) {
  const llm = getLLMBackend();
  const controller = new LoopController(llm);

  const description = args[0] ?? await text({ message: "Describe the agent:" });
  if (!description || typeof description !== "string") {
    outro("Description required.");
    return;
  }

  const outputMode = await select({
    message: "Output target?",
    options: [
      { label: "Claude Skills (~/.claude/skills/)", value: "claude-skills" },
      { label: "Standalone (./agents/)", value: "standalone" },
    ],
  });

  const toolsInput = await text({
    message: "Tools (comma-separated, or Enter for defaults):",
    defaultValue: "read_file, run_command",
  });

  const thresholdStr = await text({
    message: "Pass threshold (0.0 - 1.0):",
    defaultValue: "0.85",
  });
  const threshold = parseFloat(typeof thresholdStr === "string" ? thresholdStr : "0.85");

  const maxIterStr = await text({
    message: "Max iterations:",
    defaultValue: "5",
  });
  const maxIterations = parseInt(typeof maxIterStr === "string" ? maxIterStr : "5");

  intro("Creating agent...");

  const agentName = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  const result = await controller.run({
    description,
    name: agentName,
    tools: typeof toolsInput === "string" ? toolsInput.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
    threshold,
    maxIterations,
  });

  if (result.passed) {
    outro(`Agent "${agentName}" created and passed quality gate (score: ${(result.finalScore ?? 0).toFixed(2)})`);
  } else {
    outro(`Agent "${agentName}" did not pass quality gate after ${maxIterations} iterations (best: ${result.bestScore?.toFixed(2) ?? "N/A"})`);
  }
}

async function cmdList() {
  const agents = getAllAgents();
  if (agents.length === 0) {
    console.log("No agents found.");
    return;
  }
  console.log(`\n Agents (${agents.length}):\n`);
  for (const agent of agents) {
    const version = getLatestAgentVersion(agent.id);
    const evals = version ? getEvalRunsForVersion(version.id) : [];
    const bestEval = evals.find((e) => e.passed);
    const status = bestEval ? "PASS" : evals.length > 0 ? "FAIL" : "NEW";
    console.log(`  [${status}] ${agent.name} (v${agent.latest_version}) — ${agent.description ?? ""}`);
  }
  console.log();
}

async function cmdHistory(args: string[]) {
  const name = args[0];
  if (!name) {
    console.error("Usage: agent-forge history <agent-name>");
    return;
  }
  const agent = getAgentByName(name);
  if (!agent) {
    console.error(`Agent "${name}" not found.`);
    return;
  }
  const versions = getAllAgentVersions(agent.id);
  console.log(`\n ${agent.name} — ${versions.length} version(s):\n`);
  for (const v of versions) {
    const evals = getEvalRunsForVersion(v.id);
    const best = evals.find((e) => e.passed);
    const latest = evals[evals.length - 1];
    console.log(`  v${v.version}: ${latest ? `score=${latest.composite_score?.toFixed(2) ?? "N/A"} pass=${latest.passed ? "yes" : "no"}` : "no evals"}`);
  }
  console.log();
}

async function cmdInspect(args: string[]) {
  const name = args[0];
  const versionArg = args[1];
  if (!name) {
    console.error("Usage: agent-forge inspect <name> [--v N]");
    return;
  }
  const agent = getAgentByName(name);
  if (!agent) {
    console.error(`Agent "${name}" not found.`);
    return;
  }
  const version = versionArg
    ? parseInt(versionArg.replace("--v=", ""))
    : agent.latest_version;
  const v = getLatestAgentVersion(agent.id);
  if (!v) {
    console.error("No version found.");
    return;
  }
  console.log(`\n Agent: ${agent.name} v${v.version}\n`);
  console.log(v.code.slice(0, 2000));
  if (v.code.length > 2000) console.log("\n... (truncated)");
  console.log();
}

async function main() {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "create": {
      await cmdCreate(args);
      break;
    }
    case "list": {
      await cmdList();
      break;
    }
    case "history": {
      await cmdHistory(args);
      break;
    }
    case "inspect": {
      await cmdInspect(args);
      break;
    }
    case "help":
    default: {
      console.log(`
agent-forge — Meta-framework for creating and auto-refining agents

Usage:
  agent-forge create <description>    Create and refine a new agent
  agent-forge list                    List all agents
  agent-forge history <name>          Show version history
  agent-forge inspect <name> [--v N]  Inspect agent code
  agent-forge help                    Show this help

Examples:
  agent-forge create "review PRs for logic errors"
  agent-forge list
  agent-forge history pr_reviewer
  agent-forge inspect pr_reviewer --v 2
`);
      break;
    }
  }
}

main().catch(console.error);
