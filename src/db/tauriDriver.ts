import Database from "@tauri-apps/plugin-sql";
import type { Db } from "./driver";

/** Real storage: a SQLite file in the app's data directory. */
export async function openTauriDb(): Promise<Db> {
  const database = await Database.load("sqlite:tutor.db");
  return {
    async execute(sql, params = []) {
      const result = await database.execute(sql, params);
      return { rowsAffected: result.rowsAffected };
    },
    select<T>(sql: string, params: unknown[] = []) {
      return database.select<T[]>(sql, params);
    },
  };
}
