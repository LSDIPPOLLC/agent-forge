import { BaseLLMBackend, LLMMessage, LLMResponse, LLMOptions } from "./base.js";

export class OllamaBackend extends BaseLLMBackend {
  private baseUrl: string;
  private model: string;

  constructor(model: string = "llama3.2", baseUrl: string = "http://localhost:11434") {
    super();
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    return this.retry(async () => {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.7,
            num_predict: options?.maxTokens ?? 4096,
            stop: options?.stop,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        message: { content: string; stop_reason?: string };
        done_reason?: string;
      };

      return {
        content: data.message?.content ?? "",
        finishReason: (data.done_reason === "stop" ? "stop" : "length") as "stop" | "length",
      };
    });
  }
}

export function createOllamaBackend(): OllamaBackend {
  const model = process.env["OLLAMA_MODEL"] ?? "llama3.2";
  const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
  return new OllamaBackend(model, baseUrl);
}
