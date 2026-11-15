import { isTauri } from "@tauri-apps/api/core";
import type { FetchLike } from "./types";

let cached: Promise<FetchLike> | undefined;

/**
 * In the desktop app, requests go through Tauri's HTTP plugin (made from Rust),
 * so local LLM servers don't reject them for cross-origin reasons. The URLs it
 * may reach are listed in src-tauri/capabilities/default.json.
 */
export function getFetch(): Promise<FetchLike> {
  cached ??= (async () => {
    if (isTauri()) {
      const http = await import("@tauri-apps/plugin-http");
      return (input: string, init?: RequestInit) => http.fetch(input, init);
    }
    return (input: string, init?: RequestInit) => globalThis.fetch(input, init);
  })();
  return cached;
}
