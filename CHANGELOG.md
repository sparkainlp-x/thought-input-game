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
- Fixed: the near-duplicate warning on storing now names the closest stored thought
  (highest Jaccard above 0.7; a tie goes to the earlier one). The original named the
  last one above 0.7. Only the name in the message can differ, and only when two
  stored thoughts are above 0.7 (with the built-in thoughts: Tree and Arrow).
- Added: `createMulberry32` and `createRng(seed, "mulberry32")`, a well-defined
  32-bit generator for tests and measurements. `createRng(seed)` and the game still
  use the original generator, so game behaviour is unchanged.
- Measurements: `docs/behaviour.md` now uses 1000 probes per stored thought and
  mulberry32, adds a comparison with the legacy generator (section 6b) and a section
  on the store warning. The conclusions are unchanged; every rate moved by about 1 point or
  less, within the sampling error of the earlier 200-probe tables.
- Added: `docs/gate-experiment.md` and `scripts/gate_experiment.js`, an optional
  experiment on stricter gate checks for dense random patterns. Not used by the
  game; tau stays 0.35.
- Documentation: README limits now give the dense-pattern gate numbers; an "AI
  assistance" note was added.
