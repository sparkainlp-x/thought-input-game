# Changelog

## Unreleased

Initial public version. Starting point: the supplied single-file game, kept in
`test/fixtures/original-thought-input-game.html`. Changes on top of it:

- Packaging: memory, gate, scoring helpers and the sonification mapping moved to
  `src/membrane.js`; page script moved to `src/game.js`; unit tests, browser tests,
  a generated `docs/behaviour.md`, CI and a Pages workflow added. Behaviour is
  unchanged and checked against the original code.
- Fixed: after a round was won, a free-mode projection re-enabled Project, so the
  round could be scored again and unlock another thought.
- Fixed: after a free-mode projection in an open round, Peek stayed disabled and
  Fragment assist did nothing.
- Fixed: the pad could not be used with the keyboard (cells reacted to pointer
  events only). Space and Enter now toggle the focused cell.
- Accessibility: `aria-live` on the verdict, `role="group"` on the status bar,
  `role="img"` on the hologram canvas.
- Privacy: removed the Google Fonts request; system fonts are used.
- Wording: the "Honest limits" footer says the memory is a list of patterns
  combined into a weighted field at recall, not a trained matrix.
- Documented, not changed: the random generator is not the integer LCG it was
  written as (the product exceeds 2^53 in JavaScript); it has a cycle of 10466
  draws after a lead-in of 2423. Targets, Fragment assist and Scramble keep the
  original sequence.
- Documented, not changed: the near-duplicate warning on storing reports the last
  stored thought with Jaccard above 0.7, not the closest.
