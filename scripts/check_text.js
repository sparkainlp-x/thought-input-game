#!/usr/bin/env node
"use strict";
/* Wording and privacy rules for tracked text files (same spirit as the sibling
 * membrane repositories): no overclaiming words, no status badges, no emoji,
 * no tracked build/cache files, and no external network request in the page.
 *   node scripts/check_text.js
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const BANNED = [
  [/\bproven\b/i, "overclaim word"],
  [/\bvalidated\b/i, "overclaim word"],
  [/production[- ]ready/i, "overclaim phrase"],
  [/quantum advantage/i, "overclaim phrase"],
  [/real[- ]world performance/i, "overclaim phrase"],
  [/clinical(ly)? (sensitivity|specificity|validated)/i, "clinical-sounding phrase"],
  [/shields\.io|badge\.svg|badgen\.net/i, "status badge"]
];
const EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D\u2300-\u23FF]/u;
const TEXT = /\.(md|js|json|yml|yaml|cff|html|txt)$|(^|\/)LICENSE$|(^|\/)\.gitignore$/;
const SKIP = new Set(["scripts/check_text.js", "LICENSE", "package-lock.json"]);
const SKIP_PREFIX = ["test/fixtures/", "node_modules/", "e2e/"];

function files() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (e) {
    const out = [];
    (function walk(d) {
      for (const n of fs.readdirSync(path.join(ROOT, d))) {
        if (n === ".git" || n === "node_modules") continue;
        const rel = path.join(d, n);
        if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel); else out.push(rel);
      }
    })("");
    return out;
  }
}

const problems = [];
for (const f of files()) {
  if (SKIP.has(f) || SKIP_PREFIX.some((p) => f.startsWith(p))) continue;
  if (/(^|\/)__pycache__\/|\.pyc$|\.DS_Store$/.test(f)) { problems.push(f + ": tracked cache file"); continue; }
  if (!TEXT.test(f) || !fs.existsSync(path.join(ROOT, f))) continue;
  const lines = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const [re, why] of BANNED) if (re.test(line)) problems.push(`${f}:${i + 1}: ${why}: ${line.trim().slice(0, 80)}`);
    if (EMOJI.test(line)) problems.push(`${f}:${i + 1}: emoji or pictographic symbol`);
  });
}
// Privacy: the page must not load anything from another origin.
for (const f of ["index.html", "src/game.js", "src/membrane.js"]) {
  const t = fs.readFileSync(path.join(ROOT, f), "utf8");
  const m = t.match(/(src|href)\s*=\s*["']https?:\/\/[^"']+["']|@import\s+url\(["']?https?:|fetch\(\s*["']https?:|XMLHttpRequest|navigator\.sendBeacon|WebSocket\(/g);
  if (m) problems.push(f + ": possible external request: " + m.join(", "));
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("text rules ok");
