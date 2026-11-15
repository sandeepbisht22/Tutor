/**
 * Topic colours: each top-level topic gets one of the tag colours, picked from
 * its id so it stays the same without being stored. Sub-topics share the colour
 * of their top-level topic, the way volumes of one series share a binding.
 */
export const TAG_COLORS = ["red", "orange", "yellow", "lime", "teal", "ice", "blue", "purple", "pink"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

interface TreeNode {
  id: string;
  children: TreeNode[];
}

export function tagColor(id: string): TagColor {
  let hash = 2166136261; // FNV-1a: small, stable, and spreads short ids well
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return TAG_COLORS[(hash >>> 0) % TAG_COLORS.length];
}

/** The id of the top-level topic that holds `id`, or null when it is not in the tree. */
export function rootTopicId(tree: readonly TreeNode[], id: string): string | null {
  const holds = (node: TreeNode): boolean => node.id === id || node.children.some(holds);
  return tree.find(holds)?.id ?? null;
}

export function topicTagColor(tree: readonly TreeNode[], id: string): TagColor {
  return tagColor(rootTopicId(tree, id) ?? id);
}

const USUAL_ANSWER_MS = 12_000;
const MIN_ANSWER_MS = 4_000;
const MAX_ANSWER_MS = 60_000;

/** Whole minutes to answer `count` questions at the user's typical pace (a usual pace without history). */
export function estimateMinutes(count: number, typicalAnswerMs: number | null): number {
  if (count <= 0) return 0;
  const pace = Math.min(MAX_ANSWER_MS, Math.max(MIN_ANSWER_MS, typicalAnswerMs ?? USUAL_ANSWER_MS));
  return Math.max(1, Math.ceil((count * pace) / 60_000));
}
