# Owner questions (mattpocock-grilling round 1, recorded not asked; owner said do not stop)

Each question is worded so "yes" accepts my recommendation. Nothing waits on these except the DECISION tickets in FIX-PLAN.md.

❓ **Q1 - Parallel progress across tabs/devices**: Today two tabs (or a phone that played offline) lose each other's XP, rounds, seen counts and fresh misses, because counters merge by max and `wrong` by newer `ts` (AUD rows for K-1/K-2, reproduced: 39 + 10 xp -> 39). Options: (a) per-device counters that sum on read; (b) send deltas (events) instead of whole state; (c) accept it and document "use one tab".
➡️ Yes to (a) for xp/cro/rounds/seen/hist plus per-question last-changed times for `wrong` (small, keeps the jsonb design).

---

❓ **Q2 - Cross-device identity for v1**: ADR 0004 gives each device its own anonymous user, so a learner's phone and laptop never share progress at all. Is one device per learner acceptable for v1?
➡️ Yes for v1; add an export/import code later (it is promised in ADR 0004 and exists nowhere).

---

❓ **Q3 - Coach on a public host**: The coach can be drained by minted cookies and triggered cross-site (AUD rows for D-api-1/H-1/H-2). Ship the first public deploy with the coach OFF (no key) until per-IP limits, a daily cap and a required device cookie land?
➡️ Yes.

---

❓ **Q4 - Guardrail scope**: The Claude Code hook fails open and has 19 evasions; main is unprotected on GitHub. Make GitHub branch protection (PR + required `check`, no force-push, no deletion) the real boundary and keep the hook as a cheap, fail-closed tripwire?
➡️ Yes; you need to turn on the ruleset yourself (I cannot reach repo settings).

---

❓ **Q5 - Parity gate**: Retired-question refresh (`freshenRound`) was dropped in the web port and 24 of 69 legacy tests are not fully ported. Is "port freshen-with-Claude + port the 24 missing tests by name" the bar for deleting `croissant-quest.html`?
➡️ Yes.

---

❓ **Q6 - Streak semantics**: Should a streak count play days from any device (laptop day 1 + phone days 2-3 = 3), and should a date in the future (clock skew) be rejected?
➡️ Yes to both (store play days, not just `last`; reject `last` later than server today + 1).
