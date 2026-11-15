import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { toPositional, type Db } from "./driver";

const STORAGE_KEY = "tutor-preview-db";

/**
 * Browser-only SQLite for UI work with `npm run dev` (no Tauri shell).
 * Data is kept in localStorage, so it is a preview store, not real storage.
 * It is never included in the desktop build.
 */
export async function openSqljsDb(): Promise<Db> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });

  let saved: Uint8Array | undefined;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  } catch {
    saved = undefined;
  }
  const database = new SQL.Database(saved);
  database.run("PRAGMA foreign_keys = ON");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const bytes = database.export();
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        localStorage.setItem(STORAGE_KEY, btoa(binary));
        // export() resets pragmas on the connection
        database.run("PRAGMA foreign_keys = ON");
      } catch {
        // Preview storage is best-effort (quota, private mode…)
      }
    }, 400);
  };

  type Bind = Parameters<typeof database.run>[1];

  return {
    async execute(sql, params = []) {
      database.run(toPositional(sql), params as Bind);
      const rowsAffected = database.getRowsModified();
      persist();
      return { rowsAffected };
    },
    async select<T>(sql: string, params: unknown[] = []) {
      const statement = database.prepare(toPositional(sql));
      try {
        statement.bind(params as Bind);
        const rows: T[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as T);
        return rows;
      } finally {
        statement.free();
      }
    },
  };
}
