import type { Annotation, DocNode, NoteBlock } from "../domain/types";
import { newId } from "./id";

/**
 * A note is a list of top-level blocks (paragraph, heading, list, code…).
 * Every block carries a stable `blockId` attribute so a question can point at the
 * exact text it was made from, and a hash so we can tell when that text changed.
 */

export const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };

const INLINE = new Set(["text", "hardBreak"]);

/** Plain text of a node. Inline children are joined directly, block children by newline. */
export function nodeText(node: DocNode): string {
  if (node.type === "figure") return figureText(node);
  if (typeof node.text === "string") return node.text;
  if (node.type === "hardBreak") return "\n";
  const children = node.content ?? [];
  if (children.length === 0) return "";
  const inline = children.every((child) => INLINE.has(child.type));
  return children
    .map(nodeText)
    .filter((part) => inline || part.trim() !== "")
    .join(inline ? "" : "\n");
}

/** An image reads as its description plus the words written on it. Never empty. */
function figureText(node: DocNode): string {
  const description = typeof node.attrs?.description === "string" ? node.attrs.description.trim() : "";
  const labels = figureAnnotations(node)
    .map((a) => a.text.trim())
    .filter((text) => text !== "");
  const parts = [description ? `Image: ${description}` : "Image"];
  if (labels.length > 0) parts.push(`Labels: ${labels.join(", ")}`);
  return parts.join("\n");
}

export function figureAnnotations(node: DocNode): Annotation[] {
  const value = node.attrs?.annotations;
  return Array.isArray(value) ? (value as Annotation[]) : [];
}

/** Small, fast, synchronous 53-bit string hash (cyrb53). Not cryptographic. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export interface NormalizedDoc {
  /** the document with a unique blockId on every top-level node */
  doc: DocNode;
  /** blockId of every top-level node, in order (including empty ones) */
  ids: string[];
  /** non-empty blocks, ready to store */
  blocks: NoteBlock[];
  /** true when ids had to be added or de-duplicated */
  changed: boolean;
}

/**
 * Make sure every top-level node has a unique blockId (existing ids are kept,
 * missing or duplicated ones get a fresh id) and list the non-empty blocks.
 */
export function normalizeBlocks(doc: DocNode, genId: () => string = newId): NormalizedDoc {
  const seen = new Set<string>();
  const ids: string[] = [];
  const blocks: NoteBlock[] = [];
  let changed = false;

  const content = (doc.content ?? []).map((node) => {
    const existing = node.attrs?.blockId;
    let id = typeof existing === "string" && existing !== "" ? existing : null;
    let next = node;
    if (id === null || seen.has(id)) {
      id = genId();
      changed = true;
      next = { ...node, attrs: { ...node.attrs, blockId: id } };
    }
    seen.add(id);
    ids.push(id);

    const text = nodeText(next).trim();
    if (text !== "") {
      blocks.push({ id, position: blocks.length, type: next.type, text, hash: hashText(text) });
    }
    return next;
  });

  return { doc: { ...doc, content }, ids, blocks, changed };
}
