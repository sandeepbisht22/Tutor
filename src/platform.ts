import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Everything that differs between the desktop app and the browser preview
 * (`npm run dev` without Tauri) goes through this file.
 */

export const desktop = isTauri();

/** Which of Tutor's two windows this page is: the main one, or the sticky question. */
export async function windowKind(): Promise<"main" | "sticky"> {
  if (desktop) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().label === "sticky" ? "sticky" : "main";
  }
  return location.hash === "#sticky" ? "sticky" : "main";
}

// ---------- events between the two windows ----------

export type TutorEvent =
  | "tutor://data-changed" // something was saved; other windows should reload what they show
  | "tutor://practising" // payload: boolean — a practice session is open in the main window
  | "tutor://tick" // sent by the desktop shell every 15 s to the sticky window
  | "tutor://pause-stickies" // payload: minutes — chosen from the tray menu
  | "tutor://engine-progress"; // payload: EngineProgress — while the built-in AI is being downloaded

const channel = !desktop && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("tutor") : null;

export async function emitEvent(name: TutorEvent, payload?: unknown): Promise<void> {
  if (desktop) {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(name, payload);
  } else {
    channel?.postMessage({ name, payload });
  }
}

/** Listen for an event from the other window or the shell. Returns a function that stops listening. */
export function onEvent<T = unknown>(name: TutorEvent, handler: (payload: T) => void): () => void {
  if (desktop) {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<T>(name, (event) => handler(event.payload)).then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      }),
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }
  const listener = (event: MessageEvent<{ name: string; payload: T }>) => {
    if (event.data.name === name) handler(event.data.payload);
  };
  channel?.addEventListener("message", listener);
  return () => channel?.removeEventListener("message", listener);
}

// ---------- windows ----------

export const showMainWindow = () => (desktop ? invoke<void>("show_main") : Promise.resolve());
export const showSticky = () => (desktop ? invoke<void>("sticky_show") : Promise.resolve());
export const hideSticky = () => (desktop ? invoke<void>("sticky_hide") : Promise.resolve());
export const compactSticky = (compact: boolean) =>
  desktop ? invoke<void>("sticky_compact", { compact }) : Promise.resolve();

// ---------- secrets (cloud API keys) ----------

const keyName = (provider: string) => `api-key-${provider}`;

/** In the desktop app keys live in the system keychain. The browser preview keeps them for the tab only. */
export async function getApiKey(provider: string): Promise<string | null> {
  if (desktop) return invoke<string | null>("secret_get", { name: keyName(provider) });
  return sessionStorage.getItem(keyName(provider));
}

export async function setApiKey(provider: string, value: string): Promise<void> {
  if (desktop) await invoke("secret_set", { name: keyName(provider), value });
  else sessionStorage.setItem(keyName(provider), value);
}

export async function deleteApiKey(provider: string): Promise<void> {
  if (desktop) await invoke("secret_delete", { name: keyName(provider) });
  else sessionStorage.removeItem(keyName(provider));
}

// ---------- system ----------

export async function totalMemoryGb(): Promise<number | null> {
  if (!desktop) return null;
  try {
    return await invoke<number>("total_memory_gb");
  } catch {
    return null;
  }
}

export async function launchAtLoginEnabled(): Promise<boolean> {
  if (!desktop) return false;
  try {
    const { isEnabled } = await import("@tauri-apps/plugin-autostart");
    return await isEnabled();
  } catch {
    return false;
  }
}

export async function setLaunchAtLogin(on: boolean): Promise<void> {
  if (!desktop) return;
  const { enable, disable } = await import("@tauri-apps/plugin-autostart");
  await (on ? enable() : disable());
}

// ---------- the built-in AI engine (desktop app only) ----------

export interface EngineStatus {
  /** the engine and its model are on this computer */
  installed: boolean;
  installing: boolean;
  running: boolean;
  modelName: string;
}

export interface EngineProgress {
  stage: "engine" | "unpacking" | "model";
  received: number;
  total: number;
}

const NO_ENGINE: EngineStatus = { installed: false, installing: false, running: false, modelName: "" };

export async function engineStatus(): Promise<EngineStatus> {
  if (!desktop) return NO_ENGINE;
  try {
    return await invoke<EngineStatus>("engine_status");
  } catch {
    return NO_ENGINE;
  }
}

/** Download the engine and model. Resolves when both are on disk; rejects with a readable reason. */
export const engineInstall = () => invoke<void>("engine_install");
export const engineCancel = () => invoke<void>("engine_cancel");
/** Start the engine if needed and wait until the model is loaded. Returns its local port. */
export const engineEnsureRunning = () => invoke<number>("engine_ensure_running");
export const engineRemove = () => invoke<void>("engine_remove");
