"use client";

// cloning bot — the STANDALONE overlap-assembly workspace (Gibson / NEBuilder
// HiFi). A full-surface overlay launched from the /sequences library "Assemble"
// action (NOT an editor tab, NOT a top-nav item). Calm, progressive disclosure,
// APE-style: pick + order fragments, choose linear / circular, set the overlap
// (length default, Tm advanced), REVIEW each junction with its primers + the
// assembled-construct preview + warnings, then Save. On save the product lands
// as a new sequence in the active collection and the junction primers become an
// oligo order list (copyable, or saved as primer_bind features).
//
// All biology comes from the pure engine (lib/sequences/cloning.ts); this file
// only orchestrates the picker, the review, and the save path. No emojis (inline
// SVG only), no em-dashes, Tooltip component for icon-only buttons.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Tooltip from "@/components/Tooltip";
import { sequencesApi } from "@/lib/local-api";
import { sanitizeRawSequence } from "@/lib/sequences/import";
import {
  assembleGibson,
  productGc,
  DEFAULT_OVERLAP_BP,
  DEFAULT_ANNEAL_TM,
  type Fragment,
  type AssemblyResult,
  type OverlapMode,
} from "@/lib/sequences/cloning";
import {
  annotationsToCloneFeatures,
  productToGenbank,
  oligoOrderText,
} from "@/lib/sequences/cloning-io";
import {
  cutAndLigate,
  type CutLigateResult,
  type LigateFragment,
} from "@/lib/sequences/cut-ligate";
import {
  runGateway,
  type GatewayResult,
  type GatewayReaction,
  type GatewaySubstrate,
} from "@/lib/sequences/cloning-gateway";
import type { SequenceRecord } from "@/lib/types";

/** Which assembly chemistry the workspace is driving. */
type CloneMethod = "overlap" | "restriction" | "golden-gate" | "gateway";

const METHOD_LABEL: Record<CloneMethod, string> = {
  overlap: "Overlap (Gibson / NEBuilder)",
  restriction: "Restriction + ligation",
  "golden-gate": "Golden Gate (Type IIS)",
  gateway: "Gateway (BP / LR)",
};

/** Type IIS enzymes offered for Golden Gate, and common cutters for restriction. */
const GOLDEN_GATE_ENZYMES = ["BsaI", "BsmBI", "BbsI", "SapI"];
const RESTRICTION_ENZYMES = ["EcoRI", "BamHI", "HindIII", "PstI", "KpnI", "SmaI", "XhoI", "NotI"];

// --- small inline icons (no emojis) -----------------------------------------

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function UpIcon({ className }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><polyline points="18 15 12 9 6 15" /></svg>);
}
function DownIcon({ className }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>);
}
function TrashIcon({ className }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>);
}
function WarnIcon({ className }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>);
}
function CopyIcon({ className }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>);
}

// --- types for the workspace's working state --------------------------------

/** A fragment chosen for the assembly: either a library sequence (resolved on
 *  demand) or a pasted ad-hoc sequence. */
type PickedFragment =
  | { kind: "library"; id: number; name: string }
  | { kind: "pasted"; name: string; seq: string };

type Step = "pick" | "review";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Project ids the saved construct should be filed under (active collection). */
  activeProjectIds: string[];
  /** Called after a successful save with the new sequence's id, so the library
   *  can select + open it in the editor. */
  onSaved: (newId: number) => void;
}

// --- monospace sequence preview (wraps; highlights junction seams) -----------

function PreviewBox({ seq, circular }: { seq: string; circular: boolean }) {
  const shown = seq.length > 4000 ? seq.slice(0, 4000) : seq;
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-meta font-medium uppercase tracking-wide text-gray-500">
          Assembled construct {circular ? "(circular)" : "(linear)"}
        </span>
        <span className="text-meta text-gray-500">
          {seq.length.toLocaleString()} bp · {productGc(seq).toFixed(0)}% GC
        </span>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-meta leading-relaxed text-gray-700">
        {shown}
        {seq.length > shown.length ? `\n… (${(seq.length - shown.length).toLocaleString()} more bp)` : ""}
      </pre>
    </div>
  );
}

export default function CloningWorkspace({ open, onClose, activeProjectIds, onSaved }: Props) {
  const [picked, setPicked] = useState<PickedFragment[]>([]);
  const [circular, setCircular] = useState(true);
  const [step, setStep] = useState<Step>("pick");
  const [method, setMethod] = useState<CloneMethod>("overlap");
  // Enzymes for the cut-ligate methods (restriction / golden-gate).
  const [enzymeNames, setEnzymeNames] = useState<string[]>(["BsaI"]);
  // Gateway reaction type (BP or LR).
  const [gatewayReaction, setGatewayReaction] = useState<GatewayReaction>("LR");
  // Overlap sizing. length is the default; Tm is the advanced disclosure.
  const [overlapKind, setOverlapKind] = useState<"length" | "tm">("length");
  const [overlapBp, setOverlapBp] = useState(DEFAULT_OVERLAP_BP);
  const [overlapTm, setOverlapTm] = useState(48);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Which cut-ligate product (when several are possible) the user will save.
  const [selectedProduct, setSelectedProduct] = useState(0);
  // Paste dialog state.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteSeq, setPasteSeq] = useState("");

  const { data: library = [] } = useQuery({
    queryKey: ["sequences"],
    queryFn: () => sequencesApi.list(),
    enabled: open,
  });
  // DNA only (Gibson is a DNA assembly).
  const dnaLibrary = useMemo(
    () => library.filter((s: SequenceRecord) => s.seq_type === "dna"),
    [library],
  );

  // Reset when opened.
  useEffect(() => {
    if (open) {
      setPicked([]);
      setCircular(true);
      setStep("pick");
      setMethod("overlap");
      setEnzymeNames(["BsaI"]);
      setGatewayReaction("LR");
      setOverlapKind("length");
      setOverlapBp(DEFAULT_OVERLAP_BP);
      setOverlapTm(48);
      setShowAdvanced(false);
      setName("");
      setSaveError(null);
      setCopied(false);
      setSelectedProduct(0);
    }
  }, [open]);


  // Resolve the full bases + features of every picked LIBRARY fragment (pasted
  // ones already carry their seq). Keyed on the picked id list so it refetches
  // only when the selection changes.
  const libraryIds = picked.filter((p) => p.kind === "library").map((p) => p.id);
  const { data: resolved, isFetching: resolving } = useQuery({
    queryKey: ["cloning-fragments", libraryIds],
    enabled: open && libraryIds.length > 0,
    queryFn: async () => {
      const map = new Map<number, { seq: string; features: ReturnType<typeof annotationsToCloneFeatures> }>();
      for (const id of libraryIds) {
        const detail = await sequencesApi.get(id);
        if (detail) {
          map.set(id, {
            seq: detail.seq,
            features: annotationsToCloneFeatures(detail.annotations),
          });
        }
      }
      return map;
    },
  });

  // Build the engine's Fragment[] from the picked list + resolved bases.
  const fragments: Fragment[] = useMemo(() => {
    return picked.map((p) => {
      if (p.kind === "pasted") {
        return { name: p.name, seq: p.seq, features: [] };
      }
      const r = resolved?.get(p.id);
      return { name: p.name, seq: r?.seq ?? "", features: r?.features ?? [] };
    });
  }, [picked, resolved]);

  const overlap: OverlapMode = useMemo(
    () =>
      overlapKind === "length"
        ? { kind: "length", bp: overlapBp }
        : { kind: "tm", targetTm: overlapTm },
    [overlapKind, overlapBp, overlapTm],
  );

  // Switching method snaps the enzyme selection to a sensible default for that
  // chemistry, resets the product selection, and returns to the pick step. Done in
  // the handler (not an effect) to avoid cascading-render setState-in-effect.
  const switchMethod = useCallback((m: CloneMethod) => {
    setMethod(m);
    setStep("pick");
    setSelectedProduct(0);
    if (m === "golden-gate") setEnzymeNames(["BsaI"]);
    else if (m === "restriction") setEnzymeNames(["EcoRI"]);
  }, []);

  // Resolve the per-fragment circular flag from its library record (pasted
  // fragments default to linear). Used by the cut-ligate and Gateway engines.
  const fragmentIsCircular = useCallback(
    (i: number): boolean => {
      const p = picked[i];
      if (!p || p.kind !== "library") return false;
      return library.find((s: SequenceRecord) => s.id === p.id)?.circular ?? false;
    },
    [picked, library],
  );

  // Run the pure OVERLAP engine whenever inputs change (cheap, deterministic).
  const result: AssemblyResult | null = useMemo(() => {
    if (method !== "overlap") return null;
    if (fragments.length < 2 || fragments.some((f) => !f.seq)) return null;
    return assembleGibson(fragments, { circular, overlap, annealTargetTm: DEFAULT_ANNEAL_TM });
  }, [method, fragments, circular, overlap]);

  // Run the pure CUT-LIGATE engine (restriction / golden-gate). Resolved library
  // fragments carry their circular flag from the library record.
  const cutLigateResult: CutLigateResult | null = useMemo(() => {
    if (method === "overlap") return null;
    if (fragments.length < 1 || fragments.some((f) => !f.seq)) return null;
    const ligFrags: LigateFragment[] = fragments.map((f, i) => ({
      name: f.name,
      seq: f.seq,
      circular: fragmentIsCircular(i),
    }));
    return cutAndLigate(ligFrags, {
      enzymeNames,
      mode: method === "golden-gate" ? "golden-gate" : "restriction",
      circularOnly: true,
      allowBlunt: false,
    });
  }, [method, fragments, enzymeNames, fragmentIsCircular]);

  // Run the pure GATEWAY engine (BP / LR). Slot 0 is the insert/entry substrate
  // (an attB-PCR product is linear; an entry clone is circular); slot 1 is the
  // donor/destination cassette vector (circular). The gene of interest transfers
  // onto the cassette backbone.
  const gatewayResult: GatewayResult | null = useMemo(() => {
    if (method !== "gateway") return null;
    if (fragments.length < 2 || !fragments[0]?.seq || !fragments[1]?.seq) return null;
    const insert: GatewaySubstrate = {
      name: fragments[0].name,
      seq: fragments[0].seq,
      circular: fragmentIsCircular(0),
      features: fragments[0].features ?? [],
    };
    const cassette: GatewaySubstrate = {
      name: fragments[1].name,
      seq: fragments[1].seq,
      circular: fragmentIsCircular(1),
      features: fragments[1].features ?? [],
    };
    return runGateway(insert, cassette, gatewayReaction);
  }, [method, fragments, gatewayReaction, fragmentIsCircular]);

  const canReview =
    method === "overlap"
      ? picked.length >= 2 && !resolving && fragments.every((f) => f.seq)
      : method === "gateway"
        ? picked.length === 2 && !resolving && fragments.every((f) => f.seq)
        : picked.length >= 1 && !resolving && fragments.every((f) => f.seq) && enzymeNames.length > 0;

  // --- fragment list editing ---
  const addLibrary = useCallback((rec: SequenceRecord) => {
    setPicked((p) => [...p, { kind: "library", id: rec.id, name: rec.display_name }]);
  }, []);
  const addPasted = useCallback(() => {
    const cleaned = sanitizeRawSequence(pasteSeq, "dna");
    if (!cleaned) return;
    setPicked((p) => [...p, { kind: "pasted", name: pasteName.trim() || `Pasted ${p.length + 1}`, seq: cleaned }]);
    setPasteOpen(false);
    setPasteName("");
    setPasteSeq("");
  }, [pasteSeq, pasteName]);
  const move = useCallback((i: number, dir: -1 | 1) => {
    setPicked((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);
  const remove = useCallback((i: number) => {
    setPicked((p) => p.filter((_, k) => k !== i));
  }, []);

  // --- save path ---
  const handleSave = useCallback(async () => {
    if (!result) return;
    setSaving(true);
    setSaveError(null);
    try {
      const genbank = productToGenbank(name.trim() || "Assembled construct", result.product, {
        primersAsFeatures: result.primers,
      });
      const rec = await sequencesApi.create({
        display_name: name.trim() || "Assembled construct",
        genbank,
        seq_type: "dna",
        project_ids: activeProjectIds,
      });
      if (!rec) {
        setSaveError("Could not save the construct.");
        return;
      }
      onSaved(rec.id);
    } catch {
      setSaveError("Could not save the construct.");
    } finally {
      setSaving(false);
    }
  }, [result, name, activeProjectIds, onSaved]);

  // Selected product, clamped so it stays valid as the product list changes
  // (avoids a reset effect; out-of-range simply falls back to the first product).
  const safeProductIndex =
    cutLigateResult && selectedProduct < cutLigateResult.products.length ? selectedProduct : 0;

  // Save a cut-ligate (restriction / golden-gate) product as a new sequence.
  const handleSaveCutLigate = useCallback(async () => {
    const prod = cutLigateResult?.products[safeProductIndex];
    if (!prod) return;
    setSaving(true);
    setSaveError(null);
    try {
      const genbank = productToGenbank(name.trim() || "Assembled construct", {
        seq: prod.seq,
        circular: prod.circular,
        features: [],
      });
      const rec = await sequencesApi.create({
        display_name: name.trim() || "Assembled construct",
        genbank,
        seq_type: "dna",
        project_ids: activeProjectIds,
      });
      if (!rec) {
        setSaveError("Could not save the construct.");
        return;
      }
      onSaved(rec.id);
    } catch {
      setSaveError("Could not save the construct.");
    } finally {
      setSaving(false);
    }
  }, [cutLigateResult, safeProductIndex, name, activeProjectIds, onSaved]);

  // Save a Gateway product (the desired clone, or the byproduct) as a sequence.
  const saveGatewayProduct = useCallback(
    async (index: number) => {
      const prod = gatewayResult?.products[index];
      if (!prod) return;
      setSaving(true);
      setSaveError(null);
      try {
        const fallback =
          prod.role === "clone"
            ? gatewayReaction === "BP"
              ? "Entry clone"
              : "Expression clone"
            : "Gateway byproduct";
        const genbank = productToGenbank(name.trim() || fallback, {
          seq: prod.seq,
          circular: prod.circular,
          features: prod.features,
        });
        const rec = await sequencesApi.create({
          display_name: name.trim() || fallback,
          genbank,
          seq_type: "dna",
          project_ids: activeProjectIds,
        });
        if (!rec) {
          setSaveError("Could not save the construct.");
          return;
        }
        onSaved(rec.id);
      } catch {
        setSaveError("Could not save the construct.");
      } finally {
        setSaving(false);
      }
    },
    [gatewayResult, gatewayReaction, name, activeProjectIds, onSaved],
  );

  const copyOligos = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(oligoOrderText(result.primers));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked; the list is still on screen to copy manually.
    }
  }, [result]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label="Assemble construct">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-gray-800">Assemble construct</h1>
          <p className="text-meta text-gray-500">
            {method === "overlap"
              ? "Overlap assembly (Gibson / NEBuilder HiFi). Join fragments by shared homologous ends."
              : method === "restriction"
                ? "Restriction + ligation. Cut fragments with one or more enzymes and ligate the compatible ends."
                : method === "golden-gate"
                  ? "Golden Gate (Type IIS). One enzyme excises its sites and ligates the parts by defined overhangs, scarlessly."
                  : "Gateway recombination. att-site BP and LR reactions transfer a gene between vectors with no enzyme digestion or ligation."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {step === "review" ? (
            <button
              type="button"
              onClick={() => setStep("pick")}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-meta font-medium text-gray-700 hover:bg-gray-100"
            >
              Back to fragments
            </button>
          ) : null}
          <Tooltip label="Close (your selection is discarded)">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>
      </header>

      {/* Method tabs (overlap / restriction / golden-gate) */}
      <div className="flex items-center gap-1 border-b border-gray-100 px-5 py-2">
        {(["overlap", "restriction", "golden-gate", "gateway"] as CloneMethod[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMethod(m)}
            className={`rounded-md px-3 py-1.5 text-meta font-medium ${
              method === m
                ? "bg-sky-100 text-sky-700"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {METHOD_LABEL[m]}
          </button>
        ))}
      </div>

      {step === "pick" ? (
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_22rem] gap-0 overflow-hidden">
          {/* LEFT: ordered fragment list + options */}
          <section className="flex min-h-0 flex-col overflow-y-auto p-5">
            <h2 className="mb-1 text-body font-semibold text-gray-700">
              {method === "gateway" ? "Substrates" : "Fragments, in order"}
            </h2>
            <p className="mb-3 text-meta text-gray-500">
              {method === "overlap"
                ? "Order is 5'->3' along the product. For a plasmid put the insert first, then the vector backbone."
                : method === "gateway"
                  ? gatewayReaction === "BP"
                    ? "Add two substrates in order. First the attB substrate (your attB-PCR product or attB clone), then the attP donor vector (pDONR)."
                    : "Add two substrates in order. First the attL entry clone (carries your gene), then the attR destination vector (pDEST)."
                  : "Order does not matter; the engine ligates by compatible ends. Mark library plasmids that should be cut open as circular."}
            </p>

            {picked.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 px-4 py-8 text-center text-body text-gray-400">
                {method === "overlap"
                  ? "Add two or more fragments from your library or paste a sequence."
                  : method === "gateway"
                    ? "Add the two substrates for this reaction, from your library or pasted."
                    : "Add the fragment(s) to cut and ligate, from your library or pasted."}
              </div>
            ) : (
              <ol className="space-y-2">
                {picked.map((p, i) => {
                  const frag = fragments[i];
                  const len = frag?.seq.length ?? 0;
                  return (
                    <li key={`${p.kind}-${i}-${p.name}`} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-meta font-semibold text-sky-700">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-gray-800">{p.name}</span>
                        <span className="block text-meta text-gray-400">
                          {p.kind === "pasted" ? "Pasted" : "Library"} ·{" "}
                          {resolving && p.kind === "library" && !len ? "resolving…" : `${len.toLocaleString()} bp`}
                        </span>
                      </span>
                      <Tooltip label="Move up">
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30" aria-label="Move up">
                          <UpIcon className="h-4 w-4" />
                        </button>
                      </Tooltip>
                      <Tooltip label="Move down">
                        <button type="button" onClick={() => move(i, 1)} disabled={i === picked.length - 1} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30" aria-label="Move down">
                          <DownIcon className="h-4 w-4" />
                        </button>
                      </Tooltip>
                      <Tooltip label="Remove">
                        <button type="button" onClick={() => remove(i)} className="rounded p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove">
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="mt-3">
              <button
                type="button"
                onClick={() => setPasteOpen((o) => !o)}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-meta font-medium text-gray-700 hover:bg-gray-100"
              >
                Paste a sequence…
              </button>
              {pasteOpen ? (
                <div className="mt-2 rounded-md border border-gray-200 p-3">
                  <input
                    type="text"
                    value={pasteName}
                    onChange={(e) => setPasteName(e.target.value)}
                    placeholder="Fragment name"
                    className="mb-2 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-body focus:border-sky-400 focus:outline-none"
                  />
                  <textarea
                    value={pasteSeq}
                    onChange={(e) => setPasteSeq(e.target.value)}
                    placeholder="Paste DNA bases (ACGT). Whitespace, numbers, and a FASTA header are stripped."
                    rows={3}
                    className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 font-mono text-meta focus:border-sky-400 focus:outline-none"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" onClick={() => setPasteOpen(false)} className="rounded-md px-3 py-1.5 text-meta font-medium text-gray-500 hover:bg-gray-100">Cancel</button>
                    <button type="button" onClick={addPasted} disabled={!sanitizeRawSequence(pasteSeq, "dna")} className="rounded-md bg-sky-600 px-3 py-1.5 text-meta font-medium text-white hover:bg-sky-700 disabled:opacity-50">Add fragment</button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Options */}
            <div className="mt-6 space-y-4 border-t border-gray-100 pt-4">
              {method === "gateway" ? (
                <div>
                  <span className="mb-1.5 block text-meta font-medium uppercase tracking-wide text-gray-400">
                    Reaction
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setGatewayReaction("BP")}
                      className={`rounded-md border px-3 py-1.5 text-meta font-medium ${gatewayReaction === "BP" ? "border-sky-500 bg-sky-50 text-sky-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                    >
                      BP (attB x attP)
                    </button>
                    <button
                      type="button"
                      onClick={() => setGatewayReaction("LR")}
                      className={`rounded-md border px-3 py-1.5 text-meta font-medium ${gatewayReaction === "LR" ? "border-sky-500 bg-sky-50 text-sky-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                    >
                      LR (attL x attR)
                    </button>
                  </div>
                  <p className="mt-1 text-meta text-gray-400">
                    {gatewayReaction === "BP"
                      ? "attB substrate x attP donor builds an attL entry clone (the ccdB cassette leaves as the byproduct)."
                      : "attL entry clone x attR destination builds an attB expression clone (the ccdB cassette leaves as the byproduct)."}
                  </p>
                </div>
              ) : method !== "overlap" ? (
                <div>
                  <span className="mb-1.5 block text-meta font-medium uppercase tracking-wide text-gray-400">
                    {method === "golden-gate" ? "Type IIS enzyme" : "Restriction enzyme(s)"}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {(method === "golden-gate" ? GOLDEN_GATE_ENZYMES : RESTRICTION_ENZYMES).map((e) => {
                      const on = enzymeNames.includes(e);
                      return (
                        <button
                          key={e}
                          type="button"
                          onClick={() =>
                            setEnzymeNames((prev) => {
                              if (method === "golden-gate") return [e]; // single Type IIS enzyme
                              return on ? prev.filter((x) => x !== e) : [...prev, e];
                            })
                          }
                          className={`rounded-md border px-2.5 py-1 font-mono text-meta ${
                            on
                              ? "border-sky-500 bg-sky-50 text-sky-700"
                              : "border-gray-200 text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          {e}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-meta text-gray-400">
                    {method === "golden-gate"
                      ? "The enzyme's recognition sites are excised; parts ligate by their defined 4 bp overhangs into a scarless circle."
                      : "Each enzyme cuts its sites; compatible sticky (or blunt) ends ligate. Pick the enzyme(s) flanking your insert and vector."}
                  </p>
                </div>
              ) : (
              <>
              <div>
                <span className="mb-1.5 block text-meta font-medium uppercase tracking-wide text-gray-400">Product topology</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCircular(true)} className={`rounded-md border px-3 py-1.5 text-meta font-medium ${circular ? "border-sky-500 bg-sky-50 text-sky-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                    Circular (plasmid)
                  </button>
                  <button type="button" onClick={() => setCircular(false)} className={`rounded-md border px-3 py-1.5 text-meta font-medium ${!circular ? "border-sky-500 bg-sky-50 text-sky-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                    Linear
                  </button>
                </div>
                <p className="mt-1 text-meta text-gray-400">
                  {circular ? "The last fragment joins back to the first, closing the loop." : "An open construct; the two ends are not joined."}
                </p>
              </div>

              <div>
                <span className="mb-1.5 block text-meta font-medium uppercase tracking-wide text-gray-400">Homology overlap</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-body text-gray-700">
                    <input type="radio" checked={overlapKind === "length"} onChange={() => setOverlapKind("length")} />
                    Length
                  </label>
                  {overlapKind === "length" ? (
                    <span className="flex items-center gap-1">
                      <input type="number" min={10} max={60} value={overlapBp} onChange={(e) => setOverlapBp(Math.max(10, Math.min(60, Number(e.target.value) || DEFAULT_OVERLAP_BP)))} className="w-16 rounded-md border border-gray-200 px-2 py-1 text-body focus:border-sky-400 focus:outline-none" />
                      <span className="text-meta text-gray-500">bp</span>
                    </span>
                  ) : null}
                </div>
                <button type="button" onClick={() => setShowAdvanced((s) => !s)} className="mt-2 text-meta font-medium text-sky-600 hover:text-sky-800">
                  {showAdvanced ? "Hide advanced" : "Advanced: size by Tm"}
                </button>
                {showAdvanced ? (
                  <div className="mt-2 flex items-center gap-3">
                    <label className="flex items-center gap-2 text-body text-gray-700">
                      <input type="radio" checked={overlapKind === "tm"} onChange={() => setOverlapKind("tm")} />
                      Target Tm
                    </label>
                    {overlapKind === "tm" ? (
                      <span className="flex items-center gap-1">
                        <input type="number" min={40} max={70} value={overlapTm} onChange={(e) => setOverlapTm(Math.max(40, Math.min(70, Number(e.target.value) || 48)))} className="w-16 rounded-md border border-gray-200 px-2 py-1 text-body focus:border-sky-400 focus:outline-none" />
                        <span className="text-meta text-gray-500">C</span>
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <p className="mt-1 text-meta text-gray-400">
                  The shared end each junction&apos;s primers add. Default 25 bp suits Gibson / NEBuilder HiFi.
                </p>
              </div>
              </>
              )}
            </div>
          </section>

          {/* RIGHT: pick from library */}
          <aside className="flex min-h-0 flex-col border-l border-gray-200">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-body font-semibold text-gray-700">Your DNA library</h2>
              <p className="mt-0.5 text-meta text-gray-500">Click to add a fragment in order.</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {dnaLibrary.length === 0 ? (
                <div className="px-4 py-6 text-body text-gray-400">No DNA sequences in your library yet.</div>
              ) : (
                <ul>
                  {dnaLibrary.map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => addLibrary(s)} className="flex w-full items-center justify-between gap-2 border-b border-gray-50 px-4 py-2 text-left hover:bg-sky-50">
                        <span className="min-w-0">
                          <span className="block truncate text-body font-medium text-gray-800">{s.display_name}</span>
                          <span className="block text-meta text-gray-400">{s.length.toLocaleString()} bp{s.circular ? " · circular" : ""}</span>
                        </span>
                        <span className="text-lg leading-none text-sky-500">+</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-gray-100 p-4">
              <Tooltip
                label={
                  canReview
                    ? "Review the product before saving"
                    : method === "gateway"
                      ? "Add the two substrates first"
                      : "Add at least two fragments first"
                }
              >
                <button
                  type="button"
                  onClick={() => setStep("review")}
                  disabled={!canReview}
                  className="w-full rounded-md bg-sky-600 px-3 py-2 text-body font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {method === "overlap"
                    ? "Review junctions"
                    : method === "gateway"
                      ? "Run recombination"
                      : "Cut and ligate"}
                </button>
              </Tooltip>
            </div>
          </aside>
        </div>
      ) : method === "gateway" ? (
        // --- GATEWAY REVIEW STEP (BP / LR) ---
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {gatewayResult && gatewayResult.products.length > 0 ? (
            <div className="mx-auto max-w-4xl space-y-5">
              <label className="block">
                <span className="mb-1 block text-meta font-medium uppercase tracking-wide text-gray-400">Construct name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={gatewayReaction === "BP" ? "Entry clone" : "Expression clone"}
                  className="w-full max-w-md rounded-md border border-gray-200 px-3 py-2 text-body focus:border-sky-400 focus:outline-none"
                />
              </label>

              {gatewayResult.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-meta font-semibold text-amber-800">
                    <WarnIcon className="h-4 w-4" /> Notes
                  </div>
                  <ul className="list-inside list-disc space-y-0.5 text-meta text-amber-700">
                    {gatewayResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              ) : null}

              {gatewayResult.products.map((prod, i) => (
                <div key={i} className="rounded-md border border-gray-200 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-body font-semibold text-gray-700">
                      {prod.role === "clone"
                        ? gatewayReaction === "BP"
                          ? "Entry clone"
                          : "Expression clone"
                        : "Byproduct"}
                    </h2>
                    <span className="text-meta text-gray-500">
                      {prod.circular ? "Circular" : "Linear"} · {prod.seq.length.toLocaleString()} bp ·{" "}
                      {productGc(prod.seq).toFixed(0)}% GC
                    </span>
                  </div>
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    {prod.attSites.map((att, k) => (
                      <div key={k} className="rounded bg-gray-50 px-2 py-1.5">
                        <div className="mb-0.5 font-sans text-meta font-medium text-gray-700">{att.name}</div>
                        <div className="break-all font-mono text-meta text-gray-600">{att.seq}</div>
                      </div>
                    ))}
                  </div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-2 font-mono text-meta leading-relaxed text-gray-700">
                    {prod.seq.length > 4000 ? prod.seq.slice(0, 4000) + "\n…" : prod.seq}
                  </pre>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => saveGatewayProduct(i)}
                      disabled={saving}
                      className="rounded-md bg-sky-600 px-4 py-1.5 text-meta font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      {saving ? "Saving…" : `Save ${prod.role === "clone" ? "clone" : "byproduct"}`}
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
                {saveError ? <span className="text-meta text-rose-600">{saveError}</span> : null}
                <button type="button" onClick={() => setStep("pick")} className="rounded-md border border-gray-200 px-4 py-2 text-body font-medium text-gray-700 hover:bg-gray-100">
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-body text-gray-400">
              <span>No recombination product from these substrates.</span>
              {gatewayResult?.warnings.length ? (
                <ul className="list-inside list-disc text-meta text-amber-600">
                  {gatewayResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      ) : method !== "overlap" ? (
        // --- CUT-LIGATE REVIEW STEP (restriction / golden-gate) ---
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {cutLigateResult && cutLigateResult.products.length > 0 ? (
            <div className="mx-auto max-w-4xl space-y-5">
              <label className="block">
                <span className="mb-1 block text-meta font-medium uppercase tracking-wide text-gray-400">Construct name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Assembled construct"
                  className="w-full max-w-md rounded-md border border-gray-200 px-3 py-2 text-body focus:border-sky-400 focus:outline-none"
                />
              </label>

              {cutLigateResult.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-meta font-semibold text-amber-800">
                    <WarnIcon className="h-4 w-4" /> Notes
                  </div>
                  <ul className="list-inside list-disc space-y-0.5 text-meta text-amber-700">
                    {cutLigateResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              ) : null}

              <div>
                <h2 className="mb-2 text-body font-semibold text-gray-700">
                  {cutLigateResult.products.length === 1
                    ? "Assembled product"
                    : `Possible products (${cutLigateResult.products.length})`}
                </h2>
                {cutLigateResult.products.length > 1 ? (
                  <p className="mb-2 text-meta text-gray-500">
                    The overhangs are symmetric, so more than one circular product can form. Pick the one to save.
                  </p>
                ) : null}
                <div className="space-y-3">
                  {cutLigateResult.products.map((prod, i) => (
                    <label
                      key={i}
                      className={`block cursor-pointer rounded-md border p-3 ${
                        safeProductIndex === i ? "border-sky-400 ring-1 ring-sky-200" : "border-gray-200"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        {cutLigateResult.products.length > 1 ? (
                          <input
                            type="radio"
                            name="cutligate-product"
                            checked={safeProductIndex === i}
                            onChange={() => setSelectedProduct(i)}
                          />
                        ) : null}
                        <span className="text-meta font-medium text-gray-700">
                          {prod.circular ? "Circular" : "Linear"} · {prod.seq.length.toLocaleString()} bp ·{" "}
                          {productGc(prod.seq).toFixed(0)}% GC
                        </span>
                        <span className="text-meta text-gray-400">
                          junctions: {prod.junctionOverhangs.map((o) => o || "blunt").join(", ")}
                        </span>
                      </div>
                      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-meta leading-relaxed text-gray-700">
                        {prod.seq.length > 4000 ? prod.seq.slice(0, 4000) + "\n…" : prod.seq}
                      </pre>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="mb-2 text-body font-semibold text-gray-700">Digested pieces ({cutLigateResult.pieces.length})</h2>
                <div className="overflow-x-auto rounded-md border border-gray-200">
                  <table className="w-full text-left text-meta">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">From</th>
                        <th className="px-2 py-1.5 font-medium">Left end</th>
                        <th className="px-2 py-1.5 font-medium">Right end</th>
                        <th className="px-2 py-1.5 font-medium">Length</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-700">
                      {cutLigateResult.pieces.map((pc, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-2 py-1.5">{pc.sourceName}</td>
                          <td className="px-2 py-1.5 font-mono">{endLabel(pc.left)}</td>
                          <td className="px-2 py-1.5 font-mono">{endLabel(pc.right)}</td>
                          <td className="px-2 py-1.5">{pc.seq.length.toLocaleString()} bp</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
                {saveError ? <span className="text-meta text-rose-600">{saveError}</span> : null}
                <button type="button" onClick={() => setStep("pick")} className="rounded-md border border-gray-200 px-4 py-2 text-body font-medium text-gray-700 hover:bg-gray-100">
                  Back
                </button>
                <button type="button" onClick={handleSaveCutLigate} disabled={saving} className="rounded-md bg-sky-600 px-5 py-2 text-body font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                  {saving ? "Saving…" : "Save product"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-body text-gray-400">
              <span>No assembled product from these fragments and enzyme(s).</span>
              {cutLigateResult?.warnings.length ? (
                <ul className="list-inside list-disc text-meta text-amber-600">
                  {cutLigateResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        // --- OVERLAP REVIEW STEP ---
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {result ? (
            <div className="mx-auto max-w-4xl space-y-5">
              {/* Construct name + preview */}
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-meta font-medium uppercase tracking-wide text-gray-400">Construct name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Assembled construct"
                    className="w-full max-w-md rounded-md border border-gray-200 px-3 py-2 text-body focus:border-sky-400 focus:outline-none"
                  />
                </label>
                <PreviewBox seq={result.product.seq} circular={result.product.circular} />
              </div>

              {/* Assembly-level warnings */}
              {result.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-meta font-semibold text-amber-800">
                    <WarnIcon className="h-4 w-4" /> Assembly warnings
                  </div>
                  <ul className="list-inside list-disc space-y-0.5 text-meta text-amber-700">
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              ) : null}

              {/* Junctions */}
              <div>
                <h2 className="mb-2 text-body font-semibold text-gray-700">Junctions ({result.junctions.length})</h2>
                <div className="space-y-3">
                  {result.junctions.map((jn, i) => {
                    const up = result.primers[jn.fragmentIndex];
                    const down = result.primers[jn.nextFragmentIndex];
                    return (
                      <div key={i} className="rounded-md border border-gray-200 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-body font-medium text-gray-800">
                            {up?.fragmentName} <span className="text-gray-400">-&gt;</span> {down?.fragmentName}
                          </span>
                          <span className="text-meta text-gray-500">
                            overlap {jn.overlapBp} bp · Tm {Number.isFinite(jn.overlapTm) ? jn.overlapTm.toFixed(1) : "—"} C
                          </span>
                        </div>
                        {jn.warning ? (
                          <div className="mb-2 flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1 text-meta text-amber-700">
                            <WarnIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {jn.warning}
                          </div>
                        ) : null}
                        <div className="mb-2 rounded bg-gray-50 px-2 py-1 font-mono text-meta text-gray-600 break-all">
                          overlap: {jn.overlapSeq || "—"}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-meta">
                          <PrimerCell label={`${down?.fragmentName} forward`} primer={down?.forward} />
                          <PrimerCell label={`${up?.fragmentName} reverse`} primer={up?.reverse} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Oligo order list */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-body font-semibold text-gray-700">Oligo order list ({result.primers.length * 2})</h2>
                  <button type="button" onClick={copyOligos} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-meta font-medium text-gray-700 hover:bg-gray-100">
                    <CopyIcon className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy all"}
                  </button>
                </div>
                <div className="overflow-x-auto rounded-md border border-gray-200">
                  <table className="w-full text-left text-meta">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Name</th>
                        <th className="px-2 py-1.5 font-medium">Sequence (5&apos;-&gt;3&apos;)</th>
                        <th className="px-2 py-1.5 font-medium">Len</th>
                        <th className="px-2 py-1.5 font-medium">Anneal Tm</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-gray-700">
                      {result.primers.flatMap((fp) => [
                        { key: `${fp.fragmentIndex}F`, n: `${fp.fragmentName} F`, p: fp.forward },
                        { key: `${fp.fragmentIndex}R`, n: `${fp.fragmentName} R`, p: fp.reverse },
                      ]).map((row) => (
                        <tr key={row.key} className="border-t border-gray-100">
                          <td className="whitespace-nowrap px-2 py-1.5 font-sans text-gray-800">{row.n}</td>
                          <td className="px-2 py-1.5 break-all">{row.p.sequence}</td>
                          <td className="px-2 py-1.5">{row.p.length}</td>
                          <td className="px-2 py-1.5">{Number.isFinite(row.p.annealTm) ? row.p.annealTm.toFixed(1) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-meta text-gray-400">
                  Each primer is a 3&apos; annealing region (sized to ~{DEFAULT_ANNEAL_TM} C) plus a 5&apos; homology tail that adds the overlap. Saved with the construct as primer_bind features.
                </p>
              </div>

              {/* Save */}
              <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
                {saveError ? <span className="text-meta text-rose-600">{saveError}</span> : null}
                <button type="button" onClick={() => setStep("pick")} className="rounded-md border border-gray-200 px-4 py-2 text-body font-medium text-gray-700 hover:bg-gray-100">
                  Back
                </button>
                <button type="button" onClick={handleSave} disabled={saving} className="rounded-md bg-sky-600 px-5 py-2 text-body font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                  {saving ? "Saving…" : "Save construct"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-body text-gray-400">
              Add at least two fragments to assemble.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Short human label for a digested piece end (blunt / 5' or 3' overhang seq). */
function endLabel(end: { kind: string; overhang: string; original?: boolean }): string {
  if (end.kind === "blunt") return end.original ? "blunt (original)" : "blunt";
  const tag = end.kind === "5overhang" ? "5'" : "3'";
  return `${tag} ${end.overhang}`;
}

function PrimerCell({ label, primer }: { label: string; primer?: { sequence: string; tail: string; anneal: string; annealTm: number; length: number } }) {
  if (!primer) return null;
  return (
    <div className="rounded bg-gray-50 px-2 py-1.5">
      <div className="mb-0.5 flex items-center justify-between">
        <span className="font-sans font-medium text-gray-700">{label}</span>
        <span className="font-sans text-gray-400">{primer.length} nt · anneal {Number.isFinite(primer.annealTm) ? primer.annealTm.toFixed(0) : "—"} C</span>
      </div>
      <div className="font-mono break-all">
        {primer.tail ? <span className="text-sky-600">{primer.tail}</span> : null}
        <span className="text-gray-800">{primer.anneal}</span>
      </div>
    </div>
  );
}
