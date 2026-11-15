import type { Db } from "../db/driver";
import type { StoredImage } from "../domain/types";
import { newId } from "../lib/id";

export async function saveImage(
  db: Db,
  input: { noteId: string; mime: string; data: string; width: number; height: number },
): Promise<StoredImage> {
  const id = newId();
  await db.execute(
    `INSERT INTO images (id, note_id, mime, data, width, height, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.noteId, input.mime, input.data, Math.round(input.width), Math.round(input.height), Date.now()],
  );
  return { id, mime: input.mime, data: input.data, width: input.width, height: input.height };
}

export async function getImage(db: Db, id: string): Promise<StoredImage | null> {
  const rows = await db.select<StoredImage>(`SELECT id, mime, data, width, height FROM images WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export function imageDataUrl(image: StoredImage): string {
  return `data:${image.mime};base64,${image.data}`;
}
