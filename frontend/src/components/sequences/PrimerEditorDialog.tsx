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
import { colorForType } from "@/lib/sequences/feature-colors";
import ColorSwatchPicker from "./ColorSwatchPicker";
import LivingPopup from "@/components/ui/LivingPopup";

/** What the dialog hands back on Save. The parent re-derives the feature
 *  geometry from `oligo` (the same findBindingSites path) and persists. */
export interface PrimerEditorSavePayload {
  name: string;
  description: string;
  /** The primer's own 5'->3' oligo, sanitized to IUPAC nucleotides (ACGTU + ambiguity codes). */
  oligo: string;
  phosphorylated: boolean;
  /** The chosen binding site (forward coords + strand), or null if it does not
   *  anneal. The parent keeps the previous geometry when null. */
  site: BindingSite | null;
  /** primer colors bot — the user-chosen primer color (hex), or undefined to use
   *  the default primer color. Persists on the primer_bind feature. */
  color?: string;
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
  /** primer colors bot — the primer's current explicit color (hex), or "" when it
   *  has none (renders with the default primer color). */
  initialColor?: string;
  /** When true, fields are read-only (no Save, no edits). */
  readOnly?: boolean;
  onSubmit: (payload: PrimerEditorSavePayload) => void;
  onDelete?: () => void;
  /** sequence editor master (redesign). Duplicate this primer (edit mode only).
   *  Makes an independent copy on the molecule and closes the dialog. */
  onDuplicate?: () => void;
  onCancel: () => void;
}

// --- inline icons -----------------------------------------------------------
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
function IconTrash({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
// sequence editor master (redesign). Duplicate glyph: two stacked sheets.
function IconDuplicate({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
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

/**
 * Inline binding-site visualization: a strip of the surrounding template bases
 * with the primer drawn over its annealed span as the SnapGene-style thin
 * annealing bracket (horizontal line + end feet + a 3' caret hook). Mirrors the
 * vendor primer renderer (Linear/Primers.tsx) so the dialog matches the map.
 */
function BindingViz({
  template,
  site,
  color: primerColor,
}: {
  template: string;
  site: BindingSite;
  /** primer colors bot — the primer's display color for the annealing bracket. */
  color: string;
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
  const color = primerColor; // primer colors bot — the chosen primer color

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
    <div className="overflow-x-auto rounded-md border border-border bg-surface-raised px-3 py-2">
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
        {/* Template bases (the annealed window highlighted; a mismatch base, from
            the aligner, is drawn in rose). `site.mismatches` are forward template
            coordinates, so we shift by `lo` into local indices. */}
        {bases.split("").map((b, i) => {
          const inAnneal = i >= annealStart && i < annealEnd;
          const isMismatch = (site.mismatches ?? []).includes(lo + i);
          const fill = isMismatch ? "#e11d48" : inAnneal ? "#374151" : "#9ca3af";
          return (
            <text
              key={i}
              x={i * CHAR_W + CHAR_W / 2}
              y={baseY}
              textAnchor="middle"
              fontSize={11}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fill={fill}
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
  // primer colors bot — the primer's explicit color (hex), or "" for the default.
  const [color, setColor] = useState("");
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
    setColor(request.initialColor ?? "");
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
      color: color.trim() || undefined,
    });
  };

  return (
    <LivingPopup open onClose={request.onCancel} label="Edit primer" selfSize>
      <div
        className="pointer-events-auto relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-surface-raised ros-popup-card-shadow"
        data-testid="primer-editor-dialog"
        data-tour-popup-occluding="primer-editor"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-pink-50 dark:bg-pink-500/15 text-pink-600 dark:text-pink-300">
            <IconPrimer className="h-4 w-4" />
          </span>
          <h2 className="text-title font-semibold text-foreground">
            {readOnly ? "Primer" : "Edit primer"}
          </h2>
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
          {/* Name */}
          <label className="block">
            <span className="mb-1 block text-meta font-medium text-foreground-muted">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly}
              placeholder="e.g. GFP-seq-F"
              className="w-full rounded-md border border-border px-2.5 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none disabled:bg-surface-sunken disabled:text-foreground-muted"
            />
          </label>

          {/* Description */}
          <label className="block">
            <span className="mb-1 block text-meta font-medium text-foreground-muted">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly}
              placeholder="Optional note about this primer"
              className="w-full rounded-md border border-border px-2.5 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none disabled:bg-surface-sunken disabled:text-foreground-muted"
            />
          </label>

          {/* Oligo sequence + reverse-complement action */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-meta font-medium text-foreground-muted">Sequence</span>
              {!readOnly ? (
                <Tooltip label="Replace the oligo with its reverse complement">
                  <button
                    type="button"
                    onClick={() => setRaw((r) => reverseComplement(sanitizePrimer(r)))}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
                  >
                    <IconSwap className="h-3.5 w-3.5" />
                    Reverse complement
                  </button>
                </Tooltip>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="select-none text-meta font-medium text-foreground-muted">5&apos;</span>
              <textarea
                ref={seqRef}
                value={raw}
                onChange={(e) => setRaw(sanitizePrimer(e.target.value))}
                disabled={readOnly}
                rows={2}
                placeholder="Type or paste bases (5' to 3')"
                spellCheck={false}
                className="w-full resize-y rounded-md border border-border px-2.5 py-2 font-mono text-body tracking-wide text-foreground focus:border-sky-400 focus:outline-none disabled:bg-surface-sunken disabled:text-foreground-muted"
              />
              <span className="select-none text-meta font-medium text-foreground-muted">3&apos;</span>
            </div>
          </div>

          {/* 5' phosphorylation */}
          <label className="flex items-center gap-2 text-body text-foreground">
            <input
              type="checkbox"
              checked={phosphorylated}
              disabled={readOnly}
              onChange={(e) => setPhosphorylated(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border text-sky-600 dark:text-sky-300 focus:ring-sky-400"
            />
            5&apos; Phosphorylated
          </label>

          {/* primer colors bot — set this primer's color so its arrow + label
              render in it on the detail view and the map. A forward + reverse
              pair colored alike are easy to match at a glance. */}
          <ColorSwatchPicker
            value={color}
            effectiveColor={color.trim() || colorForType("primer_bind")}
            onChange={setColor}
            onReset={() => setColor("")}
            resetLabel="Use default primer color"
            disabled={readOnly}
          />

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
            <span className="mb-1 block text-meta font-medium text-foreground-muted">Binding</span>
            {length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-meta text-foreground-muted">
                Enter a sequence to see where it anneals.
              </p>
            ) : sites.length === 0 ? (
              <p className="rounded-md border border-dashed border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-2.5 py-2 text-meta text-amber-700 dark:text-amber-300">
                This oligo does not anneal to the template. Saving keeps the
                primer&apos;s current position on the map.
              </p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-meta text-foreground-muted">
                  {sites.length} binding {sites.length === 1 ? "site" : "sites"} on this template.
                </p>
                {sites.length > 1 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {sites.map((s, i) => (
                      <button
                        key={`${s.start}-${s.end}-${s.direction}`}
                        type="button"
                        onClick={() => setSiteIdx(i)}
                        className={`rounded-md px-2 py-0.5 text-meta font-medium transition-colors ${
                          i === siteIdx
                            ? "bg-pink-600 text-white"
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
                    <span className="font-medium">{site.annealedLength}</span> of {length} bases anneal
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

          {/* Binding-site visualization (SnapGene-style thin bracket + 3' hook) */}
          {site ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-meta font-medium text-foreground-muted">
                  Annealing (primer over template)
                </span>
                <span className="text-meta font-medium text-foreground-muted">
                  {site.annealedLength - (site.mismatches?.length ?? 0)}/{site.annealedLength}{" "}
                  matched (
                  {Math.round(
                    (site.identity ??
                      (site.annealedLength - (site.mismatches?.length ?? 0)) /
                        Math.max(1, site.annealedLength)) * 100,
                  )}
                  %)
                </span>
              </div>
              <BindingViz
                template={template}
                site={site}
                color={color.trim() || colorForType("primer_bind")}
              />
              {/* Base-for-base alignment with mismatches highlighted, when the
                  aligner placed an imperfect primer. */}
              {site.alignedPrimer && site.alignedTemplate ? (
                <div className="mt-2 overflow-x-auto rounded-md border border-border bg-surface-raised px-3 py-2.5 font-mono text-meta leading-relaxed">
                  <div className="whitespace-pre">
                    <span className="text-foreground-muted">5&apos; </span>
                    {site.alignedPrimer.split("").map((pb, i) => {
                      const match = pb !== "-" && site.alignedTemplate![i] === pb;
                      return (
                        <span
                          key={i}
                          className={match ? "font-semibold text-sky-700 dark:text-sky-300" : "font-semibold text-rose-600 dark:text-rose-300"}
                        >
                          {pb}
                        </span>
                      );
                    })}
                    <span className="text-foreground-muted"> 3&apos;</span>
                  </div>
                  <div className="whitespace-pre text-foreground-muted">
                    {"   "}
                    {site.alignedPrimer
                      .split("")
                      .map((pb, i) => (pb !== "-" && site.alignedTemplate![i] === pb ? "|" : " "))
                      .join("")}
                  </div>
                  <div className="whitespace-pre">
                    <span className="text-foreground-muted">3&apos; </span>
                    {site.alignedTemplate.split("").map((tb, i) => {
                      const match = tb !== "-" && site.alignedPrimer![i] === tb;
                      return (
                        <span key={i} className={match ? "text-foreground-muted" : "text-rose-500"}>
                          {tb}
                        </span>
                      );
                    })}
                    <span className="text-foreground-muted"> 5&apos;</span>
                  </div>
                </div>
              ) : null}
              <p className="mt-1 text-meta text-foreground-muted">
                The thin bracket marks the annealed bases; the hook points toward the
                primer&apos;s 3&apos; end. Mismatched bases are shown in rose.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-sunken px-4 py-3">
          <div className="flex items-center gap-1">
            {/* sequence editor master (redesign). Duplicate the primer. Edit mode
                only; mirrors the right-click "Duplicate". */}
            {!readOnly && request.onDuplicate ? (
              <Tooltip label="Duplicate this primer">
                <button
                  type="button"
                  onClick={request.onDuplicate}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-body font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
                >
                  <IconDuplicate className="h-4 w-4" />
                  Duplicate
                </button>
              </Tooltip>
            ) : null}
            {!readOnly && request.onDelete ? (
              <Tooltip label="Delete this primer">
                <button
                  type="button"
                  onClick={request.onDelete}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-body font-medium text-red-600 dark:text-red-300 transition-colors hover:bg-red-50 dark:hover:bg-red-500/20"
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
              className="rounded-lg px-4 py-2 text-body text-foreground-muted transition-colors hover:bg-surface-sunken"
            >
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly ? (
              <button
                type="button"
                onClick={submit}
                className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white transition-colors hover:bg-brand-action/90"
              >
                Save
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </LivingPopup>
  );
}
