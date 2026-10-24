# Croissant Quest

A single-file French A1 learning game, focused on partitive articles (du / de la / de l' / des), with
pronunciation in English phonetics, Gujarati and Devanagari. One HTML file, no build step.

- `croissant-quest.html`: the whole game (HTML + CSS + one `<script>`).
- `docs/audit-prompt.md`: the full-structure audit prompt used to review it, chained across Claude Code skill packs.

## Running it

The game was written as a Claude artifact and expects two runtime capabilities: `db` (save state) and `sample`
(AI question generation and coaching). Without them it falls back to `localStorage` and the built-in question bank.
Open the file in a browser, or publish it as an artifact with `db` and `sample` enabled.

## Known issues

This is v18 plus the first audit fixes (findings 1-10 of the audit, except 7's full mute-h word list and 10's
build-tile variants). Still open from the audit: Claude output is not checked against the bank (so "new" can be a
copy), accessibility (focus management, sheet as a dialog, live regions, tap-target size), the long results
screen, light-theme contrast, unescaped db values at a few `innerHTML` sinks, and the smaller hygiene items.

Issues and pull requests are welcome.

## License

MIT, see `LICENSE`.
