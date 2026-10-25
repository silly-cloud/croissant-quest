import { LS_KEY } from "./game-store";
import type { Pace } from "./engine";

export type Theme = "system" | "light" | "dark";

export interface SettingsSnapshot {
  pace: Pace;
  muted: boolean;
  theme: Theme;
}

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const SETTINGS_SERVER: SettingsSnapshot = { pace: "fast", muted: false, theme: "system" };

/** Pace, sound and theme. Same storage keys as the single-file game. */
export class SettingsStore {
  private snap: SettingsSnapshot = SETTINGS_SERVER;
  private listeners = new Set<() => void>();

  constructor(
    private readonly storage: KV | null = safe(),
    private readonly root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement,
  ) {
    const get = (k: string) => {
      try {
        return this.storage?.getItem(LS_KEY + k) ?? null;
      } catch {
        return null;
      }
    };
    const theme = get("-theme");
    this.snap = {
      pace: get("-pace") === "study" ? "study" : "fast",
      muted: get("-mute") === "1",
      theme: theme === "light" || theme === "dark" ? theme : "system",
    };
    this.applyTheme();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;
  get pace(): Pace {
    return this.snap.pace;
  }
  get muted() {
    return this.snap.muted;
  }

  private put(k: string, v: string | null) {
    try {
      if (v === null) this.storage?.removeItem(LS_KEY + k);
      else this.storage?.setItem(LS_KEY + k, v);
    } catch {
      /* blocked storage: the setting still applies for this visit */
    }
  }
  private set(patch: Partial<SettingsSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }
  private applyTheme() {
    if (!this.root) return;
    if (this.snap.theme === "system") this.root.removeAttribute("data-theme");
    else this.root.setAttribute("data-theme", this.snap.theme);
  }

  setPace(p: Pace) {
    this.put("-pace", p);
    this.set({ pace: p });
  }
  setMuted(m: boolean) {
    this.put("-mute", m ? "1" : "0");
    this.set({ muted: m });
  }
  setTheme(t: Theme) {
    this.put("-theme", t === "system" ? null : t);
    this.set({ theme: t });
    this.applyTheme();
  }
  /** HUD button: flip between what the learner currently sees. */
  toggleTheme() {
    const dark =
      this.snap.theme === "dark" ||
      (this.snap.theme === "system" && typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);
    this.setTheme(dark ? "light" : "dark");
  }
}

function safe(): KV | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
