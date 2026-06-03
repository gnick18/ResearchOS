"use client";

// primer dialog bot — the SnapGene-style "Edit Primer" dialog. Double-clicking a
// primer_bind feature on the viewer opens THIS dialog (not the generic
// FeatureEditorDialog). It edits a primer the way SnapGene's "Edit Primer" does:
//
//   - Name + Description (free text)
//   - The editable 5'->3' OLIGO sequence (with 5'/3' end labels). Editing the
//     oligo re-derives the stats + binding site LIVE.
//   - "5' Phosphorylated" checkbox
//   - "Reverse complement" action (replaces the oligo with its reverse complement)
//   - Stats: length (N-mer), %GC, Tm (SantaLucia, our value), and binding info:
//     number of binding sites, the position range, annealed-bases count
//   - A binding-site VISUALIZATION drawing the primer as the new SnapGene-style
//     thin annealing bracket with a 3' hook over the surrounding template bases.
//
// The biology is REUSED, not re-implemented: gcContent / predictTm / tmBasic /
// findBindingSites from primer.ts, and the primer-metadata read/write helpers in
// primer-feature.ts. On Save the parent re-finds the binding site and updates the
// primer_bind feature's start/end/strand + the /note flags through the SAME
// feature-update path FeatureEditorDialog uses (updateFeature via applyDocEdit).
//
// Calm, compact layout mirroring PrimerDialog / FeatureEditorDialog. No emojis
// (inline SVG only), no em-dashes, Tooltip component (no native title=).

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

/** What the dialog hands back on Save. The parent re-derives the feature
 *  geometry from `oligo` (the same findBindingSites path) and persists. */
export interface PrimerEditorSavePayload {
  name: string;
  description: string;
  /** The primer's own 5'->3' oligo, sanitized to ACGTU. */
  oligo: string;
  phosphorylated: boolean;
  /** The chosen binding site (forward coords + strand), or null if it does not
   *  anneal. The parent keeps the previous geometry when null. */
  site: BindingSite | null;
}

export interface PrimerEditorRequest {
  /** The index of the primer_bind feature being edited (for the parent). */
  featureIndex: number;
  /** Full template (forward strand) the primer anneals to. */
  template: string;
  /** Seed values read off the feature. */
  initialName: string;
  initialDescription: string;
  initialOligo: string;
  initialPhosphorylated: boolean;
  /** When true, fields are read-only (no Save, no edits). */
  readOnly?: boolean;
  onSubmit: (payload: PrimerEditorSavePayload) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

// --- inline icons -----------------------------------------------------------
function IconPrimer({ className }: { className?: string }) {
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
function IconTrash({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
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

/**
 * Inline binding-site visualization: a strip of the surrounding template bases
 * with the primer drawn over its annealed span as the SnapGene-style thin
 * annealing bracket (horizontal line + end feet + a 3' caret hook). Mirrors the
 * vendor primer renderer (Linear/Primers.tsx) so the dialog matches the map.
 */
function BindingViz({
  template,
  site,
}: {
  template: string;
  site: BindingSite;
}) {
  const CHAR_W = 9; // px per base (Roboto-Mono-ish monospace cell)
  const PAD = 6; // bases of flanking context on each side
  const lo = Math.max(0, site.start - PAD);
  const hi = Math.min(template.length, site.end + PAD);
  const bases = template.slice(lo, hi).toUpperCase();
  const width = bases.length * CHAR_W;

  // The annealed span, in local (lo-relative) base coordinates.
  const annealStart = site.start - lo;
  const annealEnd = site.end - lo;
  const ax = annealStart * CHAR_W;
  const aw = (annealEnd - annealStart) * CHAR_W;

  // Geometry mirroring the vendor renderer.
  const midY = 14; // the annealing line
  const footH = 5;
  const hookW = 6;
  const hookH = 4;
  const color = "#f472b6"; // primer pink (matches feature-colors primer_bind)

  let linePath = `M ${ax} ${midY} L ${ax + aw} ${midY}`;
  linePath += ` M ${ax} ${midY} L ${ax} ${midY + footH}`; // left foot
  linePath += ` M ${ax + aw} ${midY} L ${ax + aw} ${midY + footH}`; // right foot
  if (site.direction === 1) {
    // forward: 3' end on the right, caret pointing right
    const rx = ax + aw;
    linePath += ` M ${rx - hookW} ${midY - hookH} L ${rx} ${midY} L ${rx - hookW} ${midY + hookH}`;
  } else {
    // reverse: 3' end on the left, caret pointing left
    linePath += ` M ${ax + hookW} ${midY - hookH} L ${ax} ${midY} L ${ax + hookW} ${midY + hookH}`;
  }

  const totalHeight = 44;
  const baseY = 38;

  return (
    <div className="overflow-x-auto rounded-md border border-gray-200 bg-white px-3 py-2">
      <svg
        width={Math.max(width, 1)}
        height={totalHeight}
        viewBox={`0 0 ${Math.max(width, 1)} ${totalHeight}`}
        role="img"
        aria-label={`Primer binding ${(site.start + 1).toLocaleString()} to ${site.end.toLocaleString()} on the ${
          site.direction === 1 ? "forward" : "reverse"
        } strand`}
      >
        {/* The thin annealing bracket + 3' hook (primer color). */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Template bases (the annealed window highlighted). */}
        {bases.split("").map((b, i) => {
          const inAnneal = i >= annealStart && i < annealEnd;
          return (
            <text
              key={i}
              x={i * CHAR_W + CHAR_W / 2}
              y={baseY}
              textAnchor="middle"
              fontSize={11}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fill={inAnneal ? "#374151" : "#9ca3af"}
              fontWeight={inAnneal ? 600 : 400}
            >
              {b}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default function PrimerEditorDialog({ request }: { request: PrimerEditorRequest | null }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [raw, setRaw] = useState("");
  const [phosphorylated, setPhosphorylated] = useState(false);
  // The user-chosen binding site (index into the found sites). Defaults to the
  // first (full matches sort first).
  const [siteIdx, setSiteIdx] = useState(0);
  const seqRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!request) return;
    setName(request.initialName ?? "");
    setDescription(request.initialDescription ?? "");
    setRaw(sanitizePrimer(request.initialOligo ?? ""));
    setPhosphorylated(!!request.initialPhosphorylated);
    setSiteIdx(0);
    const t = setTimeout(() => seqRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [request]);

  const readOnly = request?.readOnly ?? false;
  const oligo = useMemo(() => sanitizePrimer(raw), [raw]);
  const length = oligo.length;
  const gc = useMemo(() => gcContent(oligo), [oligo]);
  const tmNN = useMemo(() => predictTm(oligo), [oligo]);
  const tmW = useMemo(() => tmBasic(oligo), [oligo]);

  // Binding sites, re-derived LIVE from the edited oligo (same logic as Check /
  // PrimerDialog). full matches sort first, then partials.
  const sites = useMemo(() => {
    if (!request || length === 0) return [] as BindingSite[];
    return findBindingSites(oligo, request.template, { allowPartial: true });
  }, [request, oligo, length]);

  // Keep the chosen site index in range as the oligo changes.
  useEffect(() => {
    if (siteIdx >= sites.length) setSiteIdx(0);
  }, [sites.length, siteIdx]);

  const site = sites[siteIdx] ?? null;
  const template = request?.template ?? "";

  if (!request) return null;

  const submit = () => {
    if (readOnly) return;
    request.onSubmit({
      name: name.trim() || "primer",
      description: description.trim(),
      oligo,
      phosphorylated,
      site,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="primer-editor-dialog"
      data-tour-popup-occluding="primer-editor"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={request.onCancel} />
      <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-pink-50 text-pink-600">
            <IconPrimer className="h-4 w-4" />
          </span>
          <h2 className="text-base font-semibold text-gray-900">
            {readOnly ? "Primer" : "Edit primer"}
          </h2>
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
            <span className="mb-1 block text-xs font-medium text-gray-500">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly}
              placeholder="e.g. GFP-seq-F"
              className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-800 focus:border-sky-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
            />
          </label>

          {/* Description */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly}
              placeholder="Optional note about this primer"
              className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-800 focus:border-sky-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
            />
          </label>

          {/* Oligo sequence + reverse-complement action */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Sequence</span>
              {!readOnly ? (
                <Tooltip label="Replace the oligo with its reverse complement">
                  <button
                    type="button"
                    onClick={() => setRaw((r) => reverseComplement(sanitizePrimer(r)))}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100"
                  >
                    <IconSwap className="h-3.5 w-3.5" />
                    Reverse complement
                  </button>
                </Tooltip>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="select-none text-xs font-medium text-gray-400">5&apos;</span>
              <textarea
                ref={seqRef}
                value={raw}
                onChange={(e) => setRaw(sanitizePrimer(e.target.value))}
                disabled={readOnly}
                rows={2}
                placeholder="Type or paste bases (5' to 3')"
                spellCheck={false}
                className="w-full resize-y rounded-md border border-gray-200 px-2.5 py-2 font-mono text-sm tracking-wide text-gray-800 focus:border-sky-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
              />
              <span className="select-none text-xs font-medium text-gray-400">3&apos;</span>
            </div>
          </div>

          {/* 5' phosphorylation */}
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={phosphorylated}
              disabled={readOnly}
              onChange={(e) => setPhosphorylated(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-sky-600 focus:ring-sky-400"
            />
            5&apos; Phosphorylated
          </label>

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

          {/* Binding info */}
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-500">Binding</span>
            {length === 0 ? (
              <p className="rounded-md border border-dashed border-gray-200 px-2.5 py-2 text-xs text-gray-400">
                Enter a sequence to see where it anneals.
              </p>
            ) : sites.length === 0 ? (
              <p className="rounded-md border border-dashed border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
                This oligo does not anneal to the template. Saving keeps the
                primer&apos;s current position on the map.
              </p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs text-gray-500">
                  {sites.length} binding {sites.length === 1 ? "site" : "sites"} on this template.
                </p>
                {sites.length > 1 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {sites.map((s, i) => (
                      <button
                        key={`${s.start}-${s.end}-${s.direction}`}
                        type="button"
                        onClick={() => setSiteIdx(i)}
                        className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                          i === siteIdx
                            ? "bg-pink-600 text-white"
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
                    <span className="font-medium">{site.annealedLength}</span> of {length} bases anneal
                    {site.fullMatch ? "" : " (3'-anchored, 5' tail does not anneal)"}.
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Binding-site visualization (SnapGene-style thin bracket + 3' hook) */}
          {site ? (
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-500">
                Annealing (primer over template)
              </span>
              <BindingViz template={template} site={site} />
              <p className="mt-1 text-xs text-gray-400">
                The thin bracket marks the annealed bases; the hook points toward the
                primer&apos;s 3&apos; end.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
          <div>
            {!readOnly && request.onDelete ? (
              <Tooltip label="Delete this primer">
                <button
                  type="button"
                  onClick={request.onDelete}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                >
                  <IconTrash className="h-4 w-4" />
                  Delete
                </button>
              </Tooltip>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={request.onCancel}
              className="rounded-lg px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-200"
            >
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly ? (
              <button
                type="button"
                onClick={submit}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
              >
                Save
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
