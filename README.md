# Croissant Quest

A single-file French A1 learning game, focused on partitive articles (du / de la / de l' / des), with
pronunciation in English phonetics, Gujarati and Devanagari. One HTML file, no build step.

- `croissant-quest.html`: the whole game (HTML + CSS + one `<script>`).
- `docs/audit-prompt.md`: the full-structure audit prompt used to review it, chained across Claude Code skill packs.

## Running it

The game was written as a Claude artifact and expects two runtime capabilities: `db` (save state) and `sample`
(AI question generation and coaching). Without them it falls back to `localStorage` and the built-in question bank.
Open the file in a browser, or publish it as an artifact with `db` and `sample` enabled.

## Known issues (found by audit, not yet fixed)

This is v18. An audit found problems you should know about before relying on it for learning:

- Some rule texts teach incorrect French (the negation rule is too broad: `le/la/les` do not become `de`;
  "consonant before -re means masculine" is false; `jouer du piano` is not a partitive).
- Pronunciation makes a liaison through an aspirate h (`les haricots`).
- Save-state races between devices/tabs, and Quit does not cancel a running round.
- Dark-theme contrast and keyboard navigation need work.

Issues and pull requests are welcome.

## License

MIT, see `LICENSE`.
