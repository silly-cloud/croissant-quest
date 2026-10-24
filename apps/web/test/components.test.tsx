import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BANK, qid, type Question } from "@cq/content";
import { fullOf } from "@cq/shared";
import { RoundView } from "@/components/RoundView";
import { Sheet } from "@/components/Sheet";
import { WhyCard } from "@/components/WhyCard";
import { GameProvider, type Game } from "@/lib/game-context";
import { Sfx } from "@/lib/fx";
import { GameStore } from "@/lib/game-store";
import { RoundHost } from "@/lib/round-host";
import { SettingsStore } from "@/lib/settings";
import { memStorage } from "./helpers";

function makeGame(): Game {
  const s = memStorage();
  const settings = new SettingsStore({ ...s, removeItem: (k: string) => void s.raw.delete(k) }, null);
  settings.setPace("study");
  const store = new GameStore({ storage: memStorage(), fetch: () => Promise.reject(new TypeError("offline")) });
  const host = new RoundHost(store, { getPace: () => settings.pace });
  return { store, host, settings, sfx: new Sfx(() => true) };
}

const one = (k: Question["k"], pred: (q: Question) => boolean = () => true) => BANK.find((q) => q.k === k && q.t === 6 && pred(q))!;

describe("Sheet (native dialog)", () => {
  it("opens modally, moves focus in, reports a close, and gives focus back", async () => {
    const onClose = vi.fn();
    function Page({ open }: { open: boolean }) {
      return (
        <>
          <button>opener</button>
          {open && (
            <Sheet label="Topic" onClose={onClose}>
              <button>first</button>
              <button data-autofocus>wanted</button>
            </Sheet>
          )}
        </>
      );
    }
    const { rerender } = render(<Page open={false} />);
    const opener = screen.getByText("opener");
    opener.focus();
    rerender(<Page open />);
    const dlg = screen.getByRole("dialog", { name: "Topic" });
    expect(dlg).toHaveAttribute("open");
    expect(screen.getByText("wanted")).toHaveFocus();
    // Escape in a real browser fires the native close event
    act(() => void dlg.dispatchEvent(new Event("close")));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Page open={false} />);
    expect(opener).toHaveFocus();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("WhyCard", () => {
  it.each(["choice", "type", "en2fr", "build", "fix", "fr2en"] as const)("%s: shows the answer once, the rule, and all three pronunciation rows", async (k) => {
    const q = one(k);
    const onDone = vi.fn();
    render(<WhyCard q={q} picked="zzz" accentsOnly={false} onDone={onDone} />);
    const dlg = screen.getByRole("dialog");
    const line = dlg.querySelector(".answerline")!;
    const expected = q.k === "fr2en" ? q.a : fullOf(q);
    expect(line.textContent?.replace(/^Answer: /, "")).toBe(expected);
    expect(within(dlg).getByText("Eng")).toBeInTheDocument();
    expect(within(dlg).getByText("ગુજ")).toBeInTheDocument();
    expect(within(dlg).getByText("हिं")).toBeInTheDocument();
    expect(dlg.querySelectorAll("dd")).toHaveLength(3);
    await userEvent.click(within(dlg).getByRole("button", { name: "Got it" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("an exception question explains itself, not the general rule", () => {
    const q = BANK.find((x) => x.why)!;
    render(<WhyCard q={q} picked="x" accentsOnly={false} onDone={() => {}} />);
    const text = screen.getByRole("dialog").textContent!;
    expect(text).toContain(q.why![0].replace(/<[^>]+>/g, "").slice(0, 20));
  });

  it("flags accents-only near misses", () => {
    render(<WhyCard q={one("type")} picked="x" accentsOnly onDone={() => {}} />);
    expect(screen.getByRole("dialog", { name: /accents/i })).toBeInTheDocument();
  });
});

async function play(q: Question, right: boolean) {
  const user = userEvent.setup();
  switch (q.k) {
    case "choice":
    case "fr2en": {
      const pick = right ? q.a : q.o!.find((o) => o !== q.a)!;
      await user.click(screen.getByRole("button", { name: pick }));
      return;
    }
    case "type":
    case "en2fr":
      await user.type(screen.getByRole("textbox"), right ? q.a : "zzz");
      await user.click(screen.getByRole("button", { name: "Check" }));
      return;
    case "build": {
      const all = q.a.replace(/[.!?]$/, "").split(" ");
      const words = right ? all : [all.at(-1)!]; // a one-word "sentence" is wrong
      const tiles = screen.getByRole("group", { name: "Words to use" });
      const used = new Set<HTMLElement>();
      for (const w of words) {
        const btn = within(tiles).getAllByRole("button", { name: w }).find((b) => !used.has(b) && !(b as HTMLButtonElement).disabled);
        if (!btn) continue;
        used.add(btn);
        await user.click(btn);
      }
      await user.click(screen.getByRole("button", { name: "Check" }));
      return;
    }
    case "fix": {
      const bad = q.bad!.split(" ")[0]!;
      const wrong = q.s!.split(" ").find((w) => !q.bad!.split(" ").includes(w))!;
      await user.click(within(screen.getByRole("group", { name: /Tap the wrong word/ })).getAllByRole("button", { name: right ? bad : wrong })[0]!);
      await user.click(screen.getByRole("button", { name: "Check" }));
      return;
    }
  }
}

describe("RoundView: every question kind can be answered", () => {
  it.each(["choice", "fr2en", "type", "en2fr", "build", "fix"] as const)("%s: right answer scores, shows the sentence with three readings, and Continue moves on", async (k) => {
    const game = makeGame();
    const qs = [one(k), one(k, (q) => q !== one(k))];
    const engine = game.host.begin(6, "normal", qs);
    render(
      <GameProvider game={game}>
        <RoundView engine={engine} onQuit={() => {}} onDone={() => {}} />
      </GameProvider>,
    );
    expect(document.querySelector("[data-qid]")).toHaveAttribute("data-qid", qid(qs[0]!));
    await play(qs[0]!, true);
    expect(game.store.state.xp).toBe(10);
    expect(screen.getByRole("status")).toHaveTextContent(/Correct/);
    const strip = document.querySelector(".okstrip")!;
    expect(strip.querySelectorAll("dd")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(document.querySelector("[data-qid]")).toHaveAttribute("data-qid", qid(qs[1]!));
    // focus lands on the next control: the text box for typed kinds, else the question heading
    if (k === "type" || k === "en2fr") expect(screen.getByRole("textbox")).toHaveFocus();
    else expect(screen.getByRole("heading", { level: 2 })).toHaveFocus();
  });

  it.each(["choice", "type", "build", "fix"] as const)("%s: a wrong answer costs a heart, opens the why-card, and Got it moves on", async (k) => {
    const game = makeGame();
    const qs = [one(k), one(k, (q) => q !== one(k))];
    const engine = game.host.begin(6, "normal", qs);
    render(
      <GameProvider game={game}>
        <RoundView engine={engine} onQuit={() => {}} onDone={() => {}} />
      </GameProvider>,
    );
    await play(qs[0]!, false);
    const dlg = await screen.findByRole("dialog", undefined, { timeout: 2000 });
    expect(screen.getByRole("img", { name: "4 of 5 hearts left" })).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(document.querySelector("[data-qid]")).toHaveAttribute("data-qid", qid(qs[1]!)));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Quit calls back and the combo label turns EN FEU at 8", async () => {
    const game = makeGame();
    const qs = BANK.filter((q) => q.t === 6 && q.k === "choice").slice(0, 9);
    const engine = game.host.begin(6, "normal", qs);
    const onQuit = vi.fn();
    render(
      <GameProvider game={game}>
        <RoundView engine={engine} onQuit={onQuit} onDone={() => {}} />
      </GameProvider>,
    );
    for (let i = 0; i < 8; i++) {
      act(() => void engine.answer(qs[i]!.a));
      act(() => void engine.next());
    }
    expect(screen.getByText(/8 EN FEU/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Leave round" }));
    expect(onQuit).toHaveBeenCalled();
  });
});
