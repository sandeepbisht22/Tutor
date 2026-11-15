import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { toPositional, type Db } from "../db/driver";
import { migrate } from "../db/migrate";

/** In-memory SQLite for unit tests, behind the same interface the app uses. */
export async function openTestDb(): Promise<Db> {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const db: Db = {
    async execute(sql, params = []) {
      const result = database.prepare(toPositional(sql)).run(...(params as SQLInputValue[]));
      return { rowsAffected: Number(result.changes) };
    },
    async select<T>(sql: string, params: unknown[] = []) {
      return database.prepare(toPositional(sql)).all(...(params as SQLInputValue[])) as T[];
    },
  };
  await migrate(db);
  return db;
}
