# Contributing

This is a small SYNTHETIC research toy; issues and pull requests are welcome.

- Run `npm run ci` before you open a pull request (unit tests, wording check and the
  behaviour check). `npm run e2e` runs the browser tests and needs `npm install`.
- Game logic stays in `src/membrane.js` with no runtime dependencies. If a change
  alters a number in `docs/behaviour.md`, regenerate it with `npm run behaviour`
  and say why in the pull request.
- Keep claims honest: label results SYNTHETIC, report null results, and never
  describe the game as reading minds or brains, or as a medical or optical device.
- The page must not load anything from another origin (the wording check enforces it).
- Commit messages: imperative mood, one logical change per commit.
- Contributions are accepted under AGPL-3.0-only.
