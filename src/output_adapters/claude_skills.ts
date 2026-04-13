import { OutputAdapter } from "./base.js";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync, existsSync } from "fs";

export class ClaudeSkillsAdapter implements OutputAdapter {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), ".claude", "skills");
  }

  async write(params: { name: string; code: string; description: string }): Promise<void> {
    const skillDir = join(this.baseDir, params.name);
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true });
    }

    const skillMd = this.codeToSkillMd(params.code, params.description);
    const skillMdPath = join(skillDir, "SKILL.md");
    writeFileSync(skillMdPath, skillMd, "utf-8");

    const agentFile = join(skillDir, "agent.ts");
    writeFileSync(agentFile, params.code, "utf-8");
  }

  getPath(name: string): string {
    return join(this.baseDir, name, "SKILL.md");
  }

  private codeToSkillMd(code: string, description: string): string {
    const docstringMatch = code.match(/"""\n([\s\S]+?)\n"""/);
    const docstring = docstringMatch ? docstringMatch[1] : "";

    const headerMatch = code.match(/\/\/ agent: (.+)\n\/\/ description: (.+)\n\/\/ tools: (.+)/);
    const agentName = headerMatch ? headerMatch[1] : "agent";
    const toolsLine = headerMatch ? headerMatch[3] : "";

    const skillContent = docstring || `## Role\n${description}\n\n## Tools\n${toolsLine}\n\n## Behavior\nAgent code is defined in agent.ts`;

    return `---
name: ${agentName}
description: ${description}
---
${skillContent}
`;
  }
}
