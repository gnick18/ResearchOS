"use client";

// Markdown embed hybrid, Phase 7 (P7-4). Structure card renderer.
//
// Renders a compound structure card for a PubChem CID URL or a bare SMILES embed.
// Uses the SAME RDKit depiction path as the local MoleculeEmbed (MoleculeThumbnail),
// so the depiction quality and SVG rendering are identical. PubChem compounds also
// show a "Add to my library" action that saves the compound into the local molecule
// store (moleculesApi.create), mirroring the chemistry workbench importer flow.
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
      // Build a minimal Molfile from the SMILES via PubChem SDF when we have a CID,
      // or use a stub Molfile skeleton that the molecule store accepts for a SMILES-only
      // entry. In the CID case, RDKit in the workbench will re-derive geometry on first
      // open; in the SMILES case the user gets a flat entry they can open and refine.
      // The simplest safe path: fetch the SDF from PubChem when there is a CID.
      let molfile = "";
      if (data.cid != null) {
        const PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound";
        const res = await fetch(`${PUG}/cid/${data.cid}/record/SDF?record_type=2d`);
        if (res.ok) {
          molfile = await res.text();
        }
      }
      // Fallback for SMILES-only or failed SDF fetch: use a comment-only stub.
      // moleculesApi.create accepts an empty string and derives identity from the meta.
      if (!molfile && data.smiles) {
        // A minimal V2000 Molfile with no atoms; the molecule store accepts it and the
        // workbench editor prompts the user to draw or import on first open.
        molfile = `\n  ResearchOS  \n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n`;
      }

      const name = data.name !== "Unknown structure" ? data.name : (caption || "Imported compound");
      await moleculesApi.create(molfile, {
        name,
        source: "pubchem",
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
      <div className="flex items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-body font-semibold text-foreground">{title}</span>
        {facts ? (
          <span className="truncate text-meta text-foreground-muted">{facts}</span>
        ) : null}
        <span className="flex-1" />
        <Tooltip label="Add this compound to your molecule library">
          <button
            type="button"
            onClick={() => handleAddToLibrary(d)}
            disabled={saveState !== "idle"}
            className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            {saveLabel}
          </button>
        </Tooltip>
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground"
        >
          Open
        </a>
      </div>
      <div className="flex items-center justify-center px-3 py-3">
        <span className="grid h-[140px] w-[200px] place-items-center overflow-hidden rounded-md border border-border bg-white">
          {d.smiles ? (
            <MoleculeThumbnail structure={d.smiles} width={200} height={140} />
          ) : d.pngUrl ? (
            // PubChem 2D depiction as a fallback when no SMILES was cached.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={d.pngUrl}
              alt={title}
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
