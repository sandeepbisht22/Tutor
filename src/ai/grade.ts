import type { Rating } from "../domain/types";
import { extractJson, stripThinking } from "../llm/json";
import type { ChatMessage, LlmProvider } from "../llm/types";

/** Checking an answer the user typed against the expected answer. */

export interface AnswerCheck {
  /** 0 wrong … 1 fully right */
  score: number;
  /** one short sentence for the user; may be empty */
  feedback: string;
}

/** Lower case, no punctuation, no leading "the" / "a" / "an". */
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(the|an|a) /, "");

/** Answers that match word for word need no AI. */
export function quickCheck(answer: string, expected: string): AnswerCheck | null {
  const given = normalize(answer);
  return given !== "" && given === normalize(expected) ? { score: 1, feedback: "" } : null;
}

export function buildCheckMessages(input: { prompt: string; expected: string; answer: string }): ChatMessage[] {
  const system = [
    "You check a student's answer to a study question against the expected answer.",
    "Judge the meaning, not the wording. Ignore spelling, grammar and extra detail that is not wrong.",
    "score: 1 = fully correct, 0.5 = partly correct or incomplete, 0 = wrong or no real answer.",
    "feedback: one short sentence, spoken to the student as \"you\", saying what was right or what was missing. Use the language of the question.",
    'Reply with JSON only: {"score": 0.0, "feedback": "..."}',
  ].join("\n");
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `Question: ${input.prompt}\nExpected answer: ${input.expected}\nStudent's answer: ${input.answer}`,
    },
  ];
}

export function parseCheck(reply: string): AnswerCheck | null {
  const parsed = extractJson(stripThinking(reply));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const raw = typeof record.score === "string" ? Number(record.score) : record.score;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  // some models answer on a 0–10 or 0–100 scale
  const scaled = raw > 10 ? raw / 100 : raw > 1 ? raw / 10 : raw;
  return {
    score: Math.min(1, Math.max(0, scaled)),
    feedback: typeof record.feedback === "string" ? record.feedback.trim().slice(0, 300) : "",
  };
}

/** The rating Tutor proposes for a score. "Easily" (4) is always left for the user to choose. */
export function ratingForScore(score: number): Rating {
  if (score < 0.35) return 1;
  return score < 0.7 ? 2 : 3;
}

/** Check a typed answer. Null when the answer is empty or the model's reply can't be read. */
export async function checkAnswer(
  provider: LlmProvider | null,
  input: { prompt: string; expected: string; answer: string },
  signal?: AbortSignal,
): Promise<AnswerCheck | null> {
  if (input.answer.trim() === "") return null;
  const quick = quickCheck(input.answer, input.expected);
  if (quick || !provider) return quick;
  const reply = await provider.complete(buildCheckMessages(input), { maxTokens: 300, temperature: 0, signal });
  return parseCheck(reply);
}
