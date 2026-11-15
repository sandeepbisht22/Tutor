import { isTauri } from "@tauri-apps/api/core";
import type { Db } from "./driver";
import { migrate } from "./migrate";
import { migrations } from "./schema";

export type { Db } from "./driver";

let ready: Promise<Db> | undefined;

/**
 * Open the app database (once per window).
 *
 * Tutor has two windows on the same database file. Only the main window
 * creates and upgrades the tables; the sticky window waits until that is done,
 * so the two never run a migration at the same time.
 */
export function getDb(role: "main" | "sticky" = "main"): Promise<Db> {
  ready ??= open(role);
  return ready;
}

async function open(role: "main" | "sticky"): Promise<Db> {
  let db: Db;
  if (isTauri()) {
    const { openTauriDb } = await import("./tauriDriver");
    db = await openTauriDb();
  } else if (import.meta.env.DEV) {
    const { openSqljsDb } = await import("./sqljsDriver");
    db = await openSqljsDb();
  } else {
    throw new Error("Tutor has to be run as the desktop app.");
  }
  if (role === "main" || !isTauri()) await migrate(db);
  else await waitForSchema(db);
  return db;
}

async function waitForSchema(db: Db, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const rows = await db.select<{ version: number | null }>(`SELECT MAX(version) AS version FROM schema_migrations`);
      if ((rows[0]?.version ?? 0) >= migrations.length) return;
    } catch {
      // the table does not exist yet
    }
    if (Date.now() > deadline) throw new Error("The database was not ready in time.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
