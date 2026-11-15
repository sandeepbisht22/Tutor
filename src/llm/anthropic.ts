import { LlmError, readError, type FetchLike, type LlmProvider } from "./types";

const API = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";

/** Adapter for Claude through the Anthropic Messages API (needs an API key, not a Claude.ai plan). */
export function createAnthropicProvider(config: { apiKey: string; model: string; fetch: FetchLike }): LlmProvider {
  return {
    id: "anthropic",
    label: "Claude (Anthropic API)",
    kind: "cloud",
    model: config.model,
    async complete(messages, options = {}) {
      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
      const body: Record<string, unknown> = {
        model: config.model,
        max_tokens: options.maxTokens ?? 1024,
        messages: messages.filter((m) => m.role !== "system"),
      };
      if (system) body.system = system;
      if (options.temperature !== undefined) body.temperature = options.temperature;

      const response = await config.fetch(`${API}/messages`, {
        method: "POST",
        headers: headers(config.apiKey),
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!response.ok) throw new LlmError(await readError(response), response.status);
      const data = (await response.json()) as { content?: { type?: string; text?: string }[] };
      const text = (data.content ?? [])
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("");
      if (text === "") throw new LlmError("The model returned no text.");
      return text;
    },
  };
}

export async function listAnthropicModels(apiKey: string, fetch: FetchLike, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${API}/models`, { method: "GET", headers: headers(apiKey), signal });
  if (!response.ok) throw new LlmError(await readError(response), response.status);
  const data = (await response.json()) as { data?: { id?: unknown }[] };
  return (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
}

function headers(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": API_VERSION,
  };
}
