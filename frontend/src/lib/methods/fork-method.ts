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
import type { Method } from "@/lib/types";

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

/**
 * Create a fork (variant) of `source` named `newName`. Clones the per-type
 * content, then creates a new Method linked to the source via
 * `parent_method_id`. The fork always lands in the current user's namespace
 * (methodsApi.create routes owner), inherits the source's folder, and is
 * PRIVATE regardless of the source's sharing (a personal variant, not a
 * republish). Returns the freshly created fork.
 *
 * Structured protocols are read with `source.owner || undefined`, matching how
 * the method viewers load them, so forking a shared or public method reads the
 * original owner's record.
 */
export async function forkMethod(source: Method, newName: string): Promise<Method> {
  const name = newName.trim();
  if (!name) throw new Error("A fork needs a name.");

  const readOwner = source.owner || undefined;
  let newSourcePath: string | null = source.source_path ?? null;

  switch (source.method_type) {
    case "pcr": {
      const p = await pcrApi.get(protocolId(source.source_path, "pcr://protocol/"), readOwner);
      if (!p) throw new Error("Source PCR protocol not found.");
      const clone = await pcrApi.create({
        name,
        gradient: p.gradient,
        ingredients: p.ingredients,
        notes: p.notes,
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
      const clone = await lcGradientApi.create({
        name,
        description: p.description,
        gradient_steps: p.gradient_steps,
        column: p.column,
        detection_wavelength_nm: p.detection_wavelength_nm,
        ingredients: p.ingredients,
        is_public: false,
      });
      newSourcePath = `lc_gradient://protocol/${clone.id}`;
      break;
    }
    case "plate": {
      const p = await plateApi.get(protocolId(source.source_path, "plate://protocol/"), readOwner);
      if (!p) throw new Error("Source plate layout not found.");
      const clone = await plateApi.create({
        name,
        description: p.description,
        plate_size: p.plate_size,
        region_labels: p.region_labels,
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
      const clone = await cellCultureApi.create({
        name,
        description: p.description,
        cell_line: p.cell_line,
        media: p.media,
        planned_events: p.planned_events,
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
      const clone = await massSpecApi.create({
        name,
        description: p.description,
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
      const clone = await codingWorkflowApi.create({
        name,
        description: p.description,
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
      const clone = await qpcrAnalysisApi.create({
        name,
        description: p.description,
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
      if (!source.source_path) break;
      const original = await filesApi.readFile(source.source_path);
      newSourcePath = await uniqueContentPath(slugify(name), "md");
      await filesApi.writeFile(newSourcePath, original.content, `Fork method: ${name}`);
      break;
    }
    case "pdf": {
      // Copy the PDF binary so the fork owns its own file (deleting either
      // method must not break the other).
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
      // REFERENCES, not the child methods themselves.
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
