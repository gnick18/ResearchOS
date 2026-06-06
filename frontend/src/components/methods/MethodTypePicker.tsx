"use client";

import Tooltip from "@/components/Tooltip";
import {
  getMethodTypesByCategory,
  type MethodTypeId,
  type MethodTypeMeta,
} from "@/lib/methods/method-type-registry";
import { resolveEnabledMethodTypes } from "@/lib/methods/method-type-enablement";

/**
 * New-method type picker. Renders two grouped sections (Standard methods
 * for markdown/pdf, Structured methods for PCR plus future v1 types) using
 * the cosmetic registry as the source of truth. Adding a new method type is
 * a registry edit; the section it lands in is determined by its `category`.
 *
 * Extension Store Phase U2 (extension-store U2 bot): the picker now respects
 * per-account ENABLEMENT. A DISABLED type is hidden by default; passing
 * `enabledTypes` (the raw persisted `enabledMethodTypes` array, or null for
 * the default-all-enabled state) filters the tiles. When `onEnableType` is
 * also supplied, disabled types are NOT removed but shown in a muted
 * "enable to use" state with an inline enable affordance, matching the doc's
 * "enable a disabled type on use" note (METHOD doc §4.4). Omitting
 * `enabledTypes` entirely keeps the legacy behavior (every non-hidden type
 * shown), so the compound builders that don't curate are unaffected.
 */
export function MethodTypeCategoryPicker({
  uploadType,
  onSelect,
  enabledTypes,
  onEnableType,
}: {
  uploadType: MethodTypeId;
  onSelect: (id: MethodTypeId) => void;
  /** Raw persisted `enabledMethodTypes` (or null = all enabled). Absent prop
   *  = no enablement filtering at all (legacy / compound-builder behavior). */
  enabledTypes?: string[] | null;
  /** When provided, disabled types render muted with an "Enable" button that
   *  fires this instead of being hidden. Absent = disabled types are hidden. */
  onEnableType?: (id: MethodTypeId) => void;
}) {
  // When enablement isn't being curated on this surface (prop omitted), treat
  // every non-hidden type as enabled so behavior is unchanged.
  const curating = enabledTypes !== undefined;
  const enabledSet = curating
    ? resolveEnabledMethodTypes(enabledTypes)
    : null;

  const standard = visibleForPicker(
    getMethodTypesByCategory("standard"),
    enabledSet,
    Boolean(onEnableType),
  );
  const structured = visibleForPicker(
    getMethodTypesByCategory("structured"),
    enabledSet,
    Boolean(onEnableType),
  );

  return (
    <div className="space-y-4" data-tour-target="methods-type-picker">
      <MethodTypeSection
        heading="Standard methods"
        types={standard}
        selectedId={uploadType}
        enabledSet={enabledSet}
        onSelect={onSelect}
        onEnableType={onEnableType}
      />
      {structured.length > 0 && (
        <MethodTypeSection
          heading="Structured methods"
          types={structured}
          selectedId={uploadType}
          enabledSet={enabledSet}
          onSelect={onSelect}
          onEnableType={onEnableType}
        />
      )}
    </div>
  );
}

/**
 * Decide which metas a category renders. When not curating, every meta. When
 * curating WITHOUT an enable affordance, only enabled metas (disabled ones
 * vanish). When curating WITH an enable affordance, all metas (disabled ones
 * stay so the user can enable them in place).
 */
function visibleForPicker(
  metas: MethodTypeMeta[],
  enabledSet: Set<MethodTypeId> | null,
  hasEnableAffordance: boolean,
): MethodTypeMeta[] {
  if (!enabledSet) return metas;
  if (hasEnableAffordance) return metas;
  return metas.filter((m) => enabledSet.has(m.id));
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
  enabledSet,
  onSelect,
  onEnableType,
}: {
  heading: string;
  types: ReturnType<typeof getMethodTypesByCategory>;
  selectedId: MethodTypeId;
  enabledSet: Set<MethodTypeId> | null;
  onSelect: (id: MethodTypeId) => void;
  onEnableType?: (id: MethodTypeId) => void;
}) {
  return (
    <div>
      <label className="block text-meta font-medium text-foreground-muted mb-2">
        {heading}
      </label>
      <div className="flex flex-wrap gap-2">
        {types.map((meta) => {
          const Icon = meta.icon;
          const selected = selectedId === meta.id;
          const disabled = enabledSet ? !enabledSet.has(meta.id) : false;

          // A disabled tile (only reachable when an enable affordance is
          // present) shows muted with an "Enable" button instead of acting
          // as a selectable tile.
          if (disabled && onEnableType) {
            return (
              <div
                key={meta.id}
                data-tour-target={methodTypeTourSlug(meta.id)}
                className="flex-1 min-w-[180px] px-4 py-3 rounded-lg border border-dashed border-border bg-surface-sunken/60"
              >
                <div className="flex items-center gap-2 text-foreground-muted">
                  <Icon className="w-4 h-4" />
                  <span className="text-body">{meta.label}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-meta text-foreground-muted">Disabled in your library</p>
                  <Tooltip label={`Enable ${meta.label}`} placement="top">
                    <button
                      type="button"
                      onClick={() => onEnableType(meta.id)}
                      className="shrink-0 text-meta font-medium text-blue-600 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300"
                    >
                      Enable
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          }

          return (
            <button
              key={meta.id}
              type="button"
              onClick={() => onSelect(meta.id)}
              data-tour-target={methodTypeTourSlug(meta.id)}
              className={`flex-1 min-w-[180px] text-left px-4 py-3 rounded-lg border transition-colors ${
                selected
                  ? `${meta.color.bg} ${meta.color.text} border-current font-medium`
                  : "border-border text-foreground-muted hover:bg-surface-sunken"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" />
                <span className="text-body">{meta.label}</span>
              </div>
              {meta.description && (
                <p className={`mt-1 text-meta ${selected ? "" : "text-foreground-muted"}`}>
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
