import { LlmError, readError, type FetchLike, type LlmProvider } from "./types";

/**
 * Adapter for anything that speaks the OpenAI chat-completions API:
 * Ollama, LM Studio, llama.cpp's server, and OpenAI itself.
 */
export interface OpenAiCompatibleConfig {
  id: string;
  label: string;
  kind: "local" | "cloud";
  /** up to and including the version segment, e.g. http://127.0.0.1:11434/v1 */
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetch: FetchLike;
}

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): LlmProvider {
  const base = config.baseUrl.replace(/\/+$/, "");
  return {
    id: config.id,
    label: config.label,
    kind: config.kind,
    model: config.model,
    async complete(messages, options = {}) {
      const body: Record<string, unknown> = { model: config.model, messages, stream: false };
      if (options.temperature !== undefined) body.temperature = options.temperature;
      if (options.maxTokens !== undefined) {
        // OpenAI's current models take max_completion_tokens; local servers take max_tokens.
        body[config.kind === "cloud" ? "max_completion_tokens" : "max_tokens"] = options.maxTokens;
      }
      const response = await config.fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: headers(config.apiKey),
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!response.ok) throw new LlmError(await readError(response), response.status);
      const data = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new LlmError("The model returned no text.");
      return text;
    },
  };
}

/** Model ids the server offers (GET /models). */
export async function listOpenAiCompatibleModels(
  baseUrl: string,
  fetch: FetchLike,
  options: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<string[]> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
    method: "GET",
    headers: headers(options.apiKey),
    signal: options.signal,
  });
  if (!response.ok) throw new LlmError(await readError(response), response.status);
  const data = (await response.json()) as { data?: { id?: unknown }[] };
  return (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
}

function headers(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}
