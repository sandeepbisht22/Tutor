import { createOpenAiCompatibleProvider, listOpenAiCompatibleModels } from "./openaiCompatible";
import type { FetchLike, LlmProvider } from "./types";

/** Local LLM apps we look for, at their default ports. Both speak the OpenAI API. */
export const LOCAL_SERVERS = [
  { id: "ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
] as const;

export interface DetectedServer {
  id: string;
  label: string;
  baseUrl: string;
  /** chat-capable models the server has, in the server's order */
  models: string[];
}

/** Embedding / reranking models can't write questions. */
const NOT_CHAT = /embed|rerank|bge-|minilm|e5-/i;

export function chatModels(models: string[]): string[] {
  return models.filter((name) => !NOT_CHAT.test(name));
}

/** The user's chosen model if the server still has it, otherwise the first chat model. */
export function pickModel(models: string[], preferred = ""): string | null {
  const usable = chatModels(models);
  if (preferred && usable.includes(preferred)) return preferred;
  return usable[0] ?? null;
}

/** Find local LLM servers that are running right now. Never throws. */
export async function detectLocalServers(fetch: FetchLike, timeoutMs = 1500): Promise<DetectedServer[]> {
  const found = await Promise.all(
    LOCAL_SERVERS.map(async (server): Promise<DetectedServer | null> => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, timeoutMs);
      });
      try {
        const models = await Promise.race([
          listOpenAiCompatibleModels(server.baseUrl, fetch, { signal: controller.signal }),
          timeout,
        ]);
        if (models === null) return null;
        return { ...server, models: chatModels(models) };
      } catch {
        return null; // not running
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return found.filter((server): server is DetectedServer => server !== null);
}

/**
 * The provider the app should use right now, or null when none is available
 * (the app then simply works without smart features).
 */
export async function resolveLocalProvider(
  fetch: FetchLike,
  options: { preferredModel?: string; timeoutMs?: number } = {},
): Promise<LlmProvider | null> {
  const servers = await detectLocalServers(fetch, options.timeoutMs);
  for (const server of servers) {
    const model = pickModel(server.models, options.preferredModel);
    if (model) {
      return createOpenAiCompatibleProvider({
        id: server.id,
        label: server.label,
        kind: "local",
        baseUrl: server.baseUrl,
        model,
        fetch,
      });
    }
  }
  return null;
}
