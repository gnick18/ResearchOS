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

/** What the dialog hands back when the user adds the primer to the template. */
export interface PrimerAddPayload {
  name: string;
  /** The primer sequence as entered (5'->3'), sanitized to ACGTU. */
  primerSeq: string;
  /** The binding site chosen (forward-strand coords + strand). */
  site: BindingSite;
}

export interface PrimerDialogRequest {
  /** Full template (forward strand) the primer is designed against. */
  template: string;
  /** Optional bases to seed the primer field from (the current selection). */
  seedSeq?: string;
  /** Optional default name. */
  seedName?: string;
  onSubmit: (payload: PrimerAddPayload) => void;
  onCancel: () => void;
}

// --- inline icons ----------------------------------------------------------
function IconPrimer({ className }: { className?: string }) {
  // A small 5'->3' arrow-over-strand glyph.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="3" y1="16" x2="21" y2="16" />
      <path d="M4 9h12" />
      <path d="M13 6l3 3-3 3" />
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

/** A small stat chip (label over value). */
function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-md bg-gray-50 px-2.5 py-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm font-semibold text-gray-800">{value}</div>
      {hint ? <div className="text-xs text-gray-400">{hint}</div> : null}
    </div>
  );
}

export default function PrimerDialog({ request }: { request: PrimerDialogRequest | null }) {
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
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
    setName(request.seedName ?? "");
    setRaw(sanitizePrimer(request.seedSeq ?? ""));
    setRevComp(false);
    setSiteIdx(0);
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
    const annealed = site.annealedLength;
    const tail = length - annealed; // non-annealing 5' bases
    // Template region the primer's annealed part sits over (forward coords).
    const tplForward = template.slice(site.start, site.end);
    // In the primer's reading frame (5'->3'), the template strand it pairs with:
    //  - forward primer pairs with the BOTTOM strand = complement of tplForward,
    //    read 3'->5' under the primer. We display the template bases the primer
    //    matches (i.e. tplForward for a forward primer; revcomp(tplForward) for
    //    a reverse primer) so identical bases line up as a match.
    const tplUnderAnneal = site.direction === 1 ? tplForward : reverseComplement(tplForward);
    return {
      tail,
      annealed,
      primerTail: primerSeq.slice(0, tail),
      primerAnneal: primerSeq.slice(tail),
      templateAnneal: tplUnderAnneal,
    };
  }, [site, length, template, primerSeq]);

  if (!request) return null;

  const canAdd = !!site && length > 0;

  const submit = () => {
    if (!canAdd || !site) return;
    request.onSubmit({
      name: name.trim() || "primer",
      primerSeq,
      site,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="primer-dialog"
      data-tour-popup-occluding="primer"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={request.onCancel} />
      <div className="relative flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-600">
            <IconPrimer className="h-4 w-4" />
          </span>
          <h2 className="text-base font-semibold text-gray-900">Add primer</h2>
          <span className="ml-auto text-xs text-gray-400">
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
          {/* Name */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Primer name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. M13_fwd"
              className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-800 focus:border-sky-400 focus:outline-none"
            />
          </label>

          {/* Sequence + revcomp toggle */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Primer sequence (5&apos; to 3&apos;)</span>
              <Tooltip label="Reverse-complement the primer (anneal to the other strand)">
                <button
                  type="button"
                  onClick={() => setRevComp((r) => !r)}
                  aria-pressed={revComp}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                    revComp ? "bg-sky-50 text-sky-700" : "text-gray-500 hover:bg-gray-100"
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
              className="w-full resize-y rounded-md border border-gray-200 px-2.5 py-2 font-mono text-sm tracking-wide text-gray-800 focus:border-sky-400 focus:outline-none"
            />
            {revComp ? (
              <p className="mt-1 text-xs text-sky-600">
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
            <span className="mb-1 block text-xs font-medium text-gray-500">Binding site</span>
            {length === 0 ? (
              <p className="rounded-md border border-dashed border-gray-200 px-2.5 py-2 text-xs text-gray-400">
                Enter a primer to find where it anneals.
              </p>
            ) : sites.length === 0 ? (
              <p className="rounded-md border border-dashed border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
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
                        className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                          i === siteIdx
                            ? "bg-sky-600 text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        {s.direction === 1 ? "→" : "←"} {(s.start + 1).toLocaleString()}..
                        {s.end.toLocaleString()}
                        {s.fullMatch ? "" : " (3')"}
                      </button>
                    ))}
                  </div>
                ) : null}
                {site ? (
                  <div className="rounded-md bg-gray-50 px-2.5 py-2 text-xs text-gray-700">
                    <span className="font-medium text-gray-800">
                      {site.direction === 1 ? "Forward" : "Reverse"} strand
                    </span>
                    {", "}
                    position {(site.start + 1).toLocaleString()}..{site.end.toLocaleString()}
                    {", "}
                    <span className="font-medium">{site.annealedLength}</span> of {length} bp anneal
                    {site.fullMatch ? "" : " (3'-anchored, 5' tail does not anneal)"}.
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Visual alignment */}
          {alignment ? (
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-500">
                Alignment (primer over template)
              </span>
              <div className="overflow-x-auto rounded-md border border-gray-200 bg-white px-3 py-2.5 font-mono text-xs leading-relaxed">
                {/* Primer row: dimmed 5' tail, bold annealed 3' region. */}
                <div className="whitespace-pre text-gray-800">
                  <span className="text-gray-400">5&apos; </span>
                  <span className="text-gray-300">{alignment.primerTail}</span>
                  <span className="font-semibold text-sky-700">{alignment.primerAnneal}</span>
                  <span className="text-gray-400"> 3&apos;</span>
                </div>
                {/* Match bars under the annealed region only. */}
                <div className="whitespace-pre text-gray-400">
                  {"   "}
                  {" ".repeat(alignment.tail)}
                  {alignment.primerAnneal
                    .split("")
                    .map((b, i) => (b === alignment.templateAnneal[i] ? "|" : " "))
                    .join("")}
                </div>
                {/* Template row (3'->5' under the primer's 5'->3'), annealed region. */}
                <div className="whitespace-pre text-gray-600">
                  <span className="text-gray-400">3&apos; </span>
                  {" ".repeat(alignment.tail)}
                  <span>{alignment.templateAnneal}</span>
                  <span className="text-gray-400"> 5&apos;</span>
                </div>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                The 3&apos; annealed bases are shown in blue; a dimmed 5&apos; region is a
                non-annealing tail (e.g. a cloning overhang).
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
          <button
            type="button"
            onClick={request.onCancel}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-200"
          >
            Cancel
          </button>
          <Tooltip label={canAdd ? "Add this primer as a primer_bind feature" : "Enter a primer that anneals to the template"}>
            <button
              type="button"
              onClick={submit}
              disabled={!canAdd}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add primer to template
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
