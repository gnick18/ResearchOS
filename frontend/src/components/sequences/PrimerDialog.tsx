"use client";

// sequence Phase 2e bot — the PRIMER dialog. SnapGene "Add Primer" parity:
// type or paste a primer (or seed it from the current selection's bases), and
// see LIVE: length (Nmer), GC%, predicted Tm, the binding SITE on the template
// (position + how many bases anneal), a reverse-complement toggle, and a VISUAL
// ALIGNMENT of the primer against the matching template region (5'..3' primer
// over the annealed template bases, with the non-annealing 5' tail dimmed).
//
// Calm, compact layout mirroring FeatureEditorDialog. No emojis (inline SVG
// only), no em-dashes. The biology is recycled from lib/sequences/primer.ts;
// this file is pure UI + the Add-to-template handoff.

import { useEffect, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import {
  sanitizePrimer,
  reverseComplement,
  gcContent,
  predictTm,
  tmBasic,
  findBindingSites,
  type BindingSite,
} from "@/lib/sequences/primer";
import {
  designMutagenicPrimer,
  type MutationType,
  type MutationSpec,
  type MutagenicPrimer,
} from "@/lib/sequences/mutagenesis";
import { colorForType } from "@/lib/sequences/feature-colors";
import ColorSwatchPicker from "./ColorSwatchPicker";
import LivingPopup from "@/components/ui/LivingPopup";

/** What the dialog hands back when the user adds the primer to the template. */
export interface PrimerAddPayload {
  name: string;
  /** The primer sequence as entered (5'->3'), sanitized to ACGTU. */
  primerSeq: string;
  /** The binding site chosen (forward-strand coords + strand). */
  site: BindingSite;
  /** primer colors bot — the user-chosen primer color (hex), or undefined to use
   *  the default primer color. Persists on the primer_bind feature. */
  color?: string;
}

export interface PrimerDialogRequest {
  /** Full template (forward strand) the primer is designed against. */
  template: string;
  /** Optional bases to seed the primer field from (the current selection). */
  seedSeq?: string;
  /** Optional 0-based [lo, hi) selection range. Seeds the Mutagenesis target
   *  position/region. Optional + additive: when absent the dialog best-effort
   *  locates seedSeq in the template, else defaults to the template midpoint. */
  seedRange?: { lo: number; hi: number };
  /** Optional default name. */
  seedName?: string;
  /** menu reorg bot — which flow the dialog OPENS in. "standard" (default) opens
   *  the type/paste primer flow; "mutagenesis" opens straight into the SDM
   *  designer so the Primer menu's "Design mutagenesis primer..." lands there
   *  without the user hunting for the inner mode tab. */
  initialMode?: "standard" | "mutagenesis";
  onSubmit: (payload: PrimerAddPayload) => void;
  onCancel: () => void;
}

// --- inline icons ----------------------------------------------------------
function IconPrimer({ className }: { className?: string }) {
  // primer colors bot — SnapGene-style oligo glyph (bar + forward arrow above,
  // reverse arrow below). Shared shape with the toolbar IconPrimer.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M5 8h11" />
      <polyline points="14 5.5 17 8 14 10.5" />
      <path d="M19 16H10" />
      <polyline points="12 13.5 9 16 12 18.5" />
    </svg>
  );
}
function IconSwap({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function IconMutate({ className }: { className?: string }) {
  // A small "edit/pencil on a strand" glyph for the mutagenesis mode.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" />
      <path d="M14.06 6.19l3.75 3.75" />
    </svg>
  );
}

/** A default name for a mutagenic primer when the user leaves the name blank. */
function mutLabel(mp: MutagenicPrimer): string {
  if (mp.mutationType === "insertion") return "ins_mut_primer";
  if (mp.mutationType === "deletion") return "del_mut_primer";
  return "sub_mut_primer";
}

/** A small stat chip (label over value). */
function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-md bg-surface-sunken px-2.5 py-1.5">
      <div className="text-meta font-medium uppercase tracking-wide text-foreground-muted">{label}</div>
      <div className="text-body font-semibold text-foreground">{value}</div>
      {hint ? <div className="text-meta text-foreground-muted">{hint}</div> : null}
    </div>
  );
}

/** Which Add-Primer flow is active. "manual" = type/paste a primer (the original
 *  flow); "mutagenesis" = design a mutagenic SDM primer from a target + change. */
type DialogMode = "manual" | "mutagenesis";

export default function PrimerDialog({ request }: { request: PrimerDialogRequest | null }) {
  const [mode, setMode] = useState<DialogMode>("manual");
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  // primer colors bot — the user-chosen primer color (hex), or "" for the default
  // primer color. Persisted on the primer_bind feature on Add.
  const [color, setColor] = useState("");
  // --- Mutagenesis-mode inputs ----------------------------------------------
  const [mutType, setMutType] = useState<MutationType>("substitution");
  // 0-based target position (start of the edit). For deletion this is the first
  // removed base; for insertion it is the insert point (insert BEFORE it).
  const [mutPos, setMutPos] = useState(0);
  // New bases for substitution / insertion (ACGT). Ignored for deletion.
  const [mutNewBases, setMutNewBases] = useState("");
  // How many template bases the edit replaces (substitution) or removes (deletion).
  const [mutSpan, setMutSpan] = useState(1);
  // When on, the primer field is shown/interpreted as the reverse-complement of
  // what was typed (the primer anneals to the bottom strand). This flips the
  // ACTUAL primer sequence so length/GC/Tm/binding all recompute.
  const [revComp, setRevComp] = useState(false);
  // The user-chosen binding site (index into the found sites). Defaults to the
  // first (full matches sort first).
  const [siteIdx, setSiteIdx] = useState(0);
  const seqRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!request) return;
    // menu reorg bot — honor the caller's opening flow ("standard" -> the manual
    // type/paste primer; "mutagenesis" -> the SDM designer). Default standard.
    setMode(request.initialMode === "mutagenesis" ? "mutagenesis" : "manual");
    setName(request.seedName ?? "");
    setRaw(sanitizePrimer(request.seedSeq ?? ""));
    setColor("");
    setRevComp(false);
    setSiteIdx(0);
    // Seed the mutagenesis target from the selection. Prefer an explicit range;
    // else try to locate the seed bases in the template; else the midpoint.
    const tpl = request.template ?? "";
    const seed = sanitizePrimer(request.seedSeq ?? "");
    let lo = request.seedRange?.lo;
    let hi = request.seedRange?.hi;
    if (lo == null && seed.length > 0) {
      const at = tpl.toUpperCase().indexOf(seed);
      if (at >= 0) {
        lo = at;
        hi = at + seed.length;
      }
    }
    if (lo == null) lo = Math.floor(tpl.length / 2);
    if (hi == null) hi = lo;
    setMutPos(Math.max(0, Math.min(lo, Math.max(0, tpl.length - 1))));
    setMutSpan(Math.max(1, hi - lo || 1));
    setMutType("substitution");
    setMutNewBases("");
    const t = setTimeout(() => seqRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [request]);

  // The EFFECTIVE primer sequence (after the revcomp toggle). This is what gets
  // saved and what every readout is computed from.
  const primerSeq = useMemo(() => {
    const clean = sanitizePrimer(raw);
    return revComp ? reverseComplement(clean) : clean;
  }, [raw, revComp]);

  const length = primerSeq.length;
  const gc = useMemo(() => gcContent(primerSeq), [primerSeq]);
  const tmNN = useMemo(() => predictTm(primerSeq), [primerSeq]);
  const tmW = useMemo(() => tmBasic(primerSeq), [primerSeq]);

  const sites = useMemo(() => {
    if (!request || length === 0) return [] as BindingSite[];
    return findBindingSites(primerSeq, request.template, { allowPartial: true });
  }, [request, primerSeq, length]);

  // Keep the chosen site index in range as the primer changes.
  useEffect(() => {
    if (siteIdx >= sites.length) setSiteIdx(0);
  }, [sites.length, siteIdx]);

  const site = sites[siteIdx] ?? null;
  const template = request?.template ?? "";

  // --- ALIGNMENT view --------------------------------------------------------
  // Show the primer (5'->3') over the matching template region. For a forward
  // primer this is the top strand directly; for a reverse primer the primer
  // anneals to the bottom strand, so we align it against revcomp(templateRegion)
  // (which reads 5'->3' in the primer's own direction). The non-annealing 5'
  // tail (if any, from a 3'-anchored partial) is dimmed.
  // (Declared BEFORE the early return so the hook order is stable per React.)
  const alignment = useMemo(() => {
    if (!site || length === 0) return null;
    // Aligner hits (internal mismatch / small indel) carry their own gapped
    // alignment strings, already oriented so identical columns are matches. Use
    // them directly so the mismatch bases line up and can be highlighted.
    if (site.alignedPrimer && site.alignedTemplate) {
      const cols = site.alignedPrimer.split("").map((pb, i) => ({
        primer: pb,
        template: site.alignedTemplate![i] ?? "-",
        match: pb !== "-" && site.alignedTemplate![i] === pb,
      }));
      const matched = cols.filter((c) => c.match).length;
      return {
        tail: 0,
        primerTail: "",
        cols,
        matched,
        total: cols.length,
        identity: site.identity ?? matched / Math.max(1, cols.length),
      };
    }
    // Clean fast-path hit: exact / 3'-anchored partial, no mismatches. Build the
    // per-column data from the annealed region so the same renderer serves both.
    const annealed = site.annealedLength;
    const tail = length - annealed; // non-annealing 5' bases
    const tplForward = template.slice(site.start, site.end);
    const tplUnderAnneal = site.direction === 1 ? tplForward : reverseComplement(tplForward);
    const primerAnneal = primerSeq.slice(tail);
    const cols = primerAnneal.split("").map((pb, i) => ({
      primer: pb,
      template: tplUnderAnneal[i] ?? "-",
      match: pb === tplUnderAnneal[i],
    }));
    const matched = cols.filter((c) => c.match).length;
    return {
      tail,
      primerTail: primerSeq.slice(0, tail),
      cols,
      matched,
      total: cols.length,
      identity: cols.length ? matched / cols.length : 0,
    };
  }, [site, length, template, primerSeq]);

  // --- MUTAGENESIS design ----------------------------------------------------
  // Build the change spec from the inputs and design a single mutagenic primer.
  // Errors (out-of-range / empty edit) are caught and surfaced as a message
  // rather than thrown. (Declared BEFORE the early return for stable hook order.)
  const mutResult = useMemo((): { primer: MutagenicPrimer | null; error: string | null } => {
    if (mode !== "mutagenesis" || !request) return { primer: null, error: null };
    const tpl = request.template;
    const newBases = sanitizePrimer(mutNewBases);
    let spec: MutationSpec;
    if (mutType === "substitution") {
      if (newBases.length === 0) return { primer: null, error: "Enter the new base(s) to substitute." };
      spec = { type: "substitution", position: mutPos, newBases, replaceLength: Math.max(1, mutSpan) };
    } else if (mutType === "insertion") {
      if (newBases.length === 0) return { primer: null, error: "Enter the base(s) to insert." };
      spec = { type: "insertion", position: mutPos, newBases };
    } else {
      spec = { type: "deletion", position: mutPos, length: Math.max(1, mutSpan) };
    }
    try {
      return { primer: designMutagenicPrimer(tpl, spec), error: null };
    } catch (e) {
      return { primer: null, error: e instanceof Error ? e.message : "Could not design a primer." };
    }
  }, [mode, request, mutType, mutPos, mutNewBases, mutSpan]);

  if (!request) return null;

  const canAdd =
    mode === "mutagenesis" ? !!mutResult.primer : !!site && length > 0;

  const submit = () => {
    if (!canAdd) return;
    if (mode === "mutagenesis") {
      const mp = mutResult.primer;
      if (!mp) return;
      // Persist the mutagenic primer as a normal forward primer_bind. The binding
      // site is the template footprint the primer covers (the two homology arms,
      // plus the removed range for a deletion); the mutagenic primer is, by
      // convention, written 5'->3' along the forward (top) strand.
      const mutSite: BindingSite = {
        start: mp.templateStart,
        end: mp.templateEnd,
        direction: 1,
        annealedLength: mp.leftArm + mp.rightArm,
        fullMatch: false,
      };
      request.onSubmit({
        name: name.trim() || mutLabel(mp),
        primerSeq: mp.primer,
        site: mutSite,
        color: color.trim() || undefined,
      });
      return;
    }
    if (!site) return;
    request.onSubmit({
      name: name.trim() || "primer",
      primerSeq,
      site,
      color: color.trim() || undefined,
    });
  };

  return (
    <LivingPopup open onClose={request.onCancel} label="Add primer" selfSize>
      <div
        className="pointer-events-auto relative flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-2xl"
        data-testid="primer-dialog"
        data-tour-popup-occluding="primer"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sky-50 dark:bg-sky-500/15 text-sky-600 dark:text-sky-300">
            <IconPrimer className="h-4 w-4" />
          </span>
          <h2 className="text-title font-semibold text-foreground">Add primer</h2>
          <span className="ml-auto text-meta text-foreground-muted">
            Template {template.length.toLocaleString()} bp
          </span>
        </div>

        <div
          className="space-y-3 overflow-y-auto px-5 py-4"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName !== "TEXTAREA") {
              e.preventDefault();
              submit();
            }
          }}
        >
          {/* Mode toggle: manual primer vs. mutagenesis designer. */}
          <div className="flex items-center gap-1 rounded-lg bg-surface-sunken p-0.5 ros-seg-track border border-border" role="tablist" aria-label="Primer mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "manual"}
              onClick={() => setMode("manual")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-meta font-medium transition-colors ${
                mode === "manual" ? "bg-surface-raised text-foreground ros-seg-active" : "text-foreground-muted hover:text-foreground"
              }`}
            >
              <IconPrimer className="h-3.5 w-3.5" />
              Type or paste
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "mutagenesis"}
              onClick={() => setMode("mutagenesis")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-meta font-medium transition-colors ${
                mode === "mutagenesis" ? "bg-surface-raised text-foreground ros-seg-active" : "text-foreground-muted hover:text-foreground"
              }`}
            >
              <IconMutate className="h-3.5 w-3.5" />
              Mutagenesis
            </button>
          </div>

          {/* Name */}
          <label className="block">
            <span className="mb-1 block text-meta font-medium text-foreground-muted">Primer name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "mutagenesis" ? "e.g. L52A_fwd" : "e.g. M13_fwd"}
              className="w-full rounded-md border border-border px-2.5 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
            />
          </label>

          {/* primer colors bot — set a color for this primer so its arrow + label
              render in it on the map (a forward + reverse pair colored alike are
              easy to match). Defaults to the standard primer color when unset. */}
          <ColorSwatchPicker
            value={color}
            effectiveColor={color.trim() || colorForType("primer_bind")}
            onChange={setColor}
            onReset={() => setColor("")}
            resetLabel="Use default primer color"
          />

          {mode === "mutagenesis" ? (
            <MutagenesisFields
              templateLength={template.length}
              mutType={mutType}
              setMutType={setMutType}
              mutPos={mutPos}
              setMutPos={setMutPos}
              mutSpan={mutSpan}
              setMutSpan={setMutSpan}
              mutNewBases={mutNewBases}
              setMutNewBases={setMutNewBases}
              result={mutResult}
            />
          ) : (
          <>
          {/* Sequence + revcomp toggle */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-meta font-medium text-foreground-muted">Primer sequence (5&apos; to 3&apos;)</span>
              <Tooltip label="Reverse-complement the primer (anneal to the other strand)">
                <button
                  type="button"
                  onClick={() => setRevComp((r) => !r)}
                  aria-pressed={revComp}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-meta font-medium transition-colors ${
                    revComp ? "bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300" : "text-foreground-muted hover:bg-surface-sunken"
                  }`}
                >
                  <IconSwap className="h-3.5 w-3.5" />
                  Reverse complement
                </button>
              </Tooltip>
            </div>
            <textarea
              ref={seqRef}
              value={raw}
              onChange={(e) => setRaw(sanitizePrimer(e.target.value))}
              rows={2}
              placeholder="Type or paste bases, or seed from the current selection"
              spellCheck={false}
              className="w-full resize-y rounded-md border border-border px-2.5 py-2 font-mono text-body tracking-wide text-foreground focus:border-sky-400 focus:outline-none"
            />
            {revComp ? (
              <p className="mt-1 text-meta text-sky-600 dark:text-sky-300">
                Showing readouts for the reverse complement of what you typed.
              </p>
            ) : null}
          </div>

          {/* Live stats */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Length" value={length ? `${length}-mer` : "—"} />
            <Stat label="GC" value={length ? `${gc.toFixed(1)}%` : "—"} />
            <Stat
              label="Tm"
              value={length ? `${tmNN.toFixed(1)} °C` : "—"}
              hint={length ? `basic ${tmW.toFixed(1)} °C` : undefined}
            />
          </div>

          {/* Binding site */}
          <div>
            <span className="mb-1 block text-meta font-medium text-foreground-muted">Binding site</span>
            {length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-meta text-foreground-muted">
                Enter a primer to find where it anneals.
              </p>
            ) : sites.length === 0 ? (
              <p className="rounded-md border border-dashed border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-2.5 py-2 text-meta text-amber-700 dark:text-amber-300">
                No binding site found on either strand. The primer can still be
                added at its best guess only if it anneals somewhere.
              </p>
            ) : (
              <div className="space-y-1.5">
                {sites.length > 1 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {sites.map((s, i) => (
                      <button
                        key={`${s.start}-${s.end}-${s.direction}`}
                        type="button"
                        onClick={() => setSiteIdx(i)}
                        className={`rounded-md px-2 py-0.5 text-meta font-medium transition-colors ${
                          i === siteIdx
                            ? "bg-brand-action text-white"
                            : "bg-surface-sunken text-foreground-muted hover:bg-surface-sunken"
                        }`}
                      >
                        {s.direction === 1 ? "→" : "←"} {(s.start + 1).toLocaleString()}..
                        {s.end.toLocaleString()}
                        {s.fullMatch
                          ? ""
                          : s.mismatches && s.mismatches.length
                            ? ` (${s.mismatches.length} mm)`
                            : " (3')"}
                      </button>
                    ))}
                  </div>
                ) : null}
                {site ? (
                  <div className="rounded-md bg-surface-sunken px-2.5 py-2 text-meta text-foreground">
                    <span className="font-medium text-foreground">
                      {site.direction === 1 ? "Forward" : "Reverse"} strand
                    </span>
                    {", "}
                    position {(site.start + 1).toLocaleString()}..{site.end.toLocaleString()}
                    {", "}
                    <span className="font-medium">{site.annealedLength}</span> of {length} bp anneal
                    {site.mismatches && site.mismatches.length
                      ? `, ${site.mismatches.length} mismatch${site.mismatches.length === 1 ? "" : "es"}`
                      : site.fullMatch
                        ? ""
                        : " (3'-anchored, 5' tail does not anneal)"}
                    .
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Visual alignment */}
          {alignment ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-meta font-medium text-foreground-muted">
                  Alignment (primer over template)
                </span>
                <span className="text-meta font-medium text-foreground-muted">
                  {alignment.matched}/{alignment.total} matched (
                  {Math.round(alignment.identity * 100)}%)
                </span>
              </div>
              <div className="overflow-x-auto rounded-md border border-border bg-surface-raised px-3 py-2.5 font-mono text-meta leading-relaxed">
                {/* Primer row: dimmed 5' tail, annealed bases per-column (matches
                    blue, mismatches rose). */}
                <div className="whitespace-pre">
                  <span className="text-foreground-muted">5&apos; </span>
                  {alignment.tail ? (
                    <span className="text-foreground-muted">{alignment.primerTail}</span>
                  ) : null}
                  {alignment.cols.map((c, i) => (
                    <span
                      key={i}
                      className={
                        c.match ? "font-semibold text-sky-700 dark:text-sky-300" : "font-semibold text-rose-600 dark:text-rose-300"
                      }
                    >
                      {c.primer}
                    </span>
                  ))}
                  <span className="text-foreground-muted"> 3&apos;</span>
                </div>
                {/* Match bars: | for a match, blank for a mismatch/indel. */}
                <div className="whitespace-pre text-foreground-muted">
                  {"   "}
                  {" ".repeat(alignment.tail)}
                  {alignment.cols.map((c) => (c.match ? "|" : " ")).join("")}
                </div>
                {/* Template row, lined up column-for-column under the primer. */}
                <div className="whitespace-pre">
                  <span className="text-foreground-muted">3&apos; </span>
                  {" ".repeat(alignment.tail)}
                  {alignment.cols.map((c, i) => (
                    <span key={i} className={c.match ? "text-foreground-muted" : "text-rose-500"}>
                      {c.template}
                    </span>
                  ))}
                  <span className="text-foreground-muted"> 5&apos;</span>
                </div>
              </div>
              <p className="mt-1 text-meta text-foreground-muted">
                Matched bases are blue; mismatches are shown in rose. A dimmed 5&apos; region
                is a non-annealing tail (e.g. a cloning overhang).
              </p>
            </div>
          ) : null}
          </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-sunken px-4 py-3">
          <button
            type="button"
            onClick={request.onCancel}
            className="rounded-lg px-4 py-2 text-body text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <Tooltip
            label={
              canAdd
                ? "Add this primer as a primer_bind feature"
                : mode === "mutagenesis"
                  ? "Set a target and a change to design a mutagenic primer"
                  : "Enter a primer that anneals to the template"
            }
          >
            <button
              type="button"
              onClick={submit}
              disabled={!canAdd}
              className="rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white transition-colors hover:bg-brand-action/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add primer to template
            </button>
          </Tooltip>
        </div>
      </div>
    </LivingPopup>
  );
}

// --- Mutagenesis sub-form ---------------------------------------------------

const MUT_TYPES: { value: MutationType; label: string; hint: string }[] = [
  { value: "substitution", label: "Substitute", hint: "Swap base(s) at a position" },
  { value: "insertion", label: "Insert", hint: "Add base(s) at a position" },
  { value: "deletion", label: "Delete", hint: "Remove a range of bases" },
];

function MutagenesisFields({
  templateLength,
  mutType,
  setMutType,
  mutPos,
  setMutPos,
  mutSpan,
  setMutSpan,
  mutNewBases,
  setMutNewBases,
  result,
}: {
  templateLength: number;
  mutType: MutationType;
  setMutType: (t: MutationType) => void;
  mutPos: number;
  setMutPos: (n: number) => void;
  mutSpan: number;
  setMutSpan: (n: number) => void;
  mutNewBases: string;
  setMutNewBases: (s: string) => void;
  result: { primer: MutagenicPrimer | null; error: string | null };
}) {
  const mp = result.primer;
  const maxPos = Math.max(0, templateLength - 1);
  const posClamped = Math.max(0, Math.min(mutPos, templateLength));

  return (
    <div className="space-y-3">
      {/* Change type */}
      <div>
        <span className="mb-1 block text-meta font-medium text-foreground-muted">Change type</span>
        <div className="grid grid-cols-3 gap-1.5">
          {MUT_TYPES.map((mt) => (
            <Tooltip key={mt.value} label={mt.hint}>
              <button
                type="button"
                onClick={() => setMutType(mt.value)}
                aria-pressed={mutType === mt.value}
                className={`w-full rounded-md px-2 py-1.5 text-meta font-medium transition-colors ${
                  mutType === mt.value
                    ? "bg-brand-action text-white"
                    : "bg-surface-sunken text-foreground-muted hover:bg-surface-sunken"
                }`}
              >
                {mt.label}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* Position + span/new-bases inputs */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-meta font-medium text-foreground-muted">
            {mutType === "insertion" ? "Insert before position (1-based)" : "Position (1-based)"}
          </span>
          <input
            type="number"
            min={1}
            max={mutType === "insertion" ? templateLength + 1 : templateLength}
            value={posClamped + 1}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setMutPos(Math.max(0, Math.min(Math.round(v) - 1, templateLength)));
            }}
            className="w-full rounded-md border border-border px-2.5 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
          />
        </label>

        {mutType === "deletion" ? (
          <label className="block">
            <span className="mb-1 block text-meta font-medium text-foreground-muted">Bases to remove</span>
            <input
              type="number"
              min={1}
              max={Math.max(1, templateLength - posClamped)}
              value={mutSpan}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setMutSpan(Math.max(1, Math.round(v)));
              }}
              className="w-full rounded-md border border-border px-2.5 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
            />
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-meta font-medium text-foreground-muted">
              {mutType === "substitution" ? "New base(s)" : "Bases to insert"}
            </span>
            <input
              value={mutNewBases}
              onChange={(e) => setMutNewBases(sanitizePrimer(e.target.value))}
              placeholder={mutType === "substitution" ? "e.g. G" : "e.g. GAATTC"}
              spellCheck={false}
              className="w-full rounded-md border border-border px-2.5 py-1.5 font-mono text-body tracking-wide text-foreground focus:border-sky-400 focus:outline-none"
            />
          </label>
        )}
      </div>

      {/* For a substitution, let the user replace more than one template base. */}
      {mutType === "substitution" ? (
        <label className="block">
          <span className="mb-1 block text-meta font-medium text-foreground-muted">
            Template bases to replace
          </span>
          <input
            type="number"
            min={1}
            max={Math.max(1, templateLength - posClamped)}
            value={mutSpan}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setMutSpan(Math.max(1, Math.round(v)));
            }}
            className="w-32 rounded-md border border-border px-2.5 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
          />
          <span className="ml-2 text-meta text-foreground-muted">
            usually 1 (a point mutation); set higher to swap a block
          </span>
        </label>
      ) : null}

      <p className="text-meta text-foreground-muted">
        Template is {templateLength.toLocaleString()} bp (positions 1..{maxPos + 1}). The change is
        centered between matching homology arms grown to about 60 °C (QuikChange-style 10-15 base
        flanks).
      </p>

      {/* Designed primer + readouts */}
      {result.error ? (
        <p className="rounded-md border border-dashed border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-2.5 py-2 text-meta text-amber-700 dark:text-amber-300">
          {result.error}
        </p>
      ) : mp ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Length" value={`${mp.length}-mer`} />
            <Stat label="GC" value={`${mp.gc.toFixed(1)}%`} />
            <Stat label="Tm" value={`${mp.tm.toFixed(1)} °C`} hint={`arms ${mp.leftArm}+${mp.rightArm}`} />
          </div>

          {/* The designed primer with the mutation region highlighted. */}
          <div>
            <span className="mb-1 block text-meta font-medium text-foreground-muted">
              Designed mutagenic primer (5&apos; to 3&apos;)
            </span>
            <div className="overflow-x-auto rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-body tracking-wide">
              <span className="text-foreground-muted">5&apos; </span>
              {mp.primer.split("").map((b, i) => {
                const edited = i >= mp.mutationPrimerStart && i < mp.mutationPrimerEnd;
                return (
                  <span key={i} className={edited ? "font-semibold text-rose-600 dark:text-rose-300" : "text-foreground"}>
                    {b}
                  </span>
                );
              })}
              <span className="text-foreground-muted"> 3&apos;</span>
            </div>
          </div>

          {/* Primer aligned to the ORIGINAL template, mismatch-highlighted. Reuses
              the same blue-match / rose-mismatch convention as the manual view. */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-meta font-medium text-foreground-muted">
                Aligned to template (intended change in rose)
              </span>
              <span className="text-meta font-medium text-foreground-muted">
                {mp.leftArm + mp.rightArm} arm bases match
              </span>
            </div>
            <div className="overflow-x-auto rounded-md border border-border bg-surface-raised px-3 py-2.5 font-mono text-meta leading-relaxed">
              {/* Primer row. */}
              <div className="whitespace-pre">
                <span className="text-foreground-muted">5&apos; </span>
                {mp.columns.map((c, i) => (
                  <span
                    key={i}
                    className={
                      c.edited
                        ? "font-semibold text-rose-600 dark:text-rose-300"
                        : c.match
                          ? "font-semibold text-sky-700 dark:text-sky-300"
                          : "font-semibold text-rose-600 dark:text-rose-300"
                    }
                  >
                    {c.primer}
                  </span>
                ))}
                <span className="text-foreground-muted"> 3&apos;</span>
              </div>
              {/* Match bars. */}
              <div className="whitespace-pre text-foreground-muted">
                {"   "}
                {mp.columns.map((c) => (c.match ? "|" : c.edited ? "*" : " ")).join("")}
              </div>
              {/* Original-template row, lined up column-for-column. */}
              <div className="whitespace-pre">
                <span className="text-foreground-muted">3&apos; </span>
                {mp.columns.map((c, i) => (
                  <span
                    key={i}
                    className={c.match ? "text-foreground-muted" : "text-rose-500"}
                  >
                    {c.template}
                  </span>
                ))}
                <span className="text-foreground-muted"> 5&apos;</span>
              </div>
            </div>
            <p className="mt-1 text-meta text-foreground-muted">
              {mp.mutationType === "deletion"
                ? "The arms join directly across the removed bases (marked * with no template partner shown)."
                : mp.mutationType === "insertion"
                  ? "Inserted bases (rose, marked *) have no template partner."
                  : "The substituted base(s) (rose, marked *) sit over the original template base(s)."}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
