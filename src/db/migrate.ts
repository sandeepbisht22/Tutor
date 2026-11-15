import type { Db } from "./driver";
import { migrations } from "./schema";

/** Bring the database up to the latest schema version. Safe to call on every start. */
export async function migrate(db: Db, steps: string[][] = migrations): Promise<number> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`,
  );
  const rows = await db.select<{ version: number | null }>(
    `SELECT MAX(version) AS version FROM schema_migrations`,
  );
  const current = rows[0]?.version ?? 0;

  for (let v = current; v < steps.length; v++) {
    for (const statement of steps[v]) {
      await db.execute(statement);
    }
    await db.execute(`INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)`, [
      v + 1,
      Date.now(),
    ]);
  }
  return steps.length;
}
