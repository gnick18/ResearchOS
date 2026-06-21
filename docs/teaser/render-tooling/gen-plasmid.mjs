// Generates docs/teaser/scenes/sequences.html: an animated CIRCULAR PLASMID MAP
// (SeqViz Circular viewer look) that spins slowly, with colored annotated feature
// arcs + enzyme cut sites. Labels counter-rotate so they stay upright while the
// map turns. Output is pure static HTML/CSS (no JS) so the frame-stepped renderer
// can step it. Run: node gen-plasmid.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CX = 262, CY = 232, R = 118;       // plasmid center + backbone radius
const SPIN = 11;                          // seconds per full revolution (slow)
const SPIN_DELAY = 1.0;                   // assemble first, then spin

const rad = (d) => (d * Math.PI) / 180;
const px = (deg, r) => +(CX + r * Math.sin(rad(deg))).toFixed(2);
const py = (deg, r) => +(CY - r * Math.cos(rad(deg))).toFixed(2);

// Feature arcs: angles in degrees, 0 = top, clockwise. SeqViz feature colors.
const FEATURES = [
  { name: 'lacZα', color: '#a78bfa', a1: 16, a2: 80, gene: true, delay: 0.5 },
  { name: 'P_lac',     color: '#fbbf24', a1: 88, a2: 104, gene: false, delay: 0.7 },
  { name: 'ori',       color: '#818cf8', a1: 112, a2: 162, gene: false, delay: 0.9 },
  { name: 'AmpR',      color: '#34d399', a1: 196, a2: 312, gene: true, delay: 1.1 },
];

// Enzyme single-cutter sites: angle + bp label. Spread for clean labels.
const ENZYMES = [
  { name: 'EcoRI', bp: 396, ang: 6, delay: 1.45 },
  { name: 'BamHI', bp: 375, ang: 67, delay: 1.55 },
  { name: 'HindIII', bp: 447, ang: 178, delay: 1.65 },
  { name: 'PstI', bp: 1186, ang: 326, delay: 1.75 },
];

function arcPath(a1, a2, r) {
  const large = a2 - a1 > 180 ? 1 : 0;
  return `M ${px(a1, r)} ${py(a1, r)} A ${r} ${r} 0 ${large} 1 ${px(a2, r)} ${py(a2, r)}`;
}
function arcLen(a1, a2, r) { return Math.ceil(r * rad(a2 - a1)) + 2; }

// Gene arrowhead: a small chevron at the clockwise end of the arc, pointing forward.
function arrowhead(a2, r) {
  const tip = `${px(a2 + 4, r)},${py(a2 + 4, r)}`;
  const b1 = `${px(a2, r + 7)},${py(a2, r + 7)}`;
  const b2 = `${px(a2, r - 7)},${py(a2, r - 7)}`;
  return `${tip} ${b1} ${b2}`;
}

// Minor ruler ticks every 30 deg on the backbone.
let minorTicks = '';
for (let d = 0; d < 360; d += 30) {
  minorTicks += `<line x1="${px(d, R - 6)}" y1="${py(d, R - 6)}" x2="${px(d, R + 6)}" y2="${py(d, R + 6)}" stroke="#c7d2e3" stroke-width="1.4"/>`;
}

// Feature arcs + gene arrowheads + inside labels.
let featureArcs = '', featureArrows = '', featureLabels = '';
FEATURES.forEach((f, i) => {
  const L = arcLen(f.a1, f.a2, R);
  featureArcs += `<path class="feat f${i}" d="${arcPath(f.a1, f.a2, R)}" stroke="${f.color}" style="stroke-dasharray:${L};stroke-dashoffset:${L};animation-delay:${f.delay}s"/>`;
  if (f.gene) {
    featureArrows += `<polygon class="arrow ar${i}" points="${arrowhead(f.a2, R)}" fill="${f.color}" style="animation-delay:${(f.delay + 0.45).toFixed(2)}s"/>`;
  }
  const mid = (f.a1 + f.a2) / 2;
  const lx = px(mid, R - 22), ly = py(mid, R - 22);
  featureLabels += `<g class="lbl flab" style="animation-delay:${(f.delay + 0.9).toFixed(2)}s"><text x="${lx}" y="${ly}" fill="${f.color}" text-anchor="middle" dominant-baseline="middle">${f.name}</text></g>`;
});

// Enzyme cut ticks (cross the backbone) + outside two-line labels.
let enzTicks = '', enzLabels = '';
ENZYMES.forEach((e, i) => {
  enzTicks += `<line class="cut c${i}" x1="${px(e.ang, R - 11)}" y1="${py(e.ang, R - 11)}" x2="${px(e.ang, R + 11)}" y2="${py(e.ang, R + 11)}" style="animation-delay:${e.delay}s"/>`;
  const nx = px(e.ang, R + 26), ny = py(e.ang, R + 26);
  enzLabels += `<g class="lbl elab" style="animation-delay:${(e.delay + 0.15).toFixed(2)}s">`
    + `<text class="ename" x="${nx}" y="${ny - 4}" text-anchor="middle" dominant-baseline="middle">${e.name}</text>`
    + `<text class="ebp" x="${nx}" y="${ny + 9}" text-anchor="middle" dominant-baseline="middle">${e.bp}</text>`
    + `</g>`;
});

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Scene: Sequences (plasmid map)</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%}
  body{background:#eef2f9;color:#15243b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .scene{width:820px;max-width:94vw;transform-origin:center;animation:push 1.0s cubic-bezier(.4,0,.2,1) 2.9s forwards}
  .card{background:#fff;border:1px solid #e2e8f3;border-radius:20px;box-shadow:0 24px 60px rgba(20,40,80,.10);overflow:hidden}
  .hd{display:flex;align-items:center;gap:12px;padding:16px 22px;border-bottom:1px solid #eef1f7}
  .hd-icon{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#1aa0e6 0%,#7f77dd 100%);display:flex;align-items:center;justify-content:center}
  .hd b{font-size:17px;font-weight:600}.hd .sub{font-size:13px;color:#7a869b}
  .hd-right{margin-left:auto}
  .badge{font-size:11px;font-weight:600;color:#1283c9;background:#e6f1fb;padding:3px 10px;border-radius:999px}
  .body{padding:6px 22px 14px;display:flex;justify-content:center}
  svg.map{width:520px;height:464px;display:block}

  /* Backbone + ticks + spin */
  .spin{transform-box:view-box;transform-origin:${CX}px ${CY}px;animation:spin ${SPIN}s linear ${SPIN_DELAY}s infinite}
  .ring{fill:none;stroke:#b8c2d4;stroke-width:2.4;opacity:0;animation:fade .5s ease .1s forwards}
  .ring2{fill:none;stroke:#dde4f0;stroke-width:1.2;opacity:0;animation:fade .5s ease .15s forwards}
  .minor{opacity:0;animation:fade .5s ease .3s forwards}
  .feat{fill:none;stroke-width:13;stroke-linecap:butt;animation:draw .55s ease forwards}
  .arrow{opacity:0;animation:fade .25s ease forwards}
  .cut{stroke:#15243b;stroke-width:2;stroke-linecap:round;opacity:0;animation:fade .3s ease forwards}

  /* Labels counter-rotate so they stay upright while the map spins */
  .lbl{opacity:0;animation:fade .35s ease forwards}
  .lbl text{transform-box:fill-box;transform-origin:center;animation:spinrev ${SPIN}s linear ${SPIN_DELAY}s infinite}
  .flab text{font-size:13px;font-weight:700}
  .elab .ename{font-size:12.5px;font-weight:700;fill:#15243b}
  .elab .ebp{font-size:10px;font-weight:600;fill:#7a869b}

  /* Center label (does not spin) */
  .center-name{font-size:21px;font-weight:700;fill:#15243b;opacity:0;animation:fade .5s ease .7s forwards}
  .center-bp{font-size:13px;font-weight:600;fill:#7a869b;opacity:0;animation:fade .5s ease .8s forwards}

  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes spinrev{to{transform:rotate(-360deg)}}
  @keyframes draw{to{stroke-dashoffset:0}}
  @keyframes fade{to{opacity:1}}
  @keyframes push{to{transform:scale(1.04)}}
</style>
</head>
<body>
<div class="scene">
  <div class="card">
    <div class="hd">
      <div class="hd-icon">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="6.2" stroke="#fff" stroke-width="1.6" opacity=".95"/>
          <circle cx="9" cy="2.8" r="1.5" fill="#fff"/>
          <circle cx="14.6" cy="11.2" r="1.3" fill="#fff" opacity=".9"/>
          <circle cx="4" cy="12.4" r="1.1" fill="#fff" opacity=".85"/>
        </svg>
      </div>
      <div><b>Sequences</b><div class="sub">pUC19, cloning vector</div></div>
      <div class="hd-right"><span class="badge">2686 bp</span></div>
    </div>
    <div class="body">
      <svg class="map" viewBox="0 0 524 464" aria-label="pUC19 circular plasmid map">
        <g class="spin">
          <circle class="ring" cx="${CX}" cy="${CY}" r="${R}"/>
          <circle class="ring2" cx="${CX}" cy="${CY}" r="${R - 9}"/>
          <g class="minor">${minorTicks}</g>
          ${featureArcs}
          ${featureArrows}
          ${enzTicks}
          ${featureLabels}
          ${enzLabels}
        </g>
        <text class="center-name" x="${CX}" y="${CY - 4}" text-anchor="middle" dominant-baseline="middle">pUC19</text>
        <text class="center-bp" x="${CX}" y="${CY + 16}" text-anchor="middle" dominant-baseline="middle">2686 bp</text>
      </svg>
    </div>
  </div>
</div>
</body>
</html>
`;

const out = resolve(process.cwd(), '../scenes/sequences.html');
writeFileSync(out, html);
console.log('Wrote', out);
