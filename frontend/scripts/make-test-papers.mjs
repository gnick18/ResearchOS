// Generates controlled test "papers" (PDF) for verifying the BeakerBot PDF
// figure picker + Output 4 figure-style match (BeakerAI lane, 2026-06-14).
//
// Each paper places its tree figure(s) deliberately so the picker's edge cases
// are exercised: figure at the TOP, figure at the BOTTOM of a two-column page,
// and TWO figures on ONE page (so cropping the RIGHT one matters). The figures
// are real publication-style tree SVGs with distinct, readable styles (layout,
// colored clades, italic tips, support values, an aligned track) so the vision
// model has genuine style to match.
//
// Run from frontend/: node scripts/make-test-papers.mjs
// Output: ~/Desktop/ros-test-papers/*.pdf  (outside the repo, never committed).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const OUT_DIR = join(homedir(), "Desktop", "ros-test-papers");

// ---- tiny tree layout (nested {name,length,children}) -----------------------

function layout(node, opts, state = { leaf: 0 }) {
  // Assign x (cumulative length for phylogram, depth for cladogram) and y.
  const walk = (n, x0, depth) => {
    const x = opts.cladogram ? depth : x0 + (n.length ?? 0);
    if (!n.children || n.children.length === 0) {
      const y = state.leaf++;
      return { ...n, x, y, _y: y };
    }
    const kids = n.children.map((c) => walk(c, x, depth + 1));
    const y = (kids[0].y + kids[kids.length - 1].y) / 2;
    return { ...n, x, y, children: kids };
  };
  const root = walk(node, 0, 0);
  // Normalize x to [0,1] and y to leaf index range.
  let maxX = 0;
  const findMax = (n) => {
    maxX = Math.max(maxX, n.x);
    (n.children ?? []).forEach(findMax);
  };
  findMax(root);
  const leaves = state.leaf;
  const norm = (n) => ({
    ...n,
    nx: maxX ? n.x / maxX : 0,
    ny: leaves > 1 ? n.y / (leaves - 1) : 0.5,
    children: (n.children ?? []).map(norm),
  });
  return { root: norm(root), leaves };
}

const SAMPLE = {
  children: [
    {
      length: 1,
      support: 98,
      children: [
        { name: "Aspergillus fumigatus", length: 2, clade: 0 },
        { name: "Aspergillus niger", length: 1.7, clade: 0 },
      ],
    },
    {
      length: 0.8,
      support: 87,
      children: [
        {
          length: 1.2,
          support: 76,
          children: [
            { name: "Penicillium chrysogenum", length: 1.5, clade: 1 },
            { name: "Penicillium expansum", length: 1.6, clade: 1 },
          ],
        },
        { name: "Talaromyces marneffei", length: 2.4, clade: 2 },
      ],
    },
    { name: "Saccharomyces cerevisiae", length: 3.1, clade: 3 },
  ],
};

const CLADE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#9333ea"];

// ---- renderers (return an <svg> string) -------------------------------------

function rectPhylogram({ cladogram = false, italic = true, support = true, track = false, monochrome = false } = {}) {
  const W = track ? 520 : 460;
  const H = 300;
  const padL = 16,
    padR = track ? 200 : 170,
    padT = 18,
    padB = 18;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const { root } = layout(SAMPLE, { cladogram });
  const px = (n) => padL + n.nx * plotW;
  const py = (n) => padT + n.ny * plotH;
  const lines = [];
  const labels = [];
  const supports = [];
  const tips = [];
  const trackCells = [];

  const draw = (n) => {
    if (n.children && n.children.length) {
      const ys = n.children.map(py);
      lines.push(
        `<line x1="${px(n).toFixed(1)}" y1="${Math.min(...ys).toFixed(1)}" x2="${px(n).toFixed(1)}" y2="${Math.max(...ys).toFixed(1)}" stroke="#111827" stroke-width="1.6"/>`,
      );
      n.children.forEach((c) => {
        lines.push(
          `<line x1="${px(n).toFixed(1)}" y1="${py(c).toFixed(1)}" x2="${px(c).toFixed(1)}" y2="${py(c).toFixed(1)}" stroke="#111827" stroke-width="1.6"/>`,
        );
        draw(c);
      });
      if (support && n.support) {
        supports.push(
          `<text x="${(px(n) - 4).toFixed(1)}" y="${(py(n) - 3).toFixed(1)}" font-size="9" fill="#6b7280" text-anchor="end">${n.support}</text>`,
        );
      }
    } else {
      const color = monochrome ? "#111827" : CLADE_COLORS[n.clade ?? 0];
      tips.push(`<circle cx="${px(n).toFixed(1)}" cy="${py(n).toFixed(1)}" r="2.6" fill="${color}"/>`);
      labels.push(
        `<text x="${(px(n) + 6).toFixed(1)}" y="${(py(n) + 3.5).toFixed(1)}" font-size="11" fill="${color}" font-style="${italic ? "italic" : "normal"}">${n.name}</text>`,
      );
      if (track) {
        const baseX = W - padR + 120;
        for (let c = 0; c < 3; c++) {
          const v = [0.25, 0.6, 0.9][(((n.clade ?? 0) + c) % 3)];
          trackCells.push(
            `<rect x="${baseX + c * 16}" y="${(py(n) - 6).toFixed(1)}" width="13" height="12" fill="rgba(37,99,235,${v})" stroke="#e5e7eb"/>`,
          );
        }
      }
    }
  };
  draw(root);

  const trackHead = track
    ? `<text x="${W - padR + 120}" y="12" font-size="8" fill="#6b7280">expr A B C</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="white"/>
    ${lines.join("\n")}
    ${supports.join("\n")}
    ${tips.join("\n")}
    ${labels.join("\n")}
    ${trackCells.join("\n")}
    ${trackHead}
  </svg>`;
}

function circularPhylogram() {
  const S = 320;
  const cx = S / 2,
    cy = S / 2;
  const rOuter = 120;
  const { root, leaves } = layout(SAMPLE, {});
  const lines = [];
  const labels = [];
  const ring = [];
  const angleFor = (ny) => -Math.PI / 2 + ny * 1.9 * Math.PI; // leave a gap
  const radFor = (nx) => 24 + nx * (rOuter - 24);
  const pt = (n) => {
    const a = angleFor(n.ny);
    const r = radFor(n.nx);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const draw = (n) => {
    if (n.children && n.children.length) {
      // radial arc connecting children at the parent radius
      const r = radFor(n.nx);
      const a0 = angleFor(Math.min(...n.children.map((c) => c.ny)));
      const a1 = angleFor(Math.max(...n.children.map((c) => c.ny)));
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0),
        y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1),
        y1 = cy + r * Math.sin(a1);
      ring.push(
        `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="#111827" stroke-width="1.4"/>`,
      );
      n.children.forEach((c) => {
        const a = angleFor(c.ny);
        const rc = radFor(c.nx);
        lines.push(
          `<line x1="${(cx + r * Math.cos(a)).toFixed(1)}" y1="${(cy + r * Math.sin(a)).toFixed(1)}" x2="${(cx + rc * Math.cos(a)).toFixed(1)}" y2="${(cy + rc * Math.sin(a)).toFixed(1)}" stroke="#111827" stroke-width="1.4"/>`,
        );
        draw(c);
      });
    } else {
      const [x, y] = pt(n);
      const a = angleFor(n.ny);
      const color = CLADE_COLORS[n.clade ?? 0];
      // outer clade ring segment
      const rr = rOuter + 6;
      ring.push(
        `<circle cx="${(cx + rr * Math.cos(a)).toFixed(1)}" cy="${(cy + rr * Math.sin(a)).toFixed(1)}" r="5" fill="${color}"/>`,
      );
      const deg = (a * 180) / Math.PI;
      const lx = cx + (rOuter + 16) * Math.cos(a);
      const ly = cy + (rOuter + 16) * Math.sin(a);
      const flip = Math.cos(a) < 0;
      labels.push(
        `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="9" fill="${color}" font-style="italic" text-anchor="${flip ? "end" : "start"}" transform="rotate(${(deg + (flip ? 180 : 0)).toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})">${n.name}</text>`,
      );
    }
  };
  draw(root);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
    <rect width="${S}" height="${S}" fill="white"/>
    ${ring.join("\n")}
    ${lines.join("\n")}
    ${labels.join("\n")}
  </svg>`;
}

// ---- paper HTML shells ------------------------------------------------------

const METHODS = `Total genomic DNA was extracted and the ITS and beta-tubulin loci were amplified.
Sequences were aligned with MAFFT v7.490 under the L-INS-i strategy, and ambiguously aligned
regions were trimmed with trimAl v1.4 (gappyout). Maximum-likelihood phylogenies were inferred
in IQ-TREE 2 (v2.2.0) under the GTR+G substitution model selected by ModelFinder, with 1000
ultrafast bootstrap replicates. Trees were rooted on Saccharomyces cerevisiae. Nodes with
ultrafast bootstrap support below 70 were considered unsupported.`;

const ABSTRACT = `We reconstruct the phylogenetic relationships among representative Eurotiomycete
fungi using a multilocus dataset. Our analyses recover well-supported clades corresponding to the
Aspergillus and Penicillium lineages and clarify the placement of Talaromyces.`;

function paperShell({ title, body }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: letter; margin: 0.9in; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; font-size: 11pt; line-height: 1.5; }
    h1 { font-size: 16pt; margin: 0 0 4pt; }
    .auth { color: #444; font-size: 10pt; margin-bottom: 14pt; }
    h2 { font-size: 12pt; margin: 14pt 0 4pt; }
    .twocol { column-count: 2; column-gap: 26px; }
    .fig { break-inside: avoid; text-align: center; margin: 12pt 0; }
    .fig .cap { font-size: 9pt; color: #333; margin-top: 4pt; text-align: left; }
    .fig.span { column-span: all; }
    .row { display: flex; gap: 18px; align-items: flex-start; }
    .row .fig { flex: 1; }
    .spacer { height: 320px; }
  </style></head><body>${body}</body></html>`;
}

const PAPERS = [
  {
    file: "paperA-figure-top-singlecol.pdf",
    html: paperShell({
      body: `
        <h1>A multilocus phylogeny of Eurotiomycete fungi</h1>
        <div class="auth">Test Author et al. (synthetic test paper A)</div>
        <div class="fig">
          ${rectPhylogram({ italic: true, support: true })}
          <div class="cap"><b>Figure 1.</b> ML phylogram (IQ-TREE, GTR+G). Italic tip labels colored by clade; ultrafast bootstrap support at nodes.</div>
        </div>
        <h2>Abstract</h2><p>${ABSTRACT}</p>
        <h2>Methods</h2><p>${METHODS}</p>`,
    }),
  },
  {
    file: "paperB-figure-bottom-twocol.pdf",
    html: paperShell({
      body: `
        <h1>Circular phylogeny with clade annotation</h1>
        <div class="auth">Test Author et al. (synthetic test paper B)</div>
        <div class="twocol">
          <h2>Introduction</h2><p>${ABSTRACT} ${ABSTRACT}</p>
          <h2>Methods</h2><p>${METHODS}</p>
          <p>${ABSTRACT}</p>
          <div class="fig span" style="margin-top:24pt">
            ${circularPhylogram()}
            <div class="cap"><b>Figure 2.</b> Circular ML phylogram with an outer ring colored by clade; italic tip labels.</div>
          </div>
        </div>`,
    }),
  },
  {
    file: "paperC-two-figures-one-page.pdf",
    html: paperShell({
      body: `
        <h1>Comparison of tree styles</h1>
        <div class="auth">Test Author et al. (synthetic test paper C)</div>
        <p>This page carries two figures side by side, so the picker crop must isolate the intended one.</p>
        <div class="row">
          <div class="fig">
            ${rectPhylogram({ cladogram: true, italic: false, support: false, monochrome: true })}
            <div class="cap"><b>Figure 3.</b> Cladogram (uniform depths), non-italic bold-ish black tip labels, no support values.</div>
          </div>
          <div class="fig">
            ${rectPhylogram({ italic: true, support: true, track: true })}
            <div class="cap"><b>Figure 4.</b> Phylogram with an aligned 3-column expression heatmap track; italic colored tips.</div>
          </div>
        </div>`,
    }),
  },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const p of PAPERS) {
    await page.setContent(p.html, { waitUntil: "networkidle" });
    const out = join(OUT_DIR, p.file);
    await page.pdf({ path: out, printBackground: true, format: "Letter" });
    console.log("wrote", out);
  }
  await browser.close();
  // A small index so the tester knows what each file is for.
  await writeFile(
    join(OUT_DIR, "README.txt"),
    [
      "ResearchOS BeakerBot PDF figure-picker test papers (synthetic).",
      "",
      "paperA-figure-top-singlecol.pdf  - Figure 1 at the TOP of page 1, single column.",
      "  Rectangular phylogram, ITALIC colored tip labels, bootstrap support at nodes.",
      "  Also a real Methods section (MAFFT, trimAl, IQ-TREE GTR+G, 1000 UFboot) for Outputs 1/2/3.",
      "",
      "paperB-figure-bottom-twocol.pdf  - TWO-COLUMN paper; Figure 2 spans the width and flows",
      "  onto PAGE 2 (tests multi-page thumbnail nav). CIRCULAR phylogram, clade-colored tips, italic labels.",
      "",
      "paperC-two-figures-one-page.pdf  - TWO figures on ONE page, side by side.",
      "  Figure 3 (left)  = cladogram, non-italic black tips, no support.",
      "  Figure 4 (right) = phylogram with an aligned 3-column heatmap track, italic colored tips.",
      "  Use this to test cropping the RIGHT figure when two share a page.",
    ].join("\n"),
    "utf8",
  );
  console.log("\nDone. Files in:", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
