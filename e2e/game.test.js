"use strict";
// Headless browser checks of the real page (needs playwright; see README).
// GAME_URL overrides the page under test (default: ./index.html via file://).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const M = require("../src/membrane.js");

const URL_UNDER_TEST = process.env.GAME_URL || pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const GLYPHS = M.makeGlyphs();

let browser;
test.before(async () => {
  const opts = { headless: true };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  browser = await chromium.launch(opts);
});
test.after(async () => { if (browser) await browser.close(); });

async function openPage() {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const requests = [];
  const errors = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(URL_UNDER_TEST);
  return { ctx, page, requests, errors };
}
const lit = (page) => page.$$eval("#pad .cell.on", (els) => els.length);
async function waitDraw(page) {
  await page.waitForFunction(() => !document.getElementById("projectBtn").disabled, null, { timeout: 8000 });
}
async function targetName(page) {
  const t = await page.textContent("#phaseText");
  const m = /incoming thought:\s*(\w+)/.exec(t);
  assert.ok(m, "target name in banner: " + t);
  return m[1];
}
async function drawGlyph(page, name) {
  const g = GLYPHS.find((x) => x.name === name);
  for (let i = 0; i < M.N; i++) if (g.vec[i] > 0.5) await page.click(`#pad .cell[data-idx="${i}"]`);
}
async function verdict(page) {
  await page.waitForFunction(() => !/Waiting|Projecting/.test(document.getElementById("verdictBig").textContent) &&
    document.getElementById("phaseText").textContent.indexOf("Projecting") !== 0, null, { timeout: 8000 });
  return page.textContent("#verdictBig");
}

test("main elements exist and nothing external is requested", async () => {
  const { ctx, page, requests, errors } = await openPage();
  try {
    for (const id of ["pad", "holoCanvas", "projectBtn", "peekBtn", "fragmentBtn", "clearBtn", "hearPadBtn",
      "storeBtn", "scrambleBtn", "freeProjectBtn", "soundBtn", "libGrid", "verdictBig", "roTau"]) {
      assert.ok(await page.$("#" + id), "missing #" + id);
    }
    assert.equal(await page.$$eval("#pad .cell", (e) => e.length), 144);
    assert.equal(await page.textContent("#roTau"), "0.35");
    assert.equal(await page.$$eval("#libGrid .lib-item", (e) => e.length), 8);
    assert.equal(await page.textContent("#hudMemory"), "3");
    const own = new URL(URL_UNDER_TEST).origin;
    const external = requests.filter((u) => /^https?:/.test(u) && new URL(u).origin !== own);
    assert.deepEqual(external, [], "external requests: " + external.join(", "));
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test("keyboard: a pad cell can be toggled with Space and Enter", async () => {
  const { ctx, page } = await openPage();
  try {
    await page.focus('#pad .cell[data-idx="0"]');
    await page.keyboard.press("Space");
    assert.equal(await lit(page), 1, "Space should light the focused cell");
    assert.equal(await page.getAttribute('#pad .cell[data-idx="0"]', "aria-pressed"), "true");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    assert.equal(await lit(page), 2, "Enter should light the next cell");
    await page.focus('#pad .cell[data-idx="0"]');
    await page.keyboard.press("Space");
    assert.equal(await lit(page), 1, "Space again should clear it");
    assert.equal(await page.getAttribute('#pad .cell[data-idx="0"]', "aria-pressed"), "false");
  } finally { await ctx.close(); }
});

test("pointer: a click toggles exactly once (no double toggle with the keyboard handler)", async () => {
  const { ctx, page } = await openPage();
  try {
    await page.click('#pad .cell[data-idx="5"]');
    assert.equal(await lit(page), 1);
    await page.click('#pad .cell[data-idx="5"]');
    assert.equal(await lit(page), 0);
  } finally { await ctx.close(); }
});

test("a full drawing of the incoming thought is recalled and scores", async () => {
  const { ctx, page } = await openPage();
  try {
    const name = await targetName(page);
    await waitDraw(page);
    await drawGlyph(page, name);
    await page.click("#projectBtn");
    const v = await verdict(page);
    assert.match(v, new RegExp("RECALLED . " + name));
    assert.ok(Number(await page.textContent("#hudScore")) > 0);
    assert.equal(await page.isVisible("#nextBtn"), true);
  } finally { await ctx.close(); }
});

test("an empty pad is refused and a random scatter is refused by the gate", async () => {
  const { ctx, page } = await openPage();
  try {
    await waitDraw(page);
    await page.click("#projectBtn");
    assert.match(await page.textContent("#verdictBig"), /REFUSED . empty probe/);
    for (const i of [0, 13, 26, 39, 52, 65, 78, 91, 104, 117, 130, 143]) await page.click(`#pad .cell[data-idx="${i}"]`);
    await page.click("#projectBtn");
    assert.match(await verdict(page), /REFUSED by the gate|CROSSTALK/);
  } finally { await ctx.close(); }
});

test("bug: free-mode projection after a won round must not re-enable scoring", async () => {
  const { ctx, page } = await openPage();
  try {
    const name = await targetName(page);
    await waitDraw(page);
    await drawGlyph(page, name);
    await page.click("#projectBtn");
    assert.match(await verdict(page), /RECALLED/);
    const scoreWon = Number(await page.textContent("#hudScore"));
    const memWon = Number(await page.textContent("#hudMemory"));
    await page.click("#freeProjectBtn");
    await page.waitForTimeout(700);
    assert.equal(await page.isDisabled("#projectBtn"), true, "Project must stay disabled after the round was won");
    await page.click("#projectBtn", { force: true, timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(700);
    assert.equal(Number(await page.textContent("#hudScore")), scoreWon, "score must not change");
    assert.equal(Number(await page.textContent("#hudMemory")), memWon, "no extra thought may be unlocked");
  } finally { await ctx.close(); }
});

test("bug: free-mode projection in an open round keeps Peek and Fragment assist usable", async () => {
  const { ctx, page } = await openPage();
  try {
    const name = await targetName(page);
    await waitDraw(page);
    await drawGlyph(page, name);
    await page.click("#freeProjectBtn");
    await page.waitForTimeout(700);
    assert.equal(await page.isDisabled("#peekBtn"), false, "Peek should be available again");
    await page.click("#clearBtn");
    await page.click("#fragmentBtn");
    assert.ok((await lit(page)) >= 4, "Fragment assist should still load a fragment");
  } finally { await ctx.close(); }
});

test("pad and verdict are exposed to assistive technology", async () => {
  const { ctx, page } = await openPage();
  try {
    assert.equal(await page.getAttribute("#pad", "role"), "group");
    assert.equal(await page.getAttribute("#phaseBanner", "role"), "status");
    assert.equal(await page.getAttribute("#verdictBig", "aria-live"), "polite");
    assert.equal(await page.getAttribute("#holoCanvas", "role"), "img");
    assert.equal(await page.getAttribute("#soundBtn", "aria-pressed"), "true");
  } finally { await ctx.close(); }
});
