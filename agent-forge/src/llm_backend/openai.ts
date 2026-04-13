import { BaseLLMBackend, LLMMessage, LLMResponse, LLMOptions } from "./base.js";

export type OpenAIModel = "gpt-4o" | "gpt-4o-mini" | "o3" | "o3-mini" | "claude-3-5-sonnet-latest";

export class OpenAIBackend extends BaseLLMBackend {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(
    apiKey: string,
    model: OpenAIModel = "gpt-4o",
    baseUrl: string = "https://api.openai.com/v1"
  ) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    return this.retry(async () => {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 4096,
          stop: options?.stop,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI request failed: ${response.status} ${error}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string }; finish_reason: string }>;
      };

      return {
        content: data.choices[0]?.message?.content ?? "",
        finishReason: (data.choices[0]?.finish_reason === "stop" ? "stop" : "length") as "stop" | "length",
      };
    });
  }
}

export function createOpenAIBackend(): OpenAIBackend {
  const apiKey = process.env["OPENAI_API_KEY"] ?? process.env["ANTHROPIC_API_KEY"] ?? "";
  const model = (process.env["OPENAI_MODEL"] ?? "gpt-4o") as OpenAIModel;
  const baseUrl = process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
  return new OpenAIBackend(apiKey, model, baseUrl);
}
