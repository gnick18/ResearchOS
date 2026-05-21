"use client";

import {
  getMethodTypesByCategory,
  type MethodTypeId,
} from "@/lib/methods/method-type-registry";

/**
 * New-method type picker. Renders two grouped sections — Standard methods
 * (markdown/pdf) and Structured methods (PCR, plus future v1 types) — using
 * the cosmetic registry as the source of truth. Adding a new method type is
 * a registry edit; the section it lands in is determined by its `category`.
 */
export function MethodTypeCategoryPicker({
  uploadType,
  onSelect,
}: {
  uploadType: MethodTypeId;
  onSelect: (id: MethodTypeId) => void;
}) {
  const standard = getMethodTypesByCategory("standard");
  const structured = getMethodTypesByCategory("structured");

  return (
    <div className="space-y-4" data-tour-target="methods-type-picker">
      <MethodTypeSection
        heading="Standard methods"
        types={standard}
        selectedId={uploadType}
        onSelect={onSelect}
      />
      {structured.length > 0 && (
        <MethodTypeSection
          heading="Structured methods"
          types={structured}
          selectedId={uploadType}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

/**
 * Map a `MethodTypeId` to the `data-tour-target` slug used by the
 * Onboarding v4 walkthrough (§6.4b breadth tour). Kebab-cased, prefixed
 * `method-type-`. The breadth-tour cursor script hovers each tile in
 * sequence so users see that each type is its own editable graphic.
 *
 * Mapping rules:
 *   - underscores become hyphens (lc_gradient -> lc-gradient)
 *   - `plate` aliases to `plate-layout` per the breadth-step brief
 *   - `qpcr_analysis` aliases to `qpcr`
 *   - `coding_workflow` aliases to `coding`
 *
 * The aliases mirror how the speech bubble names the type ("Plate layouts",
 * "qPCR", "Coding") so the v4 step body can list one canonical kebab key
 * per type without leaking the internal `_analysis` / `_workflow` suffixes.
 */
export function methodTypeTourSlug(id: MethodTypeId): string {
  switch (id) {
    case "plate":
      return "method-type-plate-layout";
    case "qpcr_analysis":
      return "method-type-qpcr";
    case "coding_workflow":
      return "method-type-coding";
    default:
      return `method-type-${id.replace(/_/g, "-")}`;
  }
}

function MethodTypeSection({
  heading,
  types,
  selectedId,
  onSelect,
}: {
  heading: string;
  types: ReturnType<typeof getMethodTypesByCategory>;
  selectedId: MethodTypeId;
  onSelect: (id: MethodTypeId) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-2">
        {heading}
      </label>
      <div className="flex flex-wrap gap-2">
        {types.map((meta) => {
          const Icon = meta.icon;
          const selected = selectedId === meta.id;
          return (
            <button
              key={meta.id}
              type="button"
              onClick={() => onSelect(meta.id)}
              data-tour-target={methodTypeTourSlug(meta.id)}
              className={`flex-1 min-w-[180px] text-left px-4 py-3 rounded-lg border transition-colors ${
                selected
                  ? `${meta.color.bg} ${meta.color.text} border-current font-medium`
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" />
                <span className="text-sm">{meta.label}</span>
              </div>
              {meta.description && (
                <p className={`mt-1 text-xs ${selected ? "" : "text-gray-400"}`}>
                  {meta.description}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
