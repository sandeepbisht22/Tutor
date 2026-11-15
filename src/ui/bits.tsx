import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Question, QuestionMedia, TopicCounts } from "../domain/types";
import type { TagColor } from "../lib/colors";
import { formatInterval } from "../lib/scheduler";
import { AnnotatedImage } from "./AnnotatedImage";
import { useImageUrl } from "./images";

/** Small pieces used on several screens. */

/** Tutor's mark: the index card from the app icon. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" fill="var(--logo-card, #fff)" />
      <rect x="2" y="8.2" width="20" height="1.4" fill="var(--logo-rule, #dc3d55)" />
      <rect x="5" y="12" width="13" height="1" rx="0.5" fill="var(--logo-line, #9db4ee)" />
      <rect x="5" y="15" width="10" height="1" rx="0.5" fill="var(--logo-line, #9db4ee)" />
    </svg>
  );
}

/** A topic's icon: its first letter on its tag colour, like an object icon in Anytype. */
export function TopicMark({ name, color, size = "sm" }: { name: string; color: TagColor; size?: "xs" | "sm" | "md" | "lg" }) {
  const letter = (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase();
  return (
    <span className={`topic-mark is-${size} tag-${color}`} aria-hidden="true">
      {letter}
    </span>
  );
}

/** A small dot in a tag colour. */
export function TagDot({ color }: { color: TagColor }) {
  return <span className={`tag-dot tag-${color}`} aria-hidden="true" />;
}

/** A key on the keyboard, as a hint. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** How a topic's questions split into strong, learning and not practised yet. */
export function MasteryBar({ counts, label = true }: { counts: Pick<TopicCounts, "total" | "strong" | "fresh">; label?: boolean }) {
  const { total, strong, fresh } = counts;
  const learning = Math.max(0, total - strong - fresh);
  if (total === 0) return <span className="mastery is-empty" aria-hidden={!label} />;
  return (
    <span
      className="mastery"
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label ? `${strong} strong, ${learning} learning, ${fresh} not practised yet` : undefined}
    >
      {strong > 0 && <span className="is-strong" style={{ flexGrow: strong }} />}
      {learning > 0 && <span className="is-learning" style={{ flexGrow: learning }} />}
      {fresh > 0 && <span className="is-fresh" style={{ flexGrow: fresh }} />}
    </span>
  );
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "today", "yesterday", "3 days ago", "12 Mar" */
export function ago(time: number, now = Date.now()): string {
  const days = Math.floor((startOfDay(now) - startOfDay(time)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Where a question stands, in a few words. */
export function questionState(question: Question, now = Date.now()): string {
  if (question.status === "suggested") return "Suggested";
  if (question.status === "paused") return "Paused";
  if (question.state === 0) return "Not practised yet";
  const wait = question.due - now;
  return wait <= 0 ? "Ready now" : `Back in ${formatInterval(wait)}`;
}

/** A one-word colour for where a question stands, matching questionState. */
export function questionTone(question: Question, now = Date.now()): "suggested" | "paused" | "fresh" | "ready" | "waiting" {
  if (question.status === "suggested") return "suggested";
  if (question.status === "paused") return "paused";
  if (question.state === 0) return "fresh";
  return question.due <= now ? "ready" : "waiting";
}

/** The image that goes with a question, with covers closed until the answer is shown. */
export function QuestionImage({ media, revealed }: { media: QuestionMedia; revealed: boolean }) {
  const url = useImageUrl(media.imageId);
  if (!url) return url === null ? <p className="muted">The image for this question is missing.</p> : null;
  return (
    <AnnotatedImage
      src={url}
      width={media.width}
      height={media.height}
      annotations={media.annotations}
      mode={revealed ? "reveal" : "ask"}
      coverId={media.coverId}
      className="question-image"
    />
  );
}

/** A one-line text field that appears in place: Enter saves, Escape or leaving cancels. */
export function InlineInput(props: {
  initial?: string;
  label: string;
  onSubmit(value: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <input
      className="inline-input"
      autoFocus
      aria-label={props.label}
      placeholder={props.label}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={props.onCancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onCancel();
        if (event.key === "Enter") {
          const text = value.trim();
          if (text === "") props.onCancel();
          else props.onSubmit(text);
        }
      }}
    />
  );
}

/** A centered window over the screen. Escape and the backdrop close it. */
export function Dialog(props: { label: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div
        ref={panel}
        className={`dialog${props.wide ? " is-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        tabIndex={-1}
      >
        {props.children}
      </div>
    </div>
  );
}

/** The question-and-answer form used wherever a question is written or edited. */
export function QuestionForm(props: {
  initial?: { prompt: string; answer: string };
  submitLabel: string;
  note?: ReactNode;
  onSubmit(prompt: string, answer: string): void;
  onCancel(): void;
}) {
  const [prompt, setPrompt] = useState(props.initial?.prompt ?? "");
  const [answer, setAnswer] = useState(props.initial?.answer ?? "");
  const ready = prompt.trim() !== "" && answer.trim() !== "";
  return (
    <form
      className="question-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) props.onSubmit(prompt, answer);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          props.onCancel();
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && ready) {
          event.preventDefault();
          props.onSubmit(prompt, answer);
        }
      }}
    >
      <label>
        Question
        <textarea autoFocus rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </label>
      <label>
        Answer
        <textarea rows={3} value={answer} onChange={(event) => setAnswer(event.target.value)} />
      </label>
      {props.note}
      <div className="row">
        <button type="submit" className="btn-primary" disabled={!ready}>
          {props.submitLabel}
        </button>
        <button type="button" className="btn-quiet" onClick={props.onCancel}>
          Cancel
        </button>
        <span className="spacer" />
        <span className="hint">
          <Kbd>{navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl"}</Kbd> <Kbd>Enter</Kbd> saves
        </span>
      </div>
    </form>
  );
}
