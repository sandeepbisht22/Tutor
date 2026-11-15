import type { ReactNode, SVGProps } from "react";
import type { Annotation } from "../domain/types";

/**
 * note    reading the note: labels shown, covers see-through with their answer
 * ask     a question is being asked: every cover is closed
 * reveal  the answer is shown: the asked-about cover opens
 */
export type ImageMode = "note" | "ask" | "reveal";

/** Drawing units: the image is always 1000 wide; the height follows its shape. */
export const UNITS = 1000;

export function unitHeight(width: number, height: number): number {
  return width > 0 && height > 0 ? (UNITS * height) / width : UNITS * 0.75;
}

interface Props {
  src: string;
  width: number;
  height: number;
  annotations: Annotation[];
  mode: ImageMode;
  /** the cover a question is about */
  coverId?: string;
  alt?: string;
  className?: string;
  /** extra drawing on top (the editor's selection frame) */
  children?: ReactNode;
  svgProps?: SVGProps<SVGSVGElement>;
}

export function AnnotatedImage({ src, width, height, annotations, mode, coverId, alt, className, children, svgProps }: Props) {
  const h = unitHeight(width, height);
  return (
    <div className={`annotated${className ? ` ${className}` : ""}`}>
      <img src={src} alt={alt ?? ""} draggable={false} />
      <svg viewBox={`0 0 ${UNITS} ${h}`} preserveAspectRatio="none" {...svgProps}>
        {annotations.map((annotation) => (
          <Shape key={annotation.id} annotation={annotation} h={h} mode={mode} coverId={coverId} />
        ))}
        {children}
      </svg>
    </div>
  );
}

/** Corners of an annotation in drawing units (arrows may point up or left, so w and h can be negative). */
export function bounds(a: Annotation, h: number): { x: number; y: number; w: number; h: number } {
  if (a.kind === "text") {
    return { x: a.x * UNITS, y: a.y * h, w: Math.max(60, a.text.length * 16.5), h: 38 };
  }
  const x1 = a.x * UNITS;
  const y1 = a.y * h;
  const x2 = (a.x + a.w) * UNITS;
  const y2 = (a.y + a.h) * h;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function Shape({ annotation: a, h, mode, coverId }: { annotation: Annotation; h: number; mode: ImageMode; coverId?: string }) {
  const box = bounds(a, h);

  if (a.kind === "text") {
    return (
      <g data-ann={a.id}>
        <text className="ann-text" x={box.x} y={box.y} dominantBaseline="hanging">
          {a.text || "Label"}
        </text>
      </g>
    );
  }

  if (a.kind === "box") {
    return (
      <g data-ann={a.id}>
        <rect className="ann-box" x={box.x} y={box.y} width={box.w} height={box.h} rx={4} />
        <rect className="ann-hit" x={box.x} y={box.y} width={box.w} height={box.h} />
      </g>
    );
  }

  if (a.kind === "arrow") {
    const x1 = a.x * UNITS;
    const y1 = a.y * h;
    const x2 = (a.x + a.w) * UNITS;
    const y2 = (a.y + a.h) * h;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = 26;
    const wing = (offset: number) =>
      `${x2 - head * Math.cos(angle + offset)},${y2 - head * Math.sin(angle + offset)}`;
    return (
      <g data-ann={a.id}>
        <line className="ann-arrow" x1={x1} y1={y1} x2={x2} y2={y2} />
        <polygon className="ann-arrow-head" points={`${x2},${y2} ${wing(0.42)} ${wing(-0.42)}`} />
        <line className="ann-hit-line" x1={x1} y1={y1} x2={x2} y2={y2} />
      </g>
    );
  }

  // cover
  const asked = a.id === coverId;
  const open = mode === "note" || (mode === "reveal" && asked);
  const label = open ? a.text : asked ? "?" : "";
  const size = Math.min(30, Math.max(14, box.h * 0.5));
  return (
    <g data-ann={a.id}>
      <rect
        className={`ann-cover${open ? " is-open" : ""}${asked && mode !== "note" ? " is-asked" : ""}`}
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={5}
      />
      {label && (
        <text
          className={`ann-cover-text${open ? " is-open" : ""}`}
          x={box.x + box.w / 2}
          y={box.y + box.h / 2}
          fontSize={size}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {label}
        </text>
      )}
    </g>
  );
}
