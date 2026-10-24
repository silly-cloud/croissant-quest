# Audit report 2: baseline `audit-fixes` (dffd29b), items 11-21 re-verified

Method: two read-only Explore agents re-checked each open item against `croissant-quest.html` (2532 lines) with file:line evidence
(one also ran the data sections in a vm); `ponytail-audit` rules (concrete case per finding) and `graphify update` (111 nodes / 257 edges,
`docs/GRAPH_REPORT-legacy-html.md`) were used for orientation. Items 1-10 were fixed on the baseline and are pinned by `tests-legacy/` (69 tests pass).
Not run here: the audit-prompt phases 3-4 as separate tickets (the findings below *are* the ticket list; each row names the port task that closes it).
Not checked: real screen readers, on-screen keyboard, the artifact host.

| # | Status on baseline | Evidence (baseline) | Closed in the port by |
|---|---|---|---|
| 11 Repeat cap | OPEN | `topUp` serves retired questions (L1515); topics 1-5 have 7/16/13/4/5 questions and never get fresh ones (L1606 only topic 6); offline or failed Claude keeps repeats; `aiRows` never compares with the bank | shared `pickQuestions` documents the fallback; API `coach` rejects copies of bank qids (ADR 0005); web shows "repeat" honestly when no fresh question exists |
| 12 Accessibility | OPEN | `sheet()` has no dialog role/trap/Escape (L1435); no live region; no `lang`; `.ghost` ~36px tall, `.acc` 38px wide, `.quit` ~42px | web: native `<dialog>`, `aria-live`, `lang`, 44px targets, focus moved after every answer |
| 13 Results length | OPEN | est. 2200-2600px: say-list ~1200-1400px sits between score and the buttons | web: scores + buttons first, say-list and report collapsed |
| 14 innerHTML | OPEN (one real hole) | `S.hist` keys reach `innerHTML` unescaped (L2132, L2197, L2241) and `normState` keeps any key; also `aiEsc` + `textContent` shows `&amp;` literally | React escaping; `normState` drops hist keys not in `TAG` |
| 15 Missing `why` | OPEN | 7 of 246 have `why`. Strict gaps: bijou, genou, chou (-ou takes x), œil→yeux, hibou (aspirate h). Loose: sucre, beurre (-re). Unknown AI tag becomes `m` | content: `why` added for those 7; coach rejects unknown tags instead of defaulting to `m` |
| 16 Light contrast | OPEN | `--gold` text 3.97 on `--bg`; `--faint` on `--surf2` 4.34; `--lock` 1.77-2.20; `--line` borders 1.27-1.45 | web tokens: darker gold/faint, stronger border token; axe in CI |
| 17 aiRound guard | PARTLY | double press blocked by `AIBUSY` but `#btn-ai` passes its inner `<b>` so `disabled` does nothing; no timeout; late result calls `launchRound` with no round check (also in `freshenRound`) | web coach hook: 30 s timeout, disabled real button, result ignored if the round changed |
| 18 Weighted review | OPEN | sort by `S.wrong` (L1554) is discarded by `drawFrom`'s reshuffle (L1506) | shared `pickQuestions`: take weighted order without reshuffle (test) |
| 19 Pronunciation | OPEN | Hindi uses one glyph for Z and ZH (47 entries); Gujarati has two spellings for ZH; `n'avons`, `n'achetons`, `n'y` missing so 4 sentences show Latin letters; AI rows with blank pg/ph render empty | content: add the 3 words; Z/ZH glyph choice flagged for the owner (see below); shared `pron` falls back per column |
| 20 Smaller | MIXED | log cap and `__proto__` FIXED; open: long answer sent to `nearMissPrompt`; streak uses `Date.now()-864e5` (DST); 4-question AI round earns a croissant; 38 of 44 stops inert | shared `scoreRound` (calendar-day arithmetic, min-length for croissant); API truncates answers; inert stops stay (content scope) |
| 21 Hygiene | OPEN | duplicate `W` keys `j'ai`, `commande` (identical values); `.opt.sel`, `.verdict.ok` unused; `.acc` styles the 🤝 badge | extraction dedupes keys; styles not ported |

## Decision for the owner
Z vs ZH in Gujarati/Devanagari needs a native-speaker choice of glyphs; I will not guess. The port keeps today's glyphs and logs the issue.

## Ticket order (phase 3-4 equivalent)
1. 14 (security) 2. 11, 17, 18 (logic) 3. 12, 13, 16 (UI) 4. 15, 19 (content) 5. 20, 21.
