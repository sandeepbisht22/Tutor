import { ArrowUpRight, EyeOff, MousePointer2, Square, Trash2, Type } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Annotation, AnnotationKind } from "../domain/types";
import { newId } from "../lib/id";
import { AnnotatedImage, bounds, unitHeight } from "./AnnotatedImage";

interface Props {
  src: string;
  width: number;
  height: number;
  annotations: Annotation[];
  onSave(annotations: Annotation[]): void;
  onClose(): void;
}

type Tool = "select" | AnnotationKind;

const TOOLS: { tool: Tool; label: string; hint: string; icon: ReactNode }[] = [
  { tool: "select", label: "Move", hint: "Click a label or shape to select it. Drag to move it.", icon: <MousePointer2 size={16} /> },
  { tool: "text", label: "Label", hint: "Click where the label should go, then type its text.", icon: <Type size={16} /> },
  { tool: "box", label: "Box", hint: "Drag to draw a box around something.", icon: <Square size={16} /> },
  { tool: "arrow", label: "Arrow", hint: "Drag from the tail of the arrow to its tip.", icon: <ArrowUpRight size={16} /> },
  {
    tool: "cover",
    label: "Cover",
    hint: "Drag over a part to hide it, then type what it hides. Tutor will ask you what is under each cover.",
    icon: <EyeOff size={16} />,
  },
];

type Drag =
  | { kind: "create"; id: string; startX: number; startY: number }
  | { kind: "move"; id: string; startX: number; startY: number; origin: Annotation }
  | { kind: "resize"; id: string };

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Full-window editor for the labels, boxes, arrows and covers on one image. */
export function AnnotationEditor({ src, width, height, annotations, onSave, onClose }: Props) {
  const [items, setItems] = useState<Annotation[]>(annotations);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const textField = useRef<HTMLInputElement>(null);
  const h = unitHeight(width, height);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  const update = (id: string, change: Partial<Annotation>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  const remove = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedId(null);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement;
      if (event.key === "Escape") {
        if (typing) (event.target as HTMLInputElement).blur();
        else onClose();
      }
      if ((event.key === "Delete" || event.key === "Backspace") && !typing && selectedId) {
        event.preventDefault();
        remove(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // typing right after placing a label or cover goes into its text
  useEffect(() => {
    if (selected && (selected.kind === "text" || selected.kind === "cover") && selected.text === "") {
      textField.current?.focus();
    }
  }, [selected]);

  const pointAt = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const target = event.target as Element;
    const point = pointAt(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (target.closest("[data-handle]") && selectedId) {
      drag.current = { kind: "resize", id: selectedId };
      return;
    }
    if (tool === "select") {
      const hit = target.closest("[data-ann]")?.getAttribute("data-ann") ?? null;
      setSelectedId(hit);
      const origin = items.find((item) => item.id === hit);
      if (origin) drag.current = { kind: "move", id: origin.id, startX: point.x, startY: point.y, origin };
      return;
    }
    const id = newId();
    setItems((current) => [...current, { id, kind: tool, x: point.x, y: point.y, w: 0, h: 0, text: "" }]);
    setSelectedId(id);
    if (tool === "text") setTool("select");
    else drag.current = { kind: "create", id, startX: point.x, startY: point.y };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current) return;
    const point = pointAt(event);
    const item = items.find((entry) => entry.id === current.id);
    if (!item) return;

    if (current.kind === "move") {
      const dx = point.x - current.startX;
      const dy = point.y - current.startY;
      const o = current.origin;
      // keep both ends of the shape inside the image
      const minX = Math.max(0, -o.w);
      const maxX = Math.min(1, 1 - o.w);
      const minY = Math.max(0, -o.h);
      const maxY = Math.min(1, 1 - o.h);
      update(item.id, {
        x: Math.min(maxX, Math.max(minX, o.x + dx)),
        y: Math.min(maxY, Math.max(minY, o.y + dy)),
      });
    } else if (item.kind === "arrow") {
      update(item.id, { w: point.x - item.x, h: point.y - item.y });
    } else if (current.kind === "create") {
      update(item.id, {
        x: Math.min(current.startX, point.x),
        y: Math.min(current.startY, point.y),
        w: Math.abs(point.x - current.startX),
        h: Math.abs(point.y - current.startY),
      });
    } else {
      update(item.id, { w: Math.max(0.03, point.x - item.x), h: Math.max(0.03, point.y - item.y) });
    }
  };

  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.kind !== "create") return;
    const item = items.find((entry) => entry.id === current.id);
    // a click without a drag still makes a usable shape
    if (item && Math.abs(item.w) < 0.02 && Math.abs(item.h) < 0.02) {
      update(item.id, item.kind === "arrow" ? { w: 0.14, h: -0.08 } : { w: Math.min(0.24, 1 - item.x), h: Math.min(0.12, 1 - item.y) });
    }
    setTool("select");
  };

  const frame = selected ? bounds(selected, h) : null;
  const handle =
    selected && frame
      ? selected.kind === "arrow"
        ? { x: (selected.x + selected.w) * 1000, y: (selected.y + selected.h) * h }
        : selected.kind === "text"
          ? null
          : { x: frame.x + frame.w, y: frame.y + frame.h }
      : null;
  const covers = items.filter((item) => item.kind === "cover");
  const unanswered = covers.filter((item) => item.text.trim() === "").length;

  return (
    <div className="dialog-backdrop">
      <div className="annotator" role="dialog" aria-modal="true" aria-label="Labels and covers">
        <header>
          <div className="tool-row" role="toolbar" aria-label="Drawing tools">
            {TOOLS.map((entry) => (
              <button
                key={entry.tool}
                className={`tool-btn${tool === entry.tool ? " is-active" : ""}`}
                aria-pressed={tool === entry.tool}
                onClick={() => setTool(entry.tool)}
              >
                {entry.icon}
                {entry.label}
              </button>
            ))}
          </div>
          <p className="muted">{TOOLS.find((entry) => entry.tool === tool)?.hint}</p>
        </header>

        <div className="annotator-stage">
          <AnnotatedImage
            src={src}
            width={width}
            height={height}
            annotations={items}
            mode="note"
            className={tool === "select" ? "is-selecting" : "is-drawing"}
            svgProps={{
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel: onPointerUp,
              // keep the keyboard in the text field while placing and moving things
              onMouseDown: (event) => event.preventDefault(),
            }}
          >
            {frame && (
              <rect className="ann-frame" x={frame.x - 6} y={frame.y - 6} width={frame.w + 12} height={frame.h + 12} />
            )}
            {handle && <circle className="ann-handle" data-handle cx={handle.x} cy={handle.y} r={11} />}
          </AnnotatedImage>
        </div>

        <footer>
          {selected && (selected.kind === "text" || selected.kind === "cover") ? (
            <label className="annotator-text">
              {selected.kind === "cover" ? "What is under this cover?" : "Label text"}
              <input
                ref={textField}
                value={selected.text}
                placeholder={selected.kind === "cover" ? "The answer, for example “Left ventricle”" : "Label"}
                onChange={(event) => update(selected.id, { text: event.target.value })}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              />
            </label>
          ) : (
            <p className="muted annotator-text">
              {covers.length === 0
                ? "No covers yet. Each cover with an answer becomes a question."
                : `${covers.length} ${covers.length === 1 ? "cover" : "covers"}${unanswered > 0 ? `, ${unanswered} still without an answer` : ""}.`}
            </p>
          )}
          {selected && (
            <button className="btn" onClick={() => remove(selected.id)}>
              <Trash2 size={14} />
              Delete
            </button>
          )}
          <span className="spacer" />
          <button className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => onSave(items.filter((item) => item.kind !== "text" || item.text.trim() !== ""))}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
