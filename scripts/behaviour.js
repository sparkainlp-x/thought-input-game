#!/usr/bin/env node
"use strict";
/* Generates docs/behaviour.md (and docs/behaviour.json) from the game's own
 * memory and gate code. SYNTHETIC toy measurements: seeded, deterministic.
 *   node scripts/behaviour.js           write the files
 *   node scripts/behaviour.js --check   fail if the committed files are stale
 */
const fs = require("node:fs");
const path = require("node:path");
const M = require("../src/membrane.js");

const OUT_MD = path.join(__dirname, "..", "docs", "behaviour.md");
const OUT_JSON = path.join(__dirname, "..", "docs", "behaviour.json");
const TRIALS = 200;

// Sampling uses a separate, well-mixed generator (mulberry32). The game's own
// generator has a short cycle (see section 6), which would bias a Monte Carlo.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pct = (x) => (100 * x).toFixed(1) + "%";
const f2 = (x) => x.toFixed(2);

function memoryOf(k) { return M.makeGlyphs().slice(0, k); }

function randomSubset(vec, fraction, rnd) {
  const cells = [];
  for (let i = 0; i < M.N; i++) if (vec[i] > 0.5) cells.push(i);
  for (let j = cells.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [cells[j], cells[k]] = [cells[k], cells[j]]; }
  const keep = Math.max(1, Math.round(cells.length * fraction));
  const v = new Float32Array(M.N);
  for (let m = 0; m < keep; m++) v[cells[m]] = 1;
  return v;
}
function flipped(vec, p, rnd) {
  const v = Float32Array.from(vec);
  for (let i = 0; i < M.N; i++) if (rnd() < p) v[i] = v[i] > 0.5 ? 0 : 1;
  return v;
}
function classify(res, targetIdx, targetVec) {
  if (!res.accepted) return "refused";
  if (res.best !== targetIdx) return "crosstalk";
  return M.jaccard(res.recall, targetVec) === 1 ? "exact" : "recalled";
}
function tally(memory, makeProbe, rnd, trials) {
  const t = { exact: 0, recalled: 0, crosstalk: 0, refused: 0, n: 0, jsum: 0, jn: 0 };
  for (let g = 0; g < memory.length; g++) {
    for (let r = 0; r < trials; r++) {
      const res = M.project(makeProbe(memory[g].vec, rnd), memory);
      const c = classify(res, g, memory[g].vec); t[c]++; t.n++;
      if (c === "exact" || c === "recalled") { t.jsum += M.jaccard(res.recall, memory[g].vec); t.jn++; }
    }
  }
  return t;
}
const rate = (t, k) => t[k] / t.n;
const correct = (t) => (t.exact + t.recalled) / t.n;

function run() {
  const out = { trials_per_thought: TRIALS, sizes: [3, 4, 5, 6, 7, 8] };
  const glyphs = M.makeGlyphs();

  // 1. Glyphs
  out.glyphs = glyphs.map((g) => ({ name: g.name, cells: M.countLit(g.vec) }));

  // 2. Fragment size x number of stored thoughts
  const fractions = [0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0];
  out.fragment = {};
  for (const k of out.sizes) {
    out.fragment[k] = fractions.map((fr) => {
      const t = tally(memoryOf(k), (v, rnd) => randomSubset(v, fr, rnd), mulberry32(1000 + k * 100 + Math.round(fr * 100)), TRIALS);
      return { fraction: fr, correct: correct(t), exact: rate(t, "exact"), mean_jaccard: t.jn ? t.jsum / t.jn : null, crosstalk: rate(t, "crosstalk"), refused: rate(t, "refused") };
    });
  }

  // 3. Corruption of the full pattern (each cell flipped with probability p)
  const flips = [0, 0.1, 0.25, 0.4, 0.5];
  out.flip = {};
  for (const k of [3, 8]) {
    out.flip[k] = flips.map((p) => {
      const t = tally(memoryOf(k), (v, rnd) => flipped(v, p, rnd), mulberry32(5000 + k * 100 + Math.round(p * 100)), TRIALS);
      return { p, correct: correct(t), crosstalk: rate(t, "crosstalk"), refused: rate(t, "refused") };
    });
  }

  // 4. Gate on unknown patterns: random scatter at a given density
  const dens = [0.05, 0.1, 0.2, 0.3, 0.5];
  out.scatter = {};
  for (const k of [3, 8]) {
    const mem = memoryOf(k);
    out.scatter[k] = dens.map((d) => {
      const rnd = mulberry32(9000 + k * 100 + Math.round(d * 100));
      let refused = 0; const n = 2000; let maxCos = 0;
      for (let i = 0; i < n; i++) {
        const v = new Float32Array(M.N);
        for (let c = 0; c < M.N; c++) v[c] = rnd() < d ? 1 : 0;
        const res = M.project(v, mem);
        if (!res.accepted) refused++;
        if (res.bestCos > maxCos) maxCos = res.bestCos;
      }
      return { density: d, refused: refused / n, max_best_cosine: maxCos, n };
    });
  }

  // 5. Crosstalk: how alike the built-in thoughts are, and near-duplicates
  const cos = glyphs.map((a) => glyphs.map((b) => M.cosine(a.vec, b.vec)));
  const jac = glyphs.map((a) => glyphs.map((b) => M.jaccard(a.vec, b.vec)));
  let top = [];
  for (let i = 0; i < glyphs.length; i++) for (let j = i + 1; j < glyphs.length; j++) top.push({ a: glyphs[i].name, b: glyphs[j].name, cosine: cos[i][j], jaccard: jac[i][j] });
  top.sort((x, y) => y.cosine - x.cosine);
  out.pairs_top = top.slice(0, 5);
  out.pairs_min_cosine = top[top.length - 1];
  // A stored copy of Heart with m cells flipped, in a memory of Heart, Star, Tree
  // and the copy. Probe = a random half of the COPY's lit cells.
  out.duplicate = [0, 2, 5, 10, 20, 40].map((m) => {
    const heart = glyphs[0].vec;
    const dupVec = Float32Array.from(heart);
    const rnd = mulberry32(777 + m);
    const idx = [];
    for (let i = 0; i < M.N; i++) idx.push(i);
    for (let j = idx.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [idx[j], idx[k]] = [idx[k], idx[j]]; }
    for (let q = 0; q < m; q++) dupVec[idx[q]] = dupVec[idx[q]] > 0.5 ? 0 : 1;
    const mem = memoryOf(3); mem.push({ name: "HeartCopy", vec: dupVec, custom: true });
    const frRnd = mulberry32(31337 + m);
    let heartWins = 0, copyWins = 0, other = 0;
    for (let r = 0; r < TRIALS; r++) {
      const res = M.project(randomSubset(dupVec, 0.5, frRnd), mem);
      if (!res.accepted) other++; else if (res.best === 3) copyWins++; else if (res.best === 0) heartWins++; else other++;
    }
    return { flipped_cells: m, jaccard: M.jaccard(heart, dupVec), warns: !!M.closeNeighbour(dupVec, memoryOf(3)),
      copy_recalled: copyWins / TRIALS, heart_recalled_instead: heartWins / TRIALS, other_or_refused: other / TRIALS };
  });

  // 6. Game random generator
  const rand = M.createRng();
  const seen = new Map(); let leadIn = -1, period = -1, i = 0, state;
  // find the cycle by tracking the sequence of outputs through the rng itself
  const r2 = M.createRng(); const outs = []; const first = new Map();
  for (i = 0; i < 100000; i++) {
    const v = r2(); const key = Math.round(v * 0x7fffffff);
    if (first.has(key)) { leadIn = first.get(key); period = i - first.get(key); break; }
    first.set(key, i); outs.push(key);
  }
  const bins = new Array(12).fill(0); const r3 = M.createRng();
  for (let n = 0; n < 100000; n++) bins[Math.floor(r3() * 12)]++;
  out.rng = { lead_in: leadIn, period, distinct_states: first.size, bins12_of_100000: bins,
    first_values: (() => { const r = M.createRng(); return [r(), r(), r()].map((x) => Number(x.toFixed(6))); })() };

  // 7. Fragment assist exactly as the game does it (keeps half, at least 4)
  out.assist = out.sizes.map((k) => {
    const mem = memoryOf(k); const rnd = M.createRng(424242 + k);
    const t = { correct: 0, crosstalk: 0, refused: 0, n: 0 };
    for (let g = 0; g < k; g++) for (let r = 0; r < 100; r++) {
      const v = new Float32Array(M.N); M.fragmentCells(mem[g].vec, rnd).forEach((c) => { v[c] = 1; });
      const res = M.project(v, mem);
      if (!res.accepted) t.refused++; else if (res.best === g) t.correct++; else t.crosstalk++;
      t.n++;
    }
    return { memory: k, correct: t.correct / t.n, crosstalk: t.crosstalk / t.n, refused: t.refused / t.n };
  });
  return out;
}

function table(head, rows) {
  return ["| " + head.join(" | ") + " |", "|" + head.map(() => "---").join("|") + "|"].concat(rows.map((r) => "| " + r.join(" | ") + " |")).join("\n");
}

function render(o) {
  const L = [];
  L.push("# Measured behaviour of the memory and the gate");
  L.push("");
  L.push("Generated by `node scripts/behaviour.js` from `src/membrane.js`. Do not edit by hand: `npm run behaviour:check` fails if this file is stale.");
  L.push("");
  L.push("**SYNTHETIC toy.** Every number below comes from drawn 12 x 12 patterns (eight fixed glyphs, plus generated fragments, flips and random scatter) run through the game's own `project` function. The numbers describe this toy memory on these patterns. They are not a measurement of any brain, signal, device or optical hologram, and they do not predict how a person plays. Sampling uses a seeded generator, so the file is reproducible; " + o.trials_per_thought + " random probes per stored thought per cell of each table (standard error of a rate near 50% is about 1 point for 8 thoughts, 2 points for 3).");
  L.push("");
  L.push("Memory order is the game's: Heart, Star, Tree are stored first; Moon, Eye, Arrow, Spiral, Orbit are added one per won round. \"N thoughts\" below means the first N of those. `exact` means the recalled pattern equals the stored one cell for cell; `recalled` is the right thought with some cells different; `crosstalk` is the gate accepting a different thought; `refused` is the gate saying no (cosine below tau = 0.35, or fewer than 3 lit cells).");
  L.push("");
  L.push("## 1. The thoughts");
  L.push("");
  L.push(table(["thought", "lit cells"], o.glyphs.map((g) => [g.name, String(g.cells)])));
  L.push("");
  L.push("## 2. Recall from a fragment, by fragment size and by number of stored thoughts");
  L.push("");
  L.push("A fragment keeps a random fraction of the target's lit cells (no wrong cells). Cells show the share of probes recalled as the right thought (exact or with small differences). Refusals and crosstalk make up the rest.");
  L.push("");
  const fr = o.fragment[o.sizes[0]].map((x) => x.fraction);
  L.push(table(["thoughts stored"].concat(fr.map((f) => Math.round(f * 100) + "% kept")),
    o.sizes.map((k) => [String(k)].concat(o.fragment[k].map((x) => pct(x.correct))))));
  L.push("");
  L.push("Mean overlap (Jaccard) between the recalled pattern and the stored thought, over the probes recalled as the right thought. The recall is the stored thought plus or minus cells that overlapping thoughts contribute, so it is rarely cell-for-cell identical:");
  L.push("");
  L.push(table(["thoughts stored"].concat(fr.map((f) => Math.round(f * 100) + "% kept")),
    o.sizes.map((k) => [String(k)].concat(o.fragment[k].map((x) => x.mean_jaccard === null ? "n/a" : f2(x.mean_jaccard))))));
  L.push("");
  L.push("Share of probes that ended in crosstalk (a different thought accepted):");
  L.push("");
  L.push(table(["thoughts stored"].concat(fr.map((f) => Math.round(f * 100) + "% kept")),
    o.sizes.map((k) => [String(k)].concat(o.fragment[k].map((x) => pct(x.crosstalk))))));
  L.push("");
  L.push("Share of probes refused by the gate:");
  L.push("");
  L.push(table(["thoughts stored"].concat(fr.map((f) => Math.round(f * 100) + "% kept")),
    o.sizes.map((k) => [String(k)].concat(o.fragment[k].map((x) => pct(x.refused))))));
  L.push("");
  L.push("## 3. Recall of a whole pattern with random flipped cells");
  L.push("");
  L.push("Each cell of the full target is flipped with probability p (this is what the Scramble button does at p = 0.25).");
  L.push("");
  const flipKeys = Object.keys(o.flip);
  L.push(table(["thoughts stored", "p (cells flipped)", "recalled", "crosstalk", "refused"],
    flipKeys.flatMap((k) => o.flip[k].map((x) => [k, String(x.p), pct(x.correct), pct(x.crosstalk), pct(x.refused)]))));
  L.push("");
  L.push("## 4. The gate on unknown patterns");
  L.push("");
  L.push("Random scatter: every cell lit independently with the given density. 2000 probes per row. A refusal is the right answer here, because no stored thought is meant.");
  L.push("");
  L.push(table(["thoughts stored", "density", "refused", "highest best-match cosine seen"],
    Object.keys(o.scatter).flatMap((k) => o.scatter[k].map((x) => [k, String(x.density), pct(x.refused), f2(x.max_best_cosine)]))));
  L.push("");
  L.push("Dense scatter is not refused, because a probe that lights many cells overlaps every stored thought. The gate measures cosine overlap only; it does not know what a thought \"looks like\".");
  L.push("");
  L.push("## 5. Crosstalk");
  L.push("");
  L.push("Most similar pairs among the eight built-in thoughts:");
  L.push("");
  L.push(table(["pair", "cosine", "Jaccard"], o.pairs_top.map((p) => [p.a + " / " + p.b, f2(p.cosine), f2(p.jaccard)])));
  L.push("");
  L.push("Least similar pair: " + o.pairs_min_cosine.a + " / " + o.pairs_min_cosine.b + " (cosine " + f2(o.pairs_min_cosine.cosine) + ").");
  L.push("");
  L.push("A stored copy of Heart with m cells flipped (memory = Heart, Star, Tree and the copy); probe = a random half of the copy's lit cells. When the copy is close to Heart the gate often accepts Heart instead, which is the crosstalk the game warns about on storing. An exact tie goes to the earlier thought (`>` is strict).");
  L.push("");
  L.push(table(["flipped cells", "Jaccard vs Heart", "store warning (>0.7)", "copy recalled", "Heart recalled instead", "other / refused"],
    o.duplicate.map((d) => [String(d.flipped_cells), f2(d.jaccard), d.warns ? "yes" : "no", pct(d.copy_recalled), pct(d.heart_recalled_instead), pct(d.other_or_refused)])));
  L.push("");
  L.push("## 6. The game's random number generator");
  L.push("");
  L.push("The game draws its round targets, fragment cells and scrambles from a small linear congruential generator (seed " + M.DEFAULT_SEED + "). Written in JavaScript, `state * 1103515245` exceeds 2^53, so the result is not the integer LCG it was meant to be. It is still deterministic and identical in every engine (IEEE doubles), which is why it is kept unchanged here.");
  L.push("");
  L.push("- Distinct states reached: " + o.rng.distinct_states + "; lead-in " + o.rng.lead_in + " draws, then a cycle of " + o.rng.period + " draws.");
  L.push("- 12-bin histogram of the first 100000 draws: " + o.rng.bins12_of_100000.join(", ") + ".");
  L.push("- First three values: " + o.rng.first_values.join(", ") + ".");
  L.push("");
  L.push("For a game with a few draws per round this is harmless. It is not suitable for statistics, so the tables above use a separate seeded generator (mulberry32).");
  L.push("");
  L.push("## 7. Fragment assist exactly as in the game");
  L.push("");
  L.push("The Fragment assist button loads a random half of the target's lit cells (at least 4), drawn with the game's own generator, memory as in section 2. 100 assists per stored thought.");
  L.push("");
  L.push(table(["thoughts stored", "recalled", "crosstalk", "refused"], o.assist.map((a) => [String(a.memory), pct(a.correct), pct(a.crosstalk), pct(a.refused)])));
  L.push("");
  L.push("## Reading these numbers honestly");
  L.push("");
  L.push("- Fragments here contain only correct cells. A person draws wrong cells too; section 3 is the closest proxy.");
  L.push("- The patterns are eight hand-drawn glyphs that share many lit cells (Section 5). Other pattern sets would give different numbers.");
  L.push("- The memory is a list of stored patterns compared one by one with the probe, then combined as a match-weighted sum. It is not a trained weight matrix, and these results say nothing about capacity of real associative memories or holograms.");
  L.push("");
  return L.join("\n") + "\n";
}

const o = run();
const md = render(o);
const json = JSON.stringify(o, null, 1) + "\n";
if (process.argv.includes("--check")) {
  const same = fs.existsSync(OUT_MD) && fs.readFileSync(OUT_MD, "utf8") === md && fs.readFileSync(OUT_JSON, "utf8") === json;
  if (!same) { console.error("docs/behaviour.md is stale: run `npm run behaviour` and commit the result."); process.exit(1); }
  console.log("docs/behaviour.md is up to date");
} else {
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_MD, md); fs.writeFileSync(OUT_JSON, json);
  console.log("wrote " + path.relative(process.cwd(), OUT_MD));
}
