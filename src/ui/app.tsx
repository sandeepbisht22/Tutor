import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { resolveProvider, warmUpBuiltIn } from "../ai/provider";
import type { Db } from "../db";
import { createScheduler, type Scheduler } from "../lib/scheduler";
import { getFetch } from "../llm/http";
import type { LlmProvider } from "../llm/types";
import { emitEvent, engineEnsureRunning, engineStatus, getApiKey, onEvent } from "../platform";
import { loadSettings, saveSetting, type Settings } from "../repo/settings";

/** What every screen can reach: the database, the settings, the scheduler and the AI model. */
interface AppContext {
  db: Db;
  settings: Settings;
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
  scheduler: Scheduler;
  /** the AI model to use right now, or null when there is none */
  getProvider(): Promise<LlmProvider | null>;
  /** forget the cached model (after the AI setup changed) */
  resetProvider(): void;
  /** goes up whenever data changed anywhere; screens reload when it does */
  version: number;
  /** call after saving something other screens (or the other window) may be showing */
  changed(): void;
}

const Context = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const value = useContext(Context);
  if (!value) throw new Error("useApp used outside AppProvider");
  return value;
}

const PROVIDER_TTL = 30_000;

const BUILT_IN = {
  installed: async () => {
    const status = await engineStatus();
    return status.installed ? { modelName: status.modelName } : null;
  },
  start: engineEnsureRunning,
};

/** Start Tutor's built-in AI now if it is the model Tutor would use (see warmUpBuiltIn). */
export async function startBuiltInEarly(settings: Settings): Promise<boolean> {
  return warmUpBuiltIn(settings, { fetch: await getFetch(), builtIn: BUILT_IN });
}

export function AppProvider({ db, initialSettings, children }: { db: Db; initialSettings: Settings; children: ReactNode }) {
  const [settings, setSettings] = useState(initialSettings);
  const [version, setVersion] = useState(0);
  const provider = useRef<{ at: number; value: Promise<LlmProvider | null> } | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const resetProvider = useCallback(() => {
    provider.current = null;
  }, []);

  const changed = useCallback(() => {
    setVersion((n) => n + 1);
    void emitEvent("tutor://data-changed");
  }, []);

  // The other window saved something: reload settings and whatever is on screen.
  useEffect(
    () =>
      onEvent("tutor://data-changed", () => {
        void loadSettings(db).then(setSettings);
        provider.current = null;
        setVersion((n) => n + 1);
      }),
    [db],
  );

  const setSetting = useCallback(
    async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings((current) => ({ ...current, [key]: value }));
      provider.current = null;
      await saveSetting(db, key, value);
      void emitEvent("tutor://data-changed");
    },
    [db],
  );

  const getProvider = useCallback(() => {
    const cached = provider.current;
    if (cached && Date.now() - cached.at < PROVIDER_TTL) return cached.value;
    const value = getFetch()
      .then((fetch) => resolveProvider(settingsRef.current, { fetch, getApiKey, builtIn: BUILT_IN }))
      .catch(() => null);
    provider.current = { at: Date.now(), value };
    return value;
  }, []);

  const scheduler = useMemo(() => createScheduler({ retention: settings.retention }), [settings.retention]);

  const value = useMemo<AppContext>(
    () => ({ db, settings, setSetting, scheduler, getProvider, resetProvider, version, changed }),
    [db, settings, setSetting, scheduler, getProvider, resetProvider, version, changed],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * Load something from the database and keep it fresh: runs again when `deps`
 * change and whenever data changed anywhere. Undefined until the first load.
 */
export function useLoad<T>(load: (db: Db) => Promise<T>, deps: unknown[]): T | undefined {
  const { db, version } = useApp();
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let active = true;
    load(db)
      .then((result) => active && setValue(result))
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, ...deps]);
  return value;
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Something went wrong.";
}
