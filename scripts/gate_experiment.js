#!/usr/bin/env node
"use strict";
/* OPTIONAL EXPERIMENT, not part of the game. Generates docs/gate-experiment.md.
 *
 * The game's gate (tau = 0.35 on cosine, at least 3 lit cells) accepts dense
 * random patterns: a probe that lights many cells overlaps every stored thought.
 * This script asks, on the same synthetic patterns as docs/behaviour.md, whether
 * a simple extra check would refuse them, and what that would cost in recall.
 * Nothing here changes src/membrane.js or the game; tau stays 0.35.
 *   node scripts/gate_experiment.js           write docs/gate-experiment.md
 *   node scripts/gate_experiment.js --check   fail if the committed file is stale
 */
const fs = require("node:fs");
const path = require("node:path");
const M = require("../src/membrane.js");

const OUT = path.join(__dirname, "..", "docs", "gate-experiment.md");
const TRIALS = 1000;      // probes per stored thought (fragments, flips)
const SCATTER_N = 5000;   // random-scatter probes per row
const memoryOf = (k) => M.makeGlyphs().slice(0, k);
const pct = (x) => (100 * x).toFixed(1) + "%";

// Extra checks, applied only when the game's own gate has already accepted.
// precision = share of the probe's lit cells that are lit in the best match.
// cells     = probe lit cells divided by the best match's lit cells.
// margin    = best cosine minus second-best cosine.
function features(probe, memory, res) {
  const best = memory[res.best].vec;
  let inter = 0, bestCells = 0;
  for (let i = 0; i < M.N; i++) { if (probe[i] > 0.5 && best[i] > 0.5) inter++; if (best[i] > 0.5) bestCells++; }
  let second = 0;
  for (let k = 0; k < memory.length; k++) if (k !== res.best && res.matches[k] > second) second = res.matches[k];
  return { precision: res.probeCells ? inter / res.probeCells : 0, cells: res.probeCells / bestCells, margin: res.bestCos - second };
}
const VARIANTS = [
  { id: "game gate (tau 0.35)", ok: () => true },
  { id: "+ precision >= 0.5", ok: (f) => f.precision >= 0.5 },
  { id: "+ precision >= 0.6", ok: (f) => f.precision >= 0.6 },
  { id: "+ precision >= 0.7", ok: (f) => f.precision >= 0.7 },
  { id: "+ probe cells <= 1.5 x best", ok: (f) => f.cells <= 1.5 },
  { id: "+ probe cells <= 2.0 x best", ok: (f) => f.cells <= 2.0 },
  { id: "+ margin >= 0.05", ok: (f) => f.margin >= 0.05 },
  { id: "+ margin >= 0.10", ok: (f) => f.margin >= 0.10 }
];

function decide(variant, probe, memory) {
  const res = M.project(probe, memory);
  if (!res.accepted) return { res, accepted: false };
  return { res, accepted: variant.ok(features(probe, memory, res)) };
}
function randomSubset(vec, fraction, rnd) {
  const cells = [];
  for (let i = 0; i < M.N; i++) if (vec[i] > 0.5) cells.push(i);
  for (let j = cells.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [cells[j], cells[k]] = [cells[k], cells[j]]; }
  const keep = Math.max(1, Math.round(cells.length * fraction));
  const v = new Float32Array(M.N);
  for (let m = 0; m < keep; m++) v[cells[m]] = 1;
  return v;
}
function flipped(vec, p, rnd) { const v = Float32Array.from(vec); for (let i = 0; i < M.N; i++) if (rnd() < p) v[i] = v[i] > 0.5 ? 0 : 1; return v; }

// Share of probes of a family that the variant accepts as the RIGHT thought.
function recallRate(variant, k, make, seed) {
  const mem = memoryOf(k), rnd = M.createMulberry32(seed); let ok = 0, n = 0;
  for (let g = 0; g < k; g++) for (let t = 0; t < TRIALS; t++) {
    const d = decide(variant, make(mem[g].vec, rnd), mem);
    if (d.accepted && d.res.best === g) ok++; n++;
  }
  return ok / n;
}
// Share of unknown probes (random scatter) that the variant refuses.
function refuseRate(variant, k, density, seed) {
  const mem = memoryOf(k), rnd = M.createMulberry32(seed); let refused = 0;
  for (let i = 0; i < SCATTER_N; i++) {
    const v = new Float32Array(M.N); for (let c = 0; c < M.N; c++) v[c] = rnd() < density ? 1 : 0;
    if (!decide(variant, v, mem).accepted) refused++;
  }
  return refused / SCATTER_N;
}
function solid(rows) { const v = new Float32Array(M.N); for (let r = 0; r < rows; r++) for (let c = 0; c < M.G; c++) v[r * M.G + c] = 1; return v; }

function run() {
  const out = { trials: TRIALS, scatter_n: SCATTER_N, variants: VARIANTS.map((v) => v.id), sets: [3, 8] };
  out.unknown = {}; out.known = {}; out.solid = {};
  for (const k of out.sets) {
    out.unknown[k] = [0.2, 0.3, 0.4, 0.5].map((d) => ({ label: "scatter " + Math.round(d * 100) + "%",
      v: VARIANTS.map((v) => refuseRate(v, k, d, 9000 + k * 100 + Math.round(d * 100))) }));
    out.solid[k] = [12, 6].map((rows) => ({ label: rows === 12 ? "all 144 cells lit" : "top half lit (72 cells)",
      v: VARIANTS.map((v) => decide(v, solid(rows), memoryOf(k)).accepted ? "accepted" : "refused") }));
    const fam = [];
    for (const fr of [0.15, 0.2, 0.5]) fam.push({ label: "fragment " + Math.round(fr * 100) + "% kept", make: (v, r) => randomSubset(v, fr, r), seed: 1000 + k * 100 + Math.round(fr * 100) });
    for (const p of [0.1, 0.25, 0.4]) fam.push({ label: "flip p = " + p, make: (v, r) => flipped(v, p, r), seed: 5000 + k * 100 + Math.round(p * 100) });
    out.known[k] = fam.map((f) => ({ label: f.label, v: VARIANTS.map((v) => recallRate(v, k, f.make, f.seed)) }));
  }
  return out;
}
function table(head, rows) {
  return ["| " + head.join(" | ") + " |", "|" + head.map(() => "---").join("|") + "|"].concat(rows.map((r) => "| " + r.join(" | ") + " |")).join("\n");
}
function render(o) {
  const L = [];
  const head = ["probe family"].concat(o.variants);
  L.push("# Experiment: would a simple extra check refuse dense random patterns?");
  L.push("");
  L.push("Generated by `node scripts/gate_experiment.js`. **Optional experiment, not part of the game.** The game's gate is unchanged (tau = 0.35 on cosine, at least 3 lit cells); `npm run behaviour:check` fails if this file is stale.");
  L.push("");
  L.push("**SYNTHETIC toy.** Same eight glyphs and the same `project` function as `docs/behaviour.md`, " + o.trials + " probes per stored thought for fragments and flips, " + o.scatter_n + " random probes per scatter row, sampled with mulberry32. The numbers describe this toy on these patterns only.");
  L.push("");
  L.push("## The question");
  L.push("");
  L.push("A probe that lights many cells overlaps every stored thought, so the cosine gate accepts it (see section 4 of `docs/behaviour.md`). Each extra check below is applied only after the game's gate has accepted, and can only turn an acceptance into a refusal:");
  L.push("");
  L.push("- **precision >= p**: the share of the probe's lit cells that are also lit in the best-matching thought.");
  L.push("- **probe cells <= c x best**: the probe may not light more than c times as many cells as the best-matching thought.");
  L.push("- **margin >= m**: the best cosine must beat the second-best cosine by m (aimed at crosstalk, not density).");
  L.push("");
  for (const k of o.sets) {
    L.push("## " + k + " thoughts stored");
    L.push("");
    L.push("Unknown patterns, share **refused** (higher is better here):");
    L.push("");
    L.push(table(head, o.unknown[k].map((r) => [r.label].concat(r.v.map(pct)))));
    L.push("");
    L.push("Two solid patterns (not random), decision:");
    L.push("");
    L.push(table(head, o.solid[k].map((r) => [r.label].concat(r.v))));
    L.push("");
    L.push("Probes of a stored thought, share **recalled as the right thought** (higher is better here; the first column is today's behaviour):");
    L.push("");
    L.push(table(head, o.known[k].map((r) => [r.label].concat(r.v.map(pct)))));
    L.push("");
  }
  L.push("## Reading the trade-off");
  L.push("");
  L.push(o.reading.join("\n"));
  L.push("");
  return L.join("\n") + "\n";
}

if (require.main === module) {
  const o = run();
  // Plain-language reading, computed from the tables above so it cannot drift.
  const col = (id) => o.variants.indexOf(id);
  const R = [];
  const P6 = col("+ precision >= 0.6"), P7 = col("+ precision >= 0.7"), C15 = col("+ probe cells <= 1.5 x best"), M10 = col("+ margin >= 0.10");
  const cell = (k, set, label, c) => (o[set][k].find((r) => r.label === label)).v[c];
  for (const k of o.sets) {
    R.push("- **" + k + " thoughts.** 50% scatter is refused " + pct(cell(k, "unknown", "scatter 50%", 0)) + " today, " + pct(cell(k, "unknown", "scatter 50%", P6)) + " with precision >= 0.6, " + pct(cell(k, "unknown", "scatter 50%", P7)) + " with precision >= 0.7, " + pct(cell(k, "unknown", "scatter 50%", C15)) + " with probe cells <= 1.5 x best and " + pct(cell(k, "unknown", "scatter 50%", M10)) + " with margin >= 0.10.");
    R.push("  Cost, recalled right today -> precision >= 0.6 -> precision >= 0.7 -> margin >= 0.10: 20% fragment " + [0, P6, P7, M10].map((c) => pct(cell(k, "known", "fragment 20% kept", c))).join(" -> ") + "; Scramble-level noise (flip p = 0.25) " + [0, P6, P7, M10].map((c) => pct(cell(k, "known", "flip p = 0.25", c))).join(" -> ") + "; 15% fragment " + [0, P6, P7, M10].map((c) => pct(cell(k, "known", "fragment 15% kept", c))).join(" -> ") + ".");
  }
  R.push("");
  R.push("What this shows, on this toy:");
  R.push("");
  R.push("- A precision check does refuse dense random scatter (with a threshold of 0.6 or more, over 99% of 50% scatter), and it costs nothing on pure fragments, because every lit cell of a fragment is a cell of the thought (precision is 1).");
  R.push("- The price is paid on noisy drawings. The Scramble button's noise level (each cell flipped with probability 0.25) is recalled less often at precision 0.6 and much less often at 0.7, and p = 0.4 is mostly lost. These are the wrong-cells probes that the gate exists to complete, so a precision threshold trades 'refuse dense junk' directly against 'forgive wrong cells'. It is a design choice about how much wrong drawing to forgive, not a free fix.");
  R.push("- Filling the whole pad (all 144 cells) is accepted by the game's gate as the nearest thought; every precision, cell-count and margin 0.10 variant refuses it, while margin 0.05 refuses it only with 8 thoughts stored.");
  R.push("- The cell-count cap is blind to where the cells are: dense scatter has about as many cells as the thought it is matched to, so the cap barely helps (it only catches probes much bigger than the thought).");
  R.push("- A margin check (best cosine beats the second-best) refuses much dense scatter too, because scatter is about equally close to every thought, but it also refuses many honest fragments of similar thoughts (a 15% fragment drops by more than half at margin 0.10). It is aimed at crosstalk, and it trades recall for it.");
  R.push("");
  R.push("The game keeps tau = 0.35 and none of these checks. The limit is documented in the README.");
  o.reading = R;
  const md = render(o);
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(OUT) || fs.readFileSync(OUT, "utf8") !== md) { console.error("docs/gate-experiment.md is stale: run `npm run gate:experiment` and commit the result."); process.exit(1); }
    console.log("docs/gate-experiment.md is up to date");
  } else {
    fs.writeFileSync(OUT, md); console.log("wrote " + path.relative(process.cwd(), OUT));
  }
}
module.exports = { features, VARIANTS, decide, solid };
