# Croissant Quest

A single-file French A1 learning game, focused on partitive articles (du / de la / de l' / des), with
pronunciation in English phonetics, Gujarati and Devanagari. One HTML file, no build step.

- `croissant-quest.html`: the whole game (HTML + CSS + one `<script>`).
- `docs/audit-prompt.md`: the full-structure audit prompt used to review it, chained across Claude Code skill packs.

## Running it

The game was written as a Claude artifact and expects two runtime capabilities: `db` (save state) and `sample`
(AI question generation and coaching). Without them it falls back to `localStorage` and the built-in question bank.
Open the file in a browser, or publish it as an artifact with `db` and `sample` enabled.

## Tests

```
cd tests
node C-behave.js    # 49 behaviour tests: answering, saving, quitting, round building
node fixes.js       # 20 regression tests for the audit fixes
```

They run the page's `<script>` in node with a stubbed DOM, `localStorage` and artifact runtime. No dependencies.

## Audit

`docs/AUDIT-REPORT.md` is the ranked list of 21 findings from a full audit of v18. Items 1-10 are fixed on this
branch; the rest are open:

- Repeat cap is not enforced when Claude is offline, and topics 1-5 have no cap (11).
- Accessibility: focus management, dialog semantics, live regions, 44px tap targets, long results screen (12-13).
- Database-sourced text reaches `innerHTML` unescaped (14).
- Several exception questions lack their own rule text (15); light-theme contrast (16).
- Two simultaneous tabs or devices merge to the larger counters rather than adding up.

## License

MIT, see `LICENSE`.
