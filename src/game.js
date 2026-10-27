/* Thought-Input Game: user interface and round flow.
 * Memory, gate, scoring helpers and sonification mapping live in membrane.js
 * (loaded first as window.Membrane). SYNTHETIC toy; reads no minds or brains. */
    (function () {
      "use strict";

      /* ============ Helpers ============ */
      function $(id) { return document.getElementById(id); }
      function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
      var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var rand = Membrane.createRng();

      /* ============ Thought glyphs (12 x 12): see src/membrane.js ============ */
      var G = Membrane.G, N = Membrane.N;
      var GLYPHS = Membrane.makeGlyphs();

      /* ============ Memory (the shared matrix, as superimposed fields) ============
         Holographic recall in our frame: patterns are superimposed; a probe is
         compared against all of them at once, and the recalled field is the
         weighted sum of stored patterns, weighted by each one's match.       */
      var memory = GLYPHS.slice(0, 3);        // patterns currently stored
      var locked = GLYPHS.slice(3);           // unlocked one per won round
      var TAU = Membrane.TAU;                  // refusal gate threshold (cosine)

      var norm = Membrane.norm, jaccard = Membrane.jaccard;
      // Project a probe through the memory (logic in src/membrane.js).
      function project(probe) { return Membrane.project(probe, memory, TAU); }

      /* ============ Game state ============ */
      var round = 1, score = 0, streak = 0;
      var target = null;               // glyph object for this round
      var phase = "show";              // show | draw | projecting | resolved
      var peekTimer = null, peekLeft = 0;
      var fragmentUsed = false;
      var roundWon = false;            // true once this round was recalled in game mode
      var lastResult = null;
      var projAnim = null;             // {start, dur, result}
      var holoReveal = null;           // vector currently shown big in hologram

      /* ============ Pad ============ */
      var padState = new Array(N).fill(false);
      var padEl = $("pad");
      var cellEls = [];
      (function buildPad() {
        for (var i = 0; i < N; i++) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "cell";
          b.dataset.idx = i;
          b.setAttribute("aria-label", "Cell row " + (Math.floor(i / G) + 1) + " column " + (i % G + 1));
          b.setAttribute("aria-pressed", "false");
          padEl.appendChild(b);
          cellEls.push(b);
        }
      })();
      function padVec() {
        var v = new Float32Array(N);
        for (var i = 0; i < N; i++) v[i] = padState[i] ? 1 : 0;
        return v;
      }
      function padCountLit() { var s = 0; for (var i = 0; i < N; i++) if (padState[i]) s++; return s; }
      function refreshPad() {
        for (var i = 0; i < N; i++) {
          cellEls[i].classList.toggle("on", padState[i]);
          cellEls[i].setAttribute("aria-pressed", padState[i] ? "true" : "false");
        }
        var n = padCountLit();
        $("padCount").textContent = n + (n === 1 ? " cell lit" : " cells lit");
        $("roCells").textContent = n;
      }
      function clearPad() { padState = new Array(N).fill(false); refreshPad(); }

      var painting = false, paintValue = true;
      function cellFromEvent(e) {
        var el = document.elementFromPoint(e.clientX, e.clientY);
        while (el && el !== padEl && !el.classList.contains("cell")) el = el.parentElement;
        return (el && el.classList && el.classList.contains("cell")) ? el : null;
      }
      padEl.addEventListener("pointerdown", function (e) {
        var cell = cellFromEvent(e);
        if (!cell) return;
        e.preventDefault();
        var idx = parseInt(cell.dataset.idx, 10);
        paintValue = !padState[idx];
        painting = true;
        padState[idx] = paintValue;
        refreshPad();
        tickSound();
      });
      // Keyboard (Space/Enter on a focused cell) arrives as a click with detail 0;
      // real pointer clicks have detail >= 1 and are already handled on pointerdown.
      padEl.addEventListener("click", function (e) {
        if (e.detail !== 0) return;
        var cell = e.target && e.target.closest ? e.target.closest(".cell") : null;
        if (!cell) return;
        var idx = parseInt(cell.dataset.idx, 10);
        padState[idx] = !padState[idx];
        refreshPad();
        tickSound();
      });
      padEl.addEventListener("pointermove", function (e) {
        if (!painting) return;
        var cell = cellFromEvent(e);
        if (!cell) return;
        var idx = parseInt(cell.dataset.idx, 10);
        if (padState[idx] !== paintValue) { padState[idx] = paintValue; refreshPad(); }
      });
      window.addEventListener("pointerup", function () { painting = false; });
      padEl.addEventListener("pointercancel", function () { painting = false; });

      /* ============ Audio (all synthesized live; starts on first gesture) ============ */
      var actx = null, soundOn = true;
      function ensureAudio() {
        if (actx) { if (actx.state === "suspended") actx.resume(); return true; }
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        actx = new AC();
        return true;
      }
      function tone(freq, t0, dur, type, gain) {
        if (!actx || !soundOn) return;
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = type || "sine";
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain || 0.08, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(actx.destination);
        o.start(t0); o.stop(t0 + dur + 0.05);
      }
      var lastTick = 0;
      function tickSound() {
        if (!soundOn || !actx) return;
        var now = performance.now();
        if (now - lastTick < 45) return;
        lastTick = now;
        tone(1250, actx.currentTime, 0.05, "sine", 0.03);
      }
      function sweepSound() {
        if (!actx || !soundOn) return;
        var t0 = actx.currentTime;
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(150, t0);
        o.frequency.exponentialRampToValueAtTime(760, t0 + 1.15);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.15);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.25);
        o.connect(g); g.connect(actx.destination);
        o.start(t0); o.stop(t0 + 1.3);
      }
      function refuseSound() {
        if (!actx) return;
        var t0 = actx.currentTime;
        tone(96, t0, 0.28, "sine", 0.16);
        tone(82, t0 + 0.22, 0.34, "sine", 0.14);
      }
      function crosstalkSound() {
        if (!actx) return;
        var t0 = actx.currentTime;
        tone(392, t0, 0.22, "triangle", 0.09);
        tone(311, t0 + 0.18, 0.3, "triangle", 0.09);
      }
      // Sonify a pattern: row = time step, column = pitch (mapping in src/membrane.js).
      function playPattern(vec, rowMs) {
        if (!ensureAudio() || !soundOn) return;
        var t0 = actx.currentTime + 0.05;
        Membrane.patternToNotes(vec, rowMs).forEach(function (n) {
          tone(n.freq, t0 + n.start, 0.24, "triangle", 0.055);
        });
      }
      $("soundBtn").addEventListener("click", function () {
        soundOn = !soundOn;
        this.setAttribute("aria-pressed", soundOn ? "true" : "false");
        this.textContent = soundOn ? "Sound: on" : "Sound: off";
        if (soundOn) ensureAudio();
      });

      /* ============ Hologram rendering ============ */
      var holo = $("holoCanvas"), hctx = holo.getContext("2d");
      var particles = [];
      (function initParticles() {
        for (var i = 0; i < 42; i++) particles.push({
          x: Math.random(), y: Math.random(), s: 0.008 + Math.random() * 0.02, r: 0.6 + Math.random() * 1.6
        });
      })();

      function drawHologram(now) {
        var W = holo.width, H = holo.height;
        var t = now / 1000;
        hctx.clearRect(0, 0, W, H);
        // backdrop glow
        var grd = hctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, W * 0.55);
        grd.addColorStop(0, "rgba(69,195,214,0.13)");
        grd.addColorStop(1, "rgba(69,195,214,0)");
        hctx.fillStyle = grd;
        hctx.fillRect(0, 0, W, H);

        var bob = reducedMotion ? 0 : Math.sin(t * 0.9) * 5;
        var cx = W / 2, cy = H * 0.40 + bob;
        var planeW = Math.min(W * 0.52, 400), planeH = planeW * 0.44;

        // light cone from projector base to the plane
        var baseY = H * 0.90, baseHalf = 54;
        hctx.beginPath();
        hctx.moveTo(cx - baseHalf, baseY);
        hctx.lineTo(cx + baseHalf, baseY);
        hctx.lineTo(cx + planeW * 0.56, cy + planeH * 0.62);
        hctx.lineTo(cx - planeW * 0.56, cy + planeH * 0.62);
        hctx.closePath();
        var cone = hctx.createLinearGradient(0, cy, 0, baseY);
        cone.addColorStop(0, "rgba(69,195,214,0.10)");
        cone.addColorStop(1, "rgba(69,195,214,0.02)");
        hctx.fillStyle = cone;
        hctx.fill();

        // floating dust particles inside the cone area
        hctx.fillStyle = "rgba(160,225,238,0.5)";
        for (var p = 0; p < particles.length; p++) {
          var pt = particles[p];
          var py = (pt.y + t * pt.s * 0.14) % 1;
          var px = cx + (pt.x - 0.5) * planeW * 1.15;
          var pyy = cy - planeH * 0.7 + py * planeH * 1.7;
          hctx.globalAlpha = 0.16 + 0.3 * Math.abs(Math.sin(t * 0.7 + p));
          hctx.beginPath(); hctx.arc(px, pyy, pt.r, 0, 2 * Math.PI); hctx.fill();
        }
        hctx.globalAlpha = 1;

        // rotating holographic rings (ellipses) around the plane
        hctx.strokeStyle = "rgba(69,195,214,0.35)";
        hctx.lineWidth = 1.4;
        for (var ring = 0; ring < 2; ring++) {
          var rr = planeW * (0.62 + ring * 0.10);
          var rot = reducedMotion ? 0.6 : t * (0.25 + ring * 0.12);
          hctx.beginPath();
          for (var a = 0; a <= 40; a++) {
            var ang = rot + a / 40 * Math.PI * 2;
            // dashed effect: skip segments
            if (a % 9 === 8) continue;
            var ex = cx + Math.cos(ang) * rr;
            var ey = cy + Math.sin(ang) * rr * 0.30;
            if (a === 0 || a % 9 === 0) hctx.moveTo(ex, ey); else hctx.lineTo(ex, ey);
          }
          hctx.stroke();
        }

        // determine what to draw on the plane
        var mainVec = null, mainColor = "69,195,214", mainLabel = "";
        var overVec = null;
        if (phase === "show" && target) { mainVec = target.vec; mainLabel = "incoming thought"; }
        else if (phase === "projecting" && projAnim) {
          mainVec = padVec(); mainColor = "245,200,110"; mainLabel = "projecting…";
        } else if (phase === "resolved" && lastResult) {
          if (lastResult.accepted) { mainVec = lastResult.recall; mainLabel = "membrane recall"; }
          else { mainVec = padVec(); mainColor = "245,200,110"; mainLabel = "refused probe"; }
          overVec = padVec();
        } else { mainVec = padVec(); mainColor = "245,200,110"; mainLabel = "your thought, forming"; }

        $("stageMode").textContent = mainLabel;

        // plane grid
        var cellW = planeW / G, cellH = planeH / G;
        var x0 = cx - planeW / 2, y0 = cy - planeH / 2;
        hctx.strokeStyle = "rgba(69,195,214,0.16)";
        hctx.lineWidth = 1;
        for (var gx = 0; gx <= G; gx++) { hctx.beginPath(); hctx.moveTo(x0 + gx * cellW, y0); hctx.lineTo(x0 + gx * cellW, y0 + planeH); hctx.stroke(); }
        for (var gy = 0; gy <= G; gy++) { hctx.beginPath(); hctx.moveTo(x0, y0 + gy * cellH); hctx.lineTo(x0 + planeW, y0 + gy * cellH); hctx.stroke(); }

        // projection progress: reveal recall cells in field-strength order
        var revealFrac = 1, fieldOrder = null;
        if (phase === "projecting" && projAnim) {
          revealFrac = clamp((now - projAnim.start) / projAnim.dur, 0, 1);
        }
        if (phase === "resolved" || phase === "projecting") {
          var res = phase === "projecting" ? projAnim.result : lastResult;
          if (res && res.accepted) {
            fieldOrder = [];
            for (var fi = 0; fi < N; fi++) if (res.recall[fi] > 0.5) fieldOrder.push(fi);
            fieldOrder.sort(function (a, b) { return res.field[b] - res.field[a]; });
            mainVec = res.recall; mainColor = "69,195,214";
          }
        }

        if (mainVec) {
          var litCount = 0;
          for (var li = 0; li < N; li++) if (mainVec[li] > 0.5) litCount++;
          var shown = 0;
          for (var idx = 0; idx < N; idx++) {
            if (mainVec[idx] <= 0.5) continue;
            if (fieldOrder) {
              var rank = fieldOrder.indexOf(idx);
              if (rank / Math.max(1, litCount) > revealFrac) continue;
            }
            shown++;
            var col = idx % G, row = Math.floor(idx / G);
            var px2 = x0 + (col + 0.5) * cellW;
            var py2 = y0 + (row + 0.5) * cellH;
            var pulse = reducedMotion ? 0.8 : 0.72 + 0.28 * Math.sin(t * 2.2 + idx * 0.35);
            var rad = Math.min(cellW, cellH) * 0.34 * pulse + 2;
            // vertical beamlet
            hctx.strokeStyle = "rgba(" + mainColor + ",0.20)";
            hctx.lineWidth = 2;
            hctx.beginPath(); hctx.moveTo(px2, py2); hctx.lineTo(px2, baseY - 8); hctx.stroke();
            // glow orb
            var og = hctx.createRadialGradient(px2, py2, 0, px2, py2, rad * 2.4);
            og.addColorStop(0, "rgba(" + mainColor + ",0.95)");
            og.addColorStop(0.45, "rgba(" + mainColor + ",0.45)");
            og.addColorStop(1, "rgba(" + mainColor + ",0)");
            hctx.fillStyle = og;
            hctx.beginPath(); hctx.arc(px2, py2, rad * 2.4, 0, 2 * Math.PI); hctx.fill();
            hctx.fillStyle = "rgba(235,252,255,0.95)";
            hctx.beginPath(); hctx.arc(px2, py2, rad * 0.42, 0, 2 * Math.PI); hctx.fill();
          }
        }

        // probe overlay in resolved state: amber outlines where the player drew
        if (phase === "resolved" && overVec && lastResult && lastResult.accepted) {
          hctx.strokeStyle = "rgba(245,200,110,0.85)";
          hctx.lineWidth = 1.6;
          for (var oi = 0; oi < N; oi++) {
            if (overVec[oi] <= 0.5) continue;
            var oc = oi % G, orow = Math.floor(oi / G);
            hctx.strokeRect(x0 + oc * cellW + 2, y0 + orow * cellH + 2, cellW - 4, cellH - 4);
          }
        }

        // scanline sweep
        if (!reducedMotion) {
          var sy = y0 + ((t * 0.55) % 1) * planeH;
          hctx.fillStyle = "rgba(160,225,238,0.10)";
          hctx.fillRect(x0 - 8, sy, planeW + 16, 3);
        }

        // projector base
        hctx.fillStyle = "#0d1c28";
        hctx.strokeStyle = "rgba(69,195,214,0.6)";
        hctx.lineWidth = 1.4;
        hctx.beginPath();
        hctx.moveTo(cx - 74, H * 0.965);
        hctx.lineTo(cx + 74, H * 0.965);
        hctx.lineTo(cx + baseHalf, baseY);
        hctx.lineTo(cx - baseHalf, baseY);
        hctx.closePath(); hctx.fill(); hctx.stroke();
        hctx.fillStyle = "rgba(69,195,214,0.9)";
        hctx.beginPath(); hctx.ellipse(cx, baseY + 2, 30, 5, 0, 0, 2 * Math.PI); hctx.fill();
        hctx.fillStyle = "rgba(190,235,245,0.75)";
        hctx.font = "600 12px ui-monospace, Menlo, Consolas, monospace";
        hctx.textAlign = "center";
        hctx.fillText("MEMBRANE PROJECTOR", cx, H * 0.945);
      }
      function holoLoop(now) {
        requestAnimationFrame(holoLoop);
        if (document.hidden) return;
        drawHologram(now);
        // finish projection animation
        if (phase === "projecting" && projAnim && now - projAnim.start >= projAnim.dur) {
          finishProjection();
        }
      }
      requestAnimationFrame(holoLoop);

      /* ============ UI helpers ============ */
      function setPhase(html, cls) {
        $("phaseText").innerHTML = html;
        $("phaseBanner").className = "phase-banner" + (cls ? " " + cls : "");
      }
      function updateHud() {
        $("hudRound").textContent = round;
        $("hudScore").textContent = score;
        $("hudStreak").textContent = streak;
        $("hudMemory").textContent = memory.length;
      }
      function setVerdict(big, cls, msg, res) {
        var v = $("verdictBig");
        v.textContent = big;
        v.className = "verdict-big " + cls;
        if (msg) $("verdictMsg").innerHTML = msg;
        if (res) {
          $("meterFill").style.width = Math.round(res.recallCos * 100) + "%";
          $("meterVal").textContent = res.recallCos.toFixed(2);
          $("roBest").textContent = memory[res.best].name;
          $("roProbe").textContent = res.bestCos.toFixed(2);
        } else {
          $("meterFill").style.width = "0%";
          $("meterVal").textContent = "—";
          $("roBest").textContent = "—";
          $("roProbe").textContent = "—";
        }
      }

      /* ============ Library rendering ============ */
      function drawMini(cv, vec) {
        var c = cv.getContext("2d");
        c.clearRect(0, 0, cv.width, cv.height);
        var s = cv.width / G;
        for (var i = 0; i < N; i++) {
          if (vec[i] <= 0.5) continue;
          var x = (i % G) * s, y = Math.floor(i / G) * s;
          c.fillStyle = "rgba(69,195,214,0.9)";
          c.beginPath(); c.arc(x + s / 2, y + s / 2, s * 0.32, 0, 2 * Math.PI); c.fill();
        }
        c.strokeStyle = "rgba(69,195,214,0.18)";
        c.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);
      }
      function renderLibrary() {
        var grid = $("libGrid");
        grid.innerHTML = "";
        memory.forEach(function (g) {
          var d = document.createElement("div");
          d.className = "lib-item";
          var cv = document.createElement("canvas");
          cv.width = 96; cv.height = 96;
          drawMini(cv, g.vec);
          var nm = document.createElement("div"); nm.className = "nm"; nm.textContent = g.name;
          var tg = document.createElement("div"); tg.className = "tag"; tg.textContent = g.custom ? "your thought" : "in memory";
          d.appendChild(cv); d.appendChild(nm); d.appendChild(tg);
          grid.appendChild(d);
        });
        locked.forEach(function (g) {
          var d = document.createElement("div");
          d.className = "lib-item locked";
          var cv = document.createElement("canvas");
          cv.width = 96; cv.height = 96;
          drawMini(cv, g.vec);
          var nm = document.createElement("div"); nm.className = "nm"; nm.textContent = g.name;
          var tg = document.createElement("div"); tg.className = "tag"; tg.textContent = "not learned yet";
          d.appendChild(cv); d.appendChild(nm); d.appendChild(tg);
          grid.appendChild(d);
        });
        updateHud();
      }

      /* ============ Round flow ============ */
      function pickTarget() { return Membrane.pickTarget(memory, target, rand); }
      function startRound(newGlyph) {
        target = newGlyph || pickTarget();
        fragmentUsed = false;
        roundWon = false;
        lastResult = null;
        projAnim = null;
        clearPad();
        setVerdict("Waiting for a projection…", "idle", null, null);
        $("nextBtn").hidden = true;
        $("projectBtn").disabled = true;
        $("peekBtn").disabled = true;
        phase = "show";
        var secs = newGlyph ? 5 : 3.5;
        peekLeft = secs;
        setPhase("<strong>Round " + round + ".</strong>&nbsp;Memorize the incoming thought: <strong>" + target.name + "</strong>" +
          (newGlyph ? " — the membrane just learned this one." : "") + " It fades in " + secs.toFixed(1) + " s…");
        if (peekTimer) clearInterval(peekTimer);
        peekTimer = setInterval(function () {
          peekLeft -= 0.25;
          if (peekLeft <= 0) {
            clearInterval(peekTimer); peekTimer = null;
            phase = "draw";
            $("projectBtn").disabled = false;
            $("peekBtn").disabled = false;
            setPhase("<strong>Your turn.</strong>&nbsp;Draw the thought — or just its most recognizable fragment — then press <strong>Project</strong>.");
          } else {
            setPhase("<strong>Round " + round + ".</strong>&nbsp;Memorize the incoming thought: <strong>" + target.name + "</strong>. It fades in " + peekLeft.toFixed(1) + " s…");
          }
        }, 250);
        renderLibrary();
      }

      function doProject(mode) {
        if (phase === "projecting") return;
        var probe = padVec();
        if (norm(probe) === 0) {
          setVerdict("REFUSED — empty probe", "bad",
            "The pad is empty, so there is nothing to project. The gate cannot recall a thought from no signal at all — draw at least a fragment first.", null);
          phase = "draw";
          $("projectBtn").disabled = false;
          return;
        }
        ensureAudio();
        sweepSound();
        var res = project(probe);
        res.mode = mode;
        lastResult = res;
        phase = "projecting";
        projAnim = { start: performance.now(), dur: reducedMotion ? 350 : 1250, result: res };
        $("projectBtn").disabled = true;
        $("peekBtn").disabled = true;
        setPhase("<strong>Projecting…</strong>&nbsp;Your probe is passing through the shared matrix. Watch the hologram rebuild a whole thought from your fragment.");
        // Free mode resolves through the same finish path.
      }

      // After a free-mode projection: an open round goes back to drawing (Peek,
      // Fragment assist and Project work again); a round that was already won
      // stays resolved, so it cannot be scored a second time.
      function afterFreeProjection() {
        if (roundWon) return;
        phase = "draw";
        $("projectBtn").disabled = false;
        $("peekBtn").disabled = false;
      }

      function finishProjection() {
        var res = lastResult;
        projAnim = null;
        phase = "resolved";
        var bestGlyph = memory[res.best];
        var recalledJac = jaccard(res.recall, bestGlyph.vec);

        if (!res.accepted) {
          refuseSound();
          streak = 0;
          setVerdict("REFUSED by the gate", "bad",
            "Your probe's best match was <strong>" + res.bestCos.toFixed(2) + "</strong>, below τ = " + TAU.toFixed(2) +
            ". The membrane would rather say <strong>“I don't recognize this”</strong> than guess. Draw more of the thought's distinctive parts — corners, tips, the bits no other thought has.",
            res);
          setPhase("<strong>Refused.</strong>&nbsp;No thought matched strongly enough. Adjust your drawing and project again — or peek.", "bad");
          if (res.mode === "game") { $("projectBtn").disabled = false; $("peekBtn").disabled = false; phase = "draw"; }
          else { afterFreeProjection(); }
          updateHud();
          return;
        }

        if (res.mode === "free") {
          setVerdict("Projected: " + bestGlyph.name, "good",
            "Free projection: your probe matched <strong>" + bestGlyph.name + "</strong> at " + res.bestCos.toFixed(2) +
            ", and the matrix completed it (recall overlap " + res.recallCos.toFixed(2) + ", Jaccard " + recalledJac.toFixed(2) +
            "). The amber outlines on the hologram are the cells <em>you</em> actually drew — everything else, the membrane filled in.", res);
          setPhase("<strong>Free projection complete.</strong>&nbsp;That is the nearest whole thought the membrane holds.");
          afterFreeProjection();
          playPattern(res.recall, 110);
          return;
        }

        // Game mode resolution
        if (bestGlyph === target) {
          var acc = res.recallCos;
          var pts = Membrane.roundPoints(acc, streak, fragmentUsed);
          score += pts;
          roundWon = true;
          streak += 1;
          setVerdict("RECALLED — " + target.name + " · +" + pts + " pts", "good",
            "Your probe matched at <strong>" + res.bestCos.toFixed(2) + "</strong>; the projection completed the whole <strong>" + target.name +
            "</strong> (overlap " + acc.toFixed(2) + "). Amber outlines = the fragment you drew. The rest is holographic completion.", res);
          // Unlock next glyph for the following round
          var newly = null;
          if (locked.length) { newly = locked.shift(); memory.push(newly); }
          setPhase("<strong>Thought recalled.</strong>&nbsp;+" + pts + " points." +
            (newly ? " The membrane just learned a new thought: <strong>" + newly.name + "</strong> — it arrives next round." : " Every built-in thought is now in memory — crosstalk gets harder from here."), "good");
          $("nextBtn").hidden = false;
          $("nextBtn").dataset.newGlyph = newly ? newly.name : "";
          playPattern(res.recall, 110);
          updateHud();
          renderLibrary();
        } else {
          crosstalkSound();
          streak = 0;
          setVerdict("CROSSTALK — it recalled " + bestGlyph.name, "bad",
            "Your drawing matched <strong>" + bestGlyph.name + "</strong> (" + res.bestCos.toFixed(2) + ") more strongly than the incoming thought. " +
            "In a shared holographic matrix, a fragment of one thought can complete a <em>different</em> thought when they overlap. Emphasize the parts that make this thought unique.", res);
          setPhase("<strong>Crosstalk.</strong>&nbsp;The membrane completed the wrong thought. Redraw with the distinctive parts stronger, then project again.", "bad");
          $("projectBtn").disabled = false;
          $("peekBtn").disabled = false;
          phase = "draw";
          updateHud();
        }
      }

      /* ============ Controls ============ */
      $("projectBtn").addEventListener("click", function () { doProject("game"); });
      $("freeProjectBtn").addEventListener("click", function () {
        if (phase === "show" || phase === "projecting") {
          $("sandboxMsg").textContent = "Wait for the incoming thought to fade before free-projecting.";
          return;
        }
        phase = "draw";
        doProject("free");
      });
      $("nextBtn").addEventListener("click", function () {
        round += 1;
        var name = this.dataset.newGlyph;
        var glyph = null;
        if (name) for (var i = 0; i < memory.length; i++) if (memory[i].name === name) glyph = memory[i];
        startRound(glyph);
      });
      $("peekBtn").addEventListener("click", function () {
        if (phase !== "draw" || !target) return;
        score = Math.max(0, score - 15);
        updateHud();
        phase = "show";
        $("projectBtn").disabled = true;
        $("peekBtn").disabled = true;
        peekLeft = 2;
        setPhase("<strong>Peek:</strong>&nbsp;the thought is <strong>" + target.name + "</strong> — back to drawing in 2.0 s… (−15 pts)");
        if (peekTimer) clearInterval(peekTimer);
        peekTimer = setInterval(function () {
          peekLeft -= 0.25;
          if (peekLeft <= 0) {
            clearInterval(peekTimer); peekTimer = null;
            phase = "draw";
            $("projectBtn").disabled = false;
            $("peekBtn").disabled = false;
            setPhase("<strong>Your turn.</strong>&nbsp;Draw the thought, then press <strong>Project</strong>.");
          }
        }, 250);
      });
      $("clearBtn").addEventListener("click", function () { clearPad(); });
      $("fragmentBtn").addEventListener("click", function () {
        if (!target || phase !== "draw") return;
        if (fragmentUsed) { setPhase("Fragment assist already used this round. The rest is yours to remember."); return; }
        fragmentUsed = true;
        score = Math.max(0, score - 10);
        var cells = Membrane.fragmentCells(target.vec, rand);
        clearPad();
        for (var m = 0; m < cells.length; m++) padState[cells[m]] = true;
        refreshPad();
        updateHud();
        setPhase("<strong>Fragment loaded:</strong>&nbsp;half of the thought's cells, chosen at random (−10 pts). Project it as-is to feel the completion — or add what you remember first.");
      });
      $("hearPadBtn").addEventListener("click", function () {
        if (padCountLit() === 0) { setPhase("Your pad is silent — light some cells first, then listen."); return; }
        playPattern(padVec(), 120);
        setPhase("<strong>Listening to your drawing:</strong>&nbsp;rows play top to bottom, columns set the pitch. A shape is also a melody.");
      });
      $("scrambleBtn").addEventListener("click", function () {
        if (padCountLit() === 0) { $("sandboxMsg").textContent = "Draw or load a thought first — there is nothing on the pad to scramble."; return; }
        Membrane.scramblePad(padState, rand);
        refreshPad();
        $("sandboxMsg").innerHTML = "Pad scrambled: 25% of cells flipped. Now <strong>Project — free mode</strong> and see whether the membrane still recognizes the thought under damage. That tolerance is the whole point of holographic storage.";
      });
      $("storeBtn").addEventListener("click", function () {
        var lit = padCountLit();
        if (lit < 8) { $("sandboxMsg").textContent = "Too small to store: light at least 8 cells so the thought has enough structure to be recognized later."; return; }
        var name = $("customName").value.trim() || ("Your thought " + (memory.filter(function (g) { return g.custom; }).length + 1));
        var vec = padVec();
        var warn = "";
        var near = Membrane.closeNeighbour(vec, memory);
        if (near) warn = " Warning: it is very close to <strong>" + near.name + "</strong> (Jaccard " + near.jaccard.toFixed(2) + ") — expect crosstalk between them.";
        memory.push({ name: name, vec: vec, custom: true });
        $("customName").value = "";
        renderLibrary();
        $("sandboxMsg").innerHTML = "Stored <strong>" + name + "</strong> in the shared matrix (" + lit + " cells). It can now be recalled, refused, and sonified like any built-in thought." + warn;
        setPhase("<strong>New thought stored:</strong>&nbsp;" + name + " joined the membrane's memory.");
      });

      /* ============ Init ============ */
      $("roTau").textContent = TAU.toFixed(2);
      refreshPad();
      updateHud();
      startRound(null);
    })();
