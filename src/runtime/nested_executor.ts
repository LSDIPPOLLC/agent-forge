import { Executor, ExecutorResult } from "./executor.js";
import { getLatestAgentVersion, getAgentByName } from "../registry.js";

const MAX_DEPTH = parseInt(process.env["AGENT_MAX_DEPTH"] ?? "3");

interface CallStack {
  agentName: string;
  depth: number;
}

export interface NestedExecutorResult {
  output: unknown;
  error?: string;
  depthLimitReached?: boolean;
  cycleDetected?: boolean;
  callGraph: string[];
}

export class NestedExecutor {
  private executor: Executor;
  private callStack: CallStack[];
  private codeRegistry: Map<string, string>;

  constructor() {
    this.executor = new Executor();
    this.callStack = [];
    this.codeRegistry = new Map();
  }

  async executeTopLevel(agentName: string, input: unknown): Promise<NestedExecutorResult> {
    this.callStack = [];

    const code = await this.loadAgentCode(agentName);
    if (!code) {
      return {
        output: null,
        error: `Agent "${agentName}" not found in registry`,
        callGraph: [agentName],
      };
    }

    return this.executeWithDepth(agentName, code, input, 0);
  }

  private async executeWithDepth(
    agentName: string,
    code: string,
    input: unknown,
    depth: number
  ): Promise<NestedExecutorResult> {
    if (depth >= MAX_DEPTH) {
      return {
        output: null,
        error: `Depth limit (${MAX_DEPTH}) exceeded: cannot call agent at depth ${depth}`,
        depthLimitReached: true,
        callGraph: this.callStack.map((c) => c.agentName),
      };
    }

    const cycleCheck = this.callStack.find((c) => c.agentName === agentName && c.depth === depth);
    if (cycleCheck) {
      return {
        output: null,
        error: `Cycle detected: agent "${agentName}" already in call stack at depth ${depth}`,
        cycleDetected: true,
        callGraph: this.callStack.map((c) => c.agentName),
      };
    }

    this.callStack.push({ agentName, depth });

    try {
      const result = await this.executor.execute(code, input);

      if (result.error) {
        return {
          output: null,
          error: result.error,
          callGraph: this.callStack.map((c) => c.agentName),
        };
      }

      const outputWithContext = {
        ...((result.output as Record<string, unknown>) ?? {}),
        __callGraph: this.callStack.map((c) => c.agentName),
      };

      return {
        output: outputWithContext,
        callGraph: this.callStack.map((c) => c.agentName),
      };
    } finally {
      this.callStack.pop();
    }
  }

  async callSubAgent(
    subAgentName: string,
    input: unknown,
    parentContext: Record<string, unknown>
  ): Promise<NestedExecutorResult> {
    const code = await this.loadAgentCode(subAgentName);
    if (!code) {
      return {
        output: null,
        error: `Sub-agent "${subAgentName}" not found in registry`,
        callGraph: this.callStack.map((c) => c.agentName),
      };
    }

    const depth = this.callStack.length > 0 ? this.callStack[this.callStack.length - 1].depth + 1 : 0;
    return this.executeWithDepth(subAgentName, code, input, depth);
  }

  private async loadAgentCode(name: string): Promise<string | null> {
    if (this.codeRegistry.has(name)) {
      return this.codeRegistry.get(name)!;
    }

    const agent = getAgentByName(name);
    if (!agent) return null;

    const version = getLatestAgentVersion(agent.id);
    if (!version) return null;

    this.codeRegistry.set(name, version.code);
    return version.code;
  }

  getCallStack(): CallStack[] {
    return [...this.callStack];
  }

  static registerCallAgentTool(executor: NestedExecutor) {
    return async (input: { agent: string; params: unknown }) => {
      return executor.callSubAgent(input.agent, input.params, {});
    };
  }
}
