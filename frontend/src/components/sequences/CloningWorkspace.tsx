"use client";

// cloning bot — the STANDALONE cloning workspace. A full-surface overlay
// launched from the /sequences library "Assemble" action (NOT an editor tab,
// NOT a top-nav item). It drives four assembly chemistries from one method
// selector: overlap (Gibson / NEBuilder HiFi), restriction + ligation, Golden
// Gate (Type IIS), and Gateway (BP / LR). Calm, progressive disclosure,
// APE-style: pick + order fragments / substrates, set the method's options,
// REVIEW the product with its primers / pieces / att-sites + warnings, then
// Save. On save the product lands as a new sequence in the active collection
// and (for overlap) the junction primers become an oligo order list (copyable,
// or saved as primer_bind features). Every method renders its product(s) through
// the shared CloningProductPreview card, with a per-product "Save to library"
// button on the card and a Back-plus-error-only shared footer.
//
// All biology comes from the pure engines (lib/sequences/cloning.ts,
// cut-ligate.ts, cloning-gateway.ts); this file only orchestrates the picker,
// the review, and the save path. No emojis (inline SVG only), no em-dashes,
// Tooltip component for icon-only buttons.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Tooltip from "@/components/Tooltip";
import { sequencesApi } from "@/lib/local-api";
import { sanitizeRawSequence } from "@/lib/sequences/import";
import {
  assembleGibson,
  DEFAULT_OVERLAP_BP,
  DEFAULT_ANNEAL_TM,
  type Fragment,
  type AssemblyResult,
  type OverlapMode,
} from "@/lib/sequences/cloning";
import {
  annotationsToCloneFeatures,
  productToGenbank,
  productToDetail,
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
import {
  fragmentSiteSummary,
  checkGatewayMatch,
  groupGatewayPicker,
  type FragmentSiteSummary,
  type GatewayMatch,
  type GatewayKind,
} from "@/lib/sequences/pick-readouts";
import {
  filterLibrary,
  type TopologyFilter,
} from "@/lib/sequences/library-filter";
import type { SequenceRecord } from "@/lib/types";
import CloningProductPreview from "./CloningProductPreview";
import type { RibbonJunction } from "./FragmentRibbon";
import OverlapHomologyHero from "./cloning-heroes/OverlapHomologyHero";
import StickyEndLadderHero from "./cloning-heroes/StickyEndLadderHero";
import GoldenGateFingerprintHero from "./cloning-heroes/GoldenGateFingerprintHero";
import GatewayCrossoverHero from "./cloning-heroes/GatewayCrossoverHero";

/** Which assembly chemistry the workspace is driving. */
type CloneMethod = "overlap" | "restriction" | "golden-gate" | "gateway";

// Short selector-pill labels (method name only). The chemistry hint
// (Gibson / NEBuilder, Type IIS, BP / LR) lives in the per-method header
// subtitle, not crammed into the pill (see L3).
const METHOD_LABEL: Record<CloneMethod, string> = {
  overlap: "Overlap",
  restriction: "Restriction",
  "golden-gate": "Golden Gate",
  gateway: "Gateway",
};

// Method-aware DEFAULT for the library topology filter. Overlap fragments are
// LINEAR pieces (a raw circular plasmid added to a Gibson assembly is wrong; the
// engine treats the ring as a linear body, so you linearize first), so Overlap
// hides circular by default. Cut (restriction / Golden Gate) and recombine
// (Gateway) accept both topologies, so they default to "all". The user can
// always switch after the default is applied.
const DEFAULT_TOPOLOGY_FILTER: Record<CloneMethod, TopologyFilter> = {
  overlap: "linear",
  restriction: "all",
  "golden-gate": "all",
  gateway: "all",
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
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>);
}
function WarnIcon({ className }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>);
}
function CopyIcon({ className }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>);
}
function CheckIcon({ className }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>);
}
function SearchIcon({ className }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>);
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
  // Whether to carry feature annotations from source fragments into the product.
  const [carryAnnotations, setCarryAnnotations] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Which cut-ligate product (when several are possible) the user will save.
  const [selectedProduct, setSelectedProduct] = useState(0);
  // Paste dialog state.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteSeq, setPasteSeq] = useState("");
  // Library picker filtering. Search is a display_name substring; topologyFilter
  // is method-aware (Overlap defaults to "linear", since raw Gibson fragments are
  // linear; cut/recombine methods default to "all"). Both stay user-switchable.
  const [librarySearch, setLibrarySearch] = useState("");
  const [topologyFilter, setTopologyFilter] = useState<TopologyFilter>("linear");

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
  // The picker list after the topology + search filter. Pure (library-filter.ts).
  const filteredLibrary = useMemo(
    () => filterLibrary(dnaLibrary, topologyFilter, librarySearch),
    [dnaLibrary, topologyFilter, librarySearch],
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
      setCarryAnnotations(true);
      setName("");
      setSaveError(null);
      setCopied(false);
      setSelectedProduct(0);
    }
  }, [open]);

  // Re-apply the method-aware topology default whenever the method changes, and
  // reset the search so the picker starts clean on each chemistry. The control
  // stays switchable; this only seeds the default the user can override.
  useEffect(() => {
    setTopologyFilter(DEFAULT_TOPOLOGY_FILTER[method]);
    setLibrarySearch("");
  }, [method]);

  // Escape exits the Assemble workspace. If the inline paste box is open, the
  // first Escape closes that (the topmost transient layer), so it takes two
  // presses to leave the page from inside an open paste box. Bound while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (pasteOpen) {
        setPasteOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pasteOpen, onClose]);


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

  // GATEWAY att-relevance for the PICKER (gateway tab only). classifyGatewaySubstrate
  // needs the substrate SEQUENCE, which the library summaries do not carry, so on
  // the Gateway tab we resolve the bases of the topology+search-filtered DNA library
  // (already narrowed, so we never resolve the whole library) and classify each.
  // Keyed on the filtered id list so the query cache prevents refetch on re-render.
  const gatewayPickerIds = useMemo(
    () => (method === "gateway" ? filteredLibrary.map((s) => s.id) : []),
    [method, filteredLibrary],
  );
  const { data: gatewayBases, isFetching: gatewayResolving } = useQuery({
    queryKey: ["gateway-picker-bases", gatewayPickerIds],
    enabled: open && method === "gateway" && gatewayPickerIds.length > 0,
    queryFn: async () => {
      const map = new Map<number, string>();
      for (const id of gatewayPickerIds) {
        const detail = await sequencesApi.get(id);
        if (detail) map.set(id, detail.seq);
      }
      return map;
    },
  });

  // Split the (filtered) Gateway picker into att-flanked candidates (sorted to the
  // top, each tagged with its detected kind/label) and the rest. Other tabs keep a
  // flat list. Classification reuses the Phase C classifier on the resolved bases.
  const gatewayPickerGroups = useMemo(() => {
    if (method !== "gateway") {
      return { att: [] as { rec: SequenceRecord; kind: GatewayKind; label: string }[], other: filteredLibrary };
    }
    return groupGatewayPicker(
      filteredLibrary.map((rec) => ({
        rec,
        seq: gatewayBases?.get(rec.id) ?? "",
        circular: rec.circular,
      })),
    );
  }, [method, filteredLibrary, gatewayBases]);

  // Build the engine's Fragment[] from the picked list + resolved bases.
  const fragments: Fragment[] = useMemo(() => {
    return picked.map((p) => {
      if (p.kind === "pasted") {
        return { name: p.name, seq: p.seq, features: [] };
      }
      const r = resolved?.get(p.id);
      return {
        name: p.name,
        seq: r?.seq ?? "",
        features: carryAnnotations ? (r?.features ?? []) : [],
      };
    });
  }, [picked, resolved, carryAnnotations]);

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
    // The construct name is per-method (the placeholder differs by chemistry),
    // so a name typed for one method must not bleed onto the next (L1).
    setName("");
    setSaveError(null);
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

  // Engine warnings for the overlap EMPTY state, so it explains why nothing
  // assembled the way cut-ligate and Gateway already do (L5). The overlap engine
  // returns warnings even when it cannot build a usable product (too few or empty
  // fragments), but `result` above is gated to a valid >=2-fragment product. This
  // re-reads the SAME engine purely for its diagnostic warning list when there is
  // no product to show; it never feeds the save path or the populated review.
  const overlapWarnings: string[] = useMemo(() => {
    if (method !== "overlap" || result) return [];
    const usable = fragments.filter((f) => f.seq);
    if (usable.length === 0) return [];
    return assembleGibson(fragments, { circular, overlap, annealTargetTm: DEFAULT_ANNEAL_TM }).warnings;
  }, [method, result, fragments, circular, overlap]);

  // Run the pure CUT-LIGATE engine (restriction / golden-gate). Resolved library
  // fragments carry their circular flag from the library record.
  const cutLigateResult: CutLigateResult | null = useMemo(() => {
    if (method === "overlap") return null;
    if (fragments.length < 1 || fragments.some((f) => !f.seq)) return null;
    const ligFrags: LigateFragment[] = fragments.map((f, i) => ({
      name: f.name,
      seq: f.seq,
      circular: fragmentIsCircular(i),
      features: f.features ?? [],
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

  // PICK-STEP READOUTS (Phase C). Chemistry-tuned compatibility info shown on the
  // pick step BEFORE review, so the user sees each method's key fact up front.
  // Pure helpers (pick-readouts.ts) on the existing engine helpers (digestEnzymes,
  // locateAttSites); display only, no assembly-logic change.

  // Restriction / Golden Gate: how many times each selected enzyme cuts each
  // picked fragment. Index-aligned with `fragments`. Recomputed live as the user
  // changes fragments or enzymes (the digest is cheap and memoized here).
  const fragmentSiteSummaries: FragmentSiteSummary[] = useMemo(() => {
    if (method === "overlap" || method === "gateway") return [];
    return fragments.map((f) => fragmentSiteSummary(f.seq, enzymeNames));
  }, [method, fragments, enzymeNames]);

  // Gateway: classify each picked substrate (attL / attR / attB / attP) and check
  // the picked pair against the chosen BP/LR reaction. Slot order matters.
  const gatewayMatch: GatewayMatch | null = useMemo(() => {
    if (method !== "gateway") return null;
    const substrates: GatewaySubstrate[] = fragments
      .filter((f) => f.seq)
      .map((f, i) => ({
        name: f.name,
        seq: f.seq,
        circular: fragmentIsCircular(i),
        features: f.features ?? [],
      }));
    if (substrates.length === 0) return null;
    return checkGatewayMatch(substrates, gatewayReaction);
  }, [method, fragments, gatewayReaction, fragmentIsCircular]);

  // RENDERABLE PRODUCT DETAILS for the review-step map. Built from the engine
  // products via productToDetail (reuses productToGenbank -> genbankToDetail), so
  // the map renders byte-identical to a saved-sequence map. These depend only on
  // the product (NOT the user-typed name) so typing the construct name does not
  // remount SeqViz on each keystroke; the map's locus label uses a stable title.
  const overlapDetail = useMemo(
    () =>
      result
        ? productToDetail("Assembled construct", result.product, {
            primersAsFeatures: result.primers,
          })
        : null,
    [result],
  );

  const cutLigateDetails = useMemo(
    () =>
      (cutLigateResult?.products ?? []).map((prod) =>
        productToDetail("Assembled product", {
          seq: prod.seq,
          circular: prod.circular,
          features: prod.features,
        }),
      ),
    [cutLigateResult],
  );

  const gatewayDetails = useMemo(
    () =>
      (gatewayResult?.products ?? []).map((prod) =>
        productToDetail(prod.role === "clone" ? "Clone" : "Byproduct", {
          seq: prod.seq,
          circular: prod.circular,
          features: prod.features,
        }),
      ),
    [gatewayResult],
  );

  // RIBBON JUNCTION-TICK LABELS (Phase B 1c). Each chemistry labels its boundaries
  // with the readout that matters: overlap bp + Tm, the overhang seal, the att
  // scar. Boundaries sit at the END of each non-final fragment span (the seam
  // between span i and span i+1), in product bp coordinates the ribbon shares.
  const overlapRibbonJunctions: RibbonJunction[] = useMemo(() => {
    if (!result) return [];
    const spans = result.fragmentSpans;
    // One junction per span boundary; the engine's junctions[] is index-aligned
    // with the fragment order, so junction i is the seam at the end of span i.
    return result.junctions.map((jn, i) => {
      const atBp = spans[i]?.end ?? 0;
      const tm = Number.isFinite(jn.overlapTm) ? `${jn.overlapTm.toFixed(0)} C` : "n/a";
      return { atBp, label: `${jn.overlapBp} bp / ${tm}` };
    });
  }, [result]);

  const cutLigateRibbonJunctions: RibbonJunction[][] = useMemo(
    () =>
      (cutLigateResult?.products ?? []).map((prod) => {
        const spans = prod.fragmentSpans;
        // Label each interior span boundary with its overhang seal. The closing
        // (wrap-around) junction of a circular product has no interior boundary to
        // mark, so we label only the n-1 interior seams.
        const out: RibbonJunction[] = [];
        for (let i = 0; i < spans.length - 1; i += 1) {
          const oh = prod.junctionOverhangs[i];
          out.push({ atBp: spans[i].end, label: oh ? oh : "blunt" });
        }
        return out;
      }),
    [cutLigateResult],
  );

  const gatewayRibbonJunctions: RibbonJunction[][] = useMemo(
    () =>
      (gatewayResult?.products ?? []).map((prod) => {
        const spans = prod.fragmentSpans;
        // Mark each interior span boundary with the att-site scar at that seam.
        const out: RibbonJunction[] = [];
        for (let i = 0; i < spans.length - 1; i += 1) {
          const att = prod.attSites[Math.min(i, prod.attSites.length - 1)];
          out.push({ atBp: spans[i].end, label: att?.name ?? "att" });
        }
        return out;
      }),
    [gatewayResult],
  );

  const canReview =
    method === "overlap"
      ? picked.length >= 2 && !resolving && fragments.every((f) => f.seq)
      : method === "gateway"
        ? picked.length === 2 && !resolving && fragments.every((f) => f.seq)
        : picked.length >= 1 && !resolving && fragments.every((f) => f.seq) && enzymeNames.length > 0;

  // Method-specific reason the Review button is disabled. Overlap and Gateway
  // need two fragments; restriction / golden-gate need only ONE fragment plus a
  // selected enzyme, so the generic "two fragments" copy was wrong for them (L3).
  const reviewDisabledReason =
    method === "overlap"
      ? "Add at least two fragments first"
      : method === "gateway"
        ? "Add the two substrates first"
        : "Add a fragment and pick an enzyme first";

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
      // Clear the name so the next method/product starts from its own
      // placeholder rather than the just-saved construct's name (L1).
      setName("");
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
  // Each product card saves its own product (per-card Save), so the index is
  // passed in rather than read from the selected radio.
  const handleSaveCutLigate = useCallback(async (index: number) => {
    const prod = cutLigateResult?.products[index];
    if (!prod) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Chemistry-aware fallback name (mirrors Gateway), so an unnamed product
      // reads as what it is rather than the generic "Assembled construct" (L5).
      const fallback = method === "golden-gate" ? "Golden Gate assembly" : "Ligated construct";
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
      setName("");
      onSaved(rec.id);
    } catch {
      setSaveError("Could not save the construct.");
    } finally {
      setSaving(false);
    }
  }, [cutLigateResult, method, name, activeProjectIds, onSaved]);

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
        setName("");
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
    <div className="fixed inset-0 z-[60] flex flex-col bg-surface-raised" role="dialog" aria-modal="true" aria-label="Assemble construct">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-foreground">Assemble construct</h1>
          <p className="text-meta text-foreground-muted">
            {method === "overlap"
              ? "Overlap assembly (Gibson / NEBuilder HiFi). Join fragments by shared homologous ends."
              : method === "restriction"
                ? "Restriction + ligation. Cut fragments with one or more enzymes and ligate the compatible ends."
                : method === "golden-gate"
                  ? "Golden Gate (Type IIS). One enzyme excises its sites and ligates the parts by defined overhangs, scarlessly."
                  : "Gateway recombination (BP / LR). att-site reactions transfer a gene between vectors with no enzyme digestion or ligation."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {step === "review" ? (
            <button
              type="button"
              onClick={() => setStep("pick")}
              className="rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground hover:bg-surface-sunken"
            >
              Back to fragments
            </button>
          ) : null}
          <Tooltip label="Close (your selection is discarded)">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
              aria-label="Close"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>
      </header>

      {/* Method tabs (overlap / restriction / golden-gate / gateway). Flat row,
          short pill labels; the chemistry hint lives in the header subtitle. */}
      <div className="flex items-center gap-1 border-b border-border px-5 py-2">
        {(["overlap", "restriction", "golden-gate", "gateway"] as CloneMethod[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMethod(m)}
            aria-current={method === m ? "true" : undefined}
            data-testid={`clone-method-${m}`}
            className={`rounded-md px-3 py-1.5 text-meta font-medium ${
              method === m
                ? "bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300"
                : "text-foreground-muted hover:bg-surface-sunken"
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
            <h2 className="mb-1 text-body font-semibold text-foreground">
              {method === "gateway" ? "Substrates" : "Fragments, in order"}
            </h2>
            <p className="mb-3 text-meta text-foreground-muted">
              {method === "overlap"
                ? "Order is 5'->3' along the product. For a plasmid put the insert first, then the vector backbone."
                : method === "gateway"
                  ? gatewayReaction === "BP"
                    ? "Add two substrates in order. First the attB substrate (your attB-PCR product or attB clone), then the attP donor vector (pDONR)."
                    : "Add two substrates in order. First the attL entry clone (carries your gene), then the attR destination vector (pDEST)."
                  : "Order does not matter; the engine ligates by compatible ends. Mark library plasmids that should be cut open as circular."}
            </p>

            {picked.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-body text-foreground-muted">
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
                  // Phase C readouts. Restriction / Golden Gate show this
                  // fragment's per-enzyme site counts; Gateway shows the
                  // auto-detected att classification for this substrate slot.
                  const siteSummary =
                    method !== "overlap" && method !== "gateway"
                      ? fragmentSiteSummaries[i]
                      : undefined;
                  const gatewayClass =
                    method === "gateway" ? gatewayMatch?.substrates[i] : undefined;
                  return (
                    <li key={`${p.kind}-${i}-${p.name}`} className="rounded-md border border-border bg-surface-raised px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-500/15 text-meta font-semibold text-sky-700 dark:text-sky-300">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium text-foreground">{p.name}</span>
                          <span className="block text-meta text-foreground-muted">
                            {p.kind === "pasted" ? "Pasted" : "Library"} ·{" "}
                            {resolving && p.kind === "library" && !len ? "resolving…" : `${len.toLocaleString()} bp`}
                          </span>
                        </span>
                        <Tooltip label="Move up">
                          <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-foreground-muted hover:bg-surface-sunken hover:text-foreground disabled:opacity-30" aria-label="Move up">
                            <UpIcon className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <Tooltip label="Move down">
                          <button type="button" onClick={() => move(i, 1)} disabled={i === picked.length - 1} className="rounded p-1 text-foreground-muted hover:bg-surface-sunken hover:text-foreground disabled:opacity-30" aria-label="Move down">
                            <DownIcon className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <Tooltip label="Remove">
                          <button type="button" onClick={() => remove(i)} className="rounded p-1 text-foreground-muted hover:bg-rose-50 dark:hover:bg-rose-500/20 hover:text-rose-600" aria-label="Remove">
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </Tooltip>
                      </div>

                      {/* Restriction / Golden Gate: sites per fragment for the
                          selected enzyme(s). Shown only once the bases resolve. */}
                      {siteSummary && len > 0 ? (
                        <SitesPerFragment summary={siteSummary} goldenGate={method === "golden-gate"} />
                      ) : null}

                      {/* Gateway: the auto-detected att classification chip. */}
                      {gatewayClass && len > 0 ? (
                        <GatewaySubstrateChip kind={gatewayClass.kind} label={gatewayClass.label} />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="mt-3">
              <button
                type="button"
                onClick={() => setPasteOpen((o) => !o)}
                className="rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground hover:bg-surface-sunken"
              >
                Paste a sequence…
              </button>
              {pasteOpen ? (
                <div className="mt-2 rounded-md border border-border p-3">
                  <input
                    type="text"
                    value={pasteName}
                    onChange={(e) => setPasteName(e.target.value)}
                    placeholder="Fragment name"
                    className="mb-2 w-full rounded-md border border-border px-2.5 py-1.5 text-body focus:border-sky-400 focus:outline-none"
                  />
                  <textarea
                    value={pasteSeq}
                    onChange={(e) => setPasteSeq(e.target.value)}
                    placeholder="Paste DNA bases (ACGT). Whitespace, numbers, and a FASTA header are stripped."
                    rows={3}
                    className="w-full rounded-md border border-border px-2.5 py-1.5 font-mono text-meta focus:border-sky-400 focus:outline-none"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" onClick={() => setPasteOpen(false)} className="rounded-md px-3 py-1.5 text-meta font-medium text-foreground-muted hover:bg-surface-sunken">Cancel</button>
                    <button type="button" onClick={addPasted} disabled={!sanitizeRawSequence(pasteSeq, "dna")} className="rounded-md bg-brand-action px-3 py-1.5 text-meta font-medium text-white hover:bg-brand-action/90 disabled:opacity-50">Add fragment</button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Options */}
            <div className="mt-6 space-y-4 border-t border-border pt-4">
              {method === "gateway" ? (
                <div>
                  <span className="mb-1.5 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    Reaction
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setGatewayReaction("BP")}
                      className={`rounded-md border px-3 py-1.5 text-meta font-medium ${gatewayReaction === "BP" ? "border-sky-500 bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300" : "border-border text-foreground-muted hover:bg-surface-sunken"}`}
                    >
                      BP (attB x attP)
                    </button>
                    <button
                      type="button"
                      onClick={() => setGatewayReaction("LR")}
                      className={`rounded-md border px-3 py-1.5 text-meta font-medium ${gatewayReaction === "LR" ? "border-sky-500 bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300" : "border-border text-foreground-muted hover:bg-surface-sunken"}`}
                    >
                      LR (attL x attR)
                    </button>
                  </div>
                  <p className="mt-1 text-meta text-foreground-muted">
                    {gatewayReaction === "BP"
                      ? "attB substrate x attP donor builds an attL entry clone (the ccdB cassette leaves as the byproduct)."
                      : "attL entry clone x attR destination builds an attB expression clone (the ccdB cassette leaves as the byproduct)."}
                  </p>
                  {/* Phase C: gentle hint when the two picked substrates do not
                      match the chosen reaction, so the empty product is explained. */}
                  {gatewayMatch && gatewayMatch.hint ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-2 py-1.5 text-meta text-amber-700 dark:text-amber-300">
                      <WarnIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{gatewayMatch.hint}</span>
                    </div>
                  ) : null}
                </div>
              ) : method !== "overlap" ? (
                <div>
                  <span className="mb-1.5 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
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
                              ? "border-sky-500 bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300"
                              : "border-border text-foreground-muted hover:bg-surface-sunken"
                          }`}
                        >
                          {e}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-meta text-foreground-muted">
                    {method === "golden-gate"
                      ? "The enzyme's recognition sites are excised; parts ligate by their defined 4 bp overhangs into a scarless circle."
                      : "Each enzyme cuts its sites; compatible sticky (or blunt) ends ligate. Pick the enzyme(s) flanking your insert and vector."}
                  </p>
                </div>
              ) : (
              <>
              <div>
                <span className="mb-1.5 block text-meta font-medium uppercase tracking-wide text-foreground-muted">Product topology</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCircular(true)} className={`rounded-md border px-3 py-1.5 text-meta font-medium ${circular ? "border-sky-500 bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300" : "border-border text-foreground-muted hover:bg-surface-sunken"}`}>
                    Circular (plasmid)
                  </button>
                  <button type="button" onClick={() => setCircular(false)} className={`rounded-md border px-3 py-1.5 text-meta font-medium ${!circular ? "border-sky-500 bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300" : "border-border text-foreground-muted hover:bg-surface-sunken"}`}>
                    Linear
                  </button>
                </div>
                <p className="mt-1 text-meta text-foreground-muted">
                  {circular ? "The last fragment joins back to the first, closing the loop." : "An open construct; the two ends are not joined."}
                </p>
              </div>

              <div>
                <span className="mb-1.5 block text-meta font-medium uppercase tracking-wide text-foreground-muted">Annotations</span>
                <label className="flex cursor-pointer items-center gap-2 text-body text-foreground">
                  <input
                    type="checkbox"
                    checked={carryAnnotations}
                    onChange={(e) => setCarryAnnotations(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-sky-600 dark:text-sky-300 focus:ring-sky-500"
                  />
                  Carry annotations from source sequences
                </label>
                <p className="mt-1 text-meta text-foreground-muted">
                  {carryAnnotations
                    ? "Features from each fragment are rebased into the assembled product."
                    : "The product will have no annotations."}
                </p>
              </div>

              <div>
                <span className="mb-1.5 block text-meta font-medium uppercase tracking-wide text-foreground-muted">Homology overlap</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-body text-foreground">
                    <input type="radio" checked={overlapKind === "length"} onChange={() => setOverlapKind("length")} />
                    Length
                  </label>
                  {overlapKind === "length" ? (
                    <span className="flex items-center gap-1">
                      <input type="number" min={10} max={60} value={overlapBp} onChange={(e) => setOverlapBp(Math.max(10, Math.min(60, Number(e.target.value) || DEFAULT_OVERLAP_BP)))} className="w-16 rounded-md border border-border px-2 py-1 text-body focus:border-sky-400 focus:outline-none" />
                      <span className="text-meta text-foreground-muted">bp</span>
                    </span>
                  ) : null}
                </div>
                <button type="button" onClick={() => setShowAdvanced((s) => !s)} className="mt-2 text-meta font-medium text-sky-600 dark:text-sky-300 hover:text-sky-800">
                  {showAdvanced ? "Hide advanced" : "Advanced: size by Tm"}
                </button>
                {showAdvanced ? (
                  <div className="mt-2 flex items-center gap-3">
                    <label className="flex items-center gap-2 text-body text-foreground">
                      <input type="radio" checked={overlapKind === "tm"} onChange={() => setOverlapKind("tm")} />
                      Target Tm
                    </label>
                    {overlapKind === "tm" ? (
                      <span className="flex items-center gap-1">
                        <input type="number" min={40} max={70} value={overlapTm} onChange={(e) => setOverlapTm(Math.max(40, Math.min(70, Number(e.target.value) || 48)))} className="w-16 rounded-md border border-border px-2 py-1 text-body focus:border-sky-400 focus:outline-none" />
                        <span className="text-meta text-foreground-muted">°C</span>
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <p className="mt-1 text-meta text-foreground-muted">
                  {overlapKind === "tm"
                    ? `The shared end each junction's primers add, sized so the overlap melts near ${overlapTm} °C.`
                    : overlapBp === DEFAULT_OVERLAP_BP
                      ? `The shared end each junction's primers add. The default ${DEFAULT_OVERLAP_BP} bp suits Gibson / NEBuilder HiFi.`
                      : `The shared end each junction's primers add. Each junction adds a ${overlapBp} bp shared end.`}
                </p>
              </div>
              </>
              )}
            </div>
          </section>

          {/* RIGHT: pick from library */}
          <aside className="flex min-h-0 flex-col border-l border-border">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-body font-semibold text-foreground">Your DNA library</h2>
              <p className="mt-0.5 text-meta text-foreground-muted">Click to add a fragment in order.</p>

              {/* Search by name. */}
              <div className="relative mt-2.5">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted" />
                <input
                  type="text"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  placeholder="Search by name"
                  aria-label="Search the DNA library by name"
                  className="w-full rounded-md border border-border py-1.5 pl-8 pr-2.5 text-meta focus:border-sky-400 focus:outline-none"
                />
              </div>

              {/* Topology segmented control. Defaults per method (Overlap ->
                  Linear, since raw Gibson fragments are linear; cut/recombine
                  methods -> All), then stays user-switchable. */}
              <div className="mt-2 flex rounded-md border border-border p-0.5">
                {(["all", "circular", "linear"] as TopologyFilter[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTopologyFilter(t)}
                    aria-pressed={topologyFilter === t}
                    className={`flex-1 rounded px-2 py-1 text-meta font-medium capitalize ${
                      topologyFilter === t
                        ? "bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300"
                        : "text-foreground-muted hover:bg-surface-sunken"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Overlap-only calm note when the Linear default is hiding
                  circular plasmids, pointing at how to use one (linearize first). */}
              {method === "overlap" && topologyFilter === "linear" ? (
                <p className="mt-2 text-meta text-foreground-muted">
                  Gibson fragments are linear. Linearize a plasmid (PCR or restriction) before using it here.
                </p>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {dnaLibrary.length === 0 ? (
                <div className="px-4 py-6 text-body text-foreground-muted">No DNA sequences in your library yet.</div>
              ) : filteredLibrary.length === 0 ? (
                <div className="px-4 py-6 text-body text-foreground-muted">No matching sequences.</div>
              ) : method === "gateway" ? (
                <GatewayLibraryList
                  groups={gatewayPickerGroups}
                  resolving={gatewayResolving}
                  onAdd={addLibrary}
                />
              ) : (
                <ul>
                  {filteredLibrary.map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => addLibrary(s)} data-testid={`clone-fragment-row-${s.id}`} className="flex w-full items-center justify-between gap-2 border-b border-border px-4 py-2 text-left hover:bg-sky-50 dark:hover:bg-sky-500/20">
                        <span className="min-w-0">
                          <span className="block truncate text-body font-medium text-foreground">{s.display_name}</span>
                          <span className="block text-meta text-foreground-muted">{s.length.toLocaleString()} bp{s.circular ? " · circular" : ""}</span>
                        </span>
                        <span className="text-lg leading-none text-sky-500">+</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-border p-4">
              <Tooltip
                label={canReview ? "Review the product before saving" : reviewDisabledReason}
              >
                <button
                  type="button"
                  onClick={() => setStep("review")}
                  disabled={!canReview}
                  data-testid="clone-review"
                  className="w-full rounded-md bg-brand-action px-3 py-2 text-body font-medium text-white hover:bg-brand-action/90 disabled:cursor-not-allowed disabled:opacity-50"
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
            <ReviewShell
              name={name}
              onNameChange={setName}
              namePlaceholder={gatewayReaction === "BP" ? "Entry clone" : "Expression clone"}
              warnings={gatewayResult.warnings}
              saveError={saveError}
              onBack={() => setStep("pick")}
            >
              {gatewayResult.products.map((prod, i) => (
                <CloningProductPreview
                  key={i}
                  title={
                    prod.role === "clone"
                      ? gatewayReaction === "BP"
                        ? "Entry clone"
                        : "Expression clone"
                      : "Byproduct"
                  }
                  seq={prod.seq}
                  circular={prod.circular}
                  detail={gatewayDetails[i]}
                  fragmentSpans={prod.fragmentSpans}
                  ribbonJunctions={gatewayRibbonJunctions[i]}
                  hero={
                    prod.role === "clone" ? (
                      <GatewayCrossoverHero
                        reaction={gatewayResult.reaction}
                        clone={prod}
                        byproduct={gatewayResult.products.find((p) => p.role === "byproduct") ?? null}
                        substrateNames={[fragments[0]?.name ?? "Substrate 1", fragments[1]?.name ?? "Substrate 2"]}
                      />
                    ) : undefined
                  }
                  onSave={() => saveGatewayProduct(i)}
                  saving={saving}
                >
                  <div className="grid grid-cols-2 gap-2">
                    {prod.attSites.map((att, k) => (
                      <div key={k} className="rounded bg-surface-sunken px-2 py-1.5">
                        <div className="mb-0.5 font-sans text-meta font-medium text-foreground">{att.name}</div>
                        <div className="break-all font-mono text-meta text-foreground-muted">{att.seq}</div>
                      </div>
                    ))}
                  </div>
                </CloningProductPreview>
              ))}
            </ReviewShell>
          ) : (
            <ReviewEmptyState
              resolving={resolving}
              message="No recombination product from these substrates."
              warnings={gatewayResult?.warnings}
            />
          )}
        </div>
      ) : method !== "overlap" ? (
        // --- CUT-LIGATE REVIEW STEP (restriction / golden-gate) ---
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {cutLigateResult && cutLigateResult.products.length > 0 ? (
            <ReviewShell
              name={name}
              onNameChange={setName}
              namePlaceholder={method === "golden-gate" ? "Golden Gate assembly" : "Ligated construct"}
              warnings={cutLigateResult.warnings}
              saveError={saveError}
              onBack={() => setStep("pick")}
            >
              <div>
                <SectionLabel>
                  {cutLigateResult.products.length === 1
                    ? "Assembled product"
                    : `Possible products (${cutLigateResult.products.length})`}
                </SectionLabel>
                {cutLigateResult.products.length > 1 ? (
                  <p className="mb-2 text-meta text-foreground-muted">
                    The overhangs are symmetric, so more than one circular product can form. Save the one you want.
                  </p>
                ) : null}
                <div className="space-y-3">
                  {cutLigateResult.products.map((prod, i) => (
                    <CloningProductPreview
                      key={i}
                      title="Assembled product"
                      seq={prod.seq}
                      circular={prod.circular}
                      detail={cutLigateDetails[i]}
                      fragmentSpans={prod.fragmentSpans}
                      ribbonJunctions={cutLigateRibbonJunctions[i]}
                      showEnzymes
                      hero={
                        method === "golden-gate" ? (
                          <GoldenGateFingerprintHero
                            product={prod}
                            enzymeNames={enzymeNames}
                          />
                        ) : (
                          <StickyEndLadderHero
                            product={prod}
                            pieces={cutLigateResult.pieces}
                            enzymeNames={enzymeNames}
                          />
                        )
                      }
                      select={
                        cutLigateResult.products.length > 1
                          ? {
                              name: "cutligate-product",
                              checked: safeProductIndex === i,
                              onChange: () => setSelectedProduct(i),
                            }
                          : undefined
                      }
                      onSave={() => handleSaveCutLigate(i)}
                      saving={saving}
                    >
                      <div className="rounded bg-surface-sunken px-2 py-1.5 text-meta text-foreground-muted">
                        <SectionLabel>Junctions</SectionLabel>
                        {prod.junctionOverhangs.map((o) => o || "blunt").join(", ")}
                      </div>
                    </CloningProductPreview>
                  ))}
                </div>
              </div>

              <div>
                <SectionLabel>Digested pieces ({cutLigateResult.pieces.length})</SectionLabel>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-left text-meta">
                    <thead className="bg-surface-sunken text-foreground-muted">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">From</th>
                        <th className="px-2 py-1.5 font-medium">Left end</th>
                        <th className="px-2 py-1.5 font-medium">Right end</th>
                        <th className="px-2 py-1.5 font-medium">Length</th>
                      </tr>
                    </thead>
                    <tbody className="text-foreground">
                      {cutLigateResult.pieces.map((pc, i) => (
                        <tr key={i} className="border-t border-border">
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
            </ReviewShell>
          ) : (
            <ReviewEmptyState
              resolving={resolving}
              message="No assembled product from these fragments and enzyme(s)."
              warnings={cutLigateResult?.warnings}
            />
          )}
        </div>
      ) : (
        // --- OVERLAP REVIEW STEP ---
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {result ? (
            <ReviewShell
              name={name}
              onNameChange={setName}
              namePlaceholder="Assembled construct"
              warnings={result.warnings}
              saveError={saveError}
              onBack={() => setStep("pick")}
            >
              <CloningProductPreview
                title="Recombinant construct"
                seq={result.product.seq}
                circular={result.product.circular}
                detail={overlapDetail}
                fragmentSpans={result.fragmentSpans}
                ribbonJunctions={overlapRibbonJunctions}
                hero={
                  <OverlapHomologyHero
                    junctions={result.junctions}
                    primers={result.primers}
                    annealTargetTm={DEFAULT_ANNEAL_TM}
                  />
                }
                onSave={handleSave}
                saving={saving}
              />

              {/* Junction primers. The overlap sequence + Tm live in the
                  HOMOLOGY JUNCTIONS hero above (the "will it anneal" check), so
                  this section is purely the oligos to order: the two designed
                  primers per seam, each a 5' homology tail + 3' annealing region. */}
              <div>
                <SectionLabel>Junction primers ({result.junctions.length})</SectionLabel>
                <div className="space-y-3">
                  {result.junctions.map((jn, i) => {
                    const up = result.primers[jn.fragmentIndex];
                    const down = result.primers[jn.nextFragmentIndex];
                    return (
                      <div key={i} className="rounded-md border border-border p-3">
                        <div className="mb-2 text-body font-medium text-foreground">
                          {up?.fragmentName} <span className="text-foreground-muted">-&gt;</span> {down?.fragmentName}
                        </div>
                        {jn.warning ? (
                          <div className="mb-2 flex items-start gap-1.5 rounded bg-amber-50 dark:bg-amber-500/15 px-2 py-1 text-meta text-amber-700 dark:text-amber-300">
                            <WarnIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {jn.warning}
                          </div>
                        ) : null}
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
                  <SectionLabel>Oligo order list ({result.primers.length * 2})</SectionLabel>
                  <button type="button" onClick={copyOligos} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground hover:bg-surface-sunken">
                    <CopyIcon className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy all"}
                  </button>
                </div>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-left text-meta">
                    <thead className="bg-surface-sunken text-foreground-muted">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Name</th>
                        <th className="px-2 py-1.5 font-medium">Sequence (5&apos;-&gt;3&apos;)</th>
                        <th className="px-2 py-1.5 font-medium">Len</th>
                        <th className="px-2 py-1.5 font-medium">Anneal Tm</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-foreground">
                      {result.primers.flatMap((fp) => [
                        { key: `${fp.fragmentIndex}F`, n: `${fp.fragmentName} F`, p: fp.forward },
                        { key: `${fp.fragmentIndex}R`, n: `${fp.fragmentName} R`, p: fp.reverse },
                      ]).map((row) => (
                        <tr key={row.key} className="border-t border-border">
                          <td className="whitespace-nowrap px-2 py-1.5 font-sans text-foreground">{row.n}</td>
                          <td className="px-2 py-1.5 break-all">{row.p.sequence}</td>
                          <td className="px-2 py-1.5">{row.p.length}</td>
                          <td className="px-2 py-1.5">{Number.isFinite(row.p.annealTm) ? row.p.annealTm.toFixed(1) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-meta text-foreground-muted">
                  Each primer is a 3&apos; annealing region (sized to ~{DEFAULT_ANNEAL_TM} °C) plus a 5&apos; homology tail that adds the overlap. Saved with the construct as primer_bind features.
                </p>
              </div>
            </ReviewShell>
          ) : (
            <ReviewEmptyState
              resolving={resolving}
              message="Add at least two fragments to assemble."
              warnings={overlapWarnings}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Shared chrome for every review step (L10). Renders the construct-name input,
 * the amber "Notes" warnings panel, and the Back-plus-error footer IDENTICALLY
 * across overlap / cut-ligate / gateway, with the method-specific product cards,
 * oligo table, digested-pieces table, or att-site grid passed as children. The
 * save handlers and product rendering stay in the parent; only this surrounding
 * chrome is unified. Behavior-neutral.
 */
function ReviewShell({
  name,
  onNameChange,
  namePlaceholder,
  warnings,
  saveError,
  onBack,
  children,
}: {
  name: string;
  onNameChange: (v: string) => void;
  namePlaceholder: string;
  warnings: string[];
  saveError: string | null;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <label className="block">
        <span className="mb-1 block text-meta font-medium uppercase tracking-wide text-foreground-muted">Construct name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={namePlaceholder}
          className="w-full max-w-md rounded-md border border-border px-3 py-2 text-body focus:border-sky-400 focus:outline-none"
        />
      </label>

      {warnings.length > 0 ? (
        <div className="rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-meta font-semibold text-amber-800 dark:text-amber-300">
            <WarnIcon className="h-4 w-4" /> Notes
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-meta text-amber-700 dark:text-amber-300">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      {children}

      <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
        {saveError ? <span className="text-meta text-rose-600 dark:text-rose-300">{saveError}</span> : null}
        <button type="button" onClick={onBack} className="rounded-md border border-border px-4 py-2 text-body font-medium text-foreground hover:bg-surface-sunken">
          Back
        </button>
      </div>
    </div>
  );
}

/** A lightweight in-card section label, matching the option-group label style
 *  ("Reaction" / "Restriction enzyme(s)") so the review surface reads
 *  consistently (L6). */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
      {children}
    </span>
  );
}

/** Pick-step "sites per fragment" readout (Phase C). One compact line per
 *  selected enzyme showing how many times it cuts this fragment, e.g.
 *  "BsaI x2". An enzyme with 0 sites reads as a muted warning ("BsaI: no
 *  sites") with a subtle amber tint, since it cannot contribute an end (and for
 *  Golden Gate it means the part cannot be excised). Calm and scannable, not a
 *  table. Display only, on the pure fragmentSiteSummary helper. */
function SitesPerFragment({ summary, goldenGate }: { summary: FragmentSiteSummary; goldenGate: boolean }) {
  if (summary.enzymes.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-8">
      {summary.enzymes.map((e) => {
        if (e.count === 0) {
          return (
            <span
              key={e.name}
              className="inline-flex items-center gap-1 rounded bg-amber-50 dark:bg-amber-500/15 px-1.5 py-0.5 font-mono text-meta text-amber-700 dark:text-amber-300"
            >
              <WarnIcon className="h-3 w-3 shrink-0" />
              {e.name}: no sites
            </span>
          );
        }
        return (
          <span
            key={e.name}
            className="inline-flex items-center rounded bg-emerald-50 dark:bg-emerald-500/15 px-1.5 py-0.5 font-mono text-meta text-emerald-700 dark:text-emerald-300"
          >
            {e.name} x{e.count}
          </span>
        );
      })}
      {/* Golden Gate health note: a Type IIS part is normally flanked by exactly
          two sites (one per end), so flag a part with no sites to excise. */}
      {goldenGate && summary.hasNoncutter ? (
        <span className="text-meta text-amber-600 dark:text-amber-300">cannot be excised</span>
      ) : null}
    </div>
  );
}

/** Pick-step Gateway substrate chip (Phase C). A small label on each picked
 *  substrate row naming what the att auto-detection found, e.g. "attL entry
 *  clone detected". An unrecognized substrate gets a muted amber chip so the
 *  user knows why the run may not produce a clone. Display only, on the pure
 *  classifyGatewaySubstrate helper (via the checkGatewayMatch result). */
function GatewaySubstrateChip({ kind, label }: { kind: string; label: string }) {
  const recognized = kind !== "unknown";
  return (
    <div className="mt-1.5 pl-8">
      <span
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-meta font-medium ${
          recognized ? "bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"
        }`}
      >
        {recognized ? <CheckIcon className="h-3 w-3 shrink-0" /> : <WarnIcon className="h-3 w-3 shrink-0" />}
        {label}
      </span>
    </div>
  );
}

/** One picker row for a library sequence. Click adds it as the next fragment.
 *  The optional att chip names the detected Gateway kind on the Gateway tab. */
function LibraryPickerRow({
  rec,
  attLabel,
  onAdd,
}: {
  rec: SequenceRecord;
  attLabel?: string;
  onAdd: (rec: SequenceRecord) => void;
}) {
  return (
    <button type="button" onClick={() => onAdd(rec)} className="flex w-full items-center justify-between gap-2 border-b border-border px-4 py-2 text-left hover:bg-sky-50 dark:hover:bg-sky-500/20">
      <span className="min-w-0">
        <span className="block truncate text-body font-medium text-foreground">{rec.display_name}</span>
        <span className="block text-meta text-foreground-muted">{rec.length.toLocaleString()} bp{rec.circular ? " · circular" : ""}</span>
        {attLabel ? (
          <span className="mt-1 inline-flex items-center gap-1 rounded bg-sky-50 dark:bg-sky-500/15 px-1.5 py-0.5 text-meta font-medium text-sky-700 dark:text-sky-300">
            <CheckIcon className="h-3 w-3 shrink-0" />
            {attLabel}
          </span>
        ) : null}
      </span>
      <span className="text-lg leading-none text-sky-500">+</span>
    </button>
  );
}

/** Gateway-tab picker list. att-flanked substrates (attL / attR / attB / attP)
 *  float to the top under an "att-flanked substrates" sub-header, each tagged
 *  with its detected kind, then the rest under a muted "Other sequences" header
 *  (still selectable). Reuses the Phase C classifier (via gatewayPickerGroups).
 *  Shows a calm "Checking att sites…" line while the bases resolve. */
function GatewayLibraryList({
  groups,
  resolving,
  onAdd,
}: {
  groups: { att: { rec: SequenceRecord; kind: GatewayKind; label: string }[]; other: SequenceRecord[] };
  resolving: boolean;
  onAdd: (rec: SequenceRecord) => void;
}) {
  // Strip the " detected" suffix the classifier adds, so the picker chip reads as
  // the kind label itself (e.g. "attL entry clone"), matching the brief wording.
  const chip = (label: string) => label.replace(/ detected$/, "");
  return (
    <div>
      {resolving ? (
        <div className="border-b border-border px-4 py-2 text-meta text-foreground-muted">Checking att sites…</div>
      ) : null}
      {groups.att.length > 0 ? (
        <>
          <div className="bg-sky-50/60 px-4 py-1.5 text-meta font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
            att-flanked substrates
          </div>
          <ul>
            {groups.att.map(({ rec, label }) => (
              <li key={rec.id}>
                <LibraryPickerRow rec={rec} attLabel={chip(label)} onAdd={onAdd} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {groups.other.length > 0 ? (
        <>
          {groups.att.length > 0 ? (
            <div className="bg-surface-sunken px-4 py-1.5 text-meta font-medium uppercase tracking-wide text-foreground-muted">
              Other sequences
            </div>
          ) : null}
          <ul>
            {groups.other.map((rec) => (
              <li key={rec.id}>
                <LibraryPickerRow rec={rec} onAdd={onAdd} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Empty / resolving state shown when a review step has no product to render
 *  yet. Resolving reads as latency, not an error (L9). */
function ReviewEmptyState({ resolving, message, warnings }: { resolving: boolean; message: string; warnings?: string[] }) {
  if (resolving) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-body text-foreground-muted">
        <span>Resolving fragments…</span>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-body text-foreground-muted">
      <span>{message}</span>
      {warnings && warnings.length ? (
        <ul className="list-inside list-disc text-meta text-amber-600 dark:text-amber-300">
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      ) : null}
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
    <div className="rounded bg-surface-sunken px-2 py-1.5">
      <div className="mb-0.5 flex items-center justify-between">
        <span className="font-sans font-medium text-foreground">{label}</span>
        <span className="font-sans text-foreground-muted">{primer.length} nt · anneal {Number.isFinite(primer.annealTm) ? primer.annealTm.toFixed(0) : "—"} °C</span>
      </div>
      <div className="font-mono break-all">
        {primer.tail ? <span className="text-sky-600 dark:text-sky-300">{primer.tail}</span> : null}
        <span className="text-foreground">{primer.anneal}</span>
      </div>
    </div>
  );
}
