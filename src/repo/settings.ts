import type { Db } from "../db/driver";

/**
 * auto    use a model on this computer if there is one, otherwise the connected cloud model
 * device  only ever use a model on this computer
 * cloud   use the connected cloud model
 * off     no AI at all
 */
export type AiMode = "auto" | "device" | "cloud" | "off";
export type CloudProvider = "" | "anthropic" | "openai";

export interface Settings {
  /** share of questions you want to still remember when they come back, 0.7–0.97 */
  retention: number;

  aiMode: AiMode;
  /** model to use on the local AI app; empty = pick automatically */
  localModel: string;
  cloudProvider: CloudProvider;
  cloudModel: string;
  /** write question suggestions from notes in the background */
  autoSuggest: boolean;
  /** add AI-written questions straight to practice instead of asking first */
  autoAccept: boolean;
  /** let the AI check answers you type */
  checkAnswers: boolean;

  /** show questions as sticky notes on the desktop */
  stickyEnabled: boolean;
  /** minutes between sticky questions */
  stickyEveryMinutes: number;
  /** no sticky questions before this time (epoch ms) */
  stickyPausedUntil: number;
}

export const DEFAULT_SETTINGS: Settings = {
  retention: 0.9,
  aiMode: "auto",
  localModel: "",
  cloudProvider: "",
  cloudModel: "",
  autoSuggest: true,
  autoAccept: false,
  checkAnswers: true,
  stickyEnabled: true,
  stickyEveryMinutes: 20,
  stickyPausedUntil: 0,
};

export const STICKY_INTERVALS = [5, 10, 20, 30, 60, 120];

export async function loadSettings(db: Db): Promise<Settings> {
  const rows = await db.select<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const stored: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      // ignore unreadable values and fall back to the default
    }
  }

  // Keep a stored value only if it has the same type as the default.
  const settings: Settings = { ...DEFAULT_SETTINGS };
  const target = settings as unknown as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof stored[key] === typeof fallback) target[key] = stored[key];
  }

  settings.retention = clampRetention(settings.retention);
  if (!["auto", "device", "cloud", "off"].includes(settings.aiMode)) settings.aiMode = DEFAULT_SETTINGS.aiMode;
  if (!["", "anthropic", "openai"].includes(settings.cloudProvider)) settings.cloudProvider = "";
  settings.stickyEveryMinutes = Math.min(240, Math.max(1, Math.round(settings.stickyEveryMinutes)));
  return settings;
}

export async function saveSetting<K extends keyof Settings>(db: Db, key: K, value: Settings[K]): Promise<void> {
  await db.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}

export function clampRetention(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_SETTINGS.retention;
  return Math.min(0.97, Math.max(0.7, n));
}
