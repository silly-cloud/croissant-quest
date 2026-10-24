# Parity: legacy game vs the port

The legacy single-file game had 69 tests (`tests-legacy/C-behave.js` 49, `tests-legacy/fixes.js` 20).
The parity gate is: each one has a ported twin, or the difference is explained here.

- Run the gate: `node scripts/parity-report.mjs` (exit 1 if any legacy name has no mapping or a mapping points at a missing test).
- Shared-rule twins live in `packages/shared/test/legacy-parity.test.ts`. Each title is the exact legacy name behind `[legacy C-behave] ` or `[legacy fixes] `. Differences are asserted as the new behaviour in the `[changed: ...]` tests of the same file.
- A row that says `SHARED` is covered by that file. A row with a `file :: "title"` pair names a web, api or content test; the report checks the title exists in the file. `UI-only:` rows need a browser or a timer and have no shared function to call; the reason is on the row.

## The table

Columns: legacy test | where covered | same or changed (with the reason or ADR).

| id | Legacy test | Where covered | Same / changed |
|---|---|---|---|
| C1 | a right answer scores 10 then 13 xp, builds combo, and persists to localStorage | SHARED; `apps/web/test/game-store.test.ts` :: "loads the single-file game's save" | same (xp ladder shared; persistence web) |
| C2 | xp bonus caps: 8 right in a row earn 163 total | SHARED | same |
| C3 | a wrong answer costs a heart, resets combo, earns no xp, and queues the question as missed | `apps/web/test/components.test.tsx` :: "a wrong answer costs a heart, opens the why-card, and Got it moves on"; `apps/web/test/engine.test.ts` :: "counts every answer toward SEEN_CAP" | same (web: heart, combo reset) |
| C4 | answering the same question twice in one tap is ignored (double submit) | `apps/web/test/engine.test.ts` :: "ignores a second press on the same question" | same |
| C5 | a right answer works a previously-missed question's miss count back down and then clears it | `apps/web/test/engine.test.ts` :: "clears a miss once it is answered right" | same |
| C6 | each answered question is counted in S.seen | `apps/web/test/engine.test.ts` :: "counts every answer toward SEEN_CAP" | same |
| C7 | a question answered three times is retired from normal rounds | SHARED | same |
| C8 | tag history records right and wrong separately | SHARED | same |
| C9 | typed answer: accents-only miss is wrong but typing the whole answer in caps/space noise is right | SHARED | same |
| C10 | choice answers are exact-match | SHARED | same |
| C11 | ending on hearts: 5 wrong answers end the round early with 'Out of hearts' and no crown | SHARED; `apps/web/test/engine.test.ts` :: "five wrong answers end the round with no crown" | same |
| C12 | saveAll writes the whole state to localStorage and survives a reload | SHARED; `apps/web/test/game-store.test.ts` :: "loads the single-file game's save" | same |
| C13 | saveAll does not throw when storage is full/blocked | `apps/web/test/game-store.test.ts` :: "works with no storage at all" | same |
| C14 | saveAll trims log to last 120 and feelLog to last 20 in the db copy | SHARED; `apps/web/test/game-store.test.ts` :: "sends the log trimmed"; `apps/api/test/unit/core.test.ts` :: "keeps the newest 120 log entries" | changed: ADR 0006: normState keeps 500 log entries locally, 120 are stored |
| C15 | db copy carries xp, cro, streak, crowns, wrong, seen, hist, calib | SHARED; `apps/api/test/e2e/progress.e2e.ts` :: "create, read, update" | same |
| C16 | every answer is committed immediately (reload mid-round keeps the xp) | `apps/web/test/engine.test.ts` :: "scores XP with the combo ladder"; `apps/web/test/game-store.test.ts` :: "loads the single-file game's save" | same |
| C17 | answer after boot with a db: the db doc receives the answer's xp | `apps/web/test/game-store.test.ts` :: "merges the server copy into the local one" | same |
| C18 | 7/8 on topic 6 with hearts left earns crown 1; a perfect round also earns a croissant and results show | SHARED; `apps/web/e2e/smoke.spec.ts` :: "play a full round answering everything correctly" | same (score tiles: e2e) |
| C19 | exactly one miss still earns a crown while the topic has under 3 crowns | SHARED | same |
| C20 | two misses earns no crown but the round is counted | SHARED | same |
| C21 | from crown 3 up a crown needs a perfect round | SHARED | same |
| C22 | crowns never exceed 5 | SHARED | same |
| C23 | a weak-spots round never awards a topic crown | SHARED | same (and ai rounds too) |
| C24 | first round ever starts a streak of 1; next-day round makes 2; a gap resets to 1; same day does not double count | SHARED | same (yesterday by calendar arithmetic, see AUDIT-REPORT-2 #20) |
| C25 | ending a round saves to localStorage and the db doc | `apps/web/e2e/smoke.spec.ts` :: "play a full round answering everything correctly"; `apps/web/test/game-store.test.ts` :: "serialises: a save made during a sync" | same |
| C26 | results screen still appears if scoring blows up (safely isolation) | UI-only: results screen after a throwing score step is engine.ts finish(); no shared function to call. Known web gap A-product-3, not covered by any test yet | same intent, REGRESSED in web (open gap) |
| C27 | quit hides the round and shows the map, with no crown or round counted | `apps/web/test/engine.test.ts` :: "cancel() clears every timer and turns the engine inert"; `apps/web/e2e/smoke.spec.ts` :: "Quit mid-round, start another" | same |
| C28 | quit keeps the xp already earned | `apps/web/test/engine.test.ts` :: "cancel() clears every timer and turns the engine inert" | same |
| C29 | [fixed #5] after quit, a pending end-of-round timer must not crown or show results | `apps/web/test/engine.test.ts` :: "the last question's finish timer dies with the round" | same |
| C30 | a round has 8 distinct questions | SHARED | same |
| C31 | never serves a retired (3x seen) question while enough fresh ones exist | SHARED | same |
| C32 | seen count of 2 is still live (cap is at 3) | SHARED | same |
| C33 | when everything is retired the round is still a full 8 (never a short round) | SHARED | same |
| C34 | first-crown round draws from the topic and earlier topics only, at tier 1 for the topic | SHARED | same |
| C35 | higher crowns unlock higher tiers (crown 4 -> tier 5 appears) | SHARED | same |
| C36 | weak mode leads with the player's missed questions | SHARED | same |
| C37 | a weak rule (<60% over 3+ tries) puts at least 3 of its questions in a normal round | SHARED | same |
| C38 | a rule under 3 tries is not 'weak' yet | SHARED | same |
| C39 | starting a normal round with a weak rule shows the boss card first; its button then starts the round | SHARED; UI-only: the boss card itself (RoundScreen.tsx) has no web unit/e2e test yet (A-product-4) | same (trigger and 3+ questions in shared; card UI untested) |
| C40 | startRound shows the round screen and hides the map | `apps/web/e2e/smoke.spec.ts` :: "play a full round answering everything correctly"; UI-only: 5 hearts is an engine constant (engine.ts:33), asserted indirectly by 'five wrong answers end the round' | same |
| C41 | boot with nothing stored starts fresh with topics 1-5 mastered | SHARED; `apps/web/test/game-store.test.ts` :: "starts empty with the mastered stops crowned" | same |
| C42 | boot restores local state | SHARED; `apps/web/test/game-store.test.ts` :: "loads the single-file game's save" | same |
| C43 | boot survives corrupt local storage | SHARED; `apps/web/test/game-store.test.ts` :: "survives a corrupt save" | same |
| C44 | boot with a db save: db state is adopted, mutable, and later saves go to the db | SHARED; `apps/web/test/game-store.test.ts` :: "merges the server copy into the local one" | same |
| C45 | boot with an empty db creates the save doc from local state | `apps/web/test/game-store.test.ts` :: "never PUTs before a GET" | same |
| C46 | before the db read lands, answers are saved locally but NOT written to the db (no xp-0 overwrite) | `apps/web/test/game-store.test.ts` :: "never PUTs before a GET" | same |
| C47 | [fixed #4] a device copy newer than the db copy must not be lost on boot | SHARED; `apps/web/test/game-store.test.ts` :: "merges the server copy into the local one" | same |
| C48 | [fixed #6] a question answered wrong 3 times and still outstanding in S.wrong must not be retired | SHARED | same |
| C49 | [fixed #7] topic-6 crown must not be awardable by a round with no topic-6 questions | SHARED | same |
| F1 | a newer device copy survives the db read (xp 500 vs db 100) | SHARED; `apps/web/test/game-store.test.ts` :: "merges the server copy into the local one" | same (merge now also pairs streak+last, ADR 0006) |
| F2 | an answer given before the db read lands is not wiped when it does | SHARED; `apps/web/test/game-store.test.ts` :: "never PUTs before a GET" | same |
| F3 | two copies merge upward: counters never shrink, hist and seen take the larger | SHARED | same |
| F4 | a __proto__ key in a saved doc cannot re-prototype the state | SHARED; `apps/api/test/e2e/progress.e2e.ts` :: "hostile bodies are normalised" | same |
| F5 | a failed db write is shown to the learner, not swallowed | `apps/web/test/game-store.test.ts` :: "keeps playing and saving locally when the API is down, and says so"; `apps/web/e2e/smoke.spec.ts` :: "the API down: a banner says so" | same |
| F6 | quit then the timers fire: no crown, no results screen, next round untouched | `apps/web/test/engine.test.ts` :: "a timer left from a quit round never acts on the next round"; `apps/web/test/engine.test.ts` :: "a wrong answer's pending why-card never opens after Quit" | same |
| F7 | Weak Spots starts a round even with no recorded mistakes | SHARED; `apps/web/e2e/smoke.spec.ts` :: "coach unavailable: Fresh questions and Weak Spots still start a round" | same |
| F8 | Drill with no Claude and no mistakes still starts a round | SHARED; `apps/web/test/round-host.test.ts` :: "coach unavailable (fallback) still starts a local weak round" | same |
| F9 | Drill falls back to a local round when Claude fails | `apps/web/test/round-host.test.ts` :: "a 429 from the coach falls back to a local round"; `apps/web/test/round-host.test.ts` :: "coach error and an unreachable API also fall back" | same |
| F10 | a missed typed question shows the finished sentence once, not spliced into itself | SHARED; `apps/web/test/content.test.tsx` :: "never doubles the sentence" | same |
| F11 | a missed choice question closes the elision up against its noun | SHARED; `apps/web/test/content.test.tsx` :: "underlines only the supplied word for a choice, and closes elisions" | same |
| F12 | no liaison through an aspirate h (les haricots), liaison kept for mute h and vowels | SHARED; `packages/shared/test/pron.test.ts` :: "no liaison through an aspirate h" | same |
| F13 | no invented liaison after a verb or pas | SHARED | same |
| F14 | a question wrong three times stays servable until it is answered right | SHARED | same |
| F15 | mistakes for questions the bank no longer has are dropped on load | SHARED | same |
| F16 | a round of other topics' questions cannot award the topic-6 crown | SHARED | same |
| F17 | both tu and vous (nous and on, ils and elles) are accepted for an ambiguous English prompt | SHARED; `packages/shared/test/text.test.ts` :: "en2fr accepts the listed alternative subjects" | same |
| F18 | rule text no longer teaches the false negation / -re / jouer rules | SHARED; `packages/content/test/bank.test.ts` :: "keeps the corrected French rules" | same |
| F19 | white text on the button / banner / disc greens clears 4.5:1 in light and dark | `apps/web/e2e/a11y.spec.ts` :: "map, round, why-card and results have no serious or critical axe violations"; UI-only: colour contrast is CSS (tokens), no shared rule; axe checks it in light and dark | same (axe, not a token-level ratio test) |
| F20 | no model call asks for the complex tier, and the coach is no longer the quick tier | `apps/api/test/unit/core.test.ts` :: "no key means no client; the model id lives in config only" | same (coach tier is 'default', api config) |

## Totals

Output of `node scripts/parity-report.mjs`:

```
legacy tests: 69 (C-behave 49, fixes 20)
S  shared test with the exact legacy name: 49
W  no shared twin, mapped to web/api/content test: 19
U  UI-only, reason given: 1   (C26, the open web gap)
!  unmapped: 0
PARITY GATE OK
```

49 + 19 + 1 = 69. Many "S" rows also list a web or api twin; the report counts them once, under S.

## Behaviour differences, each with its reason

Asserted as the new behaviour in `packages/shared/test/legacy-parity.test.ts` (the `[changed: ...]` tests).

| Difference | Legacy | Port | Why |
|---|---|---|---|
| Croissant | any perfect round | perfect round of 8 or more questions | a 4-question coach round was too easy a croissant (AUDIT-REPORT-2 #20) |
| "Yesterday" for the streak | local `Date` arithmetic | calendar arithmetic on the day string | a DST day broke the streak (AUDIT-REPORT-2 #20) |
| Merge of `streak` and `last` | `max(streak)` and later `last` separately | both from the copy with the later `last` (equal: larger streak) | one fact, must not mix (ADR 0006) |
| Merge of `log` | log of the newer copy | union by `(at, q)`, newest 500 | no lost history across devices (ADR 0006) |
| Log size | 120 in the db copy | 500 in `normState`, 120 stored by the API | ADR 0006 |
| `last` | any string kept | only a real `YYYY-MM-DD`, else null | an arbitrary string won every `last` compare (AUDIT-REPORT-2 #14) |
| `normState` bounds | none | counters clamped to 1e9, unknown rule keys and topic ids dropped, key and map caps, log entries whitelisted | hostile or corrupt saves (AUDIT-REPORT-2 #14, ADR 0006) |
| Review picks (normal round) | "weighted" but reshuffled afterwards | most-missed earlier-topic questions first, no second shuffle | item 18, the weighting never took effect (AUDIT-REPORT-2 #18) |
| `pron` | `n'avons`, `n'achetons`, `n'y` missing; `constructor` threw | words added; prototype names never throw | AUDIT-REPORT-2 #19, #20 |
| Bank | 7 exceptions had no own `why` | `why` added | AUDIT-REPORT-2 #15 |
| Coach | no checks on model output | rejects copies of bank questions, unknown tags, HTML | ADR 0005, AUDIT-REPORT-2 #11 |
| Sheets and a11y | div overlays | `<dialog>`, `lang`, 44 px targets | AUDIT-REPORT-2 #12, #13 |

Differences with no test or no doc yet (from the product audit, owned by the web lane, not shared rules):

- Results can stay stuck on "finishing" if `store.update` throws (legacy "results screen still appears if scoring blows up"): open gap A-product-3, the only legacy behaviour that regressed. Row C26.
- The boss card has no web unit or e2e test (A-product-4). The trigger (`weakTag`) and the 3+ questions are tested in shared.
- Retired repeats in a topic-6 round are no longer swapped for coach-written questions (A-product-1).
- The fr2en why-card shows the readings (A-product-5), the Drill button shows before the feel lock (A-product-6), the copied-progress header punctuation changed (A-product-7).

## Not covered here

- Rebase of a stale device copy (planned as ADR 0010): there is no ADR 0010 and no rebase function in `packages/shared/src` on this branch, so nothing is asserted. When it lands, add `[changed: ADR 0010]` tests next to the merge ones.
- Legacy tests are not deleted by this change; `tests-legacy/*.js` still run against `croissant-quest.html` (`node tests-legacy/C-behave.js`, `node tests-legacy/fixes.js`).
