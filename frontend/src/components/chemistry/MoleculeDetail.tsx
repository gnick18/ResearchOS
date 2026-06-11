"use client";

// The main-pane detail for a selected molecule (chemistry-workbench, left-rail
// redesign). The fast browse view: a large RDKit depiction + identity facts +
// linked projects + a collapsible literature panel + quick actions. Drawing/
// editing happens in the Ketcher popup (Edit structure), which is heavy to mount,
// so clicking around the rail shows this instant RDKit view instead.

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/components/icons";
import { moleculesApi, type Molecule } from "@/lib/chemistry/api";
import { referenceClipboardText } from "@/lib/copy-reference";
import { MoleculeThumbnail } from "./MoleculeThumbnail";
import { MoleculeLiterature } from "./MoleculeLiterature";

export function MoleculeDetail({
  molecule,
  projects,
  onEdit,
  onDeleted,
}: {
  molecule: Molecule;
  projects: Array<{ id: number; name: string }>;
  onEdit: (id: string) => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showLit, setShowLit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(String(p.id), p.name);
    return map;
  }, [projects]);

  const linked = projects.filter((p) =>
    molecule.project_ids.includes(String(p.id)),
  );
  const available = projects.filter(
    (p) => !molecule.project_ids.includes(String(p.id)),
  );

  const flash = (label: string) => {
    setCopied(label);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1600);
  };
  const copy = (value: string | undefined, label: string) => {
    if (!value) return;
    void navigator.clipboard?.writeText(value).catch(() => {});
    flash(label);
  };

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["molecules"] });
    await queryClient.invalidateQueries({ queryKey: ["project-molecules"] });
  };

  const setProjects = async (next: string[]) => {
    setBusy(true);
    try {
      await moleculesApi.update(molecule.id, { project_ids: next });
      await invalidate();
    } catch {
      /* non-fatal */
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await moleculesApi.remove(molecule.id);
      await invalidate();
      onDeleted();
    } catch {
      setBusy(false);
    }
  };

  const mw =
    molecule.mol_weight != null ? `${molecule.mol_weight.toFixed(2)} g/mol` : null;
  const rows: Array<[string, string | null, boolean]> = [
    ["Formula", molecule.formula ?? null, true],
    ["Avg MW", mw, false],
    ["Canonical SMILES", molecule.smiles ?? null, true],
    ["InChIKey", molecule.inchikey ?? null, true],
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-heading font-bold text-foreground truncate">
              {molecule.name}
            </h1>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {linked.map((p) => (
                <span
                  key={p.id}
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300"
                >
                  {p.name}
                </span>
              ))}
              {molecule.source ? (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                  {molecule.source}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onEdit(molecule.id)}
            className="inline-flex items-center gap-2 px-4 py-2 text-body font-semibold text-white rounded-lg bg-gradient-to-br from-brand-action to-brand-purple flex-shrink-0"
          >
            <Icon name="pencil" className="w-4 h-4" />
            Edit structure
          </button>
        </div>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
          {/* depiction */}
          <div className="bg-white border border-border rounded-xl grid place-items-center p-4 min-h-[280px]">
            <MoleculeThumbnail
              structure={molecule.smiles ?? ""}
              width={360}
              height={280}
            />
          </div>

          {/* facts + tools */}
          <div>
            <table className="w-full border-collapse text-meta">
              <tbody>
                {rows
                  .filter(([, v]) => v != null)
                  .map(([k, v, mono]) => (
                    <tr key={k}>
                      <td className="py-1.5 pr-2 text-foreground-muted align-top w-[38%] border-b border-border">
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

            <div className="flex flex-col gap-1 mt-3">
              <ToolItem onClick={() => copy(molecule.smiles, "canonical SMILES")}>
                Copy canonical SMILES
              </ToolItem>
              <ToolItem onClick={() => copy(molecule.inchikey, "InChIKey")}>
                Copy InChIKey
              </ToolItem>
              <ToolItem
                onClick={() => {
                  copy(
                    referenceClipboardText("molecule", molecule.id, molecule.name),
                    "reference for a note",
                  );
                }}
              >
                Copy reference for a note
              </ToolItem>
            </div>
            {copied ? (
              <p className="text-meta text-brand-action mt-2">Copied {copied}.</p>
            ) : null}

            {/* linked projects */}
            <h4 className="text-[11px] uppercase tracking-wide text-foreground-muted mt-5 mb-2">
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
                      disabled={busy}
                      onClick={() =>
                        setProjects(
                          molecule.project_ids.filter((id) => id !== String(p.id)),
                        )
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
                disabled={busy}
                onChange={(e) => {
                  if (e.target.value)
                    setProjects([...molecule.project_ids, e.target.value]);
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
          </div>
        </div>

        {/* literature (lazy) */}
        <div className="mt-6">
          {showLit ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-title font-bold text-foreground">
                  Papers &amp; patents
                </h4>
                <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 rounded-full px-2 py-0.5">
                  Live
                </span>
              </div>
              <MoleculeLiterature
                query={molecule.name}
                cid={molecule.pubchem_cid}
              />
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowLit(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-body font-semibold text-foreground bg-surface-raised border border-border rounded-lg hover:border-brand-action transition-colors"
            >
              <Icon name="search" className="w-4 h-4" />
              Find papers and patents for this molecule
            </button>
          )}
        </div>

        {/* delete */}
        <div className="mt-8 pt-4 border-t border-border">
          {confirmDelete ? (
            <div className="flex items-center gap-3">
              <span className="text-meta text-foreground">
                Delete &ldquo;{molecule.name}&rdquo; from your library?
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={handleDelete}
                className="px-3 py-1.5 text-meta font-semibold text-white bg-red-600 rounded-lg disabled:opacity-60"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 text-meta text-foreground-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-2 text-meta font-semibold text-red-600 dark:text-red-400 hover:underline"
            >
              <Icon name="trash" className="w-3.5 h-3.5" />
              Delete molecule
            </button>
          )}
        </div>
      </div>
    </div>
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
