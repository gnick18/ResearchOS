// Phase 6c (2026-06-12). Recipient-side import destination picker.
//
// Renders one row per BundleEmbeddedObject that arrived with a shared note
// bundle. For each item the row shows what will happen on import:
//
//   "linked"          -- the recipient already has the same object (dedup via
//                        resolveByPortableId matched). Read-only "Link existing"
//                        badge. No destination control.
//   "snapshot"        -- a Data Hub snapshot (dataKind === "snapshot"). Read-only
//                        "Kept as frozen result snapshot" label.
//   "not-included"    -- a file type (deferred). Read-only "Not included" label.
//   "import-filed"    -- a fresh molecule, sequence, or datahub (full). Shows a
//                        destination dropdown so the recipient can pick which
//                        collection the object lands in.
//   "import-unfiled"  -- a fresh note, method, project, collection, task, or
//                        experiment. Read-only "Import fresh" label (these types
//                        do not file into a collection).
//
// The component calls onChange once after the initial dedup pass resolves, and
// again whenever any destination dropdown changes. The emitted
// destinationByHref map follows the ImportEmbeddedObjectsOpts contract: hrefs
// for items in the "Shared by <sender>" default sentinel are OMITTED (so the
// import's default-collection path runs); hrefs explicitly assigned to one of
// the recipient's existing collections carry { projectId }.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import type { BundleEmbeddedObject } from "@/lib/sharing/bundle";
import type { ObjectRefType } from "@/lib/references";
import type { ImportDestination } from "@/lib/sharing/embedded-object-import";
import { resolveByPortableId } from "@/lib/sharing/portable-identity";
import { projectsApi } from "@/lib/local-api";
import type { Project } from "@/lib/types";
import type { IconName } from "@/components/icons";

// ── Type icons (mirrors ObjectEmbed.tsx TYPE_ICON) ────────────────────────────

const TYPE_ICON: Record<ObjectRefType, IconName> = {
  sequence: "sequence",
  collection: "folder",
  method: "book",
  note: "pencil",
  file: "file",
  project: "folder",
  molecule: "vial",
  datahub: "chart",
  task: "today",
  experiment: "list",
};

const TYPE_LABEL: Record<ObjectRefType, string> = {
  sequence: "Sequence",
  collection: "Collection",
  method: "Method",
  note: "Note",
  file: "File",
  project: "Project",
  molecule: "Molecule",
  datahub: "Data Hub",
  task: "Task",
  experiment: "Experiment",
};

// ── Row classification ────────────────────────────────────────────────────────

type RowKind =
  | "resolving"        // dedup check in progress
  | "linked"           // portableId matched an existing local object
  | "snapshot"         // datahub snapshot (frozen, not recreated)
  | "not-included"     // file type (deferred)
  | "import-filed"     // fresh molecule / sequence / datahub full (collection dropdown)
  | "import-unfiled";  // fresh note / method / project / collection / task / experiment

function classifyRow(
  obj: BundleEmbeddedObject,
  isDup: boolean | null,
): RowKind {
  // Still waiting on the dedup check.
  if (isDup === null) return "resolving";
  if (isDup) return "linked";

  // Frozen snapshot.
  if (obj.type === "datahub" && obj.dataKind === "snapshot") return "snapshot";

  // File type is deferred.
  if (obj.type === "file") return "not-included";

  // Collection-supporting fresh imports.
  if (
    obj.type === "molecule" ||
    obj.type === "sequence" ||
    obj.type === "datahub"
  ) {
    return "import-filed";
  }

  // Everything else (note, method, project, collection, task, experiment).
  return "import-unfiled";
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface EmbeddedImportPickerProps {
  embeddedObjects: BundleEmbeddedObject[];
  currentUser: string;
  /** Used to label the default destination: "Shared by <senderLabel>". */
  senderLabel: string;
  /**
   * Called once after the initial dedup pass resolves (with the default map,
   * which may be empty if all items use the sentinel default or link existing),
   * and again whenever a destination dropdown changes.
   */
  onChange: (destinationByHref: Map<string, ImportDestination>) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Pre-import picker that classifies each embedded object and lets the recipient
 * choose a destination collection for fresh imports. Dedup hints run on mount
 * via resolveByPortableId (parallel, one-time check per item).
 */
export function EmbeddedImportPicker({
  embeddedObjects,
  currentUser,
  senderLabel,
  onChange,
}: EmbeddedImportPickerProps) {
  // isDupMap: null = resolving, true = dup matched, false = fresh.
  const [isDupMap, setIsDupMap] = useState<Map<string, boolean | null>>(() => {
    const m = new Map<string, boolean | null>();
    for (const obj of embeddedObjects) {
      m.set(obj.href, obj.portableId ? null : false);
    }
    return m;
  });

  // Per-href destination overrides chosen by the recipient. A missing entry
  // means "use the sentinel default" (Shared by <sender>).
  const [destinationByHref, setDestinationByHref] = useState<
    Map<string, ImportDestination>
  >(new Map());

  // Collections available to the recipient for the destination dropdowns.
  const [collections, setCollections] = useState<Project[]>([]);

  // Track whether the first onChange call has fired (after dedup resolves).
  const initialFiredRef = useRef(false);

  // ── Load recipient's collections ──────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await projectsApi.list();
        if (!cancelled) {
          setCollections(all.filter((p) => !p.is_archived));
        }
      } catch {
        // Collections unavailable, destination dropdowns show only the default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Run dedup checks in parallel ──────────────────────────────────────────

  useEffect(() => {
    if (!currentUser) return;
    const objectsNeedingCheck = embeddedObjects.filter((obj) => !!obj.portableId);
    if (objectsNeedingCheck.length === 0) {
      // Nothing to check. Fire initial onChange immediately.
      if (!initialFiredRef.current) {
        initialFiredRef.current = true;
        onChange(new Map());
      }
      return;
    }

    let cancelled = false;
    const checks = objectsNeedingCheck.map(async (obj) => {
      try {
        const local = await resolveByPortableId(
          obj.type,
          obj.portableId!,
          currentUser,
        );
        return { href: obj.href, isDup: local !== null };
      } catch {
        return { href: obj.href, isDup: false };
      }
    });

    Promise.all(checks).then((results) => {
      if (cancelled) return;
      setIsDupMap((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          next.set(r.href, r.isDup);
        }
        return next;
      });
      if (!initialFiredRef.current) {
        initialFiredRef.current = true;
        // Initial map is empty (all use sentinel default) since the user has
        // not yet changed any dropdown.
        onChange(new Map());
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // ── Derived counts for the summary line ───────────────────────────────────

  const { importCount, linkCount } = useMemo(() => {
    let imports = 0;
    let links = 0;
    for (const obj of embeddedObjects) {
      const isDup = isDupMap.get(obj.href) ?? false;
      const kind = classifyRow(obj, isDupMap.has(obj.href) ? isDup : null);
      if (kind === "linked") links++;
      if (kind === "import-filed" || kind === "import-unfiled") imports++;
    }
    return { importCount: imports, linkCount: links };
  }, [embeddedObjects, isDupMap]);

  // ── Dropdown change handler ────────────────────────────────────────────────

  function handleDestinationChange(href: string, projectId: string | null) {
    setDestinationByHref((prev) => {
      const next = new Map(prev);
      if (projectId === null) {
        // Sentinel default selected: omit this href from the map.
        next.delete(href);
      } else {
        next.set(href, { projectId });
      }
      onChange(next);
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (embeddedObjects.length === 0) return null;

  const defaultLabel = `Shared by ${senderLabel}`;

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-sunken">
      {/* Summary line */}
      <div className="px-3 py-2 border-b border-border">
        <p className="text-meta text-foreground-muted">
          {summaryLine(importCount, linkCount)}
        </p>
      </div>

      {/* Per-item rows */}
      <ul className="divide-y divide-border">
        {embeddedObjects.map((obj) => {
          const isDup = isDupMap.get(obj.href) ?? null;
          const resolving = isDup === null && !!obj.portableId;
          const kind = classifyRow(obj, resolving ? null : (isDup ?? false));
          const icon = TYPE_ICON[obj.type] ?? ("file" as IconName);
          const typeLabel = TYPE_LABEL[obj.type] ?? obj.type;
          const destination = destinationByHref.get(obj.href) ?? null;

          return (
            <li
              key={obj.href}
              className="flex items-center gap-3 px-3 py-2.5 min-h-0"
            >
              {/* Type icon */}
              <Tooltip label={typeLabel}>
                <span className="shrink-0 text-foreground-muted">
                  <Icon name={icon} className="h-4 w-4" />
                </span>
              </Tooltip>

              {/* Name */}
              <span
                className="flex-1 min-w-0 text-body text-foreground truncate"
                title={obj.name}
              >
                {obj.name || typeLabel}
              </span>

              {/* Status / destination control */}
              {kind === "resolving" && (
                <span className="text-meta text-foreground-muted shrink-0">
                  Checking
                </span>
              )}

              {kind === "linked" && (
                <span className="text-meta text-emerald-600 dark:text-emerald-300 shrink-0 font-medium">
                  Link existing
                </span>
              )}

              {kind === "snapshot" && (
                <span className="text-meta text-foreground-muted shrink-0">
                  Kept as frozen result snapshot
                </span>
              )}

              {kind === "not-included" && (
                <span className="text-meta text-foreground-muted shrink-0">
                  Not included
                </span>
              )}

              {kind === "import-unfiled" && (
                <span className="text-meta text-foreground-muted shrink-0">
                  Import fresh
                </span>
              )}

              {kind === "import-filed" && (
                <select
                  aria-label={`Destination for ${obj.name || typeLabel}`}
                  value={destination?.projectId ?? ""}
                  onChange={(e) =>
                    handleDestinationChange(
                      obj.href,
                      e.target.value === "" ? null : e.target.value,
                    )
                  }
                  className="shrink-0 text-meta text-foreground bg-surface-raised border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[160px]"
                >
                  <option value="">{defaultLabel}</option>
                  {collections.map((col) => (
                    <option key={col.id} value={String(col.id)}>
                      {col.name}
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Summary line helper ───────────────────────────────────────────────────────

function summaryLine(importCount: number, linkCount: number): string {
  const parts: string[] = [];
  if (importCount > 0) {
    parts.push(
      `${importCount} object${importCount === 1 ? "" : "s"} to import`,
    );
  }
  if (linkCount > 0) {
    parts.push(
      `link ${linkCount} existing`,
    );
  }
  if (parts.length === 0) return "No objects to import";
  return parts.join(", ");
}
