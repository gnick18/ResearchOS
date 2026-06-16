"use client";

// The structure editor (chemistry-workbench Phase 1). Ketcher canvas in a
// LivingPopup (the same shell the file viewer + note editor use), with a
// companion rail on the right: the RDKit identity of the open structure, and the
// tools that act on it. Save writes the Molfile + meta sidecar through
// moleculesApi (which computes the identity into the sidecar).
//
// `moleculeId === "new"` opens a blank canvas; a real id opens that molecule's
// stored Molfile. Ketcher is loaded via dynamic(ssr:false) because ketcher-react
// touches window at import.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Ketcher } from "ketcher-core";

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import { moleculesApi } from "@/lib/chemistry/api";
import { projectsApi } from "@/lib/local-api";
import { computeIdentity, lipinski, type MoleculeIdentity } from "@/lib/chemistry/rdkit";
import { LipinskiBadge } from "./LipinskiBadge";
import { referenceClipboardText } from "@/lib/copy-reference";
import { MoleculeLiterature } from "./MoleculeLiterature";
import MoleculeHistoryPanel from "./MoleculeHistoryPanel";
import { HISTORY_ENGINE_ENABLED } from "@/lib/chemistry/molecule-history";
import { getCurrentUserCached } from "@/lib/storage/json-store";

const KetcherCanvas = dynamic(() => import("./KetcherCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 grid place-items-center text-meta text-foreground-muted">
      Loading the structure editor…
    </div>
  ),
});

type RailTab = "identity" | "papers" | "history";

export function MoleculeEditorPopup({
  moleculeId,
  open,
  onClose,
}: {
  /** "new" for a blank canvas, a string id to edit a stored molecule, null = closed. */
  moleculeId: string | "new" | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const ketcherRef = useRef<Ketcher | null>(null);
  const identityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [name, setName] = useState("");
  const [initialStructure, setInitialStructure] = useState<string | undefined>(
    undefined,
  );
  const [identity, setIdentity] = useState<MoleculeIdentity | null>(null);
  const [rail, setRail] = useState<RailTab>("identity");
  // The compound the Papers tab queries, captured when the tab opens (not the live
  // name input) so renaming does not refire Europe PMC / PubChem on every keystroke.
  const [litQuery, setLitQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // The structure to open is known (canvas safe to mount). False while an existing
  // molecule's Molfile is still loading.
  const [structureReady, setStructureReady] = useState(false);
  // The loaded molecule's PubChem CID, if it was imported from PubChem (lets the
  // Papers tab skip the name->CID resolve and link the exact compound's patents).
  const [loadedCid, setLoadedCid] = useState<number | undefined>(undefined);
  // Project links (collection membership). Persisted immediately for a saved
  // molecule; held and applied on save for a new one.
  const [projectIds, setProjectIds] = useState<string[]>([]);
  // Transient confirmation for a copy action (the rail's copy tools), so a click
  // is never silent. Auto-clears.
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // chem-history bot: the current user's username, needed by the History panel
  // as the owner folder. Resolved once on mount; stable for the popup lifetime.
  const [historyOwner, setHistoryOwner] = useState<string>("");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "for-chemistry"],
    queryFn: () => projectsApi.list(),
  });

  // chem-history bot: resolve the current user once on mount for history panel.
  useEffect(() => {
    getCurrentUserCached()
      .then((u) => {
        if (u) setHistoryOwner(u);
      })
      .catch(() => {});
  }, []);

  const isNew = moleculeId === "new";

  // Load the molecule to edit (or reset for a new one) when the target changes.
  // KetcherCanvas loads its structure once, in onInit, so it must not mount until
  // the structure to open is known; otherwise it opens empty and the late prop
  // update is ignored. `structureReady` gates the mount on that.
  useEffect(() => {
    if (!open || moleculeId == null) return;
    let cancelled = false;
    setReady(false);
    setStructureReady(false);
    setIdentity(null);
    setLoadError(null);
    setLoadedCid(undefined);
    setProjectIds([]);
    // The popup is a single persistent instance, so reset the rail to Identity and
    // clear the captured literature query when switching molecules; otherwise the
    // new molecule would show the previous one's Papers-tab literature.
    setRail("identity");
    setLitQuery("");
    if (isNew) {
      setName("");
      setInitialStructure(undefined);
      setStructureReady(true);
      return;
    }
    moleculesApi
      .get(moleculeId)
      .then((detail) => {
        if (cancelled) return;
        if (!detail) {
          setLoadError("This molecule could not be found in your library.");
          setStructureReady(true);
          return;
        }
        setName(detail.meta.name);
        setLoadedCid(detail.meta.pubchem_cid);
        setProjectIds(detail.meta.project_ids ?? []);
        setInitialStructure(detail.molfile || detail.meta.smiles || undefined);
        setStructureReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("Could not open this molecule.");
        setStructureReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, moleculeId, isNew]);

  // Recompute the RDKit identity from the live canvas, throttled so a burst of
  // edits collapses into one (cheap) wasm parse.
  const refreshIdentity = useCallback(() => {
    if (identityTimer.current) clearTimeout(identityTimer.current);
    identityTimer.current = setTimeout(async () => {
      const k = ketcherRef.current;
      if (!k) return;
      try {
        const molfile = await k.getMolfile();
        if (!molfile || !molfile.trim()) {
          setIdentity(null);
          return;
        }
        setIdentity(await computeIdentity(molfile));
      } catch {
        setIdentity(null);
      }
    }, 250);
  }, []);

  const handleReady = useCallback(
    (ketcher: Ketcher) => {
      ketcherRef.current = ketcher;
      setReady(true);
      refreshIdentity();
    },
    [refreshIdentity],
  );

  useEffect(
    () => () => {
      if (identityTimer.current) clearTimeout(identityTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const flashCopied = useCallback((label: string) => {
    setCopied(label);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1600);
  }, []);

  const handleSave = useCallback(async () => {
    const k = ketcherRef.current;
    if (!k || saving) return;
    setSaving(true);
    try {
      const molfile = await k.getMolfile();
      if (!molfile || !molfile.trim()) {
        setLoadError("Draw a structure before saving.");
        setSaving(false);
        return;
      }
      const cleanName = name.trim() || "Untitled structure";
      if (isNew || moleculeId == null) {
        await moleculesApi.create(molfile, {
          name: cleanName,
          source: "drawn",
          project_ids: projectIds,
        });
      } else {
        await moleculesApi.update(moleculeId, { molfile, name: cleanName });
      }
      await queryClient.invalidateQueries({ queryKey: ["molecules"] });
      await queryClient.invalidateQueries({ queryKey: ["project-molecules"] });
      onClose();
    } catch {
      setLoadError("Saving failed. Your structure is still on the canvas.");
    } finally {
      setSaving(false);
    }
  }, [isNew, moleculeId, name, projectIds, queryClient, onClose, saving]);

  // Add/remove a project link. Persisted immediately for a saved molecule; for a
  // new (unsaved) one it stays local and is written by create() on save.
  const handleProjectsChange = useCallback(
    async (next: string[]) => {
      setProjectIds(next);
      if (!isNew && moleculeId != null) {
        try {
          await moleculesApi.update(moleculeId, { project_ids: next });
          await queryClient.invalidateQueries({ queryKey: ["molecules"] });
          await queryClient.invalidateQueries({ queryKey: ["project-molecules"] });
        } catch {
          // non-fatal; the chip state still reflects the intent
        }
      }
    },
    [isNew, moleculeId, queryClient],
  );

  if (moleculeId == null) return null;

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label={isNew ? "New structure" : name || "Structure editor"}
      widthClassName="max-w-5xl"
      card={false}
      fillHeight
    >
      <div className="bg-surface-raised rounded-xl shadow-2xl w-full h-full max-h-[88vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="px-4 py-3 border-b border-border bg-surface-sunken flex items-center gap-3">
          <span className="text-meta font-semibold text-foreground-muted">
            {isNew ? "Drawing" : "Editing"}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this molecule"
            className="w-56 text-body font-semibold text-foreground bg-surface-raised border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-brand-action"
          />
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-meta text-foreground-muted hover:text-foreground hover:bg-surface-raised rounded-md transition-colors"
          >
            Close
          </button>
        </div>

        {/* body: canvas + rail */}
        <div className="flex flex-1 min-h-[440px] overflow-hidden">
          <div className="flex-1 min-w-0 flex flex-col border-r border-border">
            {loadError && !ready ? (
              <div className="flex-1 grid place-items-center text-meta text-red-600 dark:text-red-300 px-6 text-center">
                {loadError}
              </div>
            ) : !structureReady ? (
              <div className="flex-1 grid place-items-center text-meta text-foreground-muted">
                Opening your structure…
              </div>
            ) : (
              <KetcherCanvas
                initialStructure={initialStructure}
                onReady={handleReady}
                onChange={refreshIdentity}
              />
            )}
          </div>

          <aside className="w-[290px] flex-shrink-0 overflow-y-auto p-4">
            <div className="flex gap-1 mb-3">
              <RailTabButton active={rail === "identity"} onClick={() => setRail("identity")}>
                Identity
              </RailTabButton>
              <RailTabButton
                active={rail === "papers"}
                onClick={() => {
                  setLitQuery(name.trim());
                  setRail("papers");
                }}
              >
                Papers &amp; patents
              </RailTabButton>
              {HISTORY_ENGINE_ENABLED && !isNew && (
                <RailTabButton
                  active={rail === "history"}
                  onClick={() => setRail("history")}
                >
                  History
                </RailTabButton>
              )}
            </div>

            {rail === "identity" ? (
              <>
                <IdentityPane
                  identity={identity}
                  ready={ready}
                  onCopied={flashCopied}
                  onCopyReference={
                    !isNew && moleculeId != null
                      ? () => {
                          void navigator.clipboard
                            ?.writeText(
                              referenceClipboardText(
                                "molecule",
                                moleculeId,
                                name.trim() || "molecule",
                              ),
                            )
                            .catch(() => {});
                          flashCopied("reference for a note");
                        }
                      : undefined
                  }
                />
                {copied ? (
                  <p className="text-meta text-brand-action mt-2">
                    Copied {copied}.
                  </p>
                ) : null}
                <ProjectLinks
                  projectIds={projectIds}
                  projects={projects}
                  onChange={handleProjectsChange}
                />
              </>
            ) : rail === "history" && !isNew && moleculeId != null && historyOwner ? (
              // chem-history bot: mounted only when the History tab is active so
              // history reads are lazy. The restore handler reloads the molecule
              // and closes the popup so the user sees the restored structure.
              <div className="-mx-4 -mb-4" style={{ height: "100%" }}>
                <MoleculeHistoryPanel
                  moleculeId={moleculeId}
                  owner={historyOwner}
                  canRestore={true}
                  onRestore={async (versionIndex) => {
                    const restored = await moleculesApi.restoreVersion(
                      moleculeId,
                      versionIndex,
                      historyOwner,
                    );
                    if (restored) {
                      await queryClient.invalidateQueries({ queryKey: ["molecules"] });
                      await queryClient.invalidateQueries({ queryKey: ["project-molecules"] });
                      onClose();
                    }
                  }}
                />
              </div>
            ) : litQuery ? (
              // Mounted only when the Papers tab is open, so the fetch is lazy.
              // Keyed by the captured query (set on tab open) so it does not refetch
              // while the user edits the name.
              <MoleculeLiterature
                key={`${litQuery}-${loadedCid ?? ""}`}
                query={litQuery}
                cid={loadedCid}
              />
            ) : (
              <p className="text-meta text-foreground-muted leading-relaxed">
                Name this structure (a compound name like &ldquo;caffeine&rdquo;, or
                import one from PubChem) to find the papers and patents that mention
                it.
              </p>
            )}
          </aside>
        </div>

        {/* save bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-surface-sunken">
          {loadError && ready ? (
            <span className="text-meta text-red-600 dark:text-red-300 mr-auto">
              {loadError}
            </span>
          ) : (
            <span className="text-meta text-foreground-muted mr-auto">
              {isNew
                ? "Saves a .mol plus a metadata sidecar to your data folder."
                : "Edits update the stored .mol and recompute its identity."}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !ready}
            className="ros-btn-raise inline-flex items-center gap-2 px-4 py-2 text-body font-semibold text-white rounded-lg bg-brand-action transition-colors hover:bg-brand-action/90 disabled:opacity-60"
          >
            <Icon name="save" className="w-4 h-4" />
            {saving ? "Saving…" : "Save to library"}
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}

function RailTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 text-meta font-bold py-1.5 rounded-lg border transition-colors ${
        active
          ? "bg-accent-soft text-brand-action border-brand-action"
          : "bg-surface-raised text-foreground-muted border-border hover:bg-surface-sunken"
      }`}
    >
      {children}
    </button>
  );
}

function IdentityPane({
  identity,
  ready,
  onCopied,
  onCopyReference,
}: {
  identity: MoleculeIdentity | null;
  ready: boolean;
  /** Flash a transient "Copied X" confirmation in the rail. */
  onCopied?: (label: string) => void;
  /** When set (saved molecule), offers a Copy-reference tool for note embeds. */
  onCopyReference?: () => void;
}) {
  const copy = (value: string | undefined, label: string) => {
    if (!value) return;
    void navigator.clipboard?.writeText(value).catch(() => {});
    onCopied?.(label);
  };

  if (!ready) {
    return (
      <p className="text-meta text-foreground-muted">Starting the engine…</p>
    );
  }
  if (!identity) {
    return (
      <p className="text-meta text-foreground-muted">
        Draw a structure to see its identity computed live by RDKit.
      </p>
    );
  }

  const rows: Array<[string, string | null, boolean]> = [
    ["Canonical SMILES", identity.smiles || null, true],
    ["InChIKey", identity.inchikey || null, true],
    ["Formula", identity.formula || null, true],
    [
      "Avg MW",
      identity.mol_weight != null ? `${identity.mol_weight.toFixed(2)} g/mol` : null,
      false,
    ],
    [
      "Exact mass",
      identity.exact_mass != null ? identity.exact_mass.toFixed(4) : null,
      false,
    ],
    ["Heavy atoms", identity.heavy_atoms?.toString() ?? null, false],
    ["Rings", identity.rings?.toString() ?? null, false],
    ["Aromatic rings", identity.aromatic_rings?.toString() ?? null, false],
    ["Rotatable bonds", identity.rotatable_bonds?.toString() ?? null, false],
    ["cLogP", identity.clogp != null ? identity.clogp.toFixed(2) : null, false],
    ["TPSA", identity.tpsa != null ? `${identity.tpsa.toFixed(1)} Å²` : null, false],
    ["H-bond donors", identity.h_donors?.toString() ?? null, false],
    ["H-bond acceptors", identity.h_acceptors?.toString() ?? null, false],
  ];

  const ro5 = lipinski(identity);

  return (
    <>
      <h4 className="text-[11px] uppercase tracking-wide text-foreground-muted mb-2">
        Identity (RDKit)
      </h4>
      <table className="w-full border-collapse text-meta">
        <tbody>
          {rows
            .filter(([, v]) => v != null)
            .map(([k, v, mono]) => (
              <tr key={k}>
                <td className="py-1.5 pr-2 text-foreground-muted align-top w-[42%] border-b border-border">
                  {k}
                </td>
                <td
                  className={`py-1.5 align-top border-b border-border break-all text-foreground ${
                    mono ? "font-mono" : ""
                  }`}
                >
                  {v}
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      <LipinskiBadge result={ro5} className="mt-3" />

      <h4 className="text-[11px] uppercase tracking-wide text-foreground-muted mt-4 mb-2">
        Companion tools
      </h4>
      <div className="flex flex-col gap-1">
        <ToolItem onClick={() => copy(identity.smiles, "canonical SMILES")}>
          Copy canonical SMILES
        </ToolItem>
        <ToolItem onClick={() => copy(identity.inchikey, "InChIKey")}>
          Copy InChIKey
        </ToolItem>
        {onCopyReference ? (
          <ToolItem onClick={onCopyReference}>
            Copy reference for a note
          </ToolItem>
        ) : null}
      </div>
    </>
  );
}

function ToolItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-body text-foreground hover:bg-accent-soft text-left"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-brand-action flex-shrink-0" />
      {children}
    </button>
  );
}

function ProjectLinks({
  projectIds,
  projects,
  onChange,
}: {
  projectIds: string[];
  projects: Array<{ id: number; name: string }>;
  onChange: (next: string[]) => void;
}) {
  const linked = projects.filter((p) => projectIds.includes(String(p.id)));
  const available = projects.filter((p) => !projectIds.includes(String(p.id)));
  return (
    <>
      <h4 className="text-[11px] uppercase tracking-wide text-foreground-muted mt-4 mb-2">
        Linked projects
      </h4>
      {linked.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {linked.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300"
            >
              {p.name}
              <button
                type="button"
                onClick={() =>
                  onChange(projectIds.filter((id) => id !== String(p.id)))
                }
                aria-label={`Unlink from ${p.name}`}
                className="leading-none hover:opacity-70"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-meta text-foreground-muted mb-2">
          Not linked to a project yet.
        </p>
      )}
      {available.length > 0 ? (
        <select
          aria-label="Add this molecule to a project"
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...projectIds, e.target.value]);
          }}
          className="w-full text-meta text-foreground bg-surface-raised border border-border rounded-md px-2 py-1.5 outline-none focus:border-brand-action"
        >
          <option value="">Add to a project…</option>
          {available.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}
    </>
  );
}
