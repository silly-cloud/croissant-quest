# Lane 1 review (ponytail-review, packages/shared + packages/content)

What this change does: moves the game's pure rules and the 246-question bank out of the HTML file into typed, tested packages.

Must fix (done in the follow-up commit)
1. **Free-form log entries stored and shown** (`state.ts normState`). Problem: `log` and `feelLog` items were kept as sent, so a client could save huge or odd objects that later reach the db and the UI. Fix: keep only known fields with capped lengths, cap list sizes, clamp counters to 0..MAX_SAFE_INTEGER and feel to 0..100. Test added.

Logged, not fixed (behaviour kept from the legacy game)
2. **Streak can look inflated after a merge** (`mergeStates`). Device A has streak 7 (last day 23rd, older save); device B restarted at 1 on the 24th (newer save). Merge shows streak 7 with last = 24th. Same as legacy. Needs a product decision (take the newer save's streak?).
3. **`scoreRound` croissant rule changed on purpose**: only full-length (8+) perfect rounds earn one (legacy: any perfect round, so a 4-question AI round earned one). Audit item 20.
4. **Integration risk**: the packages are TypeScript source (`main: src/index.ts`, ESM, JSON import attributes). NestJS compiles to CommonJS by default. The API lane must either build the packages to `dist` or run Nest as ESM. To be decided from the API agent's report.

Verdict: fix 1 first (done). Lean: nothing to delete.
Not checked: behaviour inside a browser (Lane 3).
