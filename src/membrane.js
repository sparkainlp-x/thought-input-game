/* Thought-Input Game: memory, gate and sonification logic.
 *
 * Extracted from the single-file game with the logic unchanged, apart from the
 * documented fixes in the CHANGELOG. Plain
 * ES5-style code so that the same file runs in the browser (as a classic
 * script that defines window.Membrane) and in Node (module.exports).
 * SYNTHETIC toy: a drawn 12 x 12 pattern is the "thought". Nothing here reads
 * a brain, and nothing is an optical hologram.
 */
(function (root) {
  "use strict";

  var G = 12, N = G * G;
  var TAU = 0.35;                 // refusal gate threshold (cosine)
  var MIN_PROBE_CELLS = 3;        // a probe with fewer lit cells is always refused
  var RECALL_CUTOFF = 0.38;       // recalled cell if field > 0.38 * max field
  var DEFAULT_SEED = 1234567;
  // Sonification: row = time step, column = pitch (Hz).
  var SCALE = [262, 294, 330, 392, 440, 523, 587, 659, 784, 880, 1047, 1175];

  var GLYPH_ROWS = [
    { name: "Heart", rows: [
      "............",
      ".###....###.",
      "#####..#####",
      "############",
      "############",
      ".##########.",
      "..########..",
      "...######...",
      "....####....",
      ".....##.....",
      "............",
      "............" ] },
    { name: "Star", rows: [
      ".....##.....",
      "....####....",
      "....####....",
      "############",
      ".##########.",
      "..########..",
      "...######...",
      "...##..##...",
      "..##....##..",
      "..#......#..",
      "............",
      "............" ] },
    { name: "Tree", rows: [
      ".....##.....",
      "....####....",
      "...######...",
      "..########..",
      ".##########.",
      "..########..",
      "...######...",
      ".....##.....",
      ".....##.....",
      ".....##.....",
      "....####....",
      "............" ] },
    { name: "Moon", rows: [
      "....#####...",
      "..########..",
      ".######.....",
      ".#####......",
      "#####.......",
      "####........",
      "####........",
      "#####.......",
      ".#####......",
      ".######.....",
      "..########..",
      "....#####..." ] },
    { name: "Eye", rows: [
      "............",
      "...######...",
      ".##########.",
      "####.##.####",
      "###..##..###",
      "###..##..###",
      "####.##.####",
      ".##########.",
      "...######...",
      "............",
      "............",
      "............" ] },
    { name: "Arrow", rows: [
      ".....##.....",
      "....####....",
      "...######...",
      "..########..",
      ".##########.",
      ".....##.....",
      ".....##.....",
      ".....##.....",
      ".....##.....",
      ".....##.....",
      "............",
      "............" ] },
    { name: "Spiral", rows: [
      ".##########.",
      ".#........#.",
      ".#.######.#.",
      ".#.#....#.#.",
      ".#.#.##.#.#.",
      ".#.#.#..#.#.",
      ".#.####.#.#.",
      ".#......#.#.",
      ".########.#.",
      "..........#.",
      ".##########.",
      "............" ] },
    { name: "Orbit", rows: [
      "....####....",
      "..##....##..",
      ".#........#.",
      ".#........#.",
      "#....##....#",
      "#....##....#",
      "#..........#",
      ".#........#.",
      ".#........#.",
      "..##....##..",
      "....####....",
      "............" ] }
  ];

  function rowsToVec(rows) {
    var v = new Float32Array(N);
    for (var r = 0; r < G; r++)
      for (var c = 0; c < G; c++)
        v[r * G + c] = rows[r].charAt(c) === "#" ? 1 : 0;
    return v;
  }

  // Fresh glyph objects (so a game or a test can mutate its own copies).
  function makeGlyphs() {
    return GLYPH_ROWS.map(function (g) {
      return { name: g.name, rows: g.rows, vec: rowsToVec(g.rows), custom: false };
    });
  }

  // The game's original generator, kept verbatim as the "legacy" generator and
  // still the one the game uses, so play stays identical.
  // Note: in JavaScript the product state * 1103515245 exceeds 2^53, so this is
  // NOT the exact integer LCG; it is a deterministic, engine-independent
  // sequence with a cycle of 10,466 draws (after a 2,423-draw lead-in). See docs/behaviour.md.
  function createLegacyRng(seed) {
    var state = seed === undefined ? DEFAULT_SEED : seed;
    return function rand() {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  }

  // mulberry32: a well-defined 32-bit generator (period 2^32, exact in integer
  // arithmetic through Math.imul). Used by the tests and the behaviour script
  // for sampling. Returns floats in [0, 1).
  function createMulberry32(seed) {
    var a = (seed === undefined ? DEFAULT_SEED : seed) | 0;
    return function rand() {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // createRng(seed) is the legacy generator (the game's default, unchanged).
  // createRng(seed, "mulberry32") selects the well-defined one.
  function createRng(seed, kind) {
    if (kind === undefined || kind === "legacy") return createLegacyRng(seed);
    if (kind === "mulberry32") return createMulberry32(seed);
    throw new Error("unknown generator: " + kind);
  }

  function dot(a, b) { var s = 0; for (var i = 0; i < N; i++) s += a[i] * b[i]; return s; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function cosine(a, b) {
    var na = norm(a), nb = norm(b);
    return (na > 0 && nb > 0) ? dot(a, b) / (na * nb) : 0;
  }
  function jaccard(a, b) {
    var inter = 0, uni = 0;
    for (var i = 0; i < N; i++) {
      var x = a[i] > 0.5, y = b[i] > 0.5;
      if (x && y) inter++;
      if (x || y) uni++;
    }
    return uni > 0 ? inter / uni : 0;
  }
  function countLit(v) { var s = 0; for (var i = 0; i < N; i++) if (v[i] > 0.5) s++; return s; }

  // Project a probe through the memory (an array of {name, vec, custom}).
  // Returns the best match, the recall vector, the continuous field and the
  // gate's decision. `tau` defaults to TAU.
  function project(probe, memory, tau) {
    var gate = tau === undefined ? TAU : tau;
    var matches = [];
    var i, k;
    for (k = 0; k < memory.length; k++) matches.push(cosine(probe, memory[k].vec));
    var best = 0;
    for (k = 1; k < memory.length; k++) if (matches[k] > matches[best]) best = k;
    // Superimposed recall field: sum of stored patterns weighted by match^2.
    var field = new Float32Array(N);
    for (k = 0; k < memory.length; k++) {
      if (matches[k] <= 0) continue;
      var w = matches[k] * matches[k];
      for (i = 0; i < N; i++) field[i] += w * memory[k].vec[i];
    }
    var fMax = 0;
    for (i = 0; i < N; i++) if (field[i] > fMax) fMax = field[i];
    var recall = new Float32Array(N);
    if (fMax > 0) for (i = 0; i < N; i++) recall[i] = field[i] > RECALL_CUTOFF * fMax ? 1 : 0;
    var probeCells = 0;
    for (i = 0; i < N; i++) if (probe[i] > 0.5) probeCells++;
    return {
      best: best,
      bestCos: matches[best],
      matches: matches,
      field: field, fMax: fMax,
      recall: recall,
      recallCos: memory.length ? cosine(recall, memory[best].vec) : 0,
      accepted: matches[best] >= gate && probeCells >= MIN_PROBE_CELLS,
      probeCells: probeCells
    };
  }

  // Points for a recalled thought in game mode (same arithmetic as the game).
  function roundPoints(recallCos, streak, fragmentUsed) {
    var pts = Math.round(60 + recallCos * 60 + Math.min(30, streak * 5));
    if (fragmentUsed) pts -= 10;
    return Math.max(10, pts);
  }

  // Fragment assist: keep a random half (at least 4 cells) of the target's lit
  // cells. Returns the kept cell indices. Draws from `rand` exactly as the game.
  function fragmentCells(targetVec, rand) {
    var cells = [];
    for (var i = 0; i < N; i++) if (targetVec[i] > 0.5) cells.push(i);
    for (var j = cells.length - 1; j > 0; j--) {
      var k = Math.floor(rand() * (j + 1));
      var tmp = cells[j]; cells[j] = cells[k]; cells[k] = tmp;
    }
    var keep = Math.max(4, Math.floor(cells.length * 0.5));
    return cells.slice(0, keep);
  }

  // Scramble: flip each cell independently with probability 0.25 (padState is
  // an array of booleans and is modified in place).
  function scramblePad(padState, rand) {
    for (var i = 0; i < N; i++) if (rand() < 0.25) padState[i] = !padState[i];
    return padState;
  }

  // Next round's target: a built-in (non-custom) thought, never the same one
  // twice in a row when more than one is available.
  function pickTarget(memory, previous, rand) {
    var pool = memory.filter(function (g) { return !g.custom; });
    if (!pool.length) pool = memory;
    var next;
    do { next = pool[Math.floor(rand() * pool.length)]; } while (pool.length > 1 && next === previous);
    return next;
  }

  // The stored thought a new pattern would crowd most: the one with the highest
  // Jaccard overlap, provided it is above 0.7; a tie goes to the earlier thought.
  // Returns {name, jaccard} or null. (The original game returned the LAST stored
  // thought above 0.7, not the closest; see CHANGELOG.)
  function closeNeighbour(vec, memory) {
    var warn = null;
    for (var i = 0; i < memory.length; i++) {
      var j = jaccard(vec, memory[i].vec);
      if (j > 0.7 && (warn === null || j > warn.jaccard)) warn = { name: memory[i].name, jaccard: j };
    }
    return warn;
  }

  // Sonification mapping: every lit cell is a note whose pitch is set by its
  // column and whose start time is set by its row. Returns the note list.
  function patternToNotes(vec, rowMs) {
    var step = (rowMs || 120) / 1000, notes = [];
    for (var r = 0; r < G; r++)
      for (var c = 0; c < G; c++)
        if (vec[r * G + c] > 0.5) notes.push({ row: r, col: c, freq: SCALE[c], start: r * step });
    return notes;
  }

  var api = {
    G: G, N: N, TAU: TAU, MIN_PROBE_CELLS: MIN_PROBE_CELLS, RECALL_CUTOFF: RECALL_CUTOFF,
    DEFAULT_SEED: DEFAULT_SEED, SCALE: SCALE,
    makeGlyphs: makeGlyphs, rowsToVec: rowsToVec, createRng: createRng,
    createLegacyRng: createLegacyRng, createMulberry32: createMulberry32,
    dot: dot, norm: norm, cosine: cosine, jaccard: jaccard, countLit: countLit,
    project: project, roundPoints: roundPoints, fragmentCells: fragmentCells,
    scramblePad: scramblePad, pickTarget: pickTarget, closeNeighbour: closeNeighbour,
    patternToNotes: patternToNotes
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Membrane = api;
})(typeof window !== "undefined" ? window : this);
