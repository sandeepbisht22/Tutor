import { useCallback, useEffect, useState } from "react";

/** True while the media query matches; follows changes (window resized, system theme switched). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** A yes/no preference remembered in this browser profile (a convenience; falls back to `initial`). */
export function useStoredFlag(key: string, initial: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === "1";
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // remembering the choice is optional
      }
    },
    [key],
  );
  return [value, set];
}

/** "Good morning", "Good afternoon" or "Good evening" for the local time. */
export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  return hour < 18 ? "Good afternoon" : "Good evening";
}

/** The key that goes with shortcuts on this computer: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD_KEY = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl";
