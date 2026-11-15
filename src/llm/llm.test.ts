import { describe, expect, it } from "vitest";
import { createAnthropicProvider } from "./anthropic";
import { detectLocalServers, pickModel, resolveLocalProvider } from "./detect";
import { extractJson } from "./json";
import { createOpenAiCompatibleProvider } from "./openaiCompatible";
import { LlmError, type FetchLike } from "./types";

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("OpenAI-compatible provider", () => {
  it("posts a chat completion and returns the text", async () => {
    const { fetch, calls } = fakeFetch(() => json({ choices: [{ message: { content: "hello" } }] }));
    const provider = createOpenAiCompatibleProvider({
      id: "ollama",
      label: "Ollama",
      kind: "local",
      baseUrl: "http://127.0.0.1:11434/v1/",
      model: "llama3",
      fetch,
    });
    const text = await provider.complete([{ role: "user", content: "hi" }], { maxTokens: 50 });

    expect(text).toBe("hello");
    expect(calls[0].url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ model: "llama3", max_tokens: 50, stream: false });
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("sends the API key and max_completion_tokens for cloud", async () => {
    const { fetch, calls } = fakeFetch(() => json({ choices: [{ message: { content: "ok" } }] }));
    const provider = createOpenAiCompatibleProvider({
      id: "openai",
      label: "OpenAI",
      kind: "cloud",
      baseUrl: "https://api.openai.com/v1",
      model: "some-model",
      apiKey: "sk-test",
      fetch,
    });
    await provider.complete([{ role: "user", content: "hi" }], { maxTokens: 50 });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.max_completion_tokens).toBe(50);
    expect(body.max_tokens).toBeUndefined();
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("turns HTTP errors into LlmError with the status", async () => {
    const { fetch } = fakeFetch(() => new Response("model not found", { status: 404 }));
    const provider = createOpenAiCompatibleProvider({
      id: "ollama",
      label: "Ollama",
      kind: "local",
      baseUrl: "http://x/v1",
      model: "nope",
      fetch,
    });
    const error = await provider.complete([{ role: "user", content: "hi" }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).status).toBe(404);
    expect((error as LlmError).message).toContain("model not found");
  });
});

describe("Anthropic provider", () => {
  it("moves system messages to the system field and joins text parts", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ content: [{ type: "text", text: "Hel" }, { type: "text", text: "lo" }] }),
    );
    const provider = createAnthropicProvider({ apiKey: "key", model: "claude-test", fetch });
    const text = await provider.complete([
      { role: "system", content: "Be brief." },
      { role: "user", content: "hi" },
    ]);

    expect(text).toBe("Hello");
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.system).toBe("Be brief.");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.max_tokens).toBe(1024);
  });
});

describe("local LLM detection", () => {
  it("finds running servers and ignores ones that are down", async () => {
    const { fetch } = fakeFetch((url) => {
      if (url.startsWith("http://127.0.0.1:11434")) {
        return json({ data: [{ id: "nomic-embed-text" }, { id: "llama3.2" }] });
      }
      throw new TypeError("connection refused");
    });
    const servers = await detectLocalServers(fetch);
    expect(servers).toHaveLength(1);
    expect(servers[0].id).toBe("ollama");
    expect(servers[0].models).toEqual(["llama3.2"]); // embedding model filtered out
  });

  it("gives up on a server that never answers", async () => {
    const { fetch } = fakeFetch(() => new Promise<Response>(() => {}));
    const started = Date.now();
    expect(await detectLocalServers(fetch, 50)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("picks the preferred model when available, else the first chat model", () => {
    expect(pickModel(["a", "b"], "b")).toBe("b");
    expect(pickModel(["a", "b"], "gone")).toBe("a");
    expect(pickModel(["bge-m3", "text-embedding-3"])).toBeNull();
  });

  it("resolves to a ready provider, or null when nothing is installed", async () => {
    const up = fakeFetch((url) =>
      url.includes(":1234") ? json({ data: [{ id: "qwen" }] }) : new Response("", { status: 502 }),
    );
    const provider = await resolveLocalProvider(up.fetch);
    expect(provider).toMatchObject({ id: "lmstudio", kind: "local", model: "qwen" });

    const down = fakeFetch(() => {
      throw new TypeError("connection refused");
    });
    expect(await resolveLocalProvider(down.fetch)).toBeNull();
  });
});

describe("extractJson", () => {
  it("reads JSON wrapped in prose and code fences", () => {
    expect(extractJson('Sure! ```json\n{"items":[{"q":"a {b}","a":"c"}]}\n``` Done.')).toEqual({
      items: [{ q: "a {b}", a: "c" }],
    });
    expect(extractJson('Here: [1, 2, {"x": "]"}]')).toEqual([1, 2, { x: "]" }]);
  });

  it("skips broken fragments and returns null when there is no JSON", () => {
    expect(extractJson('{oops} then {"ok": true}')).toEqual({ ok: true });
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson('{"unterminated": ')).toBeNull();
  });
});
