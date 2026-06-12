"use client";

// Markdown embed hybrid, Phase 7 (P7-4). Structure card renderer.
//
// Renders a compound structure card for a PubChem CID URL or a bare SMILES embed.
// Uses the SAME RDKit depiction path as the local MoleculeEmbed (MoleculeThumbnail),
// so the depiction quality and SVG rendering are identical. Both a PubChem compound
// and a bare SMILES show an "Add to library" action that saves the compound into the
// local molecule store (moleculesApi.create), mirroring the chemistry workbench
// importer flow. A CID saves PubChem's 2D SDF; a bare SMILES is converted to a
// molblock with RDKit (toMolblock), so the saved molecule has real identity and
// geometry on first open with no editor round-trip.
//
// For a PubChem CID: fetches identity properties from PubChem PUG-REST, then draws
// the structure from RDKit using the PubChem 2D PNG as a fallback while RDKit loads.
// For a bare SMILES: RDKit renders directly; no name or formula available.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { MoleculeThumbnail } from "@/components/chemistry/MoleculeThumbnail";
import { moleculesApi } from "@/lib/chemistry/api";
import { toMolblock } from "@/lib/chemistry/rdkit";
import {
  getExternalCache,
  putExternalCache,
  type StructureCache,
} from "@/lib/embeds/external-cache";
import {
  fetchStructureMetadataByCid,
  buildStructureCacheFromSmiles,
} from "@/lib/embeds/external-fetch";
import type { ExternalCardProps } from "./ExternalEmbed";

type LoadState =
  | { k: "loading" }
  | { k: "ok"; data: StructureCache }
  | { k: "error" };

type SaveState = "idle" | "saving" | "saved" | "error";

export default function StructureCard({ descriptor, caption, sidecarPath }: ExternalCardProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    let cancelled = false;
    setState({ k: "loading" });
    setSaveState("idle");

    (async () => {
      // Try the sidecar cache first.
      if (sidecarPath) {
        const cached = await getExternalCache(sidecarPath, descriptor.url);
        if (!cancelled && cached?.kind === "structure") {
          setState({ k: "ok", data: cached });
          return;
        }
      }

      // Cache miss: fetch from PubChem or build from SMILES.
      let data: StructureCache | null = null;
      if (descriptor.pubchemCid != null) {
        data = await fetchStructureMetadataByCid(descriptor.pubchemCid);
      } else if (descriptor.smiles) {
        data = buildStructureCacheFromSmiles(descriptor.smiles);
      }

      if (cancelled) return;
      if (!data) {
        setState({ k: "error" });
        return;
      }
      setState({ k: "ok", data });
      if (sidecarPath) {
        putExternalCache(sidecarPath, descriptor.url, data).catch(() => {});
      }
    })();

    return () => { cancelled = true; };
  }, [descriptor.url, descriptor.pubchemCid, descriptor.smiles, sidecarPath]);

  const handleAddToLibrary = async (data: StructureCache) => {
    if (saveState !== "idle") return;
    setSaveState("saving");
    try {
      // Build a real Molfile so the saved molecule has geometry and identity on
      // first open, no editor round-trip. Two source paths, both ending in a
      // molblock that moleculesApi.create runs computeIdentity over.
      //
      // PubChem CID: fetch the 2D SDF so we keep PubChem's drawn coordinates.
      // Bare SMILES (or a CID whose SDF fetch failed): convert the SMILES to a
      // molblock with RDKit, the SAME path the file importer uses for a .smi
      // entry (lib/chemistry/import-file then toMolblock). RDKit lays out flat
      // 2D coordinates, so the library thumbnail and the editor both open with a
      // real structure instead of an empty stub.
      let molfile = "";
      let source: "pubchem" | "imported" = data.cid != null ? "pubchem" : "imported";
      if (data.cid != null) {
        const PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound";
        const res = await fetch(`${PUG}/cid/${data.cid}/record/SDF?record_type=2d`);
        if (res.ok) {
          molfile = await res.text();
        }
      }
      if (!molfile && data.smiles) {
        // RDKit is browser-only and rejects during SSR, but this handler only runs
        // from a click, so the engine is available. A SMILES RDKit cannot parse
        // throws here and surfaces as the "Error" save state below.
        molfile = await toMolblock(data.smiles);
        // A SMILES-only entry is an import, not a PubChem record, even if a CID
        // was present but its SDF fetch fell through.
        source = "imported";
      }
      if (!molfile) {
        setSaveState("error");
        return;
      }

      const name = data.name !== "Unknown structure" ? data.name : (caption || "Imported compound");
      await moleculesApi.create(molfile, {
        name,
        source,
        pubchem_cid: data.cid ?? undefined,
      });
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  if (state.k === "loading") {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
          <Icon name="vial" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-foreground-muted">Structure</p>
          <p className="text-meta text-foreground-muted">loading…</p>
        </div>
      </div>
    );
  }

  if (state.k === "error") {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
          <Icon name="vial" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-foreground">
            {caption || "Structure"}
          </p>
          <p className="text-meta text-foreground-muted">
            Could not load structure.{" "}
            <a
              href={descriptor.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Open PubChem
            </a>
          </p>
        </div>
      </div>
    );
  }

  const d = state.data;
  const title = d.name !== "Unknown structure" ? d.name : (caption || "Unknown structure");
  const facts = [
    d.formula || null,
    d.mol_weight != null ? `${d.mol_weight.toFixed(2)} g/mol` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const openUrl = d.cid != null
    ? `https://pubchem.ncbi.nlm.nih.gov/compound/${d.cid}`
    : descriptor.url;

  const saveLabel =
    saveState === "saving" ? "Saving…" :
    saveState === "saved" ? "Saved" :
    saveState === "error" ? "Error" :
    "Add to library";

  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-body font-semibold text-foreground">{title}</span>
        {facts ? (
          <span className="shrink-0 text-meta text-foreground-muted">{facts}</span>
        ) : null}
        <span className="flex-1" />
        <Tooltip label="Add this compound to your molecule library">
          <button
            type="button"
            onClick={() => handleAddToLibrary(d)}
            disabled={saveState !== "idle"}
            className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
          >
            {saveLabel}
          </button>
        </Tooltip>
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open structure on PubChem ${title}`}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
      <div className="flex items-center justify-center px-3 py-3">
        <span
          role="img"
          aria-label={`Chemical structure of ${title}`}
          className="grid h-[140px] w-[200px] place-items-center overflow-hidden rounded-md border border-border bg-white"
        >
          {d.smiles ? (
            <MoleculeThumbnail structure={d.smiles} width={200} height={140} />
          ) : d.pngUrl ? (
            // PubChem 2D depiction as a fallback when no SMILES was cached.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={d.pngUrl}
              alt={`Chemical structure of ${title}`}
              width={200}
              height={140}
              className="object-contain"
            />
          ) : (
            <span className="text-meta text-foreground-muted">No depiction</span>
          )}
        </span>
      </div>
    </div>
  );
}
