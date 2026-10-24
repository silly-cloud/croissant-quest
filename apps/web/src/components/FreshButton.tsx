"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useGame, useHostSnapshot } from "@/lib/game-context";

/** Starts a round of fresh coach questions. A late answer is ignored by the host if the round changed. */
export function useFresh() {
  const router = useRouter();
  const { host } = useGame();
  const { busy } = useHostSnapshot();
  // leaving the screen abandons a request still waiting for the coach
  useEffect(() => () => host.cancelFresh(), [host]);
  const run = async () => {
    const r = await host.fresh();
    if (r === "ai") router.push("/round/6?mode=ai");
    else if (r === "weak") router.push("/round/6?mode=weak");
  };
  return { busy, run };
}

export function FreshButton() {
  const { busy, run } = useFresh();
  return (
    <button type="button" className="weak" disabled={busy} aria-busy={busy} onClick={() => void run()}>
      <i aria-hidden="true">✨</i>
      <b>{busy ? "Claude is writing 8 questions…" : "Fresh questions from Claude"}</b>
      <span>Never-before-seen exercises aimed at your weak spots</span>
    </button>
  );
}
