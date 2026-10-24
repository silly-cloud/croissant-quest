import type { Question } from "@cq/content";
import type { State } from "@cq/shared";

export type StopState = "done" | "active" | "soon" | "locked";

/** done = 5 crowns; 1-6 always playable; later stops open when the one before is crowned out (and has content). */
export function topicState(id: number, crowns: State["crowns"], bank: Question[]): StopState {
  const c = crowns[id] ?? 0;
  if (c >= 5) return "done";
  if (id <= 6) return "active";
  if ((crowns[id - 1] ?? 0) >= 5) return bank.some((q) => q.t === id) ? "active" : "soon";
  return "locked";
}

export const OFFSETS = [0, 52, 78, 52, 0, -52, -78, -52];
