import type { PronResult } from "@cq/shared";

/** The three readings of a sentence: English-letter, Gujarati and Hindi. Always together, never one alone. */
export function PronRows({ pr }: { pr: PronResult }) {
  return (
    <dl>
      <dt>Eng</dt>
      <dd lang="en">{pr.e}</dd>
      <dt>ગુજ</dt>
      <dd lang="gu">{pr.g}</dd>
      <dt>हिं</dt>
      <dd lang="hi">{pr.h}</dd>
    </dl>
  );
}
