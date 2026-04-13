import { OutputAdapter } from "./base.js";
import { join } from "path";
import { mkdirSync, writeFileSync, existsSync } from "fs";

export class StandaloneAdapter implements OutputAdapter {
  private baseDir: string;

  constructor(baseDir: string = "./agents") {
    this.baseDir = baseDir;
  }

  async write(params: { name: string; code: string; description: string }): Promise<void> {
    const agentDir = join(this.baseDir, params.name);
    if (!existsSync(agentDir)) {
      mkdirSync(agentDir, { recursive: true });
    }

    const agentFile = join(agentDir, "agent.ts");
    writeFileSync(agentFile, params.code, "utf-8");

    const readme = this.buildReadme(params.name, params.description);
    const readmePath = join(agentDir, "README.md");
    writeFileSync(readmePath, readme, "utf-8");
  }

  getPath(name: string): string {
    return join(this.baseDir, name, "agent.ts");
  }

  private buildReadme(name: string, description: string): string {
    return `# ${name}

${description}

## Usage

\`\`\`bash
bun run agent.ts '{"input": {}}'
\`\`\`

## Files

- \`agent.ts\` — the agent implementation
- \`README.md\` — this file
`;
  }
}
