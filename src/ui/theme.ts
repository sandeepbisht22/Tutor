/**
 * Light, dark, or whatever the system uses. Kept in localStorage (shared by
 * both windows, which load from the same origin) rather than the database, so
 * the colours are right before the database has opened.
 *
 * The page always carries the resolved theme, data-theme="light" or "dark",
 * so the stylesheet defines each palette once.
 */
export type ThemeChoice = "system" | "light" | "dark";

const KEY = "tutor.theme";
const CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    return CHOICES.includes(stored as ThemeChoice) ? (stored as ThemeChoice) : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const resolved = choice === "system" ? (systemDark.matches ? "dark" : "light") : choice;
  document.documentElement.dataset.theme = resolved;
}

export function saveTheme(choice: ThemeChoice): void {
  applyTheme(choice);
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // remembering the choice is optional; it still applies to this window
  }
}

/**
 * Follow a choice made in the other window, and the system switching between
 * light and dark while "system" is chosen. Returns a function that stops listening.
 */
export function followThemeChanges(onChange: (choice: ThemeChoice) => void = () => undefined): () => void {
  const fromOtherWindow = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    const choice = readTheme();
    applyTheme(choice);
    onChange(choice);
  };
  const fromSystem = () => {
    if (readTheme() === "system") applyTheme("system");
  };
  window.addEventListener("storage", fromOtherWindow);
  systemDark.addEventListener("change", fromSystem);
  return () => {
    window.removeEventListener("storage", fromOtherWindow);
    systemDark.removeEventListener("change", fromSystem);
  };
}
