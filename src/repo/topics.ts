import type { Db } from "../db/driver";
import type { Topic, TopicCounts, TopicNode } from "../domain/types";
import { newId } from "../lib/id";

interface TopicRow {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
  created_at: number;
  updated_at: number;
}

const toTopic = (row: TopicRow): Topic => ({
  id: row.id,
  parentId: row.parent_id,
  name: row.name,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const NO_COUNTS: TopicCounts = { notes: 0, total: 0, ready: 0, fresh: 0, strong: 0, suggested: 0 };

/** A question counts as "strong" once its memory is expected to last this many days. */
export const STRONG_AFTER_DAYS = 21;

export async function listTopics(db: Db): Promise<Topic[]> {
  const rows = await db.select<TopicRow>(`SELECT * FROM topics ORDER BY position, name`);
  return rows.map(toTopic);
}

export async function createTopic(db: Db, name: string, parentId: string | null = null): Promise<Topic> {
  const clean = cleanName(name);
  const now = Date.now();
  const id = newId();
  const [{ next }] = await db.select<{ next: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM topics WHERE parent_id IS $1`,
    [parentId],
  );
  await db.execute(
    `INSERT INTO topics (id, parent_id, name, position, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, parentId, clean, next, now],
  );
  return { id, parentId, name: clean, position: next, createdAt: now, updatedAt: now };
}

export async function renameTopic(db: Db, id: string, name: string): Promise<void> {
  await db.execute(`UPDATE topics SET name = $1, updated_at = $2 WHERE id = $3`, [
    cleanName(name),
    Date.now(),
    id,
  ]);
}

/** Deletes the topic with all its sub-topics, notes and questions (foreign keys cascade). */
export async function deleteTopic(db: Db, id: string): Promise<void> {
  await db.execute(`DELETE FROM topics WHERE id = $1`, [id]);
}

/** Note and question counts per topic (own items only; buildTopicTree rolls them up). */
export async function countByTopic(db: Db, now: number): Promise<Map<string, TopicCounts>> {
  const counts = new Map<string, TopicCounts>();
  const entry = (topicId: string) => {
    let value = counts.get(topicId);
    if (!value) {
      value = { ...NO_COUNTS };
      counts.set(topicId, value);
    }
    return value;
  };

  const questions = await db.select<{
    topic_id: string;
    total: number;
    ready: number;
    fresh: number;
    strong: number;
    suggested: number;
  }>(
    `SELECT topic_id,
            SUM(CASE WHEN status <> 'suggested' THEN 1 ELSE 0 END) AS total,
            SUM(CASE WHEN status = 'active' AND due <= $1 THEN 1 ELSE 0 END) AS ready,
            SUM(CASE WHEN status = 'active' AND state = 0 THEN 1 ELSE 0 END) AS fresh,
            SUM(CASE WHEN status = 'active' AND state = 2 AND stability >= $2 THEN 1 ELSE 0 END) AS strong,
            SUM(CASE WHEN status = 'suggested' THEN 1 ELSE 0 END) AS suggested
       FROM questions
      GROUP BY topic_id`,
    [now, STRONG_AFTER_DAYS],
  );
  for (const row of questions) {
    Object.assign(entry(row.topic_id), {
      total: Number(row.total),
      ready: Number(row.ready),
      fresh: Number(row.fresh),
      strong: Number(row.strong),
      suggested: Number(row.suggested),
    });
  }

  const notes = await db.select<{ topic_id: string; n: number }>(
    `SELECT topic_id, COUNT(*) AS n FROM notes GROUP BY topic_id`,
  );
  for (const row of notes) entry(row.topic_id).notes = Number(row.n);
  return counts;
}

/** Nest the flat topic list and roll counts up from sub-topics to parents. */
export function buildTopicTree(topics: Topic[], counts: Map<string, TopicCounts> = new Map()): TopicNode[] {
  const nodes = new Map<string, TopicNode>();
  for (const topic of topics) {
    nodes.set(topic.id, { ...topic, depth: 0, children: [], counts: { ...(counts.get(topic.id) ?? NO_COUNTS) } });
  }
  const roots: TopicNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const order = (a: TopicNode, b: TopicNode) => a.position - b.position || a.name.localeCompare(b.name);
  const finish = (node: TopicNode, depth: number) => {
    node.depth = depth;
    node.children.sort(order);
    for (const child of node.children) {
      finish(child, depth + 1);
      for (const key of Object.keys(NO_COUNTS) as (keyof TopicCounts)[]) node.counts[key] += child.counts[key];
    }
  };
  roots.sort(order);
  for (const root of roots) finish(root, 0);
  return roots;
}

export function findTopic(tree: TopicNode[], id: string): TopicNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node;
    const hit = findTopic(node.children, id);
    if (hit) return hit;
  }
  return undefined;
}

/** The topics from the top level down to the given one (for the "you are here" trail). */
export function topicPath(tree: TopicNode[], id: string): TopicNode[] {
  for (const node of tree) {
    if (node.id === id) return [node];
    const below = topicPath(node.children, id);
    if (below.length > 0) return [node, ...below];
  }
  return [];
}

/** The topic's id plus the ids of all its sub-topics. */
export function topicAndDescendantIds(node: TopicNode): string[] {
  return [node.id, ...node.children.flatMap(topicAndDescendantIds)];
}

function cleanName(name: string): string {
  const clean = name.trim();
  if (clean === "") throw new Error("A topic needs a name.");
  return clean;
}
