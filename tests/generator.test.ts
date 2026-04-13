import { describe, test, expect } from "bun:test";
import { Generator } from "../src/generator.js";
import { BaseLLMBackend, LLMMessage, LLMResponse } from "../src/llm_backend/base.js";

class MockLLMBackend implements BaseLLMBackend {
  response: LLMResponse;

  constructor(response: string) {
    this.response = { content: response, finishReason: "stop" };
  }

  async complete(_messages: LLMMessage[], _options?: {}): Promise<LLMResponse> {
    return this.response;
  }
}

test("Generator produces valid agent code", async () => {
  const mockResponse = `// agent: test_agent
// description: A test agent
// version: 1
// tools: read_file
// input_schema: {"path": "string"}
// output_schema: {"content": "string"}

/"""
## SKILL.md
# Role
A test agent

# Tools
## read_file
async function read_file(input: { path: string }): Promise<{ content: string }>

# Behavior
Read a file and return its content.
"""

import { tools, handle } from "agent-forge-runtime";

async function handle(input: unknown): Promise<unknown> {
  return { content: "test" };
}`;

  const llm = new MockLLMBackend(mockResponse);
  const generator = new Generator(llm);

  const schema = await generator.make({
    description: "A test agent",
    name: "test_agent",
    tools: ["read_file"],
  });

  expect(schema.name).toBe("test_agent");
  expect(schema.description).toBe("A test agent");
  expect(schema.version).toBe(1);
  expect(schema.tools).toContain("read_file");
});

test("Generator serializes to valid TypeScript", async () => {
  const mockResponse = `// agent: echo
// description: Echoes input
// version: 1
// tools: run_command
// input_schema: {"msg": "string"}
// output_schema: {"echo": "string"}

/"""
## SKILL.md
# Role
Echo agent
"""

async function handle(input: unknown): Promise<unknown> {
  return { echo: "echo" };
}`;

  const llm = new MockLLMBackend(mockResponse);
  const generator = new Generator(llm);

  const schema = await generator.make({
    description: "Echoes input",
    name: "echo",
    tools: [],
  });

  const code = generator.serialize(schema);
  expect(code).toContain("// agent: echo");
  expect(code).toContain("// description: Echoes input");
  expect(code).toContain("// version: 1");
  expect(code).toContain('"""');
  expect(code).toContain("async function handle");
});
