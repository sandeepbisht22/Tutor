/**
 * One interface for every LLM the app can talk to. The rest of the app never
 * knows (or cares) whether it is Ollama, LM Studio, a bundled model or a cloud API.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  /** e.g. "ollama", "lmstudio", "openai", "anthropic" */
  id: string;
  /** shown only in the advanced part of Settings */
  label: string;
  /** local = runs on this device; cloud = notes leave the device */
  kind: "local" | "cloud";
  model: string;
  complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class LlmError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

export async function readError(response: Response): Promise<string> {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 300);
  } catch {
    // no body
  }
  return `Request failed (${response.status})${detail ? `: ${detail}` : ""}`;
}
