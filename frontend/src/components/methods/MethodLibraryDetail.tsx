"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import remarkUnderline from "@/lib/markdown/remark-underline";
import Tooltip from "@/components/Tooltip";
import {
  fetchMethodCatalogTemplate,
  type MethodCatalogManifestEntry,
  type MethodCatalogTemplate,
} from "@/lib/methods/method-catalog";
import {
  getMethodTypeMeta,
  type MethodTypeId,
  type MethodTypeMeta,
} from "@/lib/methods/method-type-registry";
import type { MethodModuleMeta } from "@/lib/methods/method-module";
import {
  distinctComponentTypes,
  missingComponentTypes,
  resolveCatalogCompoundComponents,
} from "@/lib/methods/compound-template-detail";
import type { ResolvedCompoundComponent } from "@/lib/methods/compound-template-detail";
import type {
  CellCultureMedia,
  IonizationMode,
  LCIngredientRole,
  PCRStep,
  PlateWellRole,
} from "@/lib/types";

/**
 * Method library DETAIL pane (Extension Store Phase D, store-detail bot,
 * 2026-05-30). Fills the StoreShell's right column for the method library,
 * replacing the Phase B/C placeholder. Three shapes, matching the locked
 * information architecture (types / single-type templates / combination kits):
 *
 *  - MethodTypeDetail: describes the structured editor, shows a small sample
 *    rendering of the type, lists "Templates built on this type" as clickable
 *    cross-links (switch to the Templates segment + select), and the footer
 *    enables/disables the type.
 *  - SingleTemplateDetail: fetches the template payload lazily and renders it
 *    READ-ONLY (markdown body, or a compact structured recipe / gradient /
 *    plate / mass-spec view), shows the ONE type badge it is built on, and a
 *    "Use template" footer gated to "Enable <type>" first when that type is
 *    disabled.
 *  - CompoundTemplateDetail: shows ALL component type badges read off the
 *    components graph, renders the bundled steps, and gates "Use template"
 *    until ALL component types are enabled.
 *
 * This pane RENDERS and TRIGGERS only. Enablement (method-type-enablement.ts +
 * useEnabledMethodTypes) and instantiation (instantiateMethodFromTemplate) stay
 * where they live; the modal threads their setters down as callbacks.
 */

// ── Shared presentational atoms ──────────────────────────────────────────────

/** A type pill with the registry icon + label, used as a "built on" badge. */
function TypeBadge({ meta }: { meta: MethodTypeMeta }) {
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium ${meta.color.bg} ${meta.color.text}`}
    >
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

/** Section heading in the small-caps style the widget detail uses. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h5 className="text-meta font-semibold uppercase tracking-wide text-gray-400">
      {children}
    </h5>
  );
}

/** A label + value row for compact structured read-outs. Skips empty values. */
function Field({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-2 text-body">
      <span className="w-32 shrink-0 text-meta font-medium text-gray-400 pt-0.5">
        {label}
      </span>
      <span className="flex-1 min-w-0 text-gray-700">{value}</span>
    </div>
  );
}

function num(v: number | null | undefined): string | null {
  return v === null || v === undefined ? null : String(v);
}

/**
 * "Will be added to: <category>" line shown directly under the Use template
 * action (Extension Store polish, store-polish bot, 2026-05-30). The
 * destination category lives in the footer field, easy to scroll past, so
 * clicking Use template could silently file the method under Uncategorized.
 * This surfaces the destination next to the action; the category itself is a
 * button that scrolls to + focuses the footer field, so it stays reachable
 * from here. Renders nothing until a destLabel is supplied (e.g. in tests).
 */
function DestinationLine({
  destLabel,
  onChooseDestination,
}: {
  destLabel?: string;
  onChooseDestination?: () => void;
}) {
  if (!destLabel) return null;
  return (
    <p className="mt-2 text-center text-meta text-gray-500">
      Will be added to:{" "}
      {onChooseDestination ? (
        <button
          type="button"
          onClick={onChooseDestination}
          className="font-medium text-blue-600 hover:underline"
        >
          {destLabel}
        </button>
      ) : (
        <span className="font-medium text-gray-700">{destLabel}</span>
      )}
    </p>
  );
}

// ── 1. Method TYPE detail ────────────────────────────────────────────────────

export function MethodTypeDetail({
  module,
  on,
  curating,
  onToggle,
  templatesOfType,
  onOpenTemplate,
}: {
  module: MethodModuleMeta;
  on: boolean;
  curating: boolean;
  onToggle: (next: boolean) => void;
  /** Catalog templates whose method_type is this type (for cross-links). */
  templatesOfType: MethodCatalogManifestEntry[];
  /** Cross-link: open a template (switches to Templates segment + selects). */
  onOpenTemplate: (entry: MethodCatalogManifestEntry) => void;
}) {
  const meta = module.cosmetic;
  const Icon = meta.icon;
  return (
    <div className="flex flex-col gap-4">
      {/* Title + enabled status pill */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg ${meta.color.bg} ${meta.color.text}`}
          >
            <Icon className="w-4 h-4" />
          </span>
          <h4 className="text-title font-semibold text-gray-900 truncate">
            {meta.label}
          </h4>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-meta font-medium ${
            on ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"
          }`}
        >
          {on ? "Enabled" : "Disabled"}
        </span>
      </div>

      {/* What the editor is */}
      <section className="flex flex-col gap-2">
        <SectionLabel>The editor</SectionLabel>
        {meta.description && (
          <p className="text-body text-gray-700 leading-snug">
            {meta.description}
          </p>
        )}
        <p className="text-body text-gray-500 leading-snug">
          {module.hasStructuredProtocol
            ? "A structured editor: methods of this type carry typed fields you fill in, not just free text."
            : "A standard editor: free-form content with no typed structure."}
        </p>
      </section>

      {/* Small sample rendering of the type */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Sample</SectionLabel>
        <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          <TypeSampleRendering typeId={meta.id} />
        </div>
      </section>

      {/* Templates built on this type (cross-links) */}
      <section className="flex flex-col gap-2 border-t border-gray-100 pt-3">
        <SectionLabel>Templates built on this type</SectionLabel>
        {templatesOfType.length === 0 ? (
          <p className="text-body text-gray-400">
            No prebuilt templates use this type yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {templatesOfType.map((t) => (
              <li key={t.slug}>
                <button
                  type="button"
                  onClick={() => onOpenTemplate(t)}
                  className="group flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-body text-blue-700 hover:bg-blue-50"
                >
                  <span className="truncate">{t.title}</span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0 text-blue-400 group-hover:text-blue-600"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Footer: enable / disable the type */}
      <section className="border-t border-gray-100 pt-4">
        <EnableTypeToggle
          meta={meta}
          on={on}
          curating={curating}
          onToggle={onToggle}
        />
      </section>
    </div>
  );
}

/** Footer toggle for a method type. Disabled + explained when signed out. */
function EnableTypeToggle({
  meta,
  on,
  curating,
  onToggle,
}: {
  meta: MethodTypeMeta;
  on: boolean;
  curating: boolean;
  onToggle: (next: boolean) => void;
}) {
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${on ? "Disable" : "Enable"} ${meta.label}`}
      disabled={!curating}
      onClick={() => {
        if (!curating) return;
        onToggle(!on);
      }}
      className="inline-flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-2.5 text-body font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span>
        {on
          ? `${meta.label} is in your library`
          : `${meta.label} is hidden from New Method`}
      </span>
      <span
        className={`relative shrink-0 inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          on ? "bg-blue-600" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            on ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
  if (curating) return toggle;
  return (
    <Tooltip label="Sign in to change this" placement="top">
      {toggle}
    </Tooltip>
  );
}

// ── 2. Single-type TEMPLATE detail ───────────────────────────────────────────

export function SingleTemplateDetail({
  entry,
  typeEnabled,
  isUsing,
  anyUsing,
  onUse,
  onEnableType,
  destLabel,
  onChooseDestination,
  fetchTemplate = fetchMethodCatalogTemplate,
}: {
  entry: MethodCatalogManifestEntry;
  typeEnabled: boolean;
  isUsing: boolean;
  anyUsing: boolean;
  onUse: () => void;
  onEnableType: () => void;
  /** Category the new method will land in (the footer destination field).
   *  Shown under Use template so the destination is never a silent default. */
  destLabel?: string;
  /** Focus the footer destination field so the category is reachable here. */
  onChooseDestination?: () => void;
  /** Swappable for tests; defaults to the real catalog loader. */
  fetchTemplate?: (slug: string) => Promise<MethodCatalogTemplate>;
}) {
  const meta = getMethodTypeMeta(entry.method_type as MethodTypeId);
  const [template, setTemplate] = useState<MethodCatalogTemplate | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  // Fetch the full payload lazily on selection (the manifest entry carries only
  // metadata). Re-runs when the selected slug changes.
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setTemplate(null);
    fetchTemplate(entry.slug)
      .then((t) => {
        if (cancelled) return;
        setTemplate(t);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [entry.slug, fetchTemplate]);

  return (
    <div className="flex flex-col gap-4">
      {/* Title + the ONE type badge it is built on */}
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-title font-semibold text-gray-900">{entry.title}</h4>
        <TypeBadge meta={meta} />
      </div>

      {entry.description && (
        <p className="text-body text-gray-700 leading-snug">{entry.description}</p>
      )}

      {entry.tags && entry.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className="text-meta px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {entry.source_pdf && (
        <p className="text-meta text-gray-500">
          Includes a bundled source PDF ({entry.source_pdf.filename}), copied
          alongside the method when you use it.
        </p>
      )}

      {/* Read-only payload preview */}
      <section className="flex flex-col gap-2 border-t border-gray-100 pt-3">
        <SectionLabel>Preview</SectionLabel>
        {state === "loading" && (
          <div
            aria-hidden="true"
            className="flex animate-pulse flex-col gap-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3"
          >
            <div className="h-2.5 w-1/2 rounded bg-gray-200" />
            <div className="h-2 w-3/4 rounded bg-gray-100" />
            <div className="h-2 w-2/3 rounded bg-gray-100" />
          </div>
        )}
        {state === "error" && (
          <p className="text-body text-gray-400">
            The preview is unavailable right now. It needs an internet
            connection. You can still use the template.
          </p>
        )}
        {state === "ready" && template && (
          <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
            <StructuredPayloadView template={template} />
          </div>
        )}
      </section>

      {/* Footer action: Use template, gated behind Enable <type> first */}
      <section className="border-t border-gray-100 pt-4">
        {typeEnabled ? (
          <>
            <button
              type="button"
              onClick={onUse}
              disabled={anyUsing}
              className="w-full px-4 py-2.5 text-body font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isUsing ? "Adding..." : "Use template"}
            </button>
            <DestinationLine
              destLabel={destLabel}
              onChooseDestination={onChooseDestination}
            />
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-meta text-amber-600">
              {meta.label} is disabled in your library. Enable it to use this
              template.
            </p>
            <button
              type="button"
              onClick={onEnableType}
              className="w-full px-4 py-2.5 text-body font-medium border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50"
            >
              Enable {meta.label}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ── 3. COMBINATION (compound) TEMPLATE detail ────────────────────────────────

export function CompoundTemplateDetail({
  title,
  description,
  components,
  componentTypes,
  enabledIds,
  isUsing = false,
  anyUsing = false,
  onUse,
  onEnableType,
  destLabel,
  onChooseDestination,
}: {
  title: string;
  description?: string;
  /** Ordered, resolved components (the bundled steps). */
  components: ResolvedCompoundComponent[];
  /** Distinct component types the kit depends on (the badges + gating set). */
  componentTypes: MethodTypeId[];
  enabledIds: Set<MethodTypeId>;
  isUsing?: boolean;
  anyUsing?: boolean;
  onUse?: () => void;
  /** Enable one missing component type. */
  onEnableType?: (typeId: MethodTypeId) => void;
  /** Category the new kit will land in (the footer destination field). */
  destLabel?: string;
  /** Focus the footer destination field so the category is reachable here. */
  onChooseDestination?: () => void;
}) {
  const missing = missingComponentTypes(componentTypes, enabledIds);
  const allEnabled = missing.length === 0;
  const compoundMeta = getMethodTypeMeta("compound");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-title font-semibold text-gray-900">{title}</h4>
        <TypeBadge meta={compoundMeta} />
      </div>

      {description && (
        <p className="text-body text-gray-700 leading-snug">{description}</p>
      )}

      {/* ALL component type badges read off the components graph */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Built on these types</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {componentTypes.map((t) => {
            const meta = getMethodTypeMeta(t);
            const enabled = enabledIds.has(t);
            return (
              <span
                key={t}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium ${
                  enabled
                    ? `${meta.color.bg} ${meta.color.text}`
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                <meta.icon className="w-3 h-3" />
                {meta.label}
                {!enabled && <span className="ml-0.5">(off)</span>}
              </span>
            );
          })}
        </div>
      </section>

      {/* Bundled steps */}
      <section className="flex flex-col gap-2 border-t border-gray-100 pt-3">
        <SectionLabel>Bundled steps</SectionLabel>
        <ol className="flex flex-col gap-1.5">
          {components.map((c, i) => {
            const meta =
              c.method_type === null ? null : getMethodTypeMeta(c.method_type);
            return (
              <li
                key={`${c.owner}:${c.method_id}:${i}`}
                className="flex items-center gap-2 text-body"
              >
                <span className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-meta font-medium text-gray-600">
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0 truncate text-gray-700">
                  {c.label}
                </span>
                {meta ? (
                  <TypeBadge meta={meta} />
                ) : (
                  <span className="text-meta text-amber-600">
                    Component missing
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Footer: gated until ALL component types are enabled */}
      <section className="border-t border-gray-100 pt-4">
        {allEnabled ? (
          <>
            <button
              type="button"
              onClick={onUse}
              disabled={anyUsing}
              className="w-full px-4 py-2.5 text-body font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isUsing ? "Adding..." : "Use kit"}
            </button>
            <DestinationLine
              destLabel={destLabel}
              onChooseDestination={onChooseDestination}
            />
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-meta text-amber-600">
              Enable all required types to use this kit:
            </p>
            <p className="text-meta text-gray-500">
              These types are turned off in your library. Enabling one turns it
              on for every method, not just this kit.
            </p>
            <div className="flex flex-col gap-1.5">
              {missing.map((t) => {
                const meta = getMethodTypeMeta(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onEnableType?.(t)}
                    className="w-full px-4 py-2 text-body font-medium border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50"
                  >
                    Enable {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Lazy-loading wrapper that adapts a CATALOG compound (kit) entry to the
 * `CompoundTemplateDetail` renderer. The manifest entry carries only metadata,
 * so this fetches the full payload on selection (the same lazy pattern
 * `SingleTemplateDetail` uses), resolves the `{slug, ordering, label?}`
 * components against the manifest by slug into the render-ready shape, derives
 * the distinct component types (the gating set), and hands them to the renderer.
 *
 * The renderer itself owns the all-types gate (it calls `missingComponentTypes`
 * on `componentTypes` + `enabledIds`), so we deliberately render it ONLY once
 * the payload is ready: an empty `componentTypes` while loading would read as
 * "nothing missing" and prematurely unlock the action. Until then we show the
 * title + a status line, mirroring the single-template loading state.
 */
export function CompoundTemplateDetailLoader({
  entry,
  manifestEntries,
  enabledIds,
  isUsing,
  anyUsing,
  onUse,
  onEnableType,
  destLabel,
  onChooseDestination,
  fetchTemplate = fetchMethodCatalogTemplate,
}: {
  entry: MethodCatalogManifestEntry;
  /** The full manifest list, used to resolve each child component by slug. */
  manifestEntries: MethodCatalogManifestEntry[];
  enabledIds: Set<MethodTypeId>;
  isUsing: boolean;
  anyUsing: boolean;
  onUse: () => void;
  onEnableType: (typeId: MethodTypeId) => void;
  /** Category the new kit will land in (forwarded to the destination line). */
  destLabel?: string;
  /** Focus the footer destination field so the category is reachable here. */
  onChooseDestination?: () => void;
  /** Swappable for tests; defaults to the real catalog loader. */
  fetchTemplate?: (slug: string) => Promise<MethodCatalogTemplate>;
}) {
  const [template, setTemplate] = useState<MethodCatalogTemplate | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setTemplate(null);
    fetchTemplate(entry.slug)
      .then((t) => {
        if (cancelled) return;
        setTemplate(t);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [entry.slug, fetchTemplate]);

  const manifestBySlug = useMemo(() => {
    const map = new Map<string, MethodCatalogManifestEntry>();
    for (const e of manifestEntries) map.set(e.slug, e);
    return map;
  }, [manifestEntries]);

  const components = useMemo<ResolvedCompoundComponent[]>(() => {
    if (!template || template.method_type !== "compound") return [];
    return resolveCatalogCompoundComponents(
      template.payload.components,
      manifestBySlug,
    );
  }, [template, manifestBySlug]);

  const componentTypes = useMemo(
    () => distinctComponentTypes(components),
    [components],
  );

  if (state !== "ready" || !template || template.method_type !== "compound") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-title font-semibold text-gray-900">
            {entry.title}
          </h4>
          <TypeBadge meta={getMethodTypeMeta("compound")} />
        </div>
        {entry.description && (
          <p className="text-body text-gray-700 leading-snug">
            {entry.description}
          </p>
        )}
        <p className="text-body text-gray-400">
          {state === "error"
            ? "The kit details are unavailable right now. They need an internet connection. Reconnect and reopen this kit to use it."
            : "Loading kit..."}
        </p>
      </div>
    );
  }

  return (
    <CompoundTemplateDetail
      title={entry.title}
      description={template.payload.description ?? entry.description}
      components={components}
      componentTypes={componentTypes}
      enabledIds={enabledIds}
      isUsing={isUsing}
      anyUsing={anyUsing}
      onUse={onUse}
      onEnableType={onEnableType}
      destLabel={destLabel}
      onChooseDestination={onChooseDestination}
    />
  );
}

// ── Read-only payload renderers ──────────────────────────────────────────────

/** Render a fetched template payload read-only, switching on method_type. */
function StructuredPayloadView({
  template,
}: {
  template: MethodCatalogTemplate;
}) {
  switch (template.method_type) {
    case "markdown":
      return <MarkdownBody body={template.payload.body} />;
    case "pcr":
      return (
        <PcrPayloadView
          steps={flattenPcrSteps(template.payload.gradient)}
          ingredientCount={template.payload.ingredients.length}
        />
      );
    case "lc_gradient":
      return (
        <div className="flex flex-col gap-2">
          <GradientStepsTable steps={template.payload.gradient_steps} />
          <Field label="Column" value={lcColumnLabel(template.payload.column)} />
          <Field
            label="Detection"
            value={
              template.payload.detection_wavelength_nm
                ? `${template.payload.detection_wavelength_nm} nm`
                : null
            }
          />
          <Field
            label="Ingredients"
            value={ingredientList(
              template.payload.ingredients.map((g) => ({
                name: g.name,
                role: LC_ROLE_LABEL[g.role],
              })),
            )}
          />
        </div>
      );
    case "plate":
      return (
        <div className="flex flex-col gap-2">
          <Field
            label="Plate size"
            value={`${template.payload.plate_size}-well`}
          />
          <PlateRegions regions={template.payload.region_labels} />
        </div>
      );
    case "cell_culture":
      return (
        <div className="flex flex-col gap-2">
          <Field label="Cell line" value={template.payload.cell_line.name} />
          <Field label="Species" value={template.payload.cell_line.species} />
          <Field label="Media" value={mediaLabel(template.payload.media)} />
          <PlannedEvents events={template.payload.planned_events} />
        </div>
      );
    case "mass_spec":
      return (
        <div className="flex flex-col gap-2">
          <Field label="Instrument" value={template.payload.instrument} />
          <Field
            label="Ionization"
            value={
              template.payload.ionization_label ||
              IONIZATION_LABEL[template.payload.ionization_mode]
            }
          />
          <Field
            label="Scan range"
            value={scanRangeLabel(
              template.payload.scan.scan_mz_low,
              template.payload.scan.scan_mz_high,
            )}
          />
          <Field
            label="Resolution"
            value={num(template.payload.scan.resolution_r)}
          />
          <Field
            label="MS/MS"
            value={template.payload.scan.is_msms ? "Yes" : "No"}
          />
          <Field
            label="Calibration"
            value={template.payload.calibration.reference_standard}
          />
        </div>
      );
    case "compound":
      // A compound (kit) has no flat structured payload to preview here: its
      // bundled steps are rendered by CompoundTemplateDetail, and the modal
      // routes compound entries to CompoundTemplateDetailLoader, never to
      // SingleTemplateDetail. This case is unreachable at runtime; it exists so
      // the switch stays exhaustive over the (now compound-bearing) catalog
      // template union.
      return null;
    default: {
      const _exhaustive: never = template;
      void _exhaustive;
      return null;
    }
  }
}

/** Read-only markdown body, rendered with the same plugin stack the method
 *  markdown viewer uses (GFM + underline + sanitized raw HTML). */
function MarkdownBody({ body }: { body: string }) {
  if (!body || body.trim().length === 0) {
    return <p className="text-body text-gray-400">Empty protocol body.</p>;
  }
  return (
    <div className="prose prose-sm max-w-none text-gray-700 max-h-72 overflow-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkUnderline]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

/** Flatten a PCR gradient into an ordered step list for a compact strip. */
function flattenPcrSteps(gradient: {
  initial: PCRStep[];
  cycles: { repeats: number; steps: PCRStep[] }[];
  final: PCRStep[];
  hold: PCRStep | null;
}): { label: string; detail: string }[] {
  const out: { label: string; detail: string }[] = [];
  for (const s of gradient.initial) {
    out.push({ label: s.name, detail: `${s.temperature}C, ${s.duration}` });
  }
  gradient.cycles.forEach((cy, i) => {
    const inner = cy.steps
      .map((s) => `${s.temperature}C ${s.duration}`)
      .join(" / ");
    out.push({
      label: `Cycle ${i + 1} (x${cy.repeats})`,
      detail: inner,
    });
  });
  for (const s of gradient.final) {
    out.push({ label: s.name, detail: `${s.temperature}C, ${s.duration}` });
  }
  if (gradient.hold) {
    out.push({
      label: gradient.hold.name || "Hold",
      detail: `${gradient.hold.temperature}C, ${gradient.hold.duration}`,
    });
  }
  return out;
}

function PcrPayloadView({
  steps,
  ingredientCount,
}: {
  steps: { label: string; detail: string }[];
  ingredientCount: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-1">
        {steps.map((s, i) => (
          <li key={i} className="flex items-baseline gap-2 text-body">
            <span className="w-40 shrink-0 truncate text-gray-700">
              {s.label}
            </span>
            <span className="flex-1 min-w-0 text-gray-500">{s.detail}</span>
          </li>
        ))}
      </ol>
      <Field
        label="Reaction mix"
        value={`${ingredientCount} ingredient${ingredientCount === 1 ? "" : "s"}`}
      />
    </div>
  );
}

function GradientStepsTable({
  steps,
}: {
  steps: { time_min: number; percent_a: number; percent_b: number; flow_ml_min: number }[];
}) {
  if (steps.length === 0) return null;
  return (
    <div>
      <span className="text-meta font-medium text-gray-400">Gradient</span>
      <table className="mt-1 w-full text-body">
        <thead>
          <tr className="text-left text-meta text-gray-400">
            <th className="font-medium pr-2">min</th>
            <th className="font-medium pr-2">%A</th>
            <th className="font-medium pr-2">%B</th>
            <th className="font-medium">mL/min</th>
          </tr>
        </thead>
        <tbody className="text-gray-700">
          {steps.map((s, i) => (
            <tr key={i}>
              <td className="pr-2">{s.time_min}</td>
              <td className="pr-2">{s.percent_a}</td>
              <td className="pr-2">{s.percent_b}</td>
              <td>{s.flow_ml_min}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LC_ROLE_LABEL: Record<LCIngredientRole, string> = {
  solvent_a: "Solvent A",
  solvent_b: "Solvent B",
  buffer: "Buffer",
  additive: "Additive",
};

function lcColumnLabel(column: {
  manufacturer?: string | null;
  model?: string | null;
  length_mm?: number | null;
  inner_diameter_mm?: number | null;
  particle_size_um?: number | null;
}): string | null {
  const head = [column.manufacturer, column.model].filter(Boolean).join(" ");
  const dims = [
    column.length_mm ? `${column.length_mm} mm` : null,
    column.inner_diameter_mm ? `${column.inner_diameter_mm} mm ID` : null,
    column.particle_size_um ? `${column.particle_size_um} um` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const out = [head, dims].filter(Boolean).join(" - ");
  return out.length > 0 ? out : null;
}

function ingredientList(items: { name: string; role: string }[]): ReactNode {
  if (items.length === 0) return null;
  return (
    <span className="flex flex-col gap-0.5">
      {items.map((g, i) => (
        <span key={i} className="text-gray-700">
          {g.name}
          <span className="text-gray-400"> ({g.role})</span>
        </span>
      ))}
    </span>
  );
}

const PLATE_ROLE_LABEL: Record<PlateWellRole, string> = {
  blank: "Blank",
  sample: "Sample",
  control: "Control",
  na: "N/A",
  custom: "Custom",
};

function colLabel(i: number): string {
  return String(i + 1);
}
function rowLabel(i: number): string {
  return String.fromCharCode(65 + i);
}

function PlateRegions({
  regions,
}: {
  regions: {
    row_start: number;
    row_end: number;
    col_start: number;
    col_end: number;
    role: PlateWellRole;
    custom_label?: string;
  }[];
}) {
  if (regions.length === 0) {
    return <Field label="Regions" value="No pre-labeled regions" />;
  }
  return (
    <div>
      <span className="text-meta font-medium text-gray-400">Regions</span>
      <ul className="mt-1 flex flex-col gap-0.5 text-body text-gray-700">
        {regions.map((r, i) => (
          <li key={i}>
            {r.custom_label || PLATE_ROLE_LABEL[r.role]}
            <span className="text-gray-400">
              {" "}
              {rowLabel(r.row_start)}
              {colLabel(r.col_start)}–{rowLabel(r.row_end)}
              {colLabel(r.col_end)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function mediaLabel(media: CellCultureMedia): string | null {
  const parts = [
    media.base_medium,
    media.serum_percent ? `${media.serum_percent}% serum` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function PlannedEvents({
  events,
}: {
  events: { day_offset: number; event_type: string; split_ratio?: string }[];
}) {
  if (events.length === 0) return null;
  return (
    <div>
      <span className="text-meta font-medium text-gray-400">Schedule</span>
      <ul className="mt-1 flex flex-col gap-0.5 text-body text-gray-700">
        {events.map((e, i) => (
          <li key={i}>
            Day {e.day_offset}: {e.event_type}
            {e.split_ratio ? ` (${e.split_ratio})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

const IONIZATION_LABEL: Record<IonizationMode, string> = {
  esi_pos: "ESI (+)",
  esi_neg: "ESI (-)",
  esi_switching: "ESI (switching)",
  apci_pos: "APCI (+)",
  apci_neg: "APCI (-)",
  ei: "EI",
  maldi: "MALDI",
  other: "Other",
};

function scanRangeLabel(
  low: number | null | undefined,
  high: number | null | undefined,
): string | null {
  if ((low === null || low === undefined) && (high === null || high === undefined)) {
    return null;
  }
  return `${low ?? "?"} - ${high ?? "?"} m/z`;
}

// ── Small per-type SAMPLE renderings (illustrative, for the Type detail) ──────
// Clearly-labeled illustrative examples of what a method of this type looks
// like. NOT real vendor specs: schematic values to convey the editor's shape.

function TypeSampleRendering({ typeId }: { typeId: MethodTypeId }) {
  switch (typeId) {
    case "pcr":
      return (
        <ol className="flex flex-col gap-1 text-body text-gray-600">
          <li>Initial denaturation: 95C, 3 min</li>
          <li>Cycle x30: 95C 15s / 60C 30s / 72C 1 min</li>
          <li>Final extension: 72C, 5 min</li>
          <li>Hold: 4C</li>
        </ol>
      );
    case "lc_gradient":
      return (
        <p className="text-body text-gray-600">
          A solvent gradient over time (e.g. 5% B to 95% B over 20 min) plus
          column, flow rate, and mobile-phase ingredients.
        </p>
      );
    case "plate":
      return (
        <p className="text-body text-gray-600">
          A well-plate layout (12 to 384 wells) with labeled regions for
          samples, controls, and blanks.
        </p>
      );
    case "mass_spec":
      return (
        <p className="text-body text-gray-600">
          Ionization mode, source and scan parameters, and a calibration
          reference. Pairs with an LC gradient for a full LC-MS kit.
        </p>
      );
    case "cell_culture":
      return (
        <p className="text-body text-gray-600">
          A passaging schedule (seed, feed, split by day offset) with a cell
          line and media composition.
        </p>
      );
    case "markdown":
      return (
        <p className="text-body text-gray-600">
          Free-form protocol text with headings, lists, tables, and images.
        </p>
      );
    case "pdf":
      return (
        <p className="text-body text-gray-600">
          An uploaded PDF protocol, viewed inline.
        </p>
      );
    case "coding_workflow":
      return (
        <p className="text-body text-gray-600">
          A reusable script (Python / R / SQL) or Jupyter notebook with an
          inline read-only preview.
        </p>
      );
    case "qpcr_analysis":
      return (
        <p className="text-body text-gray-600">
          Cq readouts, melt-curve Tm, standard-curve efficiency, and ddCq
          fold-change. Pairs with a PCR cycling method.
        </p>
      );
    case "compound":
      return (
        <p className="text-body text-gray-600">
          A kit bundling other methods into one attachable unit (e.g. an LC
          gradient plus a mass-spec setup).
        </p>
      );
    default: {
      const _exhaustive: never = typeId;
      void _exhaustive;
      return null;
    }
  }
}
