# Croissant Quest v18 audit: consolidated findings

Baseline: `croissant-quest.html` (script byte-identical to the live artifact). Lanes A-G ran read-only; nothing was applied.
Status words: **FAILED** = a check fails against today's code (defect confirmed); **SUCCESSFUL** = the check passes. Lanes used the words inconsistently; this report normalises them.
Evidence lives in `lanes/*.md` and `tests/*` (A-run-all.sh, B-run-all.sh, C-behave.js, E-tests.js, F-*.js).
French caveat: Academie/Larousse/Wiktionnaire pages were not fetchable from the sandbox. Lane B's citations came from search summaries; re-open the URLs before relying on a fine point.

## Ranked fix list

| # | Sev | Finding | Lanes | Status |
|---|---|---|---|---|
| 1 | HIGH | Save can be rolled back or lost: db copy always overwrites a newer local copy (xp 500 -> 100); answers given before the db read lands are wiped; two tabs overwrite each other; db write failures are invisible. | A, E, G, C | FAILED |
| 2 | HIGH | Quit does not cancel timers: an abandoned round can finish, award a crown and open results over the map; a stale timer skips Q1 of the next round. | A, G, C | FAILED |
| 3 | HIGH | Rule text teaches wrong French: "after pas everything becomes de" (le/la/les stay; contrasted partitive stays); "consonant before -re = masculine" (fenetre, lettre are feminine); `jouer du/de la` is not a partitive. In TAG.neg, TAG.t5, TAG.gre, RULES[6], aiPrompt and the notes. | B, G | FAILED |
| 4 | HIGH | Dark theme: white on `--grn` is 2.76:1 (needs 4.5) on Check/Play/Got it/Lock it in/Drill and completed discs; 2.13:1 on Continue; banner 1.84-2.63:1. Fix: separate `--grnfill:#1B7F5E` (4.95:1). | F | FAILED |
| 5 | HIGH | Dead buttons: Weak Spots, "Fresh questions" and Drill do nothing when there are no recorded misses and Claude fails or is absent, while the message says it is drilling. | A, G | FAILED |
| 6 | HIGH | Why-card doubles the sentence ("Je mange Je mange du fromage. fromage.") on all typed questions; whyCard builds its own answer line instead of `fullOf`. Reported by you; first fix did not hold. | A, G | FAILED |
| 7 | MED | `pron()` links through aspirate h (les/des haricots -> "day-za-ree-KO"; also heros, hibou, homard) and after pas/verbs; contradicts the game's own aspirate-h rule. Needs a mute-h list when h leaves `VOW`. | B, G | FAILED |
| 8 | MED | Retired-but-uncleared mistakes: 3 wrong answers retire a question that stays in `S.wrong` and can never be drilled, so Weak Spots never clears. Related: `qid()` is the question text, so any wording fix orphans history. | A, G, E | FAILED |
| 9 | MED | Crown can be awarded with zero topic-6 questions; `topUp` ignores crown tier (crown-1 round gets 6/8 higher-tier questions). | A, C | FAILED |
| 10 | MED | Produce-the-sentence questions accept exactly one answer; correct "Vous/Elles/On" variants are marked wrong and cost a heart (7 of 25 prompts). | A, B, G | FAILED |
| 11 | MED | Repeat cap: a question reaches 13 shows offline or when Claude fails; topics 1-5 uncapped; Claude output is not checked against the bank, so "new" can be a copy. | G | FAILED |
| 12 | MED | Accessibility: focus lost after every answer; sheet is not a dialog (no focus move/trap/Escape, 49 controls behind it); no live region, no `lang`; 44 Tabs to Play; tap targets under 44px (HUD 42x35, accent keys 38x44). | F | FAILED |
| 13 | MED | Results screen 3.5-4.8 phone screens tall; "Back to the map" ~4.7 screens down. | F | FAILED |
| 14 | MED | db-sourced values reach `innerHTML` unescaped at 4 sinks (matters if anyone else can write the db). | E | FAILED |
| 15 | MED | 12 exception questions lack their own `q.why`; unrecognised AI tag silently becomes `m` (a `de l'` answer gets the `du` rule); wrong rule text elsewhere ("four -al exceptions", "naked noun", sans, -eau/-eu). | B, G | FAILED |
| 16 | MED | Light-theme contrast (XP/combo 3.97, labels 4.02, locked labels 2.41, borders ~1.4) | F | FAILED |
| 17 | MED | `aiRound` double-press guard disables the wrong element (two Claude calls); late AI result replaces a round in progress; no timeout on Claude calls. | A | FAILED |
| 18 | LOW | "Weighted to past mistakes" review pick is not weighted (drawFrom reshuffles; p=0.101); `hasContent(q.t)` filter removes 0 rows. | D | FAILED |
| 19 | LOW | Pronunciation: Z and ZH share one glyph in Gujarati/Devanagari; 4 sentences show French letters in Indic rows; translate-to-English wrong-answer card has no pronunciation; AI questions can show empty rows. | B, G | FAILED |
| 20 | LOW | Smaller: `S.log` unbounded, old-save shapes unnormalised, `__proto__` key, uncapped answer sent to explainer, `pron()` throws on "constructor", streak resets on DST day, 4-question AI round earns a croissant, 38 of 44 map stops inert. | A, E, G | FAILED |
| 21 | LOW | Hygiene: about 90 lines removable (3.7%; 39 measured), duplicate `W` keys, unused `.opt.sel`/`.verdict.ok`, `.acc` style leaks onto the handshake badge. | D | FAILED |

Passing checks (SUCCESSFUL): no complex model tier anywhere; seen flag -> count migration reads old saves; model output cannot inject markup; all 246 bank answer keys are correct; no horizontal overflow at 360/320; all 246 questions answered right and wrong throw nothing; `safely()` isolation works.

## Gaps in this audit
- Phases 0-1 orientation and 3-4 challenge/tickets skills were not run; only the lane skills were. About 40 skills were N/A (slash-only or `disable-model-invocation`), listed in each lane's ledger.
- The author's 12 original test suites were not provided; lane C built a new 49-test suite (45 pass, 4 xfail; 25/25 planted bugs caught, a score tuned to its own mutants).
- Not tested: on-screen keyboard, real screen readers, rendering in the real artifact host.

## Decisions only you can make
1. Which fix numbers to apply (suggested: 1-6, then 7-10).
2. Move the coach from Haiku-class to Sonnet?
3. Keep proof mode?
4. Keep XP, hearts, crowns and the boss card?
