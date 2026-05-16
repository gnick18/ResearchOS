// Tiny nbformat v4 parser. The full spec is large, but the surface we
// actually render is small: cell_type + source + outputs (best-mime
// pick). Reject @jupyterlab/nbformat (100+KB of types we'd never use) and
// hand-roll the walker — it's <150 LOC and zero dep weight.

export type ParsedNbCellType = "code" | "markdown" | "raw";

export type ParsedNbOutputKind = "stream" | "text" | "image" | "html";

export interface ParsedNbOutput {
  kind: ParsedNbOutputKind;
  /** For text/stream/html: the rendered string. For image: a base64
   *  payload WITHOUT the `data:image/...;base64,` prefix (the renderer
   *  reattaches the prefix it knows from `mimeType`). */
  payload: string;
  /** Concrete mime type ("image/png", "text/plain", "text/html", "stdout"). */
  mimeType: string;
}

export interface ParsedNbCell {
  cellType: ParsedNbCellType;
  source: string;
  /** Only set for code cells. */
  executionCount: number | null;
  /** Only populated for code cells; empty array for markdown/raw. */
  outputs: ParsedNbOutput[];
}

export interface ParsedNotebook {
  cells: ParsedNbCell[];
  /** When non-null, parsing succeeded but at least one cell was
   *  partially recovered — surfaced so the viewer can show a hint. */
  warnings: string[];
}

export interface ParsedNbResult {
  notebook: ParsedNotebook | null;
  /** When set, the input was not a valid notebook (or not JSON at all).
   *  The viewer renders this as a friendly message + falls back to
   *  syntax-highlighted text. */
  error: string | null;
}

/** Normalize the .ipynb cell.source field — the spec allows either a
 *  flat string or an array of strings (one per line, with trailing
 *  newlines preserved by the writer). Both collapse to one string. */
function normalizeSource(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw.map((line) => (typeof line === "string" ? line : "")).join("");
  }
  return "";
}

/** Pick the "best" mime type from a Jupyter display_data / execute_result
 *  output. Priority: image (highest fidelity preview), then HTML (pandas
 *  tables), then plain text. */
function pickBestMime(data: Record<string, unknown>): {
  mimeType: string;
  payload: string;
  kind: ParsedNbOutputKind;
} | null {
  const preferred: Array<{ mime: string; kind: ParsedNbOutputKind }> = [
    { mime: "image/png", kind: "image" },
    { mime: "image/jpeg", kind: "image" },
    { mime: "image/svg+xml", kind: "image" },
    { mime: "text/html", kind: "html" },
    { mime: "text/plain", kind: "text" },
  ];
  for (const { mime, kind } of preferred) {
    if (mime in data) {
      const v = data[mime];
      if (typeof v === "string") {
        return { mimeType: mime, payload: v, kind };
      }
      if (Array.isArray(v)) {
        return {
          mimeType: mime,
          payload: v.map((s) => (typeof s === "string" ? s : "")).join(""),
          kind,
        };
      }
    }
  }
  return null;
}

function parseOutputs(raw: unknown, warnings: string[]): ParsedNbOutput[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedNbOutput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const o = raw[i];
    if (!o || typeof o !== "object") {
      warnings.push(`Output ${i} was not an object — dropped.`);
      continue;
    }
    const r = o as Record<string, unknown>;
    const type = r.output_type;
    if (type === "stream") {
      const text = normalizeSource(r.text);
      const streamName = typeof r.name === "string" ? r.name : "stdout";
      out.push({ kind: "stream", payload: text, mimeType: streamName });
    } else if (type === "error") {
      const traceback = Array.isArray(r.traceback)
        ? r.traceback.map((s) => (typeof s === "string" ? s : "")).join("\n")
        : typeof r.evalue === "string"
          ? `${r.ename}: ${r.evalue}`
          : "(error)";
      // Strip ANSI escape sequences so tracebacks render readably in
      // a static <pre>. Real Jupyter displays these in color via a
      // separate renderer; we just drop the codes here.
      // eslint-disable-next-line no-control-regex
      const cleaned = traceback.replace(/\x1b\[[0-9;]*m/g, "");
      out.push({ kind: "stream", payload: cleaned, mimeType: "stderr" });
    } else if (type === "display_data" || type === "execute_result") {
      const data = r.data;
      if (!data || typeof data !== "object") {
        warnings.push(`Output ${i} ${type} missing data — dropped.`);
        continue;
      }
      const best = pickBestMime(data as Record<string, unknown>);
      if (!best) {
        warnings.push(`Output ${i} ${type} had no renderable mime — dropped.`);
        continue;
      }
      out.push(best);
    } else {
      warnings.push(`Output ${i} unknown output_type "${String(type)}" — dropped.`);
    }
  }
  return out;
}

export function parseNotebook(raw: string): ParsedNbResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { notebook: null, error: "Not valid JSON" };
  }
  if (!json || typeof json !== "object") {
    return { notebook: null, error: "Not an object" };
  }
  const r = json as Record<string, unknown>;
  if (r.nbformat !== 4) {
    return {
      notebook: null,
      error: `Unsupported nbformat: ${String(r.nbformat ?? "(missing)")} (only v4 supported)`,
    };
  }
  if (!Array.isArray(r.cells)) {
    return { notebook: null, error: "Notebook has no cells array" };
  }
  const warnings: string[] = [];
  const cells: ParsedNbCell[] = [];
  for (let i = 0; i < r.cells.length; i++) {
    const c = r.cells[i];
    if (!c || typeof c !== "object") {
      warnings.push(`Cell ${i} was not an object — skipped.`);
      continue;
    }
    const cr = c as Record<string, unknown>;
    const cellType =
      cr.cell_type === "code" || cr.cell_type === "markdown" || cr.cell_type === "raw"
        ? cr.cell_type
        : (warnings.push(`Cell ${i} unknown cell_type "${String(cr.cell_type)}" → treated as raw`),
          "raw" as const);
    const source = normalizeSource(cr.source);
    const executionCount =
      cellType === "code" && typeof cr.execution_count === "number"
        ? cr.execution_count
        : null;
    const outputs = cellType === "code" ? parseOutputs(cr.outputs, warnings) : [];
    cells.push({ cellType, source, executionCount, outputs });
  }
  return { notebook: { cells, warnings }, error: null };
}
