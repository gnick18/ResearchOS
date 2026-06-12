"use client";

// Markdown + ResearchOS embed hybrid, Phase 1. The block-embed renderer.
//
// RenderedMarkdown calls this when a paragraph is a lone object-embed link (a
// link with a `#ros=` view, alone on its line). It dispatches to a per-type
// renderer by `descriptor.type`, lazily so the heavy renderers (RDKit, sequence
// maps, plots) never load until an embed of that type is actually on screen.
// Types without a rich renderer yet fall back to a calm generic card, so every
// embed renders something from day one.
//
// The frame (border, rounding) lives here, each renderer fills the body and uses
// the caption (the link text) as its title. No rendering of inline mentions, the
// `a` override in RenderedMarkdown still handles those as chips.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import { objectDeepLink, type EmbedDescriptor, type ObjectRefType } from "@/lib/references";
import type { BakeEmbedsDeps } from "@/lib/export/bake-embeds";
import {
  getPin,
  liveIdentityForEmbed,
  buildPin,
  updatePin,
  type EmbedPin,
} from "@/lib/embeds/embed-pins";
import BakedEmbedView from "./BakedEmbedView";

/** The doc-level pin context, present only in an editor host. When supplied, the
 *  embed reads its frozen snapshot from `sidecarPath` and (when editable) offers a
 *  Pin / Unpin control. `deps` is threaded to snapshotEmbed for parity with the
 *  bake API. `onPin` / `onUnpin` persist the `pin` opt on the source line (the CM6
 *  rewrite); when absent the embed renders frozen but offers no control (read-only
 *  Preview). */
export interface EmbedPinContext {
  sidecarPath: string;
  deps?: BakeEmbedsDeps;
  onPin?: (descriptor: EmbedDescriptor, caption: string) => void;
  onUnpin?: (descriptor: EmbedDescriptor) => void;
}

export interface EmbedRendererProps {
  descriptor: EmbedDescriptor;
  /** The link text, used as the embed's caption / title. */
  caption: string;
  /** The note's directory, for renderers that read files relative to it. */
  basePath?: string;
  /** When the document opts into figure numbering, the label for this embed
   *  ("Figure 1", "Table 2"). Figure-type renderers prefix their caption with it.
   *  Undefined when numbering is off. */
  figureLabel?: string;
  /** When present, the embed can switch its view in place AND persist the choice.
   *  The CM6 editor passes a closure that rewrites the source line; the read-only
   *  Preview passes nothing, so a multi-view embed there switches only on screen.
   *  Multi-view renderers always update their local view first, then call this. */
  onViewChange?: (newView: string) => void;
  /** When present, the embed can freeze / unfreeze a pinned snapshot. Only an
   *  editor host supplies it; every read-only caller leaves it undefined and the
   *  embed behaves exactly as today. */
  pinContext?: EmbedPinContext;
}

// Per-type rich renderers, added as each phase lands. A type absent here uses the
// generic card. Each module default-exports a component taking EmbedRendererProps.
const EMBED_RENDERERS: Partial<
  Record<ObjectRefType, ComponentType<EmbedRendererProps>>
> = {
  molecule: lazy(() => import("./MoleculeEmbed")),
  datahub: lazy(() => import("./DataHubEmbed")),
  sequence: lazy(() => import("./SequenceEmbed")),
  note: lazy(() => import("./NoteEmbed")),
  method: lazy(() => import("./MethodEmbed")),
  project: lazy(() => import("./ProjectEmbed")),
  collection: lazy(() => import("./CollectionEmbed")),
  task: lazy(() => import("./TaskEmbed")),
  experiment: lazy(() => import("./ExperimentEmbed")),
};

// P7-2 transclusion. A note embed whose view is "transclude" renders its section
// LIVE via TransclusionEmbed instead of the normal NoteEmbed card. Kept lazy so the
// recursive markdown renderer only loads when a transclusion is actually on screen,
// and out of the per-type map so it never collides with the "note" card renderer.
const TransclusionEmbed = lazy(() => import("./TransclusionEmbed"));

const TYPE_ICON: Record<ObjectRefType, IconName> = {
  sequence: "sequence",
  collection: "folder",
  method: "book",
  note: "pencil",
  file: "file",
  project: "folder",
  molecule: "vial",
  datahub: "chart",
  task: "today",
  experiment: "list",
};

const TYPE_LABEL: Record<ObjectRefType, string> = {
  sequence: "Sequence",
  collection: "Collection",
  method: "Method",
  note: "Note",
  file: "File",
  project: "Project",
  molecule: "Molecule",
  datahub: "Data Hub",
  task: "Task",
  experiment: "Experiment",
};

/** Shown when an embed's object is not available to the viewer: deleted,
 *  not shared, or absent from the share bundle. Name-only, no "Open" link (there
 *  is nothing to open). Neutral wording ("Not available") covers both the owner's
 *  own deleted object and a recipient who was not given access. */
export function UnavailableEmbedCard({
  descriptor,
  caption,
}: {
  descriptor: EmbedDescriptor;
  caption: string;
}) {
  const label = caption || descriptor.id;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
        <Icon name="eyeOff" className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-foreground">{label}</p>
        <p className="text-meta text-foreground-muted">
          {TYPE_LABEL[descriptor.type]}
          {" · "}
          Not available
        </p>
      </div>
    </div>
  );
}

/** The universal fallback, and the Suspense placeholder while a rich renderer
 *  loads. A calm card, icon + caption + type, that opens the object. Uses only
 *  the descriptor, so it never has to read data and never fails. */
export function ObjectEmbedCard({
  descriptor,
  caption,
  loading = false,
}: {
  descriptor: EmbedDescriptor;
  caption: string;
  loading?: boolean;
}) {
  const label = caption || descriptor.id;
  const href = objectDeepLink(descriptor.type, descriptor.id);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
        <Icon name={TYPE_ICON[descriptor.type]} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-foreground">{label}</p>
        <p className="text-meta text-foreground-muted">
          {TYPE_LABEL[descriptor.type]}
          {loading ? " · loading…" : ""}
        </p>
      </div>
      {!loading ? (
        <a
          href={href}
          aria-label={`Open ${TYPE_LABEL[descriptor.type]}: ${label}`}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-meta font-semibold text-foreground-muted transition-colors hover:border-brand-action hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      ) : null}
    </div>
  );
}

/** The quiet "pinned <date>" badge shown on a frozen embed. Small, muted, text
 *  only (no inline svg, no emoji). Reuses the calm `.badge`-style look. */
function PinnedBadge({ pinnedAt }: { pinnedAt: string }) {
  let label = "pinned";
  const d = new Date(pinnedAt);
  if (!Number.isNaN(d.getTime())) {
    label = `pinned ${d.toLocaleDateString()}`;
  }
  return (
    <span
      data-embed-pinned="true"
      className="inline-flex items-center rounded-full bg-surface-sunken px-2 py-0.5 text-meta font-semibold text-foreground-muted"
    >
      {label}
    </span>
  );
}

/** The Pin / Unpin action. Text label, no inline svg, so the icon guard holds. Only
 *  rendered when the editor host supplied the matching closure. */
function PinControl({
  pinned,
  onClick,
}: {
  pinned: boolean;
  onClick: () => void;
}) {
  const label = pinned ? "Unpin" : "Pin";
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-meta font-semibold text-foreground-muted transition-colors hover:border-brand-action hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
    >
      {label}
    </button>
  );
}

/** A quiet text button used by the staleness row (View current / show pinned /
 *  Re-pin). No inline svg, calm muted styling that matches the Pin control. */
function StaleAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="shrink-0 rounded-md border border-border px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:border-brand-action hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
    >
      {label}
    </button>
  );
}

/** The quiet "source changed since you pinned this" badge plus its actions. Amber /
 *  muted, text only (no inline svg, no emoji). Rendered only when the staleness check
 *  proved the live source moved on AND we are showing the frozen snapshot. View
 *  current toggles the live render for this session without touching the pin; Re-pin
 *  (editor only) recaptures the snapshot and clears the badge. */
function StaleRow({
  viewingCurrent,
  canRepin,
  repinning,
  onToggleView,
  onRepin,
}: {
  viewingCurrent: boolean;
  canRepin: boolean;
  repinning: boolean;
  onToggleView: () => void;
  onRepin: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-amber-200 bg-amber-50 px-3 py-1.5 dark:border-amber-500/30 dark:bg-amber-500/10">
      <span
        data-embed-stale="true"
        className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-meta font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
      >
        source changed since you pinned this
      </span>
      <span className="ml-auto inline-flex items-center gap-2">
        <StaleAction
          label={viewingCurrent ? "Show pinned" : "View current"}
          onClick={onToggleView}
        />
        {canRepin ? (
          <StaleAction
            label={repinning ? "Re-pinning…" : "Re-pin"}
            onClick={onRepin}
          />
        ) : null}
      </span>
    </div>
  );
}

/** The footer holding the pinned badge and / or the Pin-Unpin control. Renders
 *  nothing when there is neither a badge nor a control (the no-pin-context case),
 *  so today's embeds get no extra chrome. */
function PinFooter({
  pin,
  pinContext,
  descriptor,
  caption,
}: {
  pin: EmbedPin | null;
  pinContext?: EmbedPinContext;
  descriptor: EmbedDescriptor;
  caption: string;
}) {
  const canPin = Boolean(pinContext?.onPin);
  const canUnpin = Boolean(pinContext?.onUnpin);
  const showControl = pin ? canUnpin : canPin;
  if (!pin && !showControl) return null;
  return (
    <div className="flex items-center gap-2 border-t border-border px-3 py-1.5">
      {pin ? <PinnedBadge pinnedAt={pin.pinnedAt} /> : null}
      <span className="ml-auto inline-flex">
        {showControl ? (
          <PinControl
            pinned={Boolean(pin)}
            onClick={() => {
              if (pin) pinContext?.onUnpin?.(descriptor);
              else pinContext?.onPin?.(descriptor, caption);
            }}
          />
        ) : null}
      </span>
    </div>
  );
}

export default function ObjectEmbed({
  descriptor,
  caption,
  basePath,
  figureLabel,
  onViewChange,
  pinContext,
}: EmbedRendererProps) {
  // P7-2 transclusion. A note embed with view "transclude" renders a live section
  // of another note, recursion-guarded. It is NOT pinnable or view-switchable in
  // v1, so it short-circuits the whole pin / stale / view-switch machinery below
  // and renders inside the same quiet figure frame. Hooks above this point are not
  // yet declared, so this early return precedes them (no conditional-hook hazard).
  if (descriptor.type === "note" && descriptor.view === "transclude") {
    return (
      <figure
        className="my-3 mx-0 overflow-hidden rounded-xl border border-border bg-surface-raised"
        aria-label={`${TYPE_LABEL[descriptor.type]} embed: ${caption || descriptor.id}`}
        data-embed-type={descriptor.type}
        data-embed-view={descriptor.view}
      >
        <Suspense
          fallback={<ObjectEmbedCard descriptor={descriptor} caption={caption} loading />}
        >
          <TransclusionEmbed
            descriptor={descriptor}
            caption={caption}
            basePath={basePath}
          />
        </Suspense>
      </figure>
    );
  }

  const Renderer = EMBED_RENDERERS[descriptor.type];

  // A pinned embed renders its FROZEN snapshot, not live. The pin id rides the
  // fragment (descriptor.opts.pin); the snapshot lives in the doc sidecar. We can
  // only resolve it when an editor / read-only host supplied a sidecarPath, every
  // other caller leaves pinContext undefined and behaves exactly as today.
  const pinId = descriptor.opts.pin;
  const sidecarPath = pinContext?.sidecarPath;
  const [pin, setPin] = useState<EmbedPin | null>(null);
  const [pinResolved, setPinResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!pinId || !sidecarPath) {
      setPin(null);
      setPinResolved(true);
      return;
    }
    setPinResolved(false);
    (async () => {
      const found = await getPin(sidecarPath, pinId);
      if (!cancelled) {
        setPin(found);
        setPinResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pinId, sidecarPath]);

  // P7-1b staleness. A frozen pin should never silently rot. When a pin is found we
  // compare the pin's stored identity (portableIdentityFor at pin time) against the
  // source's LIVE identity. They differ -> the source moved on -> show a quiet badge.
  // Best-effort and async, a failure (or a type / record with no portable identity)
  // leaves `stale` false, so the check can never produce a false positive and never
  // blocks the frozen render.
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStale(false);
    // Only a resolved pin that carries a non-null identity can be stale. A pin with
    // a null identity (a type without a portable identity, e.g. datahub / file) is
    // never flagged.
    if (!pin || pin.identity == null) return;
    (async () => {
      try {
        const live = await liveIdentityForEmbed(descriptor);
        // live == null means the source is gone or carries no identity: keep the
        // frozen pin, no stale badge (that is the whole point of a pin).
        if (!cancelled && live != null && live !== pin.identity) {
          setStale(true);
        }
      } catch {
        // Best-effort. A failure leaves stale false.
      }
    })();
    return () => {
      cancelled = true;
    };
    // pin object identity changes on every resolve / re-pin, which is exactly when
    // we want to re-run; descriptor is stable per embed line.
  }, [pin, descriptor]);

  // View current. A purely local, view-only toggle (works in preview AND editor): it
  // renders the LIVE embed for this viewing session WITHOUT touching the pin or the
  // fragment. Resets whenever the underlying pin changes (a fresh resolve / re-pin).
  const [viewingCurrent, setViewingCurrent] = useState(false);
  useEffect(() => {
    setViewingCurrent(false);
  }, [pin]);

  // Re-pin. Recapture the snapshot and UPDATE the stored pin in place, keeping the
  // same short id so the fragment (&pin=s_xxx) never needs rewriting. Editor-only:
  // gated on the same editor signal 1a uses to decide Pin / Unpin (the host wired
  // onPin / onUnpin closures). A read-only preview gets a sidecarPath but no
  // closures, so it can View current but never Re-pin. After a successful re-pin the
  // badge clears and the refreshed frozen state shows.
  const [repinning, setRepinning] = useState(false);
  const isEditorHost = Boolean(pinContext?.onPin || pinContext?.onUnpin);
  const canRepin = Boolean(sidecarPath && pinId && isEditorHost);

  const handleRepin = async () => {
    if (!sidecarPath || !pinId || repinning) return;
    setRepinning(true);
    try {
      const fresh = await buildPin(descriptor, caption, pinContext?.deps);
      await updatePin(sidecarPath, pinId, fresh);
      setPin(fresh);
      setStale(false);
      setViewingCurrent(false);
    } catch {
      // A re-pin failure leaves the existing frozen pin and the stale badge in
      // place, the user can retry. Nothing destructive happened.
    } finally {
      setRepinning(false);
    }
  };

  // While a pin id is present but not yet resolved, hold the live render back so we
  // do not flash live -> frozen. Once resolved, a found pin renders frozen; a
  // missing pin (sidecar gone or id removed) falls back to live, gracefully. The
  // View-current toggle overrides the frozen render for this session only.
  const hasPin = Boolean(pin);
  const showFrozen = hasPin && !viewingCurrent;
  const awaitingPin = Boolean(pinId && sidecarPath) && !pinResolved;

  return (
    <figure
      className="my-3 mx-0 overflow-hidden rounded-xl border border-border bg-surface-raised"
      aria-label={`${TYPE_LABEL[descriptor.type]} embed: ${caption || descriptor.id}`}
      data-embed-type={descriptor.type}
      data-embed-view={descriptor.view}
      data-embed-pinned={showFrozen ? "true" : undefined}
      data-embed-stale={stale ? "true" : undefined}
    >
      {showFrozen && pin ? (
        <BakedEmbedView snapshot={pin.snapshot} caption={caption} descriptor={descriptor} />
      ) : awaitingPin ? (
        <ObjectEmbedCard descriptor={descriptor} caption={caption} loading />
      ) : Renderer ? (
        <Suspense
          fallback={<ObjectEmbedCard descriptor={descriptor} caption={caption} loading />}
        >
          <Renderer
            descriptor={descriptor}
            caption={caption}
            basePath={basePath}
            figureLabel={figureLabel}
            onViewChange={onViewChange}
          />
        </Suspense>
      ) : (
        <ObjectEmbedCard descriptor={descriptor} caption={caption} />
      )}
      {/* The stale row shows only on a found pin whose live source has moved on. It
          stays visible while View-current is toggled (so the user can flip back),
          and clears after a successful Re-pin. */}
      {hasPin && stale ? (
        <StaleRow
          viewingCurrent={viewingCurrent}
          canRepin={canRepin}
          repinning={repinning}
          onToggleView={() => setViewingCurrent((v) => !v)}
          onRepin={handleRepin}
        />
      ) : null}
      <PinFooter
        pin={pin}
        pinContext={pinContext}
        descriptor={descriptor}
        caption={caption}
      />
    </figure>
  );
}

/**
 * The caption line below a figure-type embed (molecule, sequence, Data Hub).
 *
 * The embed title already shows the live object name (the renderers use
 * name-first priority). This component is ONLY for opt-in figure numbering:
 * when figureLabel is present (e.g. "Figure 1") it renders a figcaption that
 * reads "Figure 1. <live name>", so a renamed object never surfaces a stale
 * label. When figureLabel is absent, nothing is rendered regardless of the
 * baked caption text. A future dedicated caption field is the right home for
 * deliberate custom captions.
 *
 * Prop signature is unchanged (caption, name, figureLabel) so call sites do
 * not need updates.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */
export function EmbedCaption({
  caption,
  name,
  figureLabel,
}: {
  caption: string;
  name?: string;
  figureLabel?: string;
}) {
  if (!figureLabel) return null;
  const text = name || caption || "";
  if (!text) return null;
  return (
    <figcaption className="border-t border-border px-3 py-2 text-meta text-foreground-muted">
      <span className="font-semibold text-foreground">{figureLabel}. </span>
      {text}
    </figcaption>
  );
}
