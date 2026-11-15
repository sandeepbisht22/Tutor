import { mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { PencilLine, Trash2 } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { Annotation } from "../domain/types";
import { AnnotatedImage } from "./AnnotatedImage";
import { AnnotationEditor } from "./AnnotationEditor";
import { useImageUrl } from "./images";

/**
 * An image inside a note. The picture itself is stored once in the database;
 * its description and everything drawn on it live here, in the note's document,
 * so they are saved, undone and copied together with the text around them.
 */
export const Figure = Node.create({
  name: "figure",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    const data = (name: string, fallback: unknown, parse: (raw: string) => unknown = (raw) => raw) => ({
      default: fallback,
      parseHTML: (element: HTMLElement) => {
        const raw = element.getAttribute(`data-${name}`);
        return raw === null ? fallback : parse(raw);
      },
      renderHTML: (attributes: Record<string, unknown>) => {
        const key = name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
        const value = attributes[key];
        return { [`data-${name}`]: typeof value === "string" ? value : JSON.stringify(value) };
      },
    });
    return {
      imageId: data("image-id", null),
      width: data("width", 0, Number),
      height: data("height", 0, Number),
      description: data("description", ""),
      annotations: data("annotations", [], (raw) => {
        try {
          return JSON.parse(raw) as Annotation[];
        } catch {
          return [];
        }
      }),
    };
  },

  parseHTML() {
    return [{ tag: "figure[data-image-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureView);
  },
});

function FigureView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const attrs = node.attrs as { imageId: string; width: number; height: number; description: string; annotations: Annotation[] };
  const url = useImageUrl(attrs.imageId);
  const [editing, setEditing] = useState(false);
  const covers = attrs.annotations.filter((a) => a.kind === "cover" && a.text.trim() !== "").length;

  return (
    <NodeViewWrapper className={`figure${selected ? " is-selected" : ""}`} data-drag-handle>
      {url ? (
        <AnnotatedImage
          src={url}
          width={attrs.width}
          height={attrs.height}
          annotations={attrs.annotations}
          mode="note"
          alt={attrs.description}
        />
      ) : (
        <div className="figure-placeholder">{url === null ? "This image is missing." : ""}</div>
      )}
      <div className="figure-bar">
        <textarea
          className="figure-description"
          rows={1}
          aria-label="Image description"
          placeholder="Describe what this image shows"
          value={attrs.description}
          onChange={(event) => updateAttributes({ description: event.target.value })}
        />
        <button type="button" className="btn" onClick={() => setEditing(true)} disabled={!url}>
          <PencilLine size={14} />
          Labels and covers
        </button>
        <button type="button" className="icon-btn" aria-label="Remove image" title="Remove image" onClick={deleteNode}>
          <Trash2 size={15} />
        </button>
      </div>
      {covers > 0 && (
        <p className="figure-note">
          {covers === 1 ? "1 cover is a question." : `${covers} covers are questions.`} Tutor will hide each one and ask what is under it.
        </p>
      )}
      {editing &&
        url &&
        createPortal(
          <AnnotationEditor
            src={url}
            width={attrs.width}
            height={attrs.height}
            annotations={attrs.annotations}
            onClose={() => setEditing(false)}
            onSave={(annotations) => {
              updateAttributes({ annotations });
              setEditing(false);
            }}
          />,
          document.body,
        )}
    </NodeViewWrapper>
  );
}
