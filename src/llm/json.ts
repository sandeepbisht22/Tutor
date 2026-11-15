/**
 * Small local models often wrap JSON in prose or ``` fences. Pull out the first
 * complete JSON object or array from a model reply; null if there is none.
 */
export function extractJson(text: string): unknown {
  for (let start = 0; start < text.length; start++) {
    const open = text[start];
    if (open !== "{" && open !== "[") continue;
    const end = matchingEnd(text, start);
    if (end === -1) continue;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // not valid JSON from this position; keep scanning
    }
  }
  return null;
}

/**
 * Every complete JSON object in the text, in order, skipping the ones that do
 * not parse. For replies whose outer JSON is broken (a missing quote in the
 * third item) but whose first items are fine.
 */
export function extractJsonObjects(text: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "{") continue;
    const end = matchingEnd(text, start);
    if (end === -1) continue;
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1));
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        found.push(value as Record<string, unknown>);
        start = end; // the objects inside it are already part of this one
      }
    } catch {
      // broken from here; the objects nested inside may still be whole
    }
  }
  return found;
}

function matchingEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Remove the "thinking out loud" block some models put before their answer. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "");
}
