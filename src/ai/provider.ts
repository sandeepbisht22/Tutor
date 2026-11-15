import { createAnthropicProvider } from "../llm/anthropic";
import { resolveLocalProvider } from "../llm/detect";
import { createOpenAiCompatibleProvider } from "../llm/openaiCompatible";
import type { FetchLike, LlmProvider } from "../llm/types";
import type { CloudProvider, Settings } from "../repo/settings";

/** Tutor's own engine: a model Tutor downloaded and runs itself. */
export interface BuiltIn {
  /** installed, and with which model; null when not installed */
  installed(): Promise<{ modelName: string } | null>;
  /** start it if needed and wait until it can answer; resolves to its local port */
  start(): Promise<number>;
}

export interface ProviderDeps {
  fetch: FetchLike;
  /** reads the API key from the system keychain */
  getApiKey(provider: Exclude<CloudProvider, "">): Promise<string | null>;
  builtIn?: BuiltIn;
}

export const CLOUD_LABELS: Record<Exclude<CloudProvider, "">, string> = {
  anthropic: "Claude",
  openai: "ChatGPT",
};

type AiSettings = Pick<Settings, "aiMode" | "localModel" | "cloudProvider" | "cloudModel">;

/**
 * The model Tutor should use right now, following the user's choice.
 * On this computer, in this order: an AI app that is already running
 * (Ollama, LM Studio), then Tutor's built-in engine. After that the connected
 * cloud model, unless the user chose "this computer only".
 * Null means "work without AI".
 */
export async function resolveProvider(settings: AiSettings, deps: ProviderDeps): Promise<LlmProvider | null> {
  if (settings.aiMode === "off") return null;
  if (settings.aiMode !== "cloud") {
    const local = await deviceProvider(settings, deps);
    if (local || settings.aiMode === "device") return local;
  }
  return cloudProvider(settings, deps);
}

/** The parts of ProviderDeps a model on this computer needs (never the keychain). */
type DeviceDeps = Pick<ProviderDeps, "fetch" | "builtIn">;

/**
 * Start Tutor's built-in engine ahead of the first request, so the first
 * suggestion does not wait for the model to load. Only when the built-in
 * engine is the model Tutor would use: not when AI is off or cloud-only, not
 * when it is not installed, and not when Ollama or LM Studio is running
 * (those come first). Resolves to true when it started the engine.
 */
export async function warmUpBuiltIn(settings: AiSettings, deps: DeviceDeps): Promise<boolean> {
  if (!deps.builtIn || settings.aiMode === "off" || settings.aiMode === "cloud") return false;
  const local = await deviceProvider(settings, deps);
  if (local?.id !== "builtin") return false;
  await deps.builtIn.start();
  return true;
}

/** A model on this computer: an AI app that is already running (Ollama, LM Studio), then Tutor's built-in engine. */
async function deviceProvider(settings: AiSettings, deps: DeviceDeps): Promise<LlmProvider | null> {
  return (await resolveLocalProvider(deps.fetch, { preferredModel: settings.localModel })) ?? (await builtInProvider(deps));
}

async function builtInProvider(deps: DeviceDeps): Promise<LlmProvider | null> {
  const builtIn = deps.builtIn;
  const installed = await builtIn?.installed().catch(() => null);
  if (!builtIn || !installed) return null;
  return {
    id: "builtin",
    label: "Tutor's built-in AI",
    kind: "local",
    model: installed.modelName,
    // The engine is started on first use and may have been stopped since, so
    // every request asks for it (a no-op when it is already running).
    async complete(messages, options) {
      const port = await builtIn.start();
      return createOpenAiCompatibleProvider({
        id: "builtin",
        label: "Tutor's built-in AI",
        kind: "local",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: installed.modelName,
        fetch: deps.fetch,
      }).complete(messages, options);
    },
  };
}

async function cloudProvider(settings: AiSettings, deps: ProviderDeps): Promise<LlmProvider | null> {
  if (!settings.cloudProvider || !settings.cloudModel) return null;
  const apiKey = await deps.getApiKey(settings.cloudProvider);
  if (!apiKey) return null;
  if (settings.cloudProvider === "anthropic") {
    return createAnthropicProvider({ apiKey, model: settings.cloudModel, fetch: deps.fetch });
  }
  return createOpenAiCompatibleProvider({
    id: "openai",
    label: "ChatGPT (OpenAI API)",
    kind: "cloud",
    baseUrl: "https://api.openai.com/v1",
    model: settings.cloudModel,
    apiKey,
    fetch: deps.fetch,
  });
}
