"use client";

import { useState, type RefObject } from "react";
import type { Question } from "@cq/content";
import type { QuestionView } from "@/lib/engine";

/** French text with the blank drawn as a gap. */
export function Sentence({ s }: { s: string }) {
  const [before, ...rest] = s.split("___");
  if (!rest.length) return <span lang="fr">{s}</span>;
  return (
    <span lang="fr">
      {before}
      <span className="bl" role="img" aria-label="blank" />
      {rest.join("___")}
    </span>
  );
}

export const KIND_LABEL: Record<Question["k"], string> = {
  choice: "Choose",
  type: "Write the sentence",
  en2fr: "Translate into French",
  build: "Build the sentence",
  fix: "Tap the mistake",
  fr2en: "What does it mean?",
};

interface Common {
  q: Question;
  view: QuestionView;
  answered: boolean;
  picked: string | null;
  /** tap-to-answer kinds */
  onAnswer: (v: string) => void;
  /** check-then-answer kinds report what is ready to check (null = nothing yet) */
  onDraft: (v: string | null) => void;
  /** Enter in the text box */
  onSubmit: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** choice and fr2en: tap an option and it is judged on the spot. */
function Options({ q, view, answered, picked, onAnswer, english }: Common & { english?: boolean }) {
  return (
    <div className="opts" role="group" aria-label="Answers">
      {view.options.map((o) => {
        const good = answered && (o === q.a ? true : false);
        const bad = answered && o === picked && o !== q.a;
        return (
          <button
            key={o}
            type="button"
            lang={english ? "en" : "fr"}
            className={"opt" + (english ? " en long" : o.length > 6 ? " long" : "") + (good ? " good" : "") + (bad ? " bad" : "")}
            disabled={answered}
            onClick={() => onAnswer(o)}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

const ACCENTS = ["é", "è", "ê", "à", "â", "ù", "û", "î", "ô", "ç", "œ", "'"];

function TypeBox({ q, answered, onDraft, onSubmit, inputRef }: Common) {
  const [value, setValue] = useState("");
  const set = (v: string) => {
    setValue(v);
    onDraft(v.trim() ? v : null);
  };
  return (
    <>
      <input
        ref={inputRef}
        className="typebox"
        lang="fr"
        value={value}
        readOnly={answered}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Type in French…"
        aria-label={q.k === "type" ? "Type the missing French word or the whole sentence" : "Write the French sentence"}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim() && !answered) onSubmit();
        }}
      />
      <div className="accents" role="group" aria-label="Accented letters">
        {ACCENTS.map((a) => (
          <button
            key={a}
            type="button"
            className="acc"
            disabled={answered}
            aria-label={a === "'" ? "apostrophe" : `insert ${a}`}
            onClick={() => {
              const el = inputRef.current;
              const start = el?.selectionStart ?? value.length;
              const end = el?.selectionEnd ?? start;
              set(value.slice(0, start) + a + value.slice(end));
              requestAnimationFrame(() => {
                el?.focus();
                el?.setSelectionRange(start + 1, start + 1);
              });
            }}
          >
            {a}
          </button>
        ))}
      </div>
    </>
  );
}

function BuildTiles({ view, answered, onDraft }: Common) {
  const [built, setBuilt] = useState<number[]>([]);
  const update = (next: number[]) => {
    setBuilt(next);
    onDraft(next.length ? next.map((i) => view.tiles[i]).join(" ") : null);
  };
  return (
    <>
      <div className="tiles" role="group" aria-label="Your sentence, in order. Tap a word to take it back">
        {built.map((idx, pos) => (
          <button key={idx} type="button" lang="fr" className="tile" disabled={answered} onClick={() => update(built.filter((_, p) => p !== pos))}>
            {view.tiles[idx]}
          </button>
        ))}
      </div>
      <div className="tiles bank" role="group" aria-label="Words to use">
        {view.tiles.map((w, idx) => (
          <button key={idx} type="button" lang="fr" className="tile" disabled={answered || built.includes(idx)} onClick={() => update([...built, idx])}>
            {w}
          </button>
        ))}
      </div>
    </>
  );
}

function FixWords({ view, answered, onDraft }: Common) {
  const [at, setAt] = useState<number | null>(null);
  return (
    <>
      <div className="wordline" role="group" aria-label="The sentence. Tap the wrong word">
        {view.words.map((w, i) => (
          <button
            key={i}
            type="button"
            lang="fr"
            className="wd"
            aria-pressed={at === i}
            disabled={answered}
            onClick={() => {
              setAt(i);
              onDraft(w);
            }}
          >
            {w}
          </button>
        ))}
      </div>
      <div className="gloss">One word here is wrong. Tap it.</div>
    </>
  );
}

/** Everything the learner interacts with for one question (not the Check button). */
export function QuestionBody(p: Common) {
  const { q } = p;
  switch (q.k) {
    case "choice":
      return (
        <>
          <div className="card">
            <div className="fr">
              <Sentence s={q.s ?? ""} />
            </div>
            <div className="gloss">{q.en}</div>
          </div>
          <Options {...p} />
        </>
      );
    case "fr2en":
      return (
        <>
          <div className="card">
            <div className="fr" lang="fr">
              {q.s}
            </div>
          </div>
          <Options {...p} english />
        </>
      );
    case "type":
      return (
        <>
          <div className="card">
            <div className="fr">
              <Sentence s={q.s ?? ""} />
            </div>
            <div className="gloss">{q.en}</div>
          </div>
          <TypeBox {...p} />
        </>
      );
    case "en2fr":
      return (
        <>
          <div className="card">
            <div className="fr plain" lang="en">
              {q.en}
            </div>
            <div className="gloss">Write it in French, full sentence.</div>
          </div>
          <TypeBox {...p} />
        </>
      );
    case "build":
      return (
        <>
          <div className="card">
            <div className="fr plain" lang="en">
              {q.en}
            </div>
          </div>
          <BuildTiles {...p} />
        </>
      );
    case "fix":
      return (
        <>
          <div className="card">
            <div className="gloss" style={{ marginTop: 0 }}>
              {q.en}
            </div>
          </div>
          <FixWords {...p} />
        </>
      );
  }
}
