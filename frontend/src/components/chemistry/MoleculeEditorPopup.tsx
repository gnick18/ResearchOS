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
import { useQueryClient } from "@tanstack/react-query";
import type { Ketcher } from "ketcher-core";

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import { moleculesApi } from "@/lib/chemistry/api";
import { computeIdentity, type MoleculeIdentity } from "@/lib/chemistry/rdkit";

const KetcherCanvas = dynamic(() => import("./KetcherCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 grid place-items-center text-meta text-foreground-muted">
      Loading the structure editor…
    </div>
  ),
});

type RailTab = "identity" | "papers";

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
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // The structure to open is known (canvas safe to mount). False while an existing
  // molecule's Molfile is still loading.
  const [structureReady, setStructureReady] = useState(false);

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
    },
    [],
  );

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
        await moleculesApi.create(molfile, { name: cleanName, source: "drawn" });
      } else {
        await moleculesApi.update(moleculeId, { molfile, name: cleanName });
      }
      await queryClient.invalidateQueries({ queryKey: ["molecules"] });
      onClose();
    } catch {
      setLoadError("Saving failed. Your structure is still on the canvas.");
    } finally {
      setSaving(false);
    }
  }, [isNew, moleculeId, name, queryClient, onClose, saving]);

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
              <RailTabButton active={rail === "papers"} onClick={() => setRail("papers")}>
                Papers &amp; patents
              </RailTabButton>
            </div>

            {rail === "identity" ? (
              <IdentityPane identity={identity} ready={ready} />
            ) : (
              <p className="text-meta text-foreground-muted leading-relaxed">
                Live papers and patents for the open structure are coming in the
                next chunk. They will fetch from PubChem, Europe PMC, and
                SureChEMBL, browser-direct, the moment you open this tab.
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
            className="inline-flex items-center gap-2 px-4 py-2 text-body font-semibold text-white rounded-lg bg-gradient-to-br from-brand-action to-brand-purple disabled:opacity-60"
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
}: {
  identity: MoleculeIdentity | null;
  ready: boolean;
}) {
  const copy = (value: string | undefined) => {
    if (!value) return;
    void navigator.clipboard?.writeText(value).catch(() => {});
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
    ["Rotatable bonds", identity.rotatable_bonds?.toString() ?? null, false],
  ];

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

      <h4 className="text-[11px] uppercase tracking-wide text-foreground-muted mt-4 mb-2">
        Companion tools
      </h4>
      <div className="flex flex-col gap-1">
        <ToolItem onClick={() => copy(identity.smiles)}>
          Copy canonical SMILES
        </ToolItem>
        <ToolItem onClick={() => copy(identity.inchikey)}>Copy InChIKey</ToolItem>
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
