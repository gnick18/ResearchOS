/**
 * Cosmetic-only registry for method types — labels, colors, icons, picker
 * tile metadata. Mirrors PCR-shaped affordances (badge, picker tile, sidebar
 * icon) across every type so cosmetic sites stay in sync as new types land.
 *
 * Deliberately excluded:
 *  - Viewer / editor components. Per-type viewers are dispatched via a
 *    switch in MethodTabs.tsx (and methods/page.tsx) so each viewer's bundle
 *    can be code-split. A registry of components would couple bundle weight
 *    to every registered type.
 *  - Repair functions. User-initiated per-type buttons import directly.
 *  - API surfaces (`pcrApi` etc). Each per-type API is imported by the page
 *    that needs it; cross-type batch operations are vanishingly rare.
 *
 * `MethodTypeId` is an alias of the source-of-truth literal union on
 * `Method.method_type` in types.ts:411. The two widen in lockstep as new
 * types land.
 */

import type { ComponentType } from "react";
import {
  CellCultureIcon,
  CodingWorkflowIcon,
  CompoundIcon,
  LcGradientIcon,
  MarkdownIcon,
  MassSpecIcon,
  PcrIcon,
  PdfIcon,
  PlateIcon,
  QpcrAnalysisIcon,
} from "./method-type-icons";

export type MethodTypeId =
  | "markdown"
  | "pdf"
  | "pcr"
  | "lc_gradient"
  | "plate"
  | "cell_culture"
  | "mass_spec"
  | "compound"
  | "coding_workflow"
  | "qpcr_analysis";

export interface MethodTypeMeta {
  /** The discriminator value as written to disk. */
  id: MethodTypeId;
  /** Display label for badges and picker tiles. */
  label: string;
  /** Compact label for tight spaces (badge pills, picker sub-lines). */
  shortLabel: string;
  /** Tailwind color pair applied to badge pills (bg + text). */
  color: { bg: string; text: string };
  /** Per-type icon component (inline SVG). */
  icon: ComponentType<{ className?: string; size?: number }>;
  /** Optional one-line description shown under the picker tile. */
  description?: string;
  /** True when the type has a structured protocol record alongside the
   * Method row (e.g. PCR's PCRProtocol). Drives "is this a structured
   * editor?" gating. */
  hasStructuredProtocol: boolean;
  /** Picker grouping. Structured types appear in the "Structured methods"
   * section; standard types in "Standard methods". */
  category: "standard" | "structured";
  /** When true, the type is excluded from the new-method picker. The type is
   * still a valid `method_type` discriminator and keeps its badge / icon /
   * color metadata; it just isn't a user-selectable tile. Used by
   * `compound`, which is reached as an extension of an existing method
   * (via the "+ Add component (extend into kit)" affordance), not as a
   * standalone "+ New Method" choice. */
  hiddenFromPicker?: boolean;
}

export const METHOD_TYPE_REGISTRY: Record<MethodTypeId, MethodTypeMeta> = {
  markdown: {
    id: "markdown",
    label: "Markdown",
    shortLabel: "Markdown",
    color: { bg: "bg-gray-100", text: "text-gray-500" },
    icon: MarkdownIcon,
    description: "Free-form protocol text with images and tables.",
    hasStructuredProtocol: false,
    category: "standard",
  },
  pdf: {
    id: "pdf",
    label: "PDF",
    shortLabel: "PDF",
    color: { bg: "bg-orange-100", text: "text-orange-600" },
    icon: PdfIcon,
    description: "Upload an existing PDF protocol.",
    hasStructuredProtocol: false,
    category: "standard",
  },
  pcr: {
    id: "pcr",
    label: "PCR",
    shortLabel: "PCR",
    color: { bg: "bg-purple-100", text: "text-purple-600" },
    icon: PcrIcon,
    description: "Thermocycler program + reaction recipe.",
    hasStructuredProtocol: true,
    category: "structured",
  },
  lc_gradient: {
    id: "lc_gradient",
    label: "LC Gradient",
    shortLabel: "LC",
    color: { bg: "bg-sky-100", text: "text-sky-600" },
    icon: LcGradientIcon,
    description: "HPLC/LC-MS solvent gradient + flow + column + ingredients.",
    hasStructuredProtocol: true,
    category: "structured",
  },
  plate: {
    id: "plate",
    label: "Plate Layout",
    shortLabel: "Plate",
    color: { bg: "bg-emerald-100", text: "text-emerald-600" },
    icon: PlateIcon,
    description: "Well-plate layout — sample/control/blank annotations.",
    hasStructuredProtocol: true,
    category: "structured",
  },
  cell_culture: {
    id: "cell_culture",
    label: "Cell culture passaging",
    shortLabel: "Cell culture",
    color: { bg: "bg-rose-100", text: "text-rose-600" },
    icon: CellCultureIcon,
    description: "Passaging schedule + media + cell line, with per-task passage history.",
    hasStructuredProtocol: true,
    category: "structured",
  },
  mass_spec: {
    id: "mass_spec",
    label: "Mass spec",
    shortLabel: "MS",
    color: { bg: "bg-violet-100", text: "text-violet-600" },
    icon: MassSpecIcon,
    description: "Ionization mode + source/scan params + calibration. Pairs with LC for LC-MS.",
    hasStructuredProtocol: true,
    category: "structured",
  },
  compound: {
    id: "compound",
    label: "Kit",
    shortLabel: "Kit",
    color: { bg: "bg-indigo-100", text: "text-indigo-600" },
    icon: CompoundIcon,
    description: "Bundle existing methods into one attachable kit (e.g. plate + assay PDF).",
    hasStructuredProtocol: true,
    category: "structured",
    // Hidden from the new-method picker: compounds are reached by extending
    // an existing method via "+ Add component (extend into kit)", not as a
    // standalone tile. Keeps the registry shape symmetric with other types
    // (badge / icon / color all still resolve) without offering a picker
    // entry-point that's the wrong mental model.
    hiddenFromPicker: true,
  },
  coding_workflow: {
    id: "coding_workflow",
    label: "Coding workflow",
    shortLabel: "Code",
    color: { bg: "bg-cyan-100", text: "text-cyan-600" },
    icon: CodingWorkflowIcon,
    description: "Reusable scripts (Python/R/SQL/etc.) and Jupyter notebooks.",
    hasStructuredProtocol: true,
    category: "structured",
  },
  qpcr_analysis: {
    id: "qpcr_analysis",
    label: "qPCR analysis",
    shortLabel: "qPCR",
    color: { bg: "bg-amber-100", text: "text-amber-700" },
    icon: QpcrAnalysisIcon,
    description:
      "Cq readouts, melt-curve Tm, standard-curve efficiency, and ΔΔCq fold-change. Pairs with a PCR cycling method via a kit for a full qPCR workflow.",
    hasStructuredProtocol: true,
    category: "structured",
  },
};

/**
 * Look up cosmetic meta for a method type. Null falls back to markdown
 * (the historical default for legacy records written before `method_type`
 * was added).
 */
export function getMethodTypeMeta(id: MethodTypeId | null | undefined): MethodTypeMeta {
  if (!id) return METHOD_TYPE_REGISTRY.markdown;
  return METHOD_TYPE_REGISTRY[id] ?? METHOD_TYPE_REGISTRY.markdown;
}

/**
 * All registered types belonging to the given picker category. Used by the
 * new-method dialog to render the Standard / Structured sections, so
 * `hiddenFromPicker` types are excluded.
 */
export function getMethodTypesByCategory(
  category: "standard" | "structured",
): MethodTypeMeta[] {
  return Object.values(METHOD_TYPE_REGISTRY).filter(
    (m) => m.category === category && !m.hiddenFromPicker,
  );
}
