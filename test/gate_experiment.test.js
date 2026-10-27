"use strict";
// Tests of the OPTIONAL gate experiment (scripts/gate_experiment.js). They also pin
// that the experiment does not alter the game's gate.
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/membrane.js");
const X = require("../scripts/gate_experiment.js");

const mem = (k) => M.makeGlyphs().slice(0, k);
const vecOf = (cells) => { const v = new Float32Array(M.N); cells.forEach((c) => { v[c] = 1; }); return v; };
const lit = (v) => { const o = []; for (let i = 0; i < M.N; i++) if (v[i] > 0.5) o.push(i); return o; };
const byId = (id) => X.VARIANTS.find((v) => v.id === id);

test("the game's gate is untouched: tau 0.35 and at least 3 lit cells", () => {
  assert.equal(M.TAU, 0.35); assert.equal(M.MIN_PROBE_CELLS, 3);
  assert.equal(byId("game gate (tau 0.35)").ok(), true);
});

test("features: a fragment of a thought has precision 1; a solid pad has precision below 1", () => {
  const memory = mem(3), heart = memory[0].vec;
  const frag = vecOf(lit(heart).slice(0, 25));
  const r = M.project(frag, memory);
  assert.equal(r.best, 0);
  assert.equal(X.features(frag, memory, r).precision, 1);
  const full = X.solid(12); const rf = M.project(full, memory);
  const f = X.features(full, memory, rf);
  assert.ok(f.precision < 0.6);
  assert.ok(f.cells > 1.5);
});

test("extra checks can only turn an acceptance into a refusal, never the reverse", () => {
  const memory = mem(8); const rnd = M.createMulberry32(5);
  for (let i = 0; i < 400; i++) {
    const d = [0.05, 0.2, 0.5][i % 3];
    const v = new Float32Array(M.N); for (let c = 0; c < M.N; c++) v[c] = rnd() < d ? 1 : 0;
    const base = M.project(v, memory).accepted;
    for (const variant of X.VARIANTS) if (X.decide(variant, v, memory).accepted) assert.ok(base, variant.id);
  }
});

test("a solid pad is accepted by the game's gate and refused by the precision checks", () => {
  const memory = mem(8), full = X.solid(12);
  assert.equal(M.project(full, memory).accepted, true);
  assert.equal(X.decide(byId("+ precision >= 0.6"), full, memory).accepted, false);
  assert.equal(X.decide(byId("+ probe cells <= 1.5 x best"), full, memory).accepted, false);
});

test("margin feature is best cosine minus second-best", () => {
  const memory = mem(3); const probe = memory[0].vec; const r = M.project(probe, memory);
  const second = Math.max(r.matches[1], r.matches[2]);
  assert.ok(Math.abs(X.features(probe, memory, r).margin - (r.bestCos - second)) < 1e-12);
});
