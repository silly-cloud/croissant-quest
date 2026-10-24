"use client";

import { useEffect, useState } from "react";
import { TAG, qid, type Question } from "@cq/content";
import { fullOf, pron } from "@cq/shared";
import { requestExplain } from "@/lib/coach";
import { answerParts } from "@/lib/answer-line";
import { Rich } from "@/lib/rich";
import { PronRows } from "./PronRows";
import { Sheet } from "./Sheet";

/** Answers the learner produced themselves can miss in ways the tag rule does not explain: ask the coach. */
const NEAR_MISS = new Set<Question["k"]>(["type", "en2fr", "build", "fix"]);

interface Props {
  q: Question;
  picked: string | null;
  accentsOnly: boolean;
  onDone: () => void;
}

export function WhyCard({ q, picked, accentsOnly, onDone }: Props) {
  const full = fullOf(q);
  const p = q.pr?.e ? q.pr : pron(full);
  // A question that IS the exception must not be explained by the general rule.
  const t = q.why ?? TAG[q.tag] ?? ["", ""];
  const [explain, setExplain] = useState<string | null>(null);

  useEffect(() => {
    if (!NEAR_MISS.has(q.k) || q._ai) return;
    let alive = true;
    void requestExplain((...a) => fetch(...a), qid(q), picked ?? "").then((text) => {
      if (alive && text) setExplain(text);
    });
    return () => {
      alive = false;
    };
  }, [q, picked]);

  return (
    <Sheet label={accentsOnly ? "So close. Check the accents" : "Not quite"} onClose={onDone}>
      <p className="verdict">
        <span aria-hidden="true">✗</span>
        <span>{accentsOnly ? "So close: accents" : "Not quite"}</span>
      </p>

      <div className={"answerline" + (q.k === "fr2en" ? " en" : "")}>
        <span className="sr-only">Answer: </span>
        {q.k === "fr2en" ? (
          <em lang="en">{q.a}</em>
        ) : (
          <span lang="fr">
            {answerParts(q).map((part, i) => (part.em ? <em key={i}>{part.text}</em> : <span key={i}>{part.text}</span>))}
          </span>
        )}
      </div>

      {q.k === "fix" ? (
        <div className="yourline">
          The broken part was <s lang="fr">{q.bad}</s>
        </div>
      ) : (
        picked && (
          <div className="yourline">
            You wrote: <s>{picked}</s>
          </div>
        )
      )}

      {accentsOnly && (
        <div className="rule">
          <i aria-hidden="true">⚠️</i>
          <span>
            The words were right, the <b>accents</b> were not. In French an accent is a letter, not decoration.
          </span>
        </div>
      )}
      {t[0] && (
        <div className="rule">
          <i aria-hidden="true">💡</i>
          <span>
            <Rich html={t[0]} />
          </span>
        </div>
      )}
      {t[1] && (
        <div className="rule">
          <i aria-hidden="true">🧠</i>
          <span>
            <b>
              <Rich html={t[1]} />
            </b>
          </span>
        </div>
      )}

      {explain && (
        <div className="coach">
          <div className="coach-h">
            <i aria-hidden="true">🧑‍🏫</i>
            <b>Why yours missed</b>
          </div>
          <div className="coach-body">{explain}</div>
        </div>
      )}

      <div className="pron">
        <h4>Say it</h4>
        <PronRows pr={p} />
        <p className="note">Gujarati and Hindi are approximations. French u and the nasal vowels have no exact equivalent.</p>
      </div>

      <div className="row2">
        <button type="button" className="go" data-autofocus onClick={onDone}>
          Got it
        </button>
      </div>
    </Sheet>
  );
}
