export interface InputSchemaField {
  type: string;
  description?: string;
}

export interface OutputSchemaField {
  type: string;
  description?: string;
}

export interface AgentSchema {
  name: string;
  description: string;
  version: number;
  tools: string[];
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  skillMd: string;
  systemPrompt: string;
  handlerCode: string;
}

export interface AgentFile {
  header: {
    agent: string;
    version: number;
    description: string;
    tools: string[];
    input_schema: string;
    output_schema: string;
  };
  skillMd: string;
  code: string;
}

export function parseAgentFile(content: string): AgentSchema | null {
  const headerMatch = content.match(/^\/\/ agent: (.+)\n\/\/ description: (.+)\n\/\/ version: (\d+)\n\/\/ tools: (.+)\n\/\/ input_schema: (.+)\n\/\/ output_schema: (.+)/);

  if (!headerMatch) return null;

  const skillMdMatch = content.match(/"""\n([\s\S]+?)\n"""/);
  const skillMd = skillMdMatch ? skillMdMatch[1] : "";

  const codeMatch = content.match(/"""\n[\s\S]+?\n"""\n([\s\S]+)$/);
  const code = codeMatch ? codeMatch[1] : "";

  return {
    name: headerMatch[1],
    description: headerMatch[2],
    version: parseInt(headerMatch[3]),
    tools: headerMatch[4].split(",").map((t) => t.trim()),
    inputSchema: JSON.parse(headerMatch[5]),
    outputSchema: JSON.parse(headerMatch[6]),
    skillMd,
    systemPrompt: "",
    handlerCode: code,
  };
}

export function serializeAgentFile(schema: AgentSchema): string {
  const header = `// agent: ${schema.name}
// description: ${schema.description}
// version: ${schema.version}
// tools: ${schema.tools.join(", ")}
// input_schema: ${JSON.stringify(schema.inputSchema)}
// output_schema: ${JSON.stringify(schema.outputSchema)}`;

  const skillBlock = `"""
${schema.skillMd}
"""`;

  return [header, skillBlock, schema.handlerCode].join("\n");
}

export function schemaToFilePath(name: string): string {
  return `agents/${name}/agent.ts`;
}
