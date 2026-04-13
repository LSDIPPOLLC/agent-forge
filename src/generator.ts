import { BaseLLMBackend, LLMMessage } from "./llm_backend/base.js";
import { AgentSchema, serializeAgentFile } from "./agent_schema.js";

const AVAILABLE_TOOLS = ["read_file", "run_command", "gh_api", "grep", "write_file", "search_web"];

const GENERATOR_SYSTEM_PROMPT = `You are AgentForge, an expert agent architect. Given a natural language task description, generate a self-contained TypeScript agent file.

## Task Description Format
{description}

## Requirements
1. File must define:
   - \`INPUT_SCHEMA\`: Record<string, string> — param name to type string
   - \`OUTPUT_SCHEMA\`: Record<string, string> — field name to type string
   - \`SYSTEM_PROMPT\`: string — the agent's persona and instructions
   - \`handle(input: unknown): Promise<unknown>\` — the main handler async function

2. Tools available (import from "agent-forge-runtime"):
   - read_file({ path: string }): Promise<{ content: string }>
   - run_command({ cmd: string, cwd?: string }): Promise<{ stdout: string; stderr: string }>
   - gh_api({ endpoint: string; method?: string }): Promise<unknown>
   - grep({ pattern: string; path: string }): Promise<string[]>
   - write_file({ path: string; content: string }): Promise<void>
   - search_web({ query: string }): Promise<string>

3. The agent should be a **specialist** — do one thing well, not many things poorly.

4. Follow best practices:
   - Handle errors gracefully and return error info in output
   - Validate input against INPUT_SCHEMA before processing
   - Use async/await throughout
   - Return structured JSON-serializable output

5. The agent file header comments (// agent:, // description:, etc.) are REQUIRED. These are parsed by the framework.

## SKILL.md Block
The docstring block (""") should contain a ## SKILL.md section with:
- # Role — one sentence persona
- # Tools — descriptions of each tool used with TypeScript signatures
- # Behavior — detailed instructions for the agent behavior

## Output Format
Return ONLY the complete TypeScript file content, starting with the agent header comment block. No markdown code fences.`;

const GENERATOR_USER_PROMPT = `Generate a TypeScript agent for the following task:

{task}

Available tools: {tools}

Return the complete agent file:`;

export class Generator {
  private llm: BaseLLMBackend;

  constructor(llm: BaseLLMBackend) {
    this.llm = llm;
  }

  async make(params: {
    description: string;
    name: string;
    tools: string[];
  }): Promise<AgentSchema> {
    const toolsList = params.tools.length > 0
      ? params.tools.join(", ")
      : AVAILABLE_TOOLS.slice(0, 3).join(", ");

    const messages: LLMMessage[] = [
      {
        role: "system",
        content: GENERATOR_SYSTEM_PROMPT.replace("{description}", params.description),
      },
      {
        role: "user",
        content: GENERATOR_USER_PROMPT
          .replace("{task}", params.description)
          .replace("{tools}", toolsList),
      },
    ];

    const response = await this.llm.complete(messages, {
      temperature: 0.7,
      maxTokens: 2048,
    });

    const code = response.content.trim();
    return this.codeToSchema(code, params);
  }

  private codeToSchema(code: string, params: { name: string; description: string; tools: string[] }): AgentSchema {
    const headerMatch = code.match(
      /\/\/ agent: (.+)\n\/\/ description: (.+)\n\/\/ version: (\d+)\n\/\/ tools: (.+)\n\/\/ input_schema: (.+)\n\/\/ output_schema: (.+)/
    );

    const skillMdMatch = code.match(/"""\n([\s\S]+?)\n"""/);
    const skillMd = skillMdMatch ? skillMdMatch[1] : "";

    const systemPromptMatch = skillMd.match(/# Role\n([^\n]+)/);
    const systemPrompt = systemPromptMatch ? systemPromptMatch[1] : "";

    const codeAfterDocstring = code.split(/"""\n[\s\S]+?\n"""\n?/)[1] ?? "";

    return {
      name: headerMatch ? headerMatch[1] : params.name,
      description: headerMatch ? headerMatch[2] : params.description,
      version: headerMatch ? parseInt(headerMatch[3]) : 1,
      tools: headerMatch
        ? headerMatch[4].split(",").map((t) => t.trim())
        : params.tools,
      inputSchema: headerMatch ? JSON.parse(headerMatch[5]) : {},
      outputSchema: headerMatch ? JSON.parse(headerMatch[6]) : {},
      skillMd,
      systemPrompt,
      handlerCode: codeAfterDocstring || `async function handle(input: unknown): Promise<unknown> {\n  return { error: "Not implemented" };\n}`,
    };
  }

  serialize(schema: AgentSchema): string {
    return serializeAgentFile(schema);
  }
}
