// FakeYeast paper companion, BYO static-site fixture (demo lab).
//
// Hand written vanilla JavaScript, no framework and no external dependency, so
// the whole interactive paper runs from the sandboxed assets origin. The
// centerpiece is a live 3D regulatory network rendered in plain canvas (Figure
// 1), the kind of custom visual a self hosted bundle can run that a templated
// page cannot. Everything below is fabricated for the demo.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

(function () {
  "use strict";

  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ----------------------------------------------------------------------- //
  // Figure 1. The 3D interactome.                                           //
  // ----------------------------------------------------------------------- //
  function initNetwork() {
    var canvas = document.getElementById("net-canvas");
    if (!canvas || !canvas.getContext) return;
    var wrap = canvas.parentElement;
    var ctx = canvas.getContext("2d");

    var MODULES = [
      { name: "fakeGFP cassette", color: [95, 240, 192] },
      { name: "Core metabolism", color: [47, 211, 154] },
      { name: "Membrane transport", color: [73, 182, 232] },
      { name: "Stress response", color: [155, 140, 255] },
      { name: "Cell cycle", color: [242, 184, 92] },
    ];
    var COUNTS = [60, 170, 165, 175, 160];

    // Build node cloud. Each module gets a center direction on a sphere, then
    // its nodes scatter around that center so the graph reads as clustered.
    var nodes = [];
    var R = 230;
    var seed = 1337;
    function rnd() {
      // Deterministic pseudo random so the figure looks the same every load.
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    }
    function gauss() {
      return (rnd() + rnd() + rnd() + rnd() - 2) / 2;
    }

    var centers = [];
    for (var m = 0; m < MODULES.length; m++) {
      if (m === 0) {
        centers.push({ x: 0, y: 0, z: 0 }); // cassette at the core
      } else {
        var t = (m - 1) / (MODULES.length - 1);
        var phi = t * Math.PI * 2;
        var theta = (rnd() - 0.5) * 1.4;
        centers.push({
          x: Math.cos(phi) * Math.cos(theta) * R * 0.78,
          y: Math.sin(theta) * R * 0.7,
          z: Math.sin(phi) * Math.cos(theta) * R * 0.78,
        });
      }
    }

    for (var mi = 0; mi < MODULES.length; mi++) {
      var spread = mi === 0 ? 70 : 95;
      for (var k = 0; k < COUNTS[mi]; k++) {
        nodes.push({
          x: centers[mi].x + gauss() * spread,
          y: centers[mi].y + gauss() * spread,
          z: centers[mi].z + gauss() * spread,
          mod: mi,
          deg: 0,
          sx: 0,
          sy: 0,
          sz: 0,
          sr: 0,
        });
      }
    }

    // Build edges. Dense inside a module via nearest neighbors, sparse across
    // modules so the clusters stay legible. Adjacency drives hover tracing.
    var edges = [];
    var adj = [];
    for (var a = 0; a < nodes.length; a++) adj.push([]);
    function link(i, j) {
      if (i === j) return;
      edges.push([i, j]);
      adj[i].push(j);
      adj[j].push(i);
      nodes[i].deg++;
      nodes[j].deg++;
    }
    // Within module, connect to a few of the closest peers.
    var byMod = [[], [], [], [], []];
    for (var n = 0; n < nodes.length; n++) byMod[nodes[n].mod].push(n);
    for (var g = 0; g < byMod.length; g++) {
      var ids = byMod[g];
      for (var ii = 0; ii < ids.length; ii++) {
        var i0 = ids[ii];
        var dists = [];
        for (var jj = 0; jj < ids.length; jj++) {
          if (ii === jj) continue;
          var j0 = ids[jj];
          var dx = nodes[i0].x - nodes[j0].x;
          var dy = nodes[i0].y - nodes[j0].y;
          var dz = nodes[i0].z - nodes[j0].z;
          dists.push([dx * dx + dy * dy + dz * dz, j0]);
        }
        dists.sort(function (p, q) {
          return p[0] - q[0];
        });
        var links = 2 + Math.floor(rnd() * 2);
        for (var L = 0; L < links && L < dists.length; L++) {
          if (rnd() < 0.85) link(i0, dists[L][1]);
        }
      }
    }
    // Cross module bridges, anchored on the cassette core so it reads central.
    for (var b = 0; b < 130; b++) {
      var src = byMod[0][Math.floor(rnd() * byMod[0].length)];
      var tgtMod = 1 + Math.floor(rnd() * 4);
      var tgt = byMod[tgtMod][Math.floor(rnd() * byMod[tgtMod].length)];
      link(src, tgt);
    }

    // Pre render one soft glow sprite per module color, drawn with drawImage so
    // the per frame cost stays low even with hundreds of nodes.
    var SPR = 64;
    var sprites = MODULES.map(function (mod) {
      var c = document.createElement("canvas");
      c.width = c.height = SPR;
      var g2 = c.getContext("2d");
      var grd = g2.createRadialGradient(SPR / 2, SPR / 2, 0, SPR / 2, SPR / 2, SPR / 2);
      var col = mod.color;
      grd.addColorStop(0, "rgba(255,255,255,0.95)");
      grd.addColorStop(0.25, "rgba(" + col[0] + "," + col[1] + "," + col[2] + ",0.95)");
      grd.addColorStop(0.6, "rgba(" + col[0] + "," + col[1] + "," + col[2] + ",0.35)");
      grd.addColorStop(1, "rgba(" + col[0] + "," + col[1] + "," + col[2] + ",0)");
      g2.fillStyle = grd;
      g2.fillRect(0, 0, SPR, SPR);
      return c;
    });

    // View + interaction state.
    var rotY = 0.6;
    var rotX = -0.25;
    var autoVel = reduceMotion ? 0 : 0.0016;
    var dragging = false;
    var lastX = 0;
    var lastY = 0;
    var idleSpin = !reduceMotion;
    var pointer = { x: -1, y: -1, inside: false };
    var hover = -1;
    var W = 0;
    var H = 0;
    var cx = 0;
    var cy = 0;
    var scale = 1;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2;
      cy = H / 2;
      scale = Math.min(W, H) / 620;
    }

    function project() {
      var cosY = Math.cos(rotY);
      var sinY = Math.sin(rotY);
      var cosX = Math.cos(rotX);
      var sinX = Math.sin(rotX);
      var focal = 620;
      for (var i = 0; i < nodes.length; i++) {
        var nd = nodes[i];
        var x1 = nd.x * cosY + nd.z * sinY;
        var z1 = -nd.x * sinY + nd.z * cosY;
        var y2 = nd.y * cosX - z1 * sinX;
        var z2 = nd.y * sinX + z1 * cosX;
        var persp = focal / (focal + z2);
        nd.sx = cx + x1 * persp * scale;
        nd.sy = cy + y2 * persp * scale;
        nd.sz = z2;
        nd.sr = (2.2 + Math.sqrt(nd.deg) * 1.5) * persp * scale;
      }
    }

    function depthAlpha(z) {
      // Front nodes near z = -R, back near z = +R. Map to opacity.
      var t = (z + R) / (2 * R);
      return 0.25 + (1 - Math.max(0, Math.min(1, t))) * 0.75;
    }

    var order = [];
    for (var oi = 0; oi < nodes.length; oi++) order.push(oi);

    function frame() {
      if (idleSpin && !dragging) rotY += autoVel;
      project();

      // Hover pick, nearest projected node to the pointer.
      hover = -1;
      if (pointer.inside && !dragging) {
        var best = 16 * 16;
        for (var h = 0; h < nodes.length; h++) {
          var ddx = nodes[h].sx - pointer.x;
          var ddy = nodes[h].sy - pointer.y;
          var d2 = ddx * ddx + ddy * ddy;
          if (d2 < best) {
            best = d2;
            hover = h;
          }
        }
      }
      var nbr = null;
      if (hover >= 0) {
        nbr = {};
        nbr[hover] = 1;
        for (var e = 0; e < adj[hover].length; e++) nbr[adj[hover][e]] = 1;
      }

      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;

      // Edges. Bucket by depth so each opacity level is one stroke pass.
      var buckets = [[], [], [], []];
      for (var ei = 0; ei < edges.length; ei++) {
        var s = edges[ei][0];
        var d = edges[ei][1];
        var az = (nodes[s].sz + nodes[d].sz) / 2;
        var bi = Math.max(0, Math.min(3, Math.floor(((az + R) / (2 * R)) * 4)));
        if (nbr && (nbr[s] || nbr[d])) continue; // highlighted later
        buckets[bi].push(ei);
      }
      var bucketAlpha = [0.5, 0.32, 0.18, 0.08];
      for (var bk = 0; bk < 4; bk++) {
        if (!buckets[bk].length) continue;
        ctx.strokeStyle = "rgba(95, 240, 192," + (nbr ? bucketAlpha[bk] * 0.25 : bucketAlpha[bk]) + ")";
        ctx.beginPath();
        for (var q = 0; q < buckets[bk].length; q++) {
          var ed = edges[buckets[bk][q]];
          ctx.moveTo(nodes[ed[0]].sx, nodes[ed[0]].sy);
          ctx.lineTo(nodes[ed[1]].sx, nodes[ed[1]].sy);
        }
        ctx.stroke();
      }

      // Highlighted edges for the hovered node.
      if (nbr) {
        ctx.strokeStyle = "rgba(234, 250, 243, 0.55)";
        ctx.beginPath();
        for (var he = 0; he < adj[hover].length; he++) {
          var t2 = adj[hover][he];
          ctx.moveTo(nodes[hover].sx, nodes[hover].sy);
          ctx.lineTo(nodes[t2].sx, nodes[t2].sy);
        }
        ctx.stroke();
      }

      // Nodes, back to front.
      order.sort(function (p, q) {
        return nodes[q].sz - nodes[p].sz;
      });
      ctx.globalCompositeOperation = "lighter";
      for (var r = 0; r < order.length; r++) {
        var idx = order[r];
        var node = nodes[idx];
        var alpha = depthAlpha(node.sz);
        var size = node.sr;
        if (nbr) {
          if (nbr[idx]) {
            alpha = 1;
            size = node.sr * (idx === hover ? 1.7 : 1.3);
          } else {
            alpha *= 0.22;
          }
        }
        ctx.globalAlpha = alpha;
        var spr = sprites[node.mod];
        var draw = size * 2.6;
        ctx.drawImage(spr, node.sx - draw / 2, node.sy - draw / 2, draw, draw);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      updateTip(nbr);
      raf = window.requestAnimationFrame(frame);
    }

    var tip = document.getElementById("net-tip");
    var GENES = ["FKY", "GFP", "SNZ", "PMA", "HSP", "CDC", "TPS", "MET", "RPL", "ADH"];
    function updateTip(nbr) {
      if (!tip) return;
      if (hover < 0) {
        tip.hidden = true;
        return;
      }
      var nd = nodes[hover];
      var name = GENES[hover % GENES.length] + (100 + (hover % 899));
      tip.innerHTML =
        name +
        '<span class="tip-sub">' +
        MODULES[nd.mod].name +
        " &middot; " +
        nd.deg +
        " links</span>";
      tip.style.left = nd.sx + "px";
      tip.style.top = nd.sy + "px";
      tip.hidden = false;
    }

    // Pointer interaction, orbit on drag, trace on hover.
    function down(ev) {
      dragging = true;
      wrap.classList.add("dragging");
      var p = point(ev);
      lastX = p.x;
      lastY = p.y;
    }
    function move(ev) {
      var p = point(ev);
      pointer.x = p.x;
      pointer.y = p.y;
      pointer.inside = true;
      if (dragging) {
        rotY += (p.x - lastX) * 0.006;
        rotX += (p.y - lastY) * 0.006;
        rotX = Math.max(-1.2, Math.min(1.2, rotX));
        lastX = p.x;
        lastY = p.y;
      }
    }
    function up() {
      dragging = false;
      wrap.classList.remove("dragging");
    }
    function leave() {
      pointer.inside = false;
    }
    function point(ev) {
      var rect = canvas.getBoundingClientRect();
      var src = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
      return { x: src.clientX - rect.left, y: src.clientY - rect.top };
    }

    wrap.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    wrap.addEventListener("pointerleave", leave);
    window.addEventListener("resize", resize);

    // Legend + counters.
    var legend = document.getElementById("net-legend");
    if (legend) {
      legend.innerHTML = MODULES.map(function (mod) {
        var c = "rgb(" + mod.color[0] + "," + mod.color[1] + "," + mod.color[2] + ")";
        return (
          '<li><span class="lg-dot" style="background:' +
          c +
          ";color:" +
          c +
          '"></span>' +
          mod.name +
          "</li>"
        );
      }).join("");
    }
    setText("net-nodes", String(nodes.length));
    setText("net-edges", String(edges.length));

    resize();

    // Pause the loop when the figure scrolls out of view to spare the CPU.
    var raf = 0;
    var running = false;
    function start() {
      if (running) return;
      running = true;
      raf = window.requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      window.cancelAnimationFrame(raf);
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) start();
        else stop();
      }).observe(wrap);
    } else {
      start();
    }
  }

  // ----------------------------------------------------------------------- //
  // Figure 2. Dose response with a live predictor.                          //
  // ----------------------------------------------------------------------- //
  var HILL = { vmax: 100, k: 45, n: 2.2 };
  function hill(x) {
    var xn = Math.pow(x, HILL.n);
    return (HILL.vmax * xn) / (Math.pow(HILL.k, HILL.n) + xn);
  }
  var STRAINS = [
    { strain: "FKY-101", promoter: "pWeak1", strength: 8 },
    { strain: "FKY-118", promoter: "pWeak2", strength: 18 },
    { strain: "FKY-126", promoter: "pMod1", strength: 30 },
    { strain: "FKY-134", promoter: "pMod2", strength: 44 },
    { strain: "FKY-152", promoter: "pMod3", strength: 58 },
    { strain: "FKY-167", promoter: "pStrong1", strength: 72 },
    { strain: "FKY-181", promoter: "pStrong2", strength: 86 },
    { strain: "FKY-199", promoter: "pMax", strength: 95 },
  ];

  function svg(tag, attrs) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var key in attrs) el.setAttribute(key, attrs[key]);
    return el;
  }

  function initDose() {
    var mount = document.getElementById("dose-chart");
    if (!mount) return;
    var W = 640;
    var H = 360;
    var padL = 52;
    var padB = 44;
    var padT = 18;
    var padR = 18;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var maxY = 110;

    function X(x) {
      return padL + (x / 100) * plotW;
    }
    function Y(y) {
      return padT + plotH - (y / maxY) * plotH;
    }

    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });

    // Gridlines + y ticks.
    for (var gy = 0; gy <= 100; gy += 25) {
      s.appendChild(svg("line", { class: "grid", x1: padL, y1: Y(gy), x2: W - padR, y2: Y(gy) }));
      var ty = svg("text", { class: "tick-label", x: padL - 10, y: Y(gy) + 4, "text-anchor": "end" });
      ty.textContent = String(gy);
      s.appendChild(ty);
    }
    for (var gx = 0; gx <= 100; gx += 20) {
      var tx = svg("text", { class: "tick-label", x: X(gx), y: H - padB + 20, "text-anchor": "middle" });
      tx.textContent = String(gx);
      s.appendChild(tx);
    }

    // Axes.
    s.appendChild(svg("line", { class: "axis", x1: padL, y1: Y(0), x2: W - padR, y2: Y(0) }));
    s.appendChild(svg("line", { class: "axis", x1: padL, y1: padT, x2: padL, y2: Y(0) }));
    var axX = svg("text", { class: "axis-title", x: padL + plotW / 2, y: H - 8, "text-anchor": "middle" });
    axX.textContent = "promoter strength";
    s.appendChild(axX);
    var axY = svg("text", { class: "axis-title", x: 14, y: padT + plotH / 2, "text-anchor": "middle", transform: "rotate(-90 14 " + (padT + plotH / 2) + ")" });
    axY.textContent = "fakeGFP, AU";
    s.appendChild(axY);

    // Prediction band + fit line.
    var up = "";
    var dn = "";
    var line = "";
    for (var x = 0; x <= 100; x += 2) {
      var y = hill(x);
      up += (x === 0 ? "M" : "L") + X(x) + " " + Y(Math.min(maxY, y + 8));
      line += (x === 0 ? "M" : "L") + X(x) + " " + Y(y);
    }
    for (var xb = 100; xb >= 0; xb -= 2) {
      dn += "L" + X(xb) + " " + Y(Math.max(0, hill(xb) - 8));
    }
    s.appendChild(svg("path", { class: "fit-band", d: up + dn + "Z" }));
    s.appendChild(svg("path", { class: "fit-line draw", d: line }));

    // Measured points with a little scatter.
    var noise = [4, -3, 5, -4, 3, -5, 2, -2];
    STRAINS.forEach(function (st, i) {
      var py = Math.max(2, Math.min(maxY, hill(st.strength) + noise[i]));
      var c = svg("circle", { class: "pt", cx: X(st.strength), cy: Y(py), r: 5.5 });
      var title = svg("title", {});
      title.textContent = st.strain + ", " + Math.round(py) + " AU at strength " + st.strength;
      c.appendChild(title);
      s.appendChild(c);
    });

    // Live marker driven by the slider.
    var mLine = svg("line", { class: "marker-line", x1: X(50), y1: Y(0), x2: X(50), y2: Y(hill(50)) });
    var mDot = svg("circle", { class: "marker-dot", cx: X(50), cy: Y(hill(50)), r: 6 });
    s.appendChild(mLine);
    s.appendChild(mDot);
    mount.appendChild(s);

    var slider = document.getElementById("strength");
    var roX = document.querySelector("#strength-readout .ro-x");
    var roY = document.querySelector("#strength-readout .ro-y");
    function update() {
      var v = Number(slider.value);
      var y = hill(v);
      mLine.setAttribute("x1", X(v));
      mLine.setAttribute("x2", X(v));
      mLine.setAttribute("y2", Y(y));
      mDot.setAttribute("cx", X(v));
      mDot.setAttribute("cy", Y(y));
      if (roX) roX.textContent = String(v);
      if (roY) roY.textContent = String(Math.round(y));
    }
    if (slider) {
      slider.addEventListener("input", update);
      update();
    }
  }

  // ----------------------------------------------------------------------- //
  // Supporting interactions.                                                //
  // ----------------------------------------------------------------------- //
  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function initDataTable() {
    var body = document.getElementById("data-rows");
    if (!body) return;
    var noise = [4, -3, 5, -4, 3, -5, 2, -2];
    body.innerHTML = STRAINS.map(function (st, i) {
      var au = Math.round(Math.max(2, hill(st.strength) + noise[i]));
      return (
        "<tr><td class=\"strain\">" +
        st.strain +
        "</td><td>" +
        st.promoter +
        "</td><td>" +
        st.strength +
        "</td><td>" +
        au +
        "</td></tr>"
      );
    }).join("");
  }

  function initStats() {
    var stats = document.querySelectorAll(".stat");
    if (!stats.length) return;
    function run(el) {
      var target = Number(el.getAttribute("data-count"));
      var decimals = Number(el.getAttribute("data-decimals") || 0);
      var suffix = el.getAttribute("data-suffix") || "";
      var out = el.querySelector(".stat-value");
      if (reduceMotion) {
        out.textContent = target.toFixed(decimals) + suffix;
        return;
      }
      var start = null;
      var dur = 1100;
      function step(ts) {
        if (start === null) start = ts;
        var p = Math.min(1, (ts - start) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        out.textContent = (target * eased).toFixed(decimals) + suffix;
        if (p < 1) window.requestAnimationFrame(step);
      }
      window.requestAnimationFrame(step);
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            run(en.target);
            io.unobserve(en.target);
          }
        });
      }, { threshold: 0.5 });
      stats.forEach(function (st) {
        io.observe(st);
      });
    } else {
      stats.forEach(run);
    }
  }

  function initReveal() {
    var cards = document.querySelectorAll("main .card");
    if (!("IntersectionObserver" in window) || reduceMotion) return;
    cards.forEach(function (c) {
      c.classList.add("reveal");
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    cards.forEach(function (c) {
      io.observe(c);
    });
  }

  function initScrollSpy() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".nav-links a"));
    if (!links.length || !("IntersectionObserver" in window)) return;
    var map = {};
    links.forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      var sec = document.getElementById(id);
      if (sec) map[id] = a;
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          links.forEach(function (a) {
            a.classList.remove("is-active");
          });
          var active = map[en.target.id];
          if (active) active.classList.add("is-active");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    Object.keys(map).forEach(function (id) {
      io.observe(document.getElementById(id));
    });
  }

  function initCite() {
    var copy = document.getElementById("copy-cite");
    var text = document.getElementById("citation-text");
    if (copy && text) {
      copy.addEventListener("click", function () {
        var value = text.textContent.replace(/\s+/g, " ").trim();
        var done = function () {
          var prev = copy.textContent;
          copy.textContent = "Copied";
          window.setTimeout(function () {
            copy.textContent = prev;
          }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done, done);
        } else {
          done();
        }
      });
    }
    var toggle = document.getElementById("toggle-bibtex");
    var bib = document.getElementById("bibtex");
    if (toggle && bib) {
      toggle.addEventListener("click", function () {
        var open = !bib.hidden;
        bib.hidden = open;
        toggle.textContent = open ? "Show BibTeX" : "Hide BibTeX";
      });
    }
  }

  function boot() {
    initNetwork();
    initDose();
    initDataTable();
    initStats();
    initReveal();
    initScrollSpy();
    initCite();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
