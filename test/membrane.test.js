"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const M = require("../src/membrane.js");

const near = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, a + " vs " + b);
const vecOf = (cells) => { const v = new Float32Array(M.N); cells.forEach((c) => { v[c] = 1; }); return v; };
const litIdx = (v) => { const o = []; for (let i = 0; i < M.N; i++) if (v[i] > 0.5) o.push(i); return o; };
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mem = (k) => M.makeGlyphs().slice(0, k);
const subset = (vec, fraction, rnd) => {
  const cells = litIdx(vec);
  for (let j = cells.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [cells[j], cells[k]] = [cells[k], cells[j]]; }
  return vecOf(cells.slice(0, Math.max(1, Math.round(cells.length * fraction))));
};

// ---- Parity with the original single-file game (kept in test/fixtures) ----
const original = fs.readFileSync(path.join(__dirname, "fixtures", "original-thought-input-game.html"), "utf8");
function between(a, b) { const i = original.indexOf(a); const j = original.indexOf(b, i); assert.ok(i > 0 && j > i, "markers " + a); return original.slice(i, j); }
function loadOriginal() {
  const code = between("var rngState = 1234567;", "/* ============ Thought glyphs") +
    between("/* ============ Thought glyphs (12 x 12) ============ */", "/* ============ Game state");
  const ctx = vm.createContext({ Math, Float32Array, Array });
  vm.runInContext(code, ctx);
  return ctx;
}

test("parity: the extracted rand() reproduces the original sequence exactly", () => {
  const o = loadOriginal();
  const r = M.createRng();
  for (let i = 0; i < 20000; i++) assert.equal(r(), o.rand(), "draw " + i);
});

test("parity: glyph vectors equal the original's", () => {
  const o = loadOriginal();
  const g = M.makeGlyphs();
  assert.equal(g.length, o.GLYPHS.length);
  g.forEach((x, i) => { assert.equal(x.name, o.GLYPHS[i].name); assert.deepEqual(Array.from(x.vec), Array.from(o.GLYPHS[i].vec)); assert.equal(x.custom, false); });
  assert.equal(o.TAU, M.TAU);
});

test("parity: project() equals the original for 3000 random probes and memories", () => {
  const o = loadOriginal();
  const rnd = mulberry32(2026);
  for (let n = 0; n < 3000; n++) {
    const k = 1 + Math.floor(rnd() * 8);
    o.memory = o.GLYPHS.slice(0, k);
    const m = M.makeGlyphs().slice(0, k);
    const probe = new Float32Array(M.N);
    const density = rnd();
    for (let i = 0; i < M.N; i++) probe[i] = rnd() < density ? 1 : 0;
    const a = M.project(probe, m), b = o.project(probe);
    assert.equal(a.best, b.best); assert.equal(a.bestCos, b.bestCos);
    assert.equal(a.accepted, b.accepted); assert.equal(a.probeCells, b.probeCells);
    assert.equal(a.recallCos, b.recallCos); assert.equal(a.fMax, b.fMax);
    assert.deepEqual(Array.from(a.recall), Array.from(b.recall));
    assert.deepEqual(Array.from(a.field), Array.from(b.field));
    assert.deepEqual(Array.from(a.matches), Array.from(b.matches));
  }
});

test("parity: jaccard and cosine equal the original's", () => {
  const o = loadOriginal();
  const rnd = mulberry32(5);
  for (let n = 0; n < 500; n++) {
    const a = new Float32Array(M.N), b = new Float32Array(M.N);
    for (let i = 0; i < M.N; i++) { a[i] = rnd() < 0.4 ? 1 : 0; b[i] = rnd() < 0.5 ? 1 : 0; }
    assert.equal(M.cosine(a, b), o.cosine(a, b)); assert.equal(M.jaccard(a, b), o.jaccard(a, b));
  }
});

// ---- Glyphs ----
test("glyphs: eight 12 x 12 patterns with the documented cell counts", () => {
  const g = M.makeGlyphs();
  assert.deepEqual(g.map((x) => x.name), ["Heart", "Star", "Tree", "Moon", "Eye", "Arrow", "Spiral", "Orbit"]);
  assert.deepEqual(g.map((x) => M.countLit(x.vec)), [70, 56, 54, 66, 68, 40, 65, 34]);
  g.forEach((x) => { assert.equal(x.rows.length, 12); x.rows.forEach((r) => assert.equal(r.length, 12)); assert.equal(x.vec.length, 144); });
});

test("glyphs: makeGlyphs returns independent copies", () => {
  const a = M.makeGlyphs(), b = M.makeGlyphs();
  a[0].vec[0] = 1; a[0].name = "x";
  assert.equal(b[0].vec[0], 0); assert.equal(b[0].name, "Heart");
});

// ---- Superposition storage ----
test("superposition: the recall field is the match-squared weighted sum of stored patterns", () => {
  const a = vecOf([0, 1, 2, 3]), b = vecOf([10, 11, 12, 13]); // orthogonal
  const memory = [{ name: "A", vec: a, custom: true }, { name: "B", vec: b, custom: true }];
  const probe = vecOf([0, 1, 2, 10]);                          // 3/4 of A, 1/4 of B
  const res = M.project(probe, memory);
  const ca = M.cosine(probe, a), cb = M.cosine(probe, b);
  assert.ok(ca > cb && ca > 0.35);
  for (let i = 0; i < M.N; i++) near(res.field[i], Math.fround(ca * ca * a[i] + cb * cb * b[i]), 1e-6);
  assert.equal(res.best, 0);
});

test("superposition: a stored thought is shared state, not a slot (cells outside the probe are filled in)", () => {
  const memory = mem(3);
  const probe = subset(memory[0].vec, 0.3, mulberry32(1));
  const res = M.project(probe, memory);
  assert.equal(res.best, 0);
  assert.ok(M.countLit(res.recall) > M.countLit(probe), "recall has more cells than the fragment");
  for (const c of litIdx(probe)) assert.equal(res.recall[c], 1, "every probe cell is inside the recall");
});

test("superposition: adding a distinct thought leaves the recall of the old ones intact", () => {
  const before = mem(3), after = mem(8);
  for (let g = 0; g < 3; g++) {
    const probe = before[g].vec;
    assert.equal(M.project(probe, before).best, g);
    assert.equal(M.project(probe, after).best, g);
  }
});

test("superposition: a custom thought joins the same memory and is recalled by its fragment", () => {
  const memory = mem(3);
  const mine = vecOf([5, 6, 7, 17, 18, 19, 29, 30, 31, 41, 42, 43]);
  memory.push({ name: "Mine", vec: mine, custom: true });
  const res = M.project(vecOf([5, 6, 7, 17, 18, 19]), memory);
  assert.equal(res.best, 3); assert.ok(res.accepted);
  assert.deepEqual(litIdx(res.recall), litIdx(mine));
});

// ---- Fragment completion ----
test("fragment completion: with 3 thoughts every 30%+ fragment (seeded, 100 each) is recalled as the right thought", () => {
  const memory = mem(3); const rnd = mulberry32(11);
  for (const fr of [0.3, 0.4, 0.5, 0.75, 1]) for (let g = 0; g < 3; g++) for (let r = 0; r < 100; r++) {
    const res = M.project(subset(memory[g].vec, fr, rnd), memory);
    assert.ok(res.accepted && res.best === g, `fraction ${fr} glyph ${g} trial ${r}`);
  }
});

test("fragment completion: with all 8 thoughts, 50% fragments succeed at least 98% of the time", () => {
  const memory = mem(8); const rnd = mulberry32(12); let ok = 0, n = 0;
  for (let g = 0; g < 8; g++) for (let r = 0; r < 200; r++) { const res = M.project(subset(memory[g].vec, 0.5, rnd), memory); if (res.accepted && res.best === g) ok++; n++; }
  assert.ok(ok / n >= 0.98, "rate " + ok / n);
});

test("fragment completion: success does not fall as the fragment grows (8 thoughts, seeded)", () => {
  const memory = mem(8); const rates = [];
  for (const fr of [0.15, 0.3, 0.5, 0.75, 1]) {
    const rnd = mulberry32(100 + Math.round(fr * 100)); let ok = 0, n = 0;
    for (let g = 0; g < 8; g++) for (let r = 0; r < 200; r++) { const res = M.project(subset(memory[g].vec, fr, rnd), memory); if (res.accepted && res.best === g) ok++; n++; }
    rates.push(ok / n);
  }
  for (let i = 1; i < rates.length; i++) assert.ok(rates[i] >= rates[i - 1] - 0.005, rates.join(","));
  assert.equal(rates[rates.length - 1], 1);
  assert.ok(rates[0] < 0.97 && rates[0] > 0.8, "15% fragments are the hard case: " + rates[0]);
});

test("fragment completion: a 10% fragment (7 cells of Heart) is refused, not guessed", () => {
  const memory = mem(3); const rnd = mulberry32(13); let refused = 0;
  for (let r = 0; r < 200; r++) if (!M.project(subset(memory[0].vec, 0.1, rnd), memory).accepted) refused++;
  assert.ok(refused / 200 > 0.95);
});

test("corruption: scrambling 25% of cells still recalls at least 95% of the time (8 thoughts, seeded)", () => {
  const memory = mem(8); const rnd = mulberry32(14); let ok = 0, n = 0;
  for (let g = 0; g < 8; g++) for (let r = 0; r < 200; r++) {
    const v = Float32Array.from(memory[g].vec); for (let i = 0; i < M.N; i++) if (rnd() < 0.25) v[i] = v[i] > 0.5 ? 0 : 1;
    const res = M.project(v, memory); if (res.accepted && res.best === g) ok++; n++;
  }
  assert.ok(ok / n >= 0.95, "rate " + ok / n);
});

test("corruption: at 50% flips the memory is no better than chance (crosstalk dominates)", () => {
  const memory = mem(8); const rnd = mulberry32(15); let ok = 0, n = 0;
  for (let g = 0; g < 8; g++) for (let r = 0; r < 200; r++) {
    const v = Float32Array.from(memory[g].vec); for (let i = 0; i < M.N; i++) if (rnd() < 0.5) v[i] = v[i] > 0.5 ? 0 : 1;
    const res = M.project(v, memory); if (res.accepted && res.best === g) ok++; n++;
  }
  assert.ok(ok / n < 0.3, "rate " + ok / n);
});

// ---- Refusing gate ----
test("gate: empty probe and probes with fewer than 3 lit cells are always refused", () => {
  const memory = mem(8);
  assert.equal(M.project(new Float32Array(M.N), memory).accepted, false);
  assert.equal(M.project(vecOf([27, 28]), memory).accepted, false);
  // The cell-count rule on its own: a 2-cell stored pattern matches a 2-cell probe perfectly (cosine 1), yet is refused.
  const tiny = [{ name: "Tiny", vec: vecOf([0, 1]), custom: true }];
  const two = M.project(vecOf([0, 1]), tiny);
  near(two.bestCos, 1, 1e-9); assert.equal(two.probeCells, 2); assert.equal(two.accepted, false);
  const three = [{ name: "Tiny3", vec: vecOf([0, 1, 2]), custom: true }];
  assert.equal(M.project(vecOf([0, 1, 2]), three).accepted, true);
});

test("gate: the threshold is tau = 0.35 and 'at tau' is accepted (>=)", () => {
  assert.equal(M.TAU, 0.35);
  const a = vecOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const memory = [{ name: "A", vec: a, custom: true }];
  // probe with k of A's cells plus (m) foreign cells: cosine = k / sqrt(16 * (k + m))
  const probe = vecOf([0, 1, 2, 3, 4, 5, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45]);
  const c = M.cosine(probe, a);
  assert.ok(c < M.TAU);
  assert.equal(M.project(probe, memory).accepted, false);
  assert.equal(M.project(probe, memory, c).accepted, true, "tau equal to the cosine accepts");
  assert.equal(M.project(probe, memory, c + 1e-9).accepted, false);
});

test("gate: sparse random patterns (5-10% density) are refused at least 90% of the time with 8 thoughts", () => {
  const memory = mem(8); const rnd = mulberry32(16); let refused = 0; const n = 2000;
  for (let i = 0; i < n; i++) { const v = new Float32Array(M.N); for (let c = 0; c < M.N; c++) v[c] = rnd() < 0.075 ? 1 : 0; if (!M.project(v, memory).accepted) refused++; }
  assert.ok(refused / n >= 0.9, "rate " + refused / n);
});

test("gate: dense random scatter is NOT refused (a documented limit of a cosine gate)", () => {
  const memory = mem(8); const rnd = mulberry32(17); let accepted = 0; const n = 500;
  for (let i = 0; i < n; i++) { const v = new Float32Array(M.N); for (let c = 0; c < M.N; c++) v[c] = rnd() < 0.5 ? 1 : 0; if (M.project(v, memory).accepted) accepted++; }
  assert.ok(accepted / n > 0.95, "rate " + accepted / n);
});

test("gate: a probe that is the complement of a thought is refused", () => {
  const memory = mem(3);
  const inv = new Float32Array(M.N); for (let i = 0; i < M.N; i++) inv[i] = memory[0].vec[i] > 0.5 ? 0 : 1;
  assert.equal(M.project(inv, memory).accepted, false);
});

// ---- Crosstalk ----
test("crosstalk: Tree and Arrow are the most similar built-in pair (cosine 0.86, Jaccard 0.74)", () => {
  const g = M.makeGlyphs(); let best = null;
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) { const c = M.cosine(g[i].vec, g[j].vec); if (!best || c > best.c) best = { c, a: g[i].name, b: g[j].name, j: M.jaccard(g[i].vec, g[j].vec) }; }
  assert.deepEqual([best.a, best.b], ["Tree", "Arrow"]);
  near(best.c, 0.86, 0.005); near(best.j, 0.74, 0.005);
});

test("crosstalk: with 8 thoughts, 20% fragments sometimes complete the WRONG thought (seeded, at least 1% of 1600)", () => {
  const memory = mem(8); const rnd = mulberry32(21); let wrong = 0, n = 0;
  for (let g = 0; g < 8; g++) for (let r = 0; r < 200; r++) { const res = M.project(subset(memory[g].vec, 0.2, rnd), memory); if (res.accepted && res.best !== g) wrong++; n++; }
  assert.ok(wrong / n >= 0.01 && wrong / n < 0.1, "rate " + wrong / n);
});

test("crosstalk: it grows with the number of stored thoughts (3 vs 8 thoughts, 10-20% fragments)", () => {
  const rate = (k) => { const memory = mem(k); const rnd = mulberry32(22); let wrong = 0, n = 0;
    for (const fr of [0.1, 0.15, 0.2]) for (let g = 0; g < k; g++) for (let r = 0; r < 200; r++) { const res = M.project(subset(memory[g].vec, fr, rnd), memory); if (res.accepted && res.best !== g) wrong++; n++; }
    return wrong / n; };
  assert.ok(rate(8) > rate(3), rate(3) + " vs " + rate(8));
});

test("crosstalk: a stored near-copy takes over; an identical copy loses ties to the earlier one", () => {
  const memory = mem(3);
  memory.push({ name: "HeartCopy", vec: Float32Array.from(memory[0].vec), custom: true });
  const probe = subset(memory[0].vec, 0.5, mulberry32(18));
  assert.equal(M.project(probe, memory).best, 0, "equal matches: the first stored thought wins");
  const dup = Float32Array.from(memory[0].vec); [14, 15, 16].forEach((c) => { dup[c] = dup[c] > 0.5 ? 0 : 1; });
  const m2 = mem(3); m2.push({ name: "Near", vec: dup, custom: true });
  const fromDup = M.project(subset(dup, 1, mulberry32(1)), m2);
  assert.equal(fromDup.best, 3, "the exact near-copy pattern matches itself best");
});

test("crosstalk: storing warns when a new pattern has Jaccard > 0.7 with a stored one", () => {
  const memory = mem(3);
  assert.equal(M.closeNeighbour(memory[0].vec, memory).name, "Heart");
  const w = M.closeNeighbour(memory[0].vec, memory); near(w.jaccard, 1);
  assert.equal(M.closeNeighbour(vecOf([0, 1, 2, 3, 4, 5, 6, 7]), memory), null);
  assert.equal(M.closeNeighbour(memory[0].vec, []), null);
});

test("closeNeighbour reports the CLOSEST stored thought, not the last one above 0.7 (fix; see CHANGELOG)", () => {
  // Tree/Arrow have Jaccard 0.74. With Tree then Arrow stored, a Tree copy matches Tree 1.00 and Arrow 0.74:
  // the original game reported the last one (Arrow); the closest is Tree, whichever order they are stored in.
  const g = M.makeGlyphs();
  const treeFirst = [g[2], g[5]], arrowFirst = [g[5], g[2]];
  assert.equal(M.closeNeighbour(g[2].vec, treeFirst).name, "Tree");
  assert.equal(M.closeNeighbour(g[2].vec, arrowFirst).name, "Tree");
  near(M.closeNeighbour(g[2].vec, treeFirst).jaccard, 1);
  // An Arrow copy: closest is Arrow in both orders.
  assert.equal(M.closeNeighbour(g[5].vec, treeFirst).name, "Arrow");
  assert.equal(M.closeNeighbour(g[5].vec, arrowFirst).name, "Arrow");
  // Ties go to the earlier thought.
  const twin = [{ name: "A", vec: g[0].vec }, { name: "B", vec: g[0].vec }];
  assert.equal(M.closeNeighbour(g[0].vec, twin).name, "A");
});

test("closeNeighbour agrees with the original whenever at most one stored thought is above 0.7", () => {
  // For the eight built-in thoughts only Tree/Arrow (0.74) are that close, so for every
  // built-in pattern stored in the 8-thought memory the result equals the original's last-match rule.
  const g = M.makeGlyphs();
  const originalRule = (vec, memory) => { let w = null; for (const m of memory) { const j = M.jaccard(vec, m.vec); if (j > 0.7) w = { name: m.name, jaccard: j }; } return w; };
  for (const x of g) {
    const a = M.closeNeighbour(x.vec, g), b = originalRule(x.vec, g);
    if (x.name === "Tree" || x.name === "Arrow") continue; // two thoughts above 0.7 (self and the other): original reports the later
    assert.deepEqual(a, b, x.name);
  }
});

// ---- Determinism ----
test("determinism: the same seed gives the same sequence; different seeds differ", () => {
  const a = M.createRng(42), b = M.createRng(42), c = M.createRng(43);
  const sa = [a(), a(), a(), a()], sb = [b(), b(), b(), b()], sc = [c(), c(), c(), c()];
  assert.deepEqual(sa, sb); assert.notDeepEqual(sa, sc);
  sa.forEach((x) => assert.ok(x >= 0 && x <= 1));
});

test("determinism: the game's default sequence starts with the pinned values", () => {
  assert.equal(M.DEFAULT_SEED, 1234567);
  const r = M.createRng();
  assert.deepEqual([r(), r(), r()].map((x) => Number(x.toFixed(6))), [0.943746, 0.500528, 0.561789]);
});

test("rng finding: the generator is not the integer LCG it was meant to be; cycle of 10466 after a 2423-draw lead-in", () => {
  // exact 31-bit LCG, for comparison
  let S = 1234567n; const r = M.createRng(); let diverged = -1;
  for (let i = 0; i < 100; i++) { S = (S * 1103515245n + 12345n) & 0x7fffffffn; if (Math.round(r() * 0x7fffffff) !== Number(S)) { diverged = i; break; } }
  assert.ok(diverged >= 0 && diverged < 5, "diverges from the exact LCG within the first draws: " + diverged);
  const r2 = M.createRng(); const first = new Map(); let lead = -1, period = -1;
  for (let i = 0; i < 100000; i++) { const k = Math.round(r2() * 0x7fffffff); if (first.has(k)) { lead = first.get(k); period = i - lead; break; } first.set(k, i); }
  assert.equal(lead, 2423); assert.equal(period, 10466);
});

test("determinism: fragment assist, scramble and target choice are reproducible with a seeded generator", () => {
  const g = M.makeGlyphs();
  const f1 = M.fragmentCells(g[0].vec, M.createRng(9)), f2 = M.fragmentCells(g[0].vec, M.createRng(9));
  assert.deepEqual(f1, f2);
  assert.equal(f1.length, 35); f1.forEach((c) => assert.equal(g[0].vec[c], 1)); assert.equal(new Set(f1).size, f1.length);
  const p1 = new Array(144).fill(false), p2 = new Array(144).fill(false);
  M.scramblePad(p1, M.createRng(9)); M.scramblePad(p2, M.createRng(9));
  assert.deepEqual(p1, p2);
  const seq = (seed) => { const r = M.createRng(seed); let prev = null; const out = []; const m = g.slice(0, 3); for (let i = 0; i < 12; i++) { prev = M.pickTarget(m, prev, r); out.push(prev.name); } return out; };
  assert.deepEqual(seq(7), seq(7));
  const s = seq(1234567); for (let i = 1; i < s.length; i++) assert.notEqual(s[i], s[i - 1], "never the same target twice in a row");
});

test("fragment assist keeps half the lit cells, at least 4", () => {
  const rnd = M.createRng(3);
  assert.equal(M.fragmentCells(vecOf(litIdx(M.makeGlyphs()[7].vec)), rnd).length, 17);   // Orbit: 34 cells
  assert.equal(M.fragmentCells(vecOf([1, 2, 3, 4, 5, 6]), rnd).length, 4);              // 6 cells -> 4 (floor(3) < 4)
  assert.equal(M.fragmentCells(vecOf([1, 2]), rnd).length, 2);                           // fewer than 4 cells: all of them
});

test("scramble flips about 25% of cells (seeded, average over 200 pads)", () => {
  let flips = 0;
  for (let s = 1; s <= 200; s++) { const rnd = mulberry32(s); const p = new Array(144).fill(false); M.scramblePad(p, rnd); flips += p.filter(Boolean).length; }
  near(flips / (200 * 144), 0.25, 0.01);
});

test("pickTarget uses built-in thoughts only, unless there are none", () => {
  const g = M.makeGlyphs().slice(0, 3); g.push({ name: "Mine", vec: vecOf([1, 2, 3, 4, 5, 6, 7, 8]), custom: true });
  const r = M.createRng(5); let prev = null;
  for (let i = 0; i < 200; i++) { prev = M.pickTarget(g, prev, r); assert.notEqual(prev.name, "Mine"); }
  const only = [{ name: "Mine", vec: vecOf([1]), custom: true }];
  assert.equal(M.pickTarget(only, only[0], M.createRng(1)).name, "Mine");
});

// ---- Scoring ----
test("roundPoints follows the game's formula", () => {
  assert.equal(M.roundPoints(1, 0, false), 120);
  assert.equal(M.roundPoints(0.88, 0, false), 113);
  assert.equal(M.roundPoints(1, 3, false), 135);
  assert.equal(M.roundPoints(1, 6, false), 150);
  assert.equal(M.roundPoints(1, 60, false), 150, "streak bonus is capped at 30");
  assert.equal(M.roundPoints(1, 0, true), 110, "fragment assist costs 10");
  assert.equal(M.roundPoints(0, 0, true), 50);
});

// ---- Sonification ----
test("sonification: column sets pitch (strictly rising scale), row sets time", () => {
  assert.equal(M.SCALE.length, 12);
  for (let i = 1; i < 12; i++) assert.ok(M.SCALE[i] > M.SCALE[i - 1]);
  assert.deepEqual(M.SCALE, [262, 294, 330, 392, 440, 523, 587, 659, 784, 880, 1047, 1175]);
  const v = vecOf([0 * 12 + 0, 0 * 12 + 11, 3 * 12 + 5, 11 * 12 + 2]);
  const notes = M.patternToNotes(v, 100);
  assert.deepEqual(notes.map((n) => [n.row, n.col, n.freq, Number(n.start.toFixed(3))]), [[0, 0, 262, 0], [0, 11, 1175, 0], [3, 5, 523, 0.3], [11, 2, 330, 1.1]]);
});

test("sonification: one note per lit cell, silent rows add nothing, default step is 120 ms", () => {
  const g = M.makeGlyphs();
  g.forEach((x) => assert.equal(M.patternToNotes(x.vec).length, M.countLit(x.vec)));
  assert.deepEqual(M.patternToNotes(new Float32Array(M.N)), []);
  const n = M.patternToNotes(vecOf([24]));
  near(n[0].start, 0.24); assert.equal(n[0].row, 2); assert.equal(n[0].freq, 262);
  const heart = M.patternToNotes(g[0].vec); assert.equal(Math.min(...heart.map((x) => x.row)), 1, "Heart's first row is empty, so the melody starts one step late");
});

test("sonification: two shapes that differ only in a column play different pitches", () => {
  const a = M.patternToNotes(vecOf([0])), b = M.patternToNotes(vecOf([1]));
  assert.notEqual(a[0].freq, b[0].freq); assert.equal(a[0].start, b[0].start);
});

// ---- Generators ----
test("createRng(seed) is the legacy generator; createRng(seed, 'legacy') is the same; unknown kind throws", () => {
  const a = M.createRng(77), b = M.createLegacyRng(77), c = M.createRng(77, "legacy");
  for (let i = 0; i < 50; i++) { const x = a(); assert.equal(x, b()); assert.equal(x, c()); }
  assert.throws(() => M.createRng(1, "nope"), /unknown generator/);
});

test("mulberry32 matches an independent BigInt implementation and the local reference", () => {
  const M32 = 0xffffffffn;
  const imul = (x, y) => (x * y) & M32;
  function ref(seed) {
    let a = BigInt(seed) & M32;
    return () => {
      a = (a + 0x6d2b79f5n) & M32;
      let t = imul(a ^ (a >> 15n), 1n | a);
      t = ((t + imul(t ^ (t >> 7n), 61n | t)) & M32) ^ t;
      return Number((t ^ (t >> 14n)) & M32) / 4294967296;
    };
  }
  for (const seed of [0, 1, 42, 1234567, 0xffffffff]) {
    const m = M.createMulberry32(seed), r = ref(seed), l = mulberry32(seed), k = M.createRng(seed, "mulberry32");
    for (let i = 0; i < 2000; i++) { const x = r(); assert.equal(m(), x); assert.equal(l(), x); assert.equal(k(), x); }
  }
});

test("mulberry32: values in [0,1), seed-determined, no short cycle, near-uniform", () => {
  const r = M.createMulberry32(M.DEFAULT_SEED);
  const seen = new Set(); const bins = new Array(12).fill(0); const n = 120000;
  for (let i = 0; i < n; i++) { const x = r(); assert.ok(x >= 0 && x < 1); seen.add(x); bins[Math.floor(x * 12)]++; }
  assert.ok(seen.size > n - 5, "no repeats within the 10466-draw legacy cycle length or beyond: " + seen.size);
  const exp = n / 12; let chi = 0; for (const b of bins) chi += (b - exp) * (b - exp) / exp;
  assert.ok(chi < 31.26, "chi-square over 12 bins (11 dof, p=0.001) = " + chi);
  assert.notEqual(M.createMulberry32(1)(), M.createMulberry32(2)());
  const a = M.createMulberry32(5), b = M.createMulberry32(5);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test("the game still uses the legacy generator (play unchanged)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "game.js"), "utf8");
  assert.match(src, /var rand = Membrane\.createRng\(\);/);
});
