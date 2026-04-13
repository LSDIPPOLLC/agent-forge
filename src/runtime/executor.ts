import { spawn } from "child_process";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export interface ExecutorResult {
  output: unknown;
  error?: string;
  executionTimeMs: number;
  stdout: string;
  stderr: string;
}

export class Executor {
  private tempDir: string;
  private timeoutMs: number;

  constructor(tempDir?: string, timeoutMs = 30000) {
    this.tempDir = tempDir ?? join(process.env["TMPDIR"] ?? "/tmp", "agent-forge-runtime");
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true });
    }
    this.timeoutMs = timeoutMs;
  }

  async execute(agentCode: string, input: unknown): Promise<ExecutorResult> {
    const runId = randomUUID().slice(0, 8);
    const agentFile = join(this.tempDir, `exec_${runId}.ts`);
    const inputFile = join(this.tempDir, `input_${runId}.json`);

    const runtimeCode = `
// Agent runtime shim
export const tools = {
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
}
`;

    const runtimeFile = join(this.tempDir, `runtime_${runId}.ts`);
    writeFileSync(runtimeFile, runtimeCode);
    writeFileSync(inputFile, JSON.stringify(input));

    const fullCode = `import { tools, handle } from "./runtime_${runId}.ts";
${agentCode}
import { readFileSync } from "fs";
const input = JSON.parse(readFileSync("./input_${runId}.json", "utf-8"));
const result = await handle(input);
console.log(JSON.stringify(result));`;

    writeFileSync(agentFile, fullCode);

    const start = Date.now();
    try {
      const { stdout, stderr } = await this.execFile(agentFile);
      const output = JSON.parse(stdout.trim());
      return {
        output,
        executionTimeMs: Date.now() - start,
        stdout,
        stderr,
      };
    } catch (e) {
      return {
        output: null,
        error: String(e),
        executionTimeMs: Date.now() - start,
        stdout: "",
        stderr: String(e),
      };
    } finally {
      try {
        unlinkSync(agentFile);
        unlinkSync(inputFile);
        unlinkSync(runtimeFile);
      } catch {}
    }
  }

  private execFile(file: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn("bun", [file], {
        cwd: this.tempDir,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (d) => (stdout += d.toString()));
      proc.stderr?.on("data", (d) => (stderr += d.toString()));

      proc.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(stderr || `Process exited with code ${code}`));
        }
      });

      proc.on("error", reject);

      setTimeout(() => {
        proc.kill();
        reject(new Error("Execution timeout"));
      }, this.timeoutMs);
    });
  }
}
