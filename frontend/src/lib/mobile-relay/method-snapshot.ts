// View method on phone, the laptop publisher (method-on-phone bot, 2026-06-10).
//
// Builds a sealed READ-MODE projection of a focused experiment's method(s) and
// seals a copy for each paired phone using the same pattern as
// notebooks-snapshot.ts / timers-snapshot.ts.
//
// The phone renders this projection as a bench-friendly protocol viewer (large
// type, scrollable, ordered steps / reagents / key params), so a researcher can
// follow the recipe away from the laptop. The method itself is NOT editable on
// the phone, only variations are added back (see the add-variation command in
// poll.ts). This snapshot is therefore a one-way read projection.
//
// Snapshot name on the relay: "method"
//
// The decrypted shape the phone reads after openSealed is MethodSnapshot. It
// carries the focused experiment id/owner/name plus one MethodProjection per
// attached method. The projection is a SIMPLIFIED read view, not the full
// editable model: each method type contributes the fields that matter at the
// bench (PCR cycling + recipe, LC gradient + column, compound child ordering,
// markdown body, or a generic source line for everything else).
//
// Per-task overrides win over the source protocol, mirroring the laptop
// viewers: an attachment's pcr_gradient / pcr_ingredients / lc_gradient /
// body_override snapshot (set when the user edits the recipe inside the
// experiment) is what the phone shows, falling back to the source protocol
// record when the attachment carries no override.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { tasksApi, methodsApi, pcrApi, lcGradientApi, filesApi } from "@/lib/local-api";
import { readFreshPhoneReformat } from "@/lib/methods/phone-reformat-cache";
import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { listDevices, publishSnapshot, type UserCaptureKeys } from "./client";
import type {
  Task,
  Method,
  TaskMethodAttachment,
  PCRGradient,
  PCRIngredient,
  LCGradientProtocol,
} from "@/lib/types";

// ── Projection types (the decrypted shape the phone parses) ──────────────────
//
// Every field is OPTIONAL on the phone side so an older laptop shape never
// crashes the viewer. The phone narrows on `methodType` to pick the renderer.

/** One ordered PCR step, flattened for read display (the laptop's PCRStep). */
export interface MethodPcrStep {
  name: string;
  /** Temperature in C. */
  temperature: number;
  /** Human duration string, e.g. "2 min", "30 sec", "Indef.". */
  duration: string;
}

/** One PCR cycle group (a repeated block of steps). */
export interface MethodPcrCycle {
  repeats: number;
  steps: MethodPcrStep[];
}

/** The PCR read projection: ordered phases + the reaction recipe. */
export interface MethodPcrProjection {
  initial: MethodPcrStep[];
  cycles: MethodPcrCycle[];
  final: MethodPcrStep[];
  hold: MethodPcrStep | null;
  /** Reaction-mix reagents (name, concentration, volume per reaction). */
  ingredients: Array<{
    name: string;
    concentration: string;
    amountPerReaction: string;
  }>;
  notes: string | null;
}

/** The LC read projection: the gradient table + column + mobile phases. */
export interface MethodLcProjection {
  /** Gradient time points, sorted by time. */
  steps: Array<{
    timeMin: number;
    percentA: number;
    percentB: number;
    flowMlMin: number;
  }>;
  column: {
    manufacturer: string | null;
    model: string | null;
    lengthMm: number | null;
    innerDiameterMm: number | null;
    particleSizeUm: number | null;
  };
  detectionWavelengthNm: number | null;
  /** Solvents / buffers / additives (the mobile-phase makeup). */
  ingredients: Array<{
    name: string;
    role: string;
    concentration: string;
  }>;
  description: string | null;
}

/** A compound (kit) read projection: the ordered child methods. */
export interface MethodCompoundProjection {
  children: Array<{
    methodId: number;
    label: string;
    /** The child's own method type, so the phone can show a type badge. */
    methodType: string | null;
  }>;
}

/**
 * One method as the phone read viewer sees it. `methodType` discriminates the
 * renderer. `pcr` / `lc` / `compound` carry a structured projection; markdown
 * and every other type carry `body` (the protocol text) so the phone always
 * has something to show. `keyParams` is a flat label/value list of the headline
 * numbers for that method, surfaced at the top of the card for a quick glance.
 */
export interface MethodProjection {
  methodId: number;
  name: string;
  /** Raw method_type from the record (null for legacy / sniffed types). */
  methodType: string | null;
  /** Resolved viewer type after the legacy source_path sniff (always set). */
  resolvedType:
    | "pcr"
    | "lc_gradient"
    | "compound"
    | "markdown"
    | "pdf"
    | "plate"
    | "cell_culture"
    | "mass_spec"
    | "coding_workflow"
    | "qpcr_analysis";
  /** Headline numbers, shown as a chip row at the top of the method card. */
  keyParams: Array<{ label: string; value: string }>;
  pcr?: MethodPcrProjection;
  lc?: MethodLcProjection;
  compound?: MethodCompoundProjection;
  /** Protocol text for markdown / generic types (read-only). Null when none. */
  body?: string | null;
}

/** The full snapshot the phone decrypts. */
export interface MethodSnapshot {
  generatedAt: string;
  /** The focused experiment (so the phone can label the screen + route variations). */
  taskId: number;
  owner: string;
  experimentName: string;
  methods: MethodProjection[];
}

// ── Resolution helpers ───────────────────────────────────────────────────────

/**
 * Resolve the effective viewer type for a method record. Mirrors
 * MethodTabs.resolveMethodType so the phone projection picks the same renderer
 * the laptop would. Honors method_type when set, else sniffs source_path.
 */
export function resolveMethodType(
  methodType: string | null | undefined,
  sourcePath: string | null | undefined,
): MethodProjection["resolvedType"] {
  if (methodType === "compound") return "compound";
  if (
    methodType === "qpcr_analysis" ||
    (sourcePath?.startsWith("qpcr_analysis://") ?? false)
  ) {
    return "qpcr_analysis";
  }
  if (methodType === "pcr" || (sourcePath?.startsWith("pcr://") ?? false)) return "pcr";
  if (
    methodType === "lc_gradient" ||
    (sourcePath?.startsWith("lc_gradient://") ?? false)
  ) {
    return "lc_gradient";
  }
  if (methodType === "plate" || (sourcePath?.startsWith("plate://") ?? false)) {
    return "plate";
  }
  if (
    methodType === "cell_culture" ||
    (sourcePath?.startsWith("cell_culture://") ?? false)
  ) {
    return "cell_culture";
  }
  if (
    methodType === "mass_spec" ||
    (sourcePath?.startsWith("mass_spec://") ?? false)
  ) {
    return "mass_spec";
  }
  if (
    methodType === "coding_workflow" ||
    (sourcePath?.startsWith("coding_workflow://") ?? false)
  ) {
    return "coding_workflow";
  }
  if (methodType === "pdf" || (sourcePath?.toLowerCase().endsWith(".pdf") ?? false)) return "pdf";
  return "markdown";
}

/** Pull the numeric protocol id out of a `<scheme>://protocol/{id}` source path. */
function extractProtocolId(sourcePath: string | null | undefined, scheme: string): number | null {
  if (!sourcePath) return null;
  const match = sourcePath.match(new RegExp(`^${scheme}://protocol/(\\d+)$`));
  return match ? parseInt(match[1], 10) : null;
}

/** Safe JSON parse that returns null on any failure (malformed override). */
function parseJsonSafe<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── Per-type projection builders ─────────────────────────────────────────────

/**
 * Build the PCR projection. The attachment's pcr_gradient / pcr_ingredients
 * override snapshot wins (the per-experiment edit); otherwise we read the
 * source protocol the method's source_path points at. Mirrors the
 * attachment-or-source fallback in PcrMethodTabContent.
 */
export async function buildPcrProjection(
  method: Method,
  attachment: TaskMethodAttachment | undefined,
): Promise<{ pcr: MethodPcrProjection; keyParams: MethodProjection["keyParams"] }> {
  let gradient = parseJsonSafe<PCRGradient>(attachment?.pcr_gradient ?? null);
  let ingredients = parseJsonSafe<PCRIngredient[]>(attachment?.pcr_ingredients ?? null);
  let notes: string | null = null;

  if (!gradient || !ingredients) {
    const protocolId = extractProtocolId(method.source_path, "pcr");
    if (protocolId !== null) {
      const source = await pcrApi.get(protocolId, method.owner || undefined).catch(() => null);
      if (source) {
        if (!gradient) gradient = source.gradient ?? null;
        if (!ingredients) ingredients = Array.isArray(source.ingredients) ? source.ingredients : [];
        notes = source.notes ?? null;
      }
    }
  }

  const safeGradient: PCRGradient = gradient ?? {
    initial: [],
    cycles: [],
    final: [],
    hold: null,
  };
  const safeIngredients: PCRIngredient[] = Array.isArray(ingredients) ? ingredients : [];

  const projection: MethodPcrProjection = {
    initial: (safeGradient.initial ?? []).map(toPcrStep),
    cycles: (safeGradient.cycles ?? []).map((c) => ({
      repeats: c.repeats,
      steps: (c.steps ?? []).map(toPcrStep),
    })),
    final: (safeGradient.final ?? []).map(toPcrStep),
    hold: safeGradient.hold ? toPcrStep(safeGradient.hold) : null,
    ingredients: safeIngredients.map((ing) => ({
      name: ing.name,
      concentration: ing.concentration,
      amountPerReaction: ing.amount_per_reaction,
    })),
    notes,
  };

  // Headline numbers: total cycle repeats + reagent count, the two things a
  // researcher double-checks before running.
  const totalRepeats = projection.cycles.reduce((sum, c) => sum + (c.repeats || 0), 0);
  const keyParams: MethodProjection["keyParams"] = [];
  if (projection.cycles.length > 0) {
    keyParams.push({ label: "Cycles", value: String(totalRepeats) });
  }
  if (projection.ingredients.length > 0) {
    keyParams.push({ label: "Reagents", value: String(projection.ingredients.length) });
  }

  return { pcr: projection, keyParams };
}

function toPcrStep(s: { name: string; temperature: number; duration: string }): MethodPcrStep {
  return { name: s.name, temperature: s.temperature, duration: s.duration };
}

/**
 * Build the LC projection. The attachment's lc_gradient override snapshot wins;
 * otherwise read the source LCGradientProtocol. Mirrors LcMethodTabContent.
 */
export async function buildLcProjection(
  method: Method,
  attachment: TaskMethodAttachment | undefined,
): Promise<{ lc: MethodLcProjection; keyParams: MethodProjection["keyParams"] }> {
  let protocol = parseJsonSafe<LCGradientProtocol>(attachment?.lc_gradient ?? null);

  if (!protocol) {
    const protocolId = extractProtocolId(method.source_path, "lc_gradient");
    if (protocolId !== null) {
      protocol = await lcGradientApi.get(protocolId, method.owner || undefined).catch(() => null);
    }
  }

  const steps = Array.isArray(protocol?.gradient_steps) ? protocol!.gradient_steps : [];
  const sortedSteps = [...steps].sort((a, b) => (a.time_min ?? 0) - (b.time_min ?? 0));
  const column = protocol?.column ?? {};
  const ingredients = Array.isArray(protocol?.ingredients) ? protocol!.ingredients : [];

  const projection: MethodLcProjection = {
    steps: sortedSteps.map((s) => ({
      timeMin: s.time_min,
      percentA: s.percent_a,
      percentB: s.percent_b,
      flowMlMin: s.flow_ml_min,
    })),
    column: {
      manufacturer: column.manufacturer ?? null,
      model: column.model ?? null,
      lengthMm: column.length_mm ?? null,
      innerDiameterMm: column.inner_diameter_mm ?? null,
      particleSizeUm: column.particle_size_um ?? null,
    },
    detectionWavelengthNm: protocol?.detection_wavelength_nm ?? null,
    ingredients: ingredients.map((ing) => ({
      name: ing.name,
      role: ing.role,
      concentration: ing.concentration ?? "",
    })),
    description: protocol?.description ?? null,
  };

  // Headline numbers: run length (last gradient time point) + detection nm.
  const keyParams: MethodProjection["keyParams"] = [];
  if (sortedSteps.length > 0) {
    const runtime = sortedSteps[sortedSteps.length - 1].time_min;
    keyParams.push({ label: "Runtime", value: `${runtime} min` });
  }
  if (projection.detectionWavelengthNm != null) {
    keyParams.push({ label: "Detection", value: `${projection.detectionWavelengthNm} nm` });
  }

  return { lc: projection, keyParams };
}

/**
 * Build the compound (kit) projection: the ordered child methods, each with its
 * own label + type badge so the phone shows the kit's steps at a glance. We do
 * NOT recursively expand each child's full recipe in v1 (that would bloat the
 * sealed blob); the phone shows the ordered child list and the researcher opens
 * the full kit on the laptop. Flagged for review.
 */
export async function buildCompoundProjection(
  method: Method,
  allMethods: Method[],
): Promise<{ compound: MethodCompoundProjection; keyParams: MethodProjection["keyParams"] }> {
  const components = Array.isArray(method.components) ? [...method.components] : [];
  components.sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0));

  const children = components.map((comp) => {
    const child = allMethods.find(
      (m) => m.id === comp.method_id && (comp.owner === null || m.owner === comp.owner),
    );
    return {
      methodId: comp.method_id,
      label: comp.label || child?.name || `Method ${comp.method_id}`,
      methodType: child?.method_type ?? null,
    };
  });

  const keyParams: MethodProjection["keyParams"] = [
    { label: "Steps", value: String(children.length) },
  ];

  return { compound: { children }, keyParams };
}

/**
 * Read a method's markdown body for the generic / markdown projection. The
 * attachment's body_override (the per-experiment edit) wins; otherwise read the
 * source .md the method's source_path points at. Best-effort, returns null when
 * neither is available so the phone shows an empty-state instead of crashing.
 */
export async function buildBody(
  method: Method,
  attachment: TaskMethodAttachment | undefined,
): Promise<string | null> {
  if (attachment?.body_override) return attachment.body_override;
  const sourcePath = method.source_path;
  // Only read genuine file paths; the structured types use `<scheme>://` source
  // paths that are not files (those carry no markdown body).
  if (!sourcePath || sourcePath.includes("://")) return null;
  try {
    const file = await filesApi.readFile(sourcePath);
    // Prefer a cached phone-friendly reformat when one exists AND was built from
    // the current body (the sidecar embeds the source SHA, so an edited method
    // invalidates it automatically). Best-effort: a miss falls through to the raw
    // body, which the phone's deterministic parser still renders as steps.
    const reformatted = await readFreshPhoneReformat(sourcePath, file.sha);
    return reformatted ?? file.content;
  } catch {
    return null;
  }
}

// ── Snapshot builder ─────────────────────────────────────────────────────────

/**
 * Build the method snapshot for one focused experiment. Reads the task, walks
 * its method_attachments, resolves each method, and builds a per-type read
 * projection. Returns null when the task cannot be read (so the publisher skips
 * a stale focus rather than publishing an empty shell).
 *
 * `taskOwner` routes the read to the right per-user namespace (the focused
 * experiment may be a task shared with the current user, owned by someone else).
 */
export async function buildMethodSnapshot(
  taskId: number,
  taskOwner: string,
): Promise<MethodSnapshot | null> {
  const task: Task | null = await tasksApi.get(taskId, taskOwner).catch(() => null);
  if (!task) return null;

  const attachments = Array.isArray(task.method_attachments) ? task.method_attachments : [];

  // Load all methods once so compound-child resolution + per-attachment lookup
  // share a single fetch. methodsApi.list returns private + public records.
  const allMethods = await methodsApi.list().catch(() => [] as Method[]);

  const methods: MethodProjection[] = [];

  for (const attachment of attachments) {
    // Resolve the method through the attachment's owner so per-user id
    // collisions (private 5 vs public 5) pick the right record. "public" and a
    // username both route through methodsApi.get; null means same owner as task.
    const lookupOwner =
      attachment.owner === null ? task.owner : attachment.owner;
    const method =
      (await methodsApi.get(attachment.method_id, lookupOwner).catch(() => null)) ??
      allMethods.find(
        (m) =>
          m.id === attachment.method_id &&
          (attachment.owner === null || m.owner === attachment.owner),
      ) ??
      null;

    if (!method) continue;

    const resolvedType = resolveMethodType(method.method_type, method.source_path);

    const projection: MethodProjection = {
      methodId: method.id,
      name: method.name,
      methodType: method.method_type ?? null,
      resolvedType,
      keyParams: [],
    };

    try {
      if (resolvedType === "pcr") {
        const { pcr, keyParams } = await buildPcrProjection(method, attachment);
        projection.pcr = pcr;
        projection.keyParams = keyParams;
      } else if (resolvedType === "lc_gradient") {
        const { lc, keyParams } = await buildLcProjection(method, attachment);
        projection.lc = lc;
        projection.keyParams = keyParams;
      } else if (resolvedType === "compound") {
        const { compound, keyParams } = await buildCompoundProjection(method, allMethods);
        projection.compound = compound;
        projection.keyParams = keyParams;
      } else {
        // markdown, pdf, plate, cell_culture, mass_spec, coding_workflow,
        // qpcr_analysis: show the protocol body / source text. These types each
        // have a rich laptop editor; for read-at-the-bench v1 the markdown body
        // (or override) is the common denominator. Structured detail for these
        // types is a follow-up. Flagged for review.
        projection.body = await buildBody(method, attachment);
      }
    } catch (err) {
      // One method failing to project must not drop the whole snapshot. Keep the
      // name + type so the phone still lists it, just without the recipe detail.
      console.warn(
        `[method-publisher] failed to project method ${method.id} (${resolvedType})`,
        err instanceof Error ? err.message : String(err),
      );
    }

    methods.push(projection);
  }

  return {
    generatedAt: new Date().toISOString(),
    taskId: task.id,
    owner: task.owner,
    experimentName: task.name,
    methods,
  };
}

// ── Publisher ────────────────────────────────────────────────────────────────

/**
 * Build the method snapshot for the focused experiment, seal a copy to each
 * paired phone's X25519 key, and publish it to the relay under the "method"
 * name. Mirrors publishNotebooksToAllDevices exactly.
 *
 * Returns how many devices it published to vs skipped (no seal key on file), or
 * a `published: 0` result when the task could not be read.
 */
export async function publishMethodToAllDevices(
  keys: UserCaptureKeys,
  taskId: number,
  taskOwner: string,
): Promise<{ published: number; skipped: number }> {
  const devices = await listDevices(keys);
  if (devices.length === 0) return { published: 0, skipped: 0 };

  const snap = await buildMethodSnapshot(taskId, taskOwner);
  if (!snap) return { published: 0, skipped: 0 };

  const plaintext = new TextEncoder().encode(JSON.stringify(snap));

  let published = 0;
  let skipped = 0;
  for (const device of devices) {
    if (!device.x25519Pubkey) {
      console.info(
        `[method-publisher] skip device ${device.devicePubkey.slice(0, 12)}... (no x25519 seal key)`,
      );
      skipped += 1;
      continue;
    }
    const sealed = sealToRecipient(
      plaintext,
      decodePublicKey(device.x25519Pubkey),
    );
    await publishSnapshot(keys, "method", device.devicePubkey, sealed);
    published += 1;
  }
  return { published, skipped };
}
