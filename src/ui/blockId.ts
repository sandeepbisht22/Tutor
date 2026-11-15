import { Extension, type Editor } from "@tiptap/react";
import type { DocNode } from "../domain/types";
import { hashText, nodeText, normalizeBlocks, type NormalizedDoc } from "../lib/blocks";

const SYNC_META = "blockIdSync";

/** Lets top-level blocks carry a stable id (stored as data-block-id). */
export const BlockId = Extension.create({
  name: "blockId",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "bulletList", "orderedList", "codeBlock", "blockquote", "figure"],
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-block-id"),
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.blockId ? { "data-block-id": attributes.blockId } : {},
          },
        },
      },
    ];
  },
});

export function isBlockIdSync(transaction: { getMeta(key: string): unknown }): boolean {
  return transaction.getMeta(SYNC_META) === true;
}

/**
 * Give every top-level block in the live editor a unique id (new blocks have
 * none; pasted blocks may repeat one) and return the normalized document.
 */
export function syncBlockIds(editor: Editor): NormalizedDoc {
  const normalized = normalizeBlocks(editor.getJSON() as DocNode);
  if (normalized.changed) {
    const transaction = editor.state.tr;
    editor.state.doc.forEach((node, offset, index) => {
      const id = normalized.ids[index];
      if (node.type.spec.attrs?.blockId !== undefined && node.attrs.blockId !== id) {
        transaction.setNodeAttribute(offset, "blockId", id);
      }
    });
    transaction.setMeta(SYNC_META, true).setMeta("addToHistory", false);
    editor.view.dispatch(transaction);
  }
  return normalized;
}

export interface CurrentBlock {
  id: string;
  type: string;
  text: string;
  hash: string;
}

/** The top-level block the cursor is in (or the selected image), if it has text. */
export function currentBlock(editor: Editor): CurrentBlock | null {
  const { $from } = editor.state.selection;
  const node = $from.depth >= 1 ? $from.node(1) : $from.nodeAfter;
  if (!node) return null;
  const id = node.attrs.blockId as string | null;
  const text = nodeText(node.toJSON() as DocNode).trim();
  if (!id || text === "") return null;
  return { id, type: node.type.name, text, hash: hashText(text) };
}
