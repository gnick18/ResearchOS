// frontend/src/lib/export/bake-embeds.ts
//
// Phase 5: export baking. Resolves every block-embed reference in a markdown
// document into a self-contained, PDF-ready representation BEFORE the PDF
// renderer walks the AST. The PDF renderer can then look up a baked result by
// href and emit a real figure/table/card instead of a bare link.
//
// This module is intentionally PURE-ISH: it calls the same async data loaders
// the live ObjectEmbed renderer calls (moleculesApi.get, dataHubApi.getContent,
// etc.) and delegates to the same pure geometry/text functions (renderPlot,
// resultToText, plainLanguageSummary). It never touches React or the DOM
// except through the guarded svgToPngDataUrl helper, which falls back
// gracefully when a real canvas is unavailable (CI, jsdom, non-browser).
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { parseObjectEmbed } from "@/lib/references";
import type { EmbedDescriptor } from "@/lib/references";
import {
  buildFigureNumberPlan,
  type FigureNumberPlan,
} from "@/lib/embeds/figure-numbering";
import { moleculesApi } from "@/lib/chemistry/api";
import { renderSvg as renderMoleculeSvg } from "@/lib/chemistry/rdkit";
import { dataHubApi } from "@/lib/datahub/api";
import {
  renderPlot,
  readPlotSource,
} from "@/lib/datahub/plot-spec";
import { resultToText } from "@/lib/datahub/result-text";
import { plainLanguageSummary } from "@/lib/datahub/plain-language";
import type { NormalizedResult } from "@/lib/datahub/run-analysis";
import { phyloApi } from "@/lib/phylo/api";
import { parseTree } from "@/lib/phylo/parse";
import { renderTreeSvg } from "@/lib/phylo/render";
import {
  figureToRenderSpec,
  figureInputsFromStored,
} from "@/lib/phylo/figure-to-render";
import {
  sequencesApi,
  notesApi,
  methodsApi,
  projectsApi,
  tasksApi,
} from "@/lib/local-api";

// ── Public types ─────────────────────────────────────────────────────────────

/** A typed error thrown by svgToPngDataUrl when a real HTMLCanvasElement is
 *  not available. The baker catches this and downgrades the embed. */
export class CanvasUnavailableError extends Error {
  constructor() {
    super("HTMLCanvasElement unavailable (non-browser environment)");
    this.name = "CanvasUnavailableError";
  }
}

/**
 * The baked representation of one object embed, keyed by its original href.
 * Each variant carries all the data the PDF renderer needs, including an
 * optional figure/table label when the document opted in with
 * `<!-- ros:number-figures -->`.
 */
export type BakedEmbed =
  | {
      kind: "image";
      /** A data: URI (PNG) that @react-pdf/renderer's Image can consume. */
      dataUrl: string;
      width: number;
      height: number;
      caption: string;
      label: string | null;
    }
  | {
      kind: "table";
      columns: string[];
      rows: string[][];
      caption: string;
      label: string | null;
    }
  | {
      kind: "text";
      body: string;
      caption: string;
      label: string | null;
    }
  | {
      kind: "card";
      title: string;
      subtitle: string;
      meta: string[];
      caption: string;
      label: string | null;
    }
  | {
      kind: "missing";
      /** The caption / display name from the markdown link text. */
      name: string;
      label: string | null;
    };

/** One resolved embed reference, in document order. */
export interface ScanResult {
  href: string;
  caption: string;
  descriptor: EmbedDescriptor;
}

// ── Scan ─────────────────────────────────────────────────────────────────────

/**
 * Scan a markdown string for block-embed paragraphs: lines whose only
 * content is a single object-embed link (`[caption](<href>)` where
 * `parseObjectEmbed(href).isEmbed` is true).
 *
 * Mirrors the same lone-link detection used by RenderedMarkdown and the
 * live editor. Returns results in document order.
 */
export function scanEmbedRefs(markdown: string): ScanResult[] {
  if (!markdown) return [];
  const results: ScanResult[] = [];
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    // Match exactly `[any text](href)` with nothing else on the line.
    const m = /^\[([^\]]*)\]\((\S+)\)$/.exec(line);
    if (!m) continue;
    const caption = m[1];
    const href = m[2];
    const descriptor = parseObjectEmbed(href);
    if (!descriptor || !descriptor.isEmbed) continue;
    results.push({ href, caption, descriptor });
  }
  return results;
}

// ── SVG rasteriser ───────────────────────────────────────────────────────────

/**
 * Rasterize an SVG string to a PNG data URL via an offscreen canvas at
 * approximately 2x pixel density. The scale factor is applied to the SVG's
 * natural width/height, so the resulting PNG is hi-res enough for PDF.
 *
 * Guard: only runs where `document` and `HTMLCanvasElement` exist. Outside a
 * real browser context, throws `CanvasUnavailableError` so the caller can
 * degrade gracefully without propagating to the user.
 *
 * @param svg      - A complete SVG document string with width/height attributes.
 * @param scalePx  - Optional output width in px. When omitted the SVG's own
 *                   width/height are used at 2x. When provided it drives the
 *                   canvas size and the SVG is scaled accordingly.
 */
export async function svgToPngDataUrl(
  svg: string,
  scalePx?: number,
): Promise<string> {
  if (
    typeof document === "undefined" ||
    typeof HTMLCanvasElement === "undefined"
  ) {
    throw new CanvasUnavailableError();
  }

  // Extract the natural width/height from the SVG's root attributes so we can
  // set up the canvas at the right aspect ratio.
  const widthMatch = /\bwidth="?(\d+(?:\.\d+)?)"?/.exec(svg);
  const heightMatch = /\bheight="?(\d+(?:\.\d+)?)"?/.exec(svg);
  const naturalW = widthMatch ? parseFloat(widthMatch[1]) : 300;
  const naturalH = heightMatch ? parseFloat(heightMatch[1]) : 200;

  const scale = scalePx ? scalePx / naturalW : 2;
  const canvasW = Math.round(naturalW * scale);
  const canvasH = Math.round(naturalH * scale);

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) throw new CanvasUnavailableError();
    ctx2d.drawImage(img, 0, 0, canvasW, canvasH);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Per-type bakers ───────────────────────────────────────────────────────────

/** Bake a molecule embed. Loads the molecule, renders the 2D depiction via
 *  RDKit.js, rasterizes to PNG. Falls back to a card when RDKit fails or
 *  the canvas is unavailable. */
async function bakeMolecule(
  descriptor: EmbedDescriptor,
  caption: string,
  label: string | null,
): Promise<BakedEmbed> {
  try {
    const detail = await moleculesApi.get(descriptor.id);
    if (!detail) {
      return { kind: "missing", name: caption || descriptor.id, label };
    }
    const meta = detail.meta;
    const structure = meta.smiles ?? detail.molfile ?? "";
    if (!structure) {
      // No renderable structure, fall back to card.
      const meta2 = meta;
      const facts: string[] = [];
      if (meta2.formula) facts.push(meta2.formula);
      if (meta2.mol_weight != null)
        facts.push(`${meta2.mol_weight.toFixed(2)} g/mol`);
      return {
        kind: "card",
        title: caption || meta2.name,
        subtitle: "Molecule",
        meta: facts,
        caption,
        label,
      };
    }
    const W = 260;
    const H = 200;
    const svg = await renderMoleculeSvg(structure, W, H);
    if (!svg) {
      return {
        kind: "card",
        title: caption || meta.name,
        subtitle: "Molecule",
        meta: [meta.formula ?? "", meta.mol_weight != null ? `${meta.mol_weight.toFixed(2)} g/mol` : ""].filter(Boolean),
        caption,
        label,
      };
    }
    const dataUrl = await svgToPngDataUrl(svg, 520);
    return { kind: "image", dataUrl, width: 520, height: Math.round(520 * (H / W)), caption, label };
  } catch (err) {
    if (err instanceof CanvasUnavailableError) {
      // Best-effort card fallback when no real canvas is available.
      return {
        kind: "card",
        title: caption || descriptor.id,
        subtitle: "Molecule",
        meta: [],
        caption,
        label,
      };
    }
    // Load failure degrades to missing.
    return { kind: "missing", name: caption || descriptor.id, label };
  }
}

/** Bake a phylogenetic tree embed into a figure image, reusing the same renderer
 *  + shared adapter the live embed and the Studio use (one mapping). A tree that
 *  is gone degrades to missing; a parse / canvas failure degrades to a card. */
async function bakePhylo(
  descriptor: EmbedDescriptor,
  caption: string,
  label: string | null,
): Promise<BakedEmbed> {
  try {
    const raw = await phyloApi.get(descriptor.id);
    if (!raw) {
      return { kind: "missing", name: caption || descriptor.id, label };
    }
    const W = 460;
    const H = 320;
    let svg = "";
    try {
      const tree = parseTree(raw.tree);
      const inputs = figureInputsFromStored(raw.meta.figure, raw.meta.metadata);
      svg = renderTreeSvg(tree, figureToRenderSpec(tree, inputs, { width: W, height: H }));
    } catch {
      svg = "";
    }
    if (!svg) {
      return {
        kind: "card",
        title: caption || raw.meta.name,
        subtitle: "Phylogenetic tree",
        meta: raw.meta.tip_count != null ? [`${raw.meta.tip_count} tips`] : [],
        caption,
        label,
      };
    }
    const dataUrl = await svgToPngDataUrl(svg, 600);
    const outW = 600;
    const outH = Math.round(600 * (H / W));
    return { kind: "image", dataUrl, width: outW, height: outH, caption, label };
  } catch (err) {
    if (err instanceof CanvasUnavailableError) {
      return {
        kind: "card",
        title: caption || descriptor.id,
        subtitle: "Phylogenetic tree",
        meta: [],
        caption,
        label,
      };
    }
    return { kind: "missing", name: caption || descriptor.id, label };
  }
}

/** Bake a Data Hub embed. Dispatches on view: plot -> image, table/summary ->
 *  table, result -> text. Falls back to card or missing on failure. */
async function bakeDataHub(
  descriptor: EmbedDescriptor,
  caption: string,
  label: string | null,
): Promise<BakedEmbed> {
  try {
    const content = await dataHubApi.getContent(descriptor.id);
    if (!content) {
      return { kind: "missing", name: caption || descriptor.id, label };
    }
    const docName = content.meta.name;

    // Plot view
    if (descriptor.view === "plot") {
      const plots = content.plots;
      const wantedId = descriptor.opts.plot;
      const plot = (wantedId ? plots.find((p) => p.id === wantedId) : null) ?? plots[0];
      if (!plot) {
        return {
          kind: "card",
          title: caption || docName,
          subtitle: "Data Hub",
          meta: [],
          caption,
          label,
        };
      }
      const analysisId = readPlotSource(plot).analysisId;
      const analysis = analysisId
        ? content.analyses.find((a) => a.id === analysisId) ?? null
        : null;
      let svg = "";
      try {
        svg = renderPlot(plot, content, analysis).svg;
      } catch {
        svg = "";
      }
      if (!svg) {
        return {
          kind: "card",
          title: caption || plot.name || docName,
          subtitle: "Data Hub plot",
          meta: [],
          caption,
          label,
        };
      }
      try {
        const dataUrl = await svgToPngDataUrl(svg, 600);
        // Extract natural dimensions from the SVG.
        const wm = /\bwidth="?(\d+(?:\.\d+)?)"?/.exec(svg);
        const hm = /\bheight="?(\d+(?:\.\d+)?)"?/.exec(svg);
        const nW = wm ? parseFloat(wm[1]) : 400;
        const nH = hm ? parseFloat(hm[1]) : 300;
        const outW = 600;
        const outH = Math.round(600 * (nH / nW));
        return { kind: "image", dataUrl, width: outW, height: outH, caption, label };
      } catch (err) {
        if (err instanceof CanvasUnavailableError) {
          return {
            kind: "card",
            title: caption || plot.name || docName,
            subtitle: "Data Hub plot",
            meta: [],
            caption,
            label,
          };
        }
        throw err;
      }
    }

    // Result view
    if (descriptor.view === "result") {
      const analysisId = descriptor.opts.analysis;
      const analysis = analysisId
        ? content.analyses.find((a) => a.id === analysisId)
        : content.analyses[0];
      const cache = analysis?.resultCache as
        | ({ ok?: boolean; kind?: string } | null)
        | undefined;
      if (!analysis || !cache || cache.ok === false || !cache.kind) {
        return {
          kind: "card",
          title: caption || docName,
          subtitle: "Data Hub result",
          meta: [],
          caption,
          label,
        };
      }
      let body = "";
      try {
        const verdict = plainLanguageSummary(cache as NormalizedResult);
        const table = resultToText(cache as NormalizedResult)
          .split("\n")
          .slice(2)
          .join("\n");
        body = table.trim() ? `${verdict}\n\n${table}` : verdict;
      } catch {
        body = "";
      }
      if (!body) {
        return {
          kind: "card",
          title: caption || analysis.name || docName,
          subtitle: "Data Hub result",
          meta: [],
          caption,
          label,
        };
      }
      return {
        kind: "text",
        body,
        caption,
        label,
      };
    }

    // Table / summary view (and default)
    if (descriptor.view === "table" || descriptor.view === "summary") {
      const maxCols = descriptor.opts.cols ?? 6;
      const maxRows = descriptor.opts.rows ?? 20;
      const showCols = content.columns.slice(0, maxCols);
      const showRows = content.rows.slice(0, maxRows);
      const columns = showCols.map((c) => c.name);
      const rows = showRows.map((r) =>
        showCols.map((c) => {
          const v = r.cells[c.id];
          return v == null ? "" : String(v);
        }),
      );
      return { kind: "table", columns, rows, caption, label };
    }

    // Unknown view
    return {
      kind: "card",
      title: caption || docName,
      subtitle: "Data Hub",
      meta: [],
      caption,
      label,
    };
  } catch {
    return { kind: "missing", name: caption || descriptor.id, label };
  }
}

/** Bake a sequence embed. The live renderer draws an inline SVG ribbon. We
 *  reproduce the same SVG string server-side and rasterize it, or fall back to
 *  a card (name, length, organism, feature count) if the canvas is unavailable.
 *  This keeps the fallback honest and avoids fragile DOM rasterization. */
async function bakeSequence(
  descriptor: EmbedDescriptor,
  caption: string,
  label: string | null,
): Promise<BakedEmbed> {
  try {
    const id = Number(descriptor.id);
    if (!Number.isFinite(id)) {
      return { kind: "missing", name: caption || descriptor.id, label };
    }
    const detail = await sequencesApi.get(id);
    if (!detail) {
      return { kind: "missing", name: caption || descriptor.id, label };
    }
    const d = detail;
    const length = d.length || d.seq.length || 1;
    const unit = String(d.seq_type).toLowerCase().includes("protein") ? "aa" : "bp";
    const title = caption || d.display_name;
    const facts: string[] = [
      `${length.toLocaleString()} ${unit}`,
      d.circular ? "Circular" : "Linear",
      `${d.feature_count} ${d.feature_count === 1 ? "feature" : "features"}`,
    ];
    if (d.organism) facts.push(d.organism);

    // Try to build the ribbon SVG (same geometry as SequenceEmbed.tsx).
    const VIEW_W = 720;
    const PAD = 16;
    const BASE_Y = 46;
    const PALETTE = ["#bfdbfe", "#bbf7d0", "#fde68a", "#fbcfe8", "#ddd6fe", "#bae6fd"];
    const span = VIEW_W - 2 * PAD;
    const xOf = (pos: number) =>
      PAD + (Math.max(0, Math.min(length, pos)) / length) * span;

    const features = (d.annotations ?? []).map((a, i) => {
      const x = xOf(a.start);
      const w = Math.max(3, xOf(a.end) - x);
      const fill = a.color || PALETTE[i % PALETTE.length];
      const showLabel = w > 44;
      return (
        `<rect x="${x.toFixed(1)}" y="${BASE_Y - 9}" width="${w.toFixed(1)}" height="18" rx="3"` +
        ` fill="${fill}" opacity="0.95"/>` +
        (showLabel
          ? `<text x="${(x + w / 2).toFixed(1)}" y="${BASE_Y + 4}" font-size="10"` +
            ` text-anchor="middle" fill="#1f2937">${escSvgText(a.name)}</text>`
          : "")
      );
    });

    const ribbonSvg =
      `<svg width="${VIEW_W}" height="72" viewBox="0 0 ${VIEW_W} 72"` +
      ` xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${VIEW_W}" height="72" fill="#ffffff"/>` +
      `<line x1="${PAD}" y1="${BASE_Y}" x2="${VIEW_W - PAD}" y2="${BASE_Y}"` +
      ` stroke="#d1d5db" stroke-width="2"/>` +
      features.join("") +
      `<text x="${PAD}" y="${BASE_Y + 22}" font-size="9" fill="#6b7280">1</text>` +
      `<text x="${VIEW_W - PAD}" y="${BASE_Y + 22}" font-size="9"` +
      ` text-anchor="end" fill="#6b7280">${length.toLocaleString()}</text>` +
      `</svg>`;

    try {
      const dataUrl = await svgToPngDataUrl(ribbonSvg, 720);
      return {
        kind: "image",
        dataUrl,
        width: 720,
        height: 72,
        caption,
        label,
      };
    } catch (err) {
      if (err instanceof CanvasUnavailableError) {
        // Non-browser: degrade to card.
        return {
          kind: "card",
          title,
          subtitle: "Sequence",
          meta: facts,
          caption,
          label,
        };
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof CanvasUnavailableError) {
      return {
        kind: "card",
        title: caption || descriptor.id,
        subtitle: "Sequence",
        meta: [],
        caption,
        label,
      };
    }
    return { kind: "missing", name: caption || descriptor.id, label };
  }
}

/** Escape text for safe inclusion in SVG. */
function escSvgText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Bake a note embed as a card with an excerpt. */
async function bakeNote(
  descriptor: EmbedDescriptor,
  caption: string,
  label: string | null,
): Promise<BakedEmbed> {
  try {
    const note = await notesApi.get(Number(descriptor.id));
    if (!note) return { kind: "missing", name: caption || descriptor.id, label };
    const title = caption || note.title;
    const firstEntry = note.entries[0];
    const excerpt = firstEntry?.content?.trim().slice(0, 140) ?? note.description?.trim().slice(0, 140) ?? "";
    const meta: string[] = [];
    if (excerpt) meta.push(excerpt);
    return {
      kind: "card",
      title,
      subtitle: "Note",
      meta,
      caption,
      label,
    };
  } catch {
    return { kind: "missing", name: caption || descriptor.id, label };
  }
}

/** Bake a method embed as a card. */
async function bakeMethod(
  descriptor: EmbedDescriptor,
  caption: string,
  label: string | null,
): Promise<BakedEmbed> {
  try {
    const method = await methodsApi.get(Number(descriptor.id));
    if (!method) return { kind: "missing", name: caption || descriptor.id, label };
    const title = caption || method.name;
    const meta: string[] = [];
    if (method.method_type) meta.push(String(method.method_type));
    return {
      kind: "card",
      title,
      subtitle: "Method",
      meta,
      caption,
      label,
    };
  } catch {
    return { kind: "missing", name: caption || descriptor.id, label };
  }
}

/** Bake a project embed as a card. */
async function bakeProject(
  descriptor: EmbedDescriptor,
  caption: string,
  label: string | null,
): Promise<BakedEmbed> {
  try {
    const project = await projectsApi.get(Number(descriptor.id));
    if (!project) return { kind: "missing", name: caption || descriptor.id, label };
    return {
      kind: "card",
      title: caption || project.name,
      subtitle: "Project",
      meta: [],
      caption,
      label,
    };
  } catch {
    return { kind: "missing", name: caption || descriptor.id, label };
  }
}

/** Bake a collection embed as a card. */
async function bakeCollection(
  descriptor: EmbedDescriptor,
  caption: string,
  label: string | null,
): Promise<BakedEmbed> {
  try {
    const project = await projectsApi.get(Number(descriptor.id));
    if (!project) return { kind: "missing", name: caption || descriptor.id, label };
    return {
      kind: "card",
      title: caption || project.name,
      subtitle: "Collection",
      meta: [],
      caption,
      label,
    };
  } catch {
    return { kind: "missing", name: caption || descriptor.id, label };
  }
}

/** Split a composite taskKey ("self:5" or "alice:5") into id + optional owner.
 *  Returns null when the key is malformed. */
function splitTaskKey(key: string): { id: number; owner?: string } | null {
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const ns = key.slice(0, colon);
  const numStr = key.slice(colon + 1);
  const id = Number(numStr);
  if (!Number.isFinite(id) || id <= 0) return null;
  return ns === "self" ? { id } : { id, owner: ns };
}

/** Bake a task embed as a card. */
async function bakeTask(
  descriptor: EmbedDescriptor,
  caption: string,
  label: string | null,
  typeLabel: string,
): Promise<BakedEmbed> {
  try {
    const parsed = splitTaskKey(descriptor.id);
    if (!parsed) return { kind: "missing", name: caption || descriptor.id, label };
    const task = await tasksApi.get(parsed.id, parsed.owner);
    if (!task) return { kind: "missing", name: caption || descriptor.id, label };
    const statusLabel = task.is_complete ? "Complete" : "In progress";
    const meta: string[] = [statusLabel];
    if (task.start_date) meta.push(task.start_date);
    return {
      kind: "card",
      title: caption || task.name,
      subtitle: typeLabel,
      meta,
      caption,
      label,
    };
  } catch {
    return { kind: "missing", name: caption || descriptor.id, label };
  }
}

/** Bake a file embed as a card. */
function bakeFile(
  descriptor: EmbedDescriptor,
  caption: string,
  label: string | null,
): BakedEmbed {
  return {
    kind: "card",
    title: caption || descriptor.id,
    subtitle: "File",
    meta: [],
    caption,
    label,
  };
}

// ── Main baking API ───────────────────────────────────────────────────────────

/** The external dependencies bakeAllEmbeds needs from the environment.
 *  Providing them explicitly (rather than closing over module-level singletons)
 *  makes the function mockable in unit tests. */
export interface BakeEmbedsDeps {
  // Intentionally left structurally open so callers can pass the real singletons
  // or test mocks. The module-level re-exports above are the real values.
}

/**
 * Pre-pass: scan all block-embed references in one or more markdown strings,
 * load each object, bake it into a PDF-ready representation, and return a Map
 * keyed by the exact link href (so the sync PDF walker can look up by href).
 *
 * Figure/table labels (from `<!-- ros:number-figures -->`) are applied in
 * document order. When multiple markdown strings are passed their embeds are
 * concatenated in argument order for labelling purposes (notes before results,
 * matching the PDF section order).
 *
 * Each embed is baked independently. A failing loader degrades that embed to
 * `kind:"missing"` without throwing; the rest of the document still bakes.
 *
 * @param markdowns - One or more markdown bodies to scan (e.g. [notesMarkdown, resultsMarkdown]).
 */
export async function bakeAllEmbeds(
  markdowns: string[],
): Promise<Map<string, BakedEmbed>> {
  // Collect all scan results across all markdown bodies in order.
  type ScanEntry = { scan: ScanResult; plan: FigureNumberPlan; indexInDoc: number };
  const allEntries: ScanEntry[] = [];
  for (const md of markdowns) {
    const plan = buildFigureNumberPlan(md);
    const scans = scanEmbedRefs(md);
    scans.forEach((scan, i) => {
      allEntries.push({ scan, plan, indexInDoc: i });
    });
  }

  // Deduplicate: bake each unique href only once, but apply the label from its
  // first occurrence. A second embed of the same href in the same doc gets the
  // same data (it IS the same object) but a fresh label at that position.
  const result = new Map<string, BakedEmbed>();

  await Promise.all(
    allEntries.map(async ({ scan, plan, indexInDoc }) => {
      const { href, caption, descriptor } = scan;
      // Get the label for this embed's position in the document.
      const label = plan.labelAt(indexInDoc) ?? null;

      // If we already baked this href, update the label if a new one is
      // assigned (first wins, subsequent occurrences inherit the same data
      // but a different label position, so we rebuild with the new label).
      // To keep the map simple: only the FIRST occurrence sets the entry
      // (the PDF walker renders each paragraph independently anyway, and
      // figure numbers count each occurrence, but two identical hrefs in
      // one doc is an unusual edge case). Keep it simple: first wins.
      if (result.has(href)) return;

      let baked: BakedEmbed;
      try {
        baked = await bakeOne(descriptor, caption, label);
      } catch {
        baked = { kind: "missing", name: caption || descriptor.id, label };
      }
      result.set(href, baked);
    }),
  );

  return result;
}

/** Bake a single embed descriptor into its PDF-ready representation. Exported so
 *  the pin layer (P7-1a) can freeze ONE embed into the same BakedEmbed shape the
 *  export pre-pass produces, reusing the exact per-type bakers (no second set of
 *  loaders to drift). `label` is null for a pin (figure numbering is an export
 *  concern, not a pin concern). */
export async function bakeOne(
  descriptor: EmbedDescriptor,
  caption: string,
  label: string | null,
): Promise<BakedEmbed> {
  switch (descriptor.type) {
    case "molecule":
      return bakeMolecule(descriptor, caption, label);
    case "datahub":
      return bakeDataHub(descriptor, caption, label);
    case "phylo":
      return bakePhylo(descriptor, caption, label);
    case "sequence":
      return bakeSequence(descriptor, caption, label);
    case "note":
      return bakeNote(descriptor, caption, label);
    case "method":
      return bakeMethod(descriptor, caption, label);
    case "project":
      return bakeProject(descriptor, caption, label);
    case "collection":
      return bakeCollection(descriptor, caption, label);
    case "task":
      return bakeTask(descriptor, caption, label, "Task");
    case "experiment":
      return bakeTask(descriptor, caption, label, "Experiment");
    case "file":
      return bakeFile(descriptor, caption, label);
    case "dataset":
      // A big-table dataset embed is a LIVE DuckDB-backed preview window, not a
      // static snapshot, so it has no PDF-bakeable form in this pass. Treat it as
      // missing (a name-only placeholder), the same as the default fallback. A
      // future pass can bake the preview window if needed.
      return { kind: "missing", name: caption || String(descriptor.id), label };
    default: {
      // TypeScript exhaustiveness guard. Treat unknown types as missing.
      const exhaustive: never = descriptor.type;
      void exhaustive;
      return { kind: "missing", name: caption || String(descriptor.id), label };
    }
  }
}
