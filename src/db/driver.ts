/**
 * Minimal database interface the whole app talks to.
 *
 * Three implementations exist:
 *  - tauriDriver: the real one, SQLite through tauri-plugin-sql (desktop app)
 *  - sqljsDriver: in-browser SQLite, only for `npm run dev` UI work without Tauri
 *  - test/nodeDb: node:sqlite, used by the unit tests
 *
 * SQL is written with `$1, $2 …` placeholders (what tauri-plugin-sql expects).
 *
 * Note: tauri-plugin-sql uses a connection pool, so BEGIN/COMMIT spread over
 * several execute() calls is not reliable. Keep each operation to as few
 * statements as possible and do not rely on multi-call transactions.
 */
export interface Db {
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** `$1` → `?1`, for drivers that only understand SQLite's numbered `?NNN` form. */
export function toPositional(sql: string): string {
  return sql.replace(/\$(\d+)/g, "?$1");
}
