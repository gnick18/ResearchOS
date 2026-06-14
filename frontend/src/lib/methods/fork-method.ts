// Forking a method = creating a variant of it. The fork CLONES the underlying
// per-type content so the new method is fully independent (editing the fork
// never touches the original), then links back to the source via
// `parent_method_id` so the explorer can nest it under its base.
//
// Why this is its own helper (not the old `methodsApi.fork`): the legacy
// `methodsApi.fork` only copied the Method record and reused / blanked the
// source_path, so a forked structured method shared the SAME underlying
// protocol record as its source (edit one, change both) and a forked markdown
// method pointed at a file that was never written. This helper does the real
// content clone per type. It is pure orchestration over the existing
// create/get APIs, so it unit-tests with those mocked.
//
// Two entry points:
//   - `forkMethod(source, name)` clones the LIBRARY method as-is.
//   - `forkAttachmentToLibrary(source, attachment, name)` clones it with the
//     experiment's edits baked in: an attached method gets edited per-task
//     (body_override / pcr_gradient / lc_gradient / plate_annotation /
//     cell_culture_schedule + variation_notes) and those edits live only on
//     the task's `method_attachment`, never the reusable library method. This
//     lets the researcher promote that edited version into a new standalone
//     method. `forkMethod` is just `forkAttachmentToLibrary(source, undefined,
//     name)` — with no attachment, no overrides apply and the clone is
//     byte-identical to a plain library fork.

import {
  methodsApi,
  pcrApi,
  lcGradientApi,
  plateApi,
  cellCultureApi,
  massSpecApi,
  codingWorkflowApi,
  qpcrAnalysisApi,
  filesApi,
} from "@/lib/local-api";
import { fileService } from "@/lib/file-system/file-service";
import type {
  CellCultureScheduleInstance,
  LCGradientProtocol,
  Method,
  PCRGradient,
  PCRIngredient,
  PlateAnnotationSnapshot,
  PlateRegionLabel,
  PlateWellAnnotation,
  TaskMethodAttachment,
} from "@/lib/types";

/** Filesystem-safe stem from a method name. Falls back to "method" when the
 *  name has no usable characters. */
function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "method";
}

/** A markdown/pdf method dir that does not collide with an existing one. The
 *  content path lives at `methods/<dir>/<file>`; we bump a numeric suffix until
 *  the file path is free so two forks of the same name never overwrite each
 *  other (or the original). */
async function uniqueContentPath(slug: string, ext: string): Promise<string> {
  let dir = slug;
  let n = 2;
  while (await fileService.fileExists(`methods/${dir}/${dir}.${ext}`)) {
    dir = `${slug}-${n}`;
    n += 1;
  }
  return `methods/${dir}/${dir}.${ext}`;
}

/** Parse the trailing numeric id out of a `type://protocol/<id>` source_path. */
function protocolId(sourcePath: string | null, prefix: string): number {
  const id = parseInt((sourcePath ?? "").replace(prefix, ""), 10);
  if (!Number.isFinite(id)) {
    throw new Error(`Cannot fork: malformed source_path "${sourcePath ?? ""}"`);
  }
  return id;
}

/** Safe JSON.parse that returns null on missing-or-corrupt input, mirroring
 *  the per-type tab viewers' "fall back to source on corrupted snapshot"
 *  contract so a malformed override never throws mid-fork. */
function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Fold an experiment's `variation_notes` into a method's text sink (markdown
 * body, or a structured protocol's notes/description) when forking an attached
 * method to the library. Returns `base` unchanged when there are no notes, so
 * a plain library fork (no attachment) is byte-identical to the legacy clone.
 * The notes are appended under a labeled heading so the bench log stays
 * distinguishable from the protocol content in the new reusable method.
 */
function withVariationNotes<T extends string | null | undefined>(
  base: T,
  notes: string | null | undefined,
  contextLabel?: string,
): string | T {
  const n = (notes ?? "").trim();
  if (!n) return base;
  const heading = contextLabel
    ? `## Variation notes (from experiment "${contextLabel}")`
    : "## Variation notes";
  const block = `${heading}\n\n${n}`;
  const b = (base ?? "").trim();
  return b ? `${b}\n\n${block}` : block;
}

/** Project a per-well annotation map back to `region_labels` as 1×1
 *  rectangles. Inlined from PlateLayoutEditor.wellsToRegionLabels (which is a
 *  client component module) so this pure-lib helper — and its unit test —
 *  don't drag React in. The well-id scheme (`A1`-style) matches GridCanvas's
 *  `parseWellId`. Per-task `sample_label` is intentionally dropped: sample
 *  identifiers belong on the per-task snapshot, not a reusable template. */
function wellsToRegionLabels(
  wells: Record<string, PlateWellAnnotation>,
): PlateRegionLabel[] {
  const out: PlateRegionLabel[] = [];
  for (const [id, ann] of Object.entries(wells)) {
    const m = id.match(/^([A-P])(\d+)$/);
    if (!m) continue;
    const row = m[1].charCodeAt(0) - 65;
    const col = Number(m[2]) - 1;
    const region: PlateRegionLabel = {
      row_start: row,
      row_end: row,
      col_start: col,
      col_end: col,
      role: ann.role,
    };
    if (ann.custom_label !== undefined) region.custom_label = ann.custom_label;
    if (ann.notes !== undefined) region.notes = ann.notes;
    out.push(region);
  }
  return out;
}

/**
 * Create a fork (variant) of `source` named `newName`, optionally baking in an
 * experiment's per-task edits from `attachment`. Clones the per-type content,
 * then creates a new Method linked to the source via `parent_method_id`. The
 * fork always lands in the current user's namespace (methodsApi.create routes
 * owner), inherits the source's folder, and is PRIVATE regardless of the
 * source's sharing (a personal variant, not a republish). Returns the freshly
 * created fork.
 *
 * When `attachment` is provided, each per-type structured override
 * (pcr_gradient/pcr_ingredients, lc_gradient, plate_annotation,
 * cell_culture_schedule, body_override) replaces the source content it shadows,
 * exactly as the experiment-page viewers render it (override-or-source). The
 * attachment's `variation_notes` are appended to the new method's text sink via
 * `withVariationNotes`. Two override fields are deliberately NOT baked in
 * because they are per-run measurement DATA, not reusable protocol template:
 *   - `qpcr_analysis` (entered Cq readouts) — the qPCR template is cloned, the
 *     run's readouts stay on the experiment.
 *   - `compound_snapshots` (per-child run data) — a compound fork copies child
 *     REFERENCES only, like a plain library fork.
 *
 * Structured protocols are read with `source.owner || undefined`, matching how
 * the method viewers load them, so forking a shared or public method reads the
 * original owner's record.
 */
export async function forkAttachmentToLibrary(
  source: Method,
  attachment: TaskMethodAttachment | undefined,
  newName: string,
  opts?: { variationContextLabel?: string },
): Promise<Method> {
  const name = newName.trim();
  if (!name) throw new Error("A fork needs a name.");

  const readOwner = source.owner || undefined;
  const variationNotes = attachment?.variation_notes ?? null;
  const ctx = opts?.variationContextLabel;
  let newSourcePath: string | null = source.source_path ?? null;

  switch (source.method_type) {
    case "pcr": {
      const p = await pcrApi.get(protocolId(source.source_path, "pcr://protocol/"), readOwner);
      if (!p) throw new Error("Source PCR protocol not found.");
      const gradientOverride = parseJson<PCRGradient>(attachment?.pcr_gradient);
      const ingredientsOverride = parseJson<PCRIngredient[]>(attachment?.pcr_ingredients);
      const clone = await pcrApi.create({
        name,
        gradient: gradientOverride ?? p.gradient,
        ingredients: Array.isArray(ingredientsOverride) ? ingredientsOverride : p.ingredients,
        notes: withVariationNotes(p.notes, variationNotes, ctx),
        is_public: false,
      });
      newSourcePath = `pcr://protocol/${clone.id}`;
      break;
    }
    case "lc_gradient": {
      const p = await lcGradientApi.get(
        protocolId(source.source_path, "lc_gradient://protocol/"),
        readOwner,
      );
      if (!p) throw new Error("Source LC gradient not found.");
      // The lc_gradient override is a FULL LCGradientProtocol snapshot
      // (`{...source, ...edits}`), so use its fields directly rather than
      // field-by-field `??` — a snapshot that legitimately cleared the
      // wavelength must not silently fall back to the source's value.
      const snap = parseJson<LCGradientProtocol>(attachment?.lc_gradient);
      const base = snap ?? p;
      const clone = await lcGradientApi.create({
        name,
        description: withVariationNotes(base.description, variationNotes, ctx),
        gradient_steps: base.gradient_steps,
        column: base.column,
        detection_wavelength_nm: base.detection_wavelength_nm,
        ingredients: base.ingredients,
        is_public: false,
      });
      newSourcePath = `lc_gradient://protocol/${clone.id}`;
      break;
    }
    case "plate": {
      const p = await plateApi.get(protocolId(source.source_path, "plate://protocol/"), readOwner);
      if (!p) throw new Error("Source plate layout not found.");
      const annotation = parseJson<PlateAnnotationSnapshot>(attachment?.plate_annotation);
      const clone = await plateApi.create({
        name,
        description: withVariationNotes(p.description, variationNotes, ctx),
        plate_size: p.plate_size,
        region_labels: annotation?.wells
          ? wellsToRegionLabels(annotation.wells)
          : p.region_labels,
        is_public: false,
      });
      newSourcePath = `plate://protocol/${clone.id}`;
      break;
    }
    case "cell_culture": {
      const p = await cellCultureApi.get(
        protocolId(source.source_path, "cell_culture://protocol/"),
        readOwner,
      );
      if (!p) throw new Error("Source cell-culture schedule not found.");
      // The cell_culture override is a per-task instance: planned-schedule
      // edits (cell_line/media/planned_events/description) BELONG in the fork;
      // the `actual_events` run log does not (and isn't part of the create
      // payload). Mirror the viewer's "instance planned, else source" seed.
      const inst = parseJson<CellCultureScheduleInstance>(attachment?.cell_culture_schedule);
      const planned =
        inst?.planned_events && inst.planned_events.length > 0
          ? inst.planned_events
          : p.planned_events;
      const clone = await cellCultureApi.create({
        name,
        description: withVariationNotes(inst?.description ?? p.description, variationNotes, ctx),
        cell_line: inst?.cell_line ?? p.cell_line,
        media: inst?.media ?? p.media,
        planned_events: planned,
        is_public: false,
      });
      newSourcePath = `cell_culture://protocol/${clone.id}`;
      break;
    }
    case "mass_spec": {
      const p = await massSpecApi.get(
        protocolId(source.source_path, "mass_spec://protocol/"),
        readOwner,
      );
      if (!p) throw new Error("Source mass-spec method not found.");
      // Mass-spec has no per-task structured override (only variation_notes).
      const clone = await massSpecApi.create({
        name,
        description: withVariationNotes(p.description, variationNotes, ctx),
        ionization_mode: p.ionization_mode,
        ionization_label: p.ionization_label,
        instrument: p.instrument,
        source: p.source,
        scan: p.scan,
        calibration: p.calibration,
        is_public: false,
      });
      newSourcePath = `mass_spec://protocol/${clone.id}`;
      break;
    }
    case "coding_workflow": {
      const p = await codingWorkflowApi.get(
        protocolId(source.source_path, "coding_workflow://protocol/"),
        readOwner,
      );
      if (!p) throw new Error("Source coding workflow not found.");
      // Coding workflow has no per-task structured override (only variation_notes).
      const clone = await codingWorkflowApi.create({
        name,
        description: withVariationNotes(p.description, variationNotes, ctx),
        language: p.language,
        language_label: p.language_label,
        embedded_code: p.embedded_code,
        external_path: p.external_path,
        output_renderer: p.output_renderer,
        is_public: false,
      });
      newSourcePath = `coding_workflow://protocol/${clone.id}`;
      break;
    }
    case "qpcr_analysis": {
      const p = await qpcrAnalysisApi.get(
        protocolId(source.source_path, "qpcr_analysis://protocol/"),
        readOwner,
      );
      if (!p) throw new Error("Source qPCR analysis not found.");
      // The qpcr_analysis override is per-run measurement DATA (entered Cq
      // readouts / melt Tms), not template — so it is intentionally NOT baked
      // into the reusable method. Only the protocol template is cloned;
      // variation_notes append to the description.
      const clone = await qpcrAnalysisApi.create({
        name,
        description: withVariationNotes(p.description, variationNotes, ctx),
        chemistry: p.chemistry,
        chemistry_label: p.chemistry_label,
        references: p.references,
        standard_curve: p.standard_curve,
        melt_curve: p.melt_curve,
        use_delta_delta_cq: p.use_delta_delta_cq,
        is_public: false,
      });
      newSourcePath = `qpcr_analysis://protocol/${clone.id}`;
      break;
    }
    case "markdown": {
      // Bake the body_override (the per-task edited markdown) when present,
      // else clone the source file. variation_notes append below the body.
      const hasOverride =
        attachment?.body_override != null ||
        (variationNotes != null && variationNotes.trim() !== "");
      if (!source.source_path && !hasOverride) break;
      const baseBody =
        attachment?.body_override ??
        (source.source_path ? (await filesApi.readFile(source.source_path)).content : "");
      const content = withVariationNotes(baseBody, variationNotes, ctx);
      newSourcePath = await uniqueContentPath(slugify(name), "md");
      await filesApi.writeFile(newSourcePath, content, `Fork method: ${name}`);
      break;
    }
    case "pdf": {
      // Copy the PDF binary so the fork owns its own file (deleting either
      // method must not break the other). A PDF method has no text sink, so
      // variation_notes can't ride along — they stay on the experiment.
      if (!source.source_path) break;
      const blob = await fileService.readFileAsBlob(source.source_path);
      if (!blob) throw new Error("Source PDF not found.");
      const ext = source.source_path.split(".").pop() || "pdf";
      newSourcePath = await uniqueContentPath(slugify(name), ext);
      await fileService.writeFileFromBlob(newSourcePath, blob);
      break;
    }
    case "compound":
      // Compounds have no protocol file; the content is the inline components
      // array, copied below. Like wrapAsCompound, this copies the child
      // REFERENCES, not the child methods themselves (so per-child
      // compound_snapshots are not baked in).
      newSourcePath = null;
      break;
    default:
      // Unknown / null type: keep whatever source_path the record had.
      break;
  }

  return methodsApi.create({
    name,
    source_path: newSourcePath,
    source_pdf_path: source.source_pdf_path ?? null,
    method_type: source.method_type ?? undefined,
    folder_path: source.folder_path ?? null,
    parent_method_id: source.id,
    tags: source.tags ?? undefined,
    components:
      source.method_type === "compound" ? source.components ?? [] : undefined,
    excerpt: source.excerpt,
    is_public: false,
  });
}

/**
 * Plain library fork: clone `source` into an independent variant with no
 * experiment edits applied. Thin wrapper over `forkAttachmentToLibrary` with
 * no attachment, so the two share one code path.
 */
export function forkMethod(source: Method, newName: string): Promise<Method> {
  return forkAttachmentToLibrary(source, undefined, newName);
}
