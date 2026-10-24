# Glossary and ADR proposals (mattpocock-domain-modeling; proposals only, the audit may not edit docs/GLOSSARY.md)

Checked docs/GLOSSARY.md and docs/adr/0001-0007 against the code and lane B's domain notes.

## Term conflicts found
- **Partitive article**: glossary says "du / de la / de l' / des, 'some' of an uncountable thing". `des` is the plural indefinite with countable nouns (des pommes). Proposed: "du / de la / de l': 'some' of an uncountable thing. `des` is the plural of un/une and the game groups it here."
- **Rule card** means two things: the per-tag rule + trick shown on a wrong answer (`TAG`) and the per-topic card on the map (`RULES`). Proposed terms: **Rule tip** (per tag) and **Topic card** (per topic).
- **Save / State / version**: glossary says "one JSON progress document per device; counters merge by max". Since ADR 0006, streak and last move together and the log is a union. Proposed: link the term to ADR 0006 and drop the merge detail (it is implementation, the skill says keep it out of the glossary).
- **Device vs learner**: the code has Users that are devices (ADR 0004). The glossary never says a learner with two devices is two users. Proposed term: **Device** = one anonymous identity; **Learner** = the person (no code entity yet).

## Missing terms
- **Exception question**: a bank question whose answer breaks its tag's general rule; carries its own `why`.
- **Kind**: one of choice, type, en2fr, build, fix, fr2en.
- **Reading**: the three pronunciation rows (English phonetic, Gujarati, Devanagari) for a sentence.
- **Fresh question**: a coach-written question, never stored in the bank, never counted in `seen`/`wrong`.

## ADRs
- ADR 0002 and 0004 need an "Amended by 0006" back-link (lane I). ADR 0004 says "a first visit creates the user"; since the review fixes only `GET /v1/progress` does.
- A new ADR is warranted only for the Q1 answer in OWNER-QUESTIONS.md (merge redesign: hard to reverse, surprising, a real trade-off). Nothing else meets all three of the skill's tests.
