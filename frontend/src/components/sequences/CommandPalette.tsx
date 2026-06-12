// sequence editor master. The Cmd-K COMMAND PALETTE, now a CENTERED MODAL.
//
// BeakerSearch v4 (ai centered-redesign bot, 2026-06-11): the v3 floating
// dock is replaced by a clean, centered modal overlay. A full-screen scrim
// sits behind the surface; clicking it or pressing Escape closes the palette.
// No drag, no resize, no tuck, no collapse, no dockControlRef.
//
// BeakerSearch v2 Phase 2 (ai palette-morph bot, 2026-06-11): Ask mode is
// KEPT. When `askMode` is "ask" the search body cross-fades to a BeakerBot
// conversation rendered right here, and the container grows to accommodate
// the thread. Back-to-search shrinks it back. The morph is now even simpler
// because the surface is centered, not floating.
//
// BeakerSearch v2 Phase 3 (ai declutter bot, 2026-06-11): command de-clutter.
// "Go to X" nav and "App" commands are now routed BEHIND a ">" prefix so the
// default view leads with the user's work (objects, recent records, sequences,
// artifacts) and the single Ask BeakerBot row. Typing ">" switches to command
// mode: the leading ">" (and any trailing space) is stripped, the remainder
// filters the global nav + app commands, and the work results are hidden so
// commands lead cleanly. An empty ">" shows ALL commands at once (the
// discoverable "show me everything" gesture). Non-global page commands that
// carry a page-defined group are shown in both modes so the sequence editor
// and other pages retain their own palette reach without the prefix.
//
// Adaptive dodge (ai adaptive-dodge bot, 2026-06-11): when BeakerBot shows a
// spotlight on a page element, the centered surface glides to the viewport
// corner farthest from the target so it never covers what BeakerBot is
// pointing at. It returns to center when the spotlight is dismissed. Driven
// by subscribeSpotlight from spotlight-controller, with geometry helpers from
// spotlight-dodge-geometry (pure, unit-tested, no DOM).
//
// Icons render through <Icon> from the verified icon library (no inline svg,
// the icon-guard enforces it); the BeakerBot mark renders via the component.
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import BeakerBot from "@/components/BeakerBot";
import BeakerBotConversation from "@/components/ai/BeakerBotConversation";
import BeakerSearchAskHeader from "@/components/ai/BeakerSearchAskHeader";
import { useConversationStore } from "@/lib/ai/conversation-store";
import {
  subscribeSpotlight,
  type SpotlightRect,
} from "@/components/ai/spotlight-controller";
import {
  wouldOcclude,
  farthestCorner,
  DODGE_SURFACE_W,
  DODGE_SURFACE_H,
} from "@/components/ai/spotlight-dodge-geometry";
import type { SelectionKind } from "@/lib/sequences/inspector-context";
import type { CapturedContext } from "@/components/beaker-search/captured-context";
import {
  buildPaletteResultsForQuery,
  filterSubflowItems,
  flattenPaletteItems,
  isPaletteItemEnabled,
  objectGroupTitle,
  paletteItemKey,
  resolveSubflowPresentation,
  runPaletteItem,
  type ArtifactNavItem,
  type EditorCommand,
  type PaletteContext,
  type PaletteContextCard,
  type PaletteGroup,
  type PaletteItem,
  type PaletteNavGroup,
  type PaletteNavItem,
  type PaletteSubflow,
  type PaletteTone,
  type SequenceNavItem,
} from "./editor-commands";
// BeakerSearch global object search, chunk 2. The palette ranks the flat
// cross-app index (debounced) into per-type object groups and jumps to a
// record by its deep-link href. The ranking brain is pure (global-source.ts);
// the palette only debounces, maps to PaletteGroups, and wires the run
// closures.
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  rankGlobalEntries,
  type GlobalObjectType,
} from "@/components/beaker-search/global-source";
import type { GlobalIndexEntry } from "@/components/beaker-search/global-index";

// Stable empty defaults so an omitted prop does not churn the result memo.
const EMPTY_SEQUENCES: SequenceNavItem[] = [];
const EMPTY_ARTIFACTS: ArtifactNavItem[] = [];
const EMPTY_NAV_GROUPS: PaletteNavGroup[] = [];
const EMPTY_OBJECT_INDEX: GlobalIndexEntry[] = [];
const EMPTY_PALETTE_GROUPS: PaletteGroup[] = [];
const EMPTY_RECENT_RECORDS: PaletteItem[] = [];

/** Per-type icon-chip classes for a tinted row (the redesign's per-type color
 *  coding, so a mixed list is scannable by hue). Tasks amber, Projects violet,
 *  Methods emerald, Sequences sky, Goals teal, Events rose, Feeds slate (the
 *  read-only external calendar tone). Data Hub orange, Molecules lime,
 *  Purchases yellow-warm. */
const CHIP_TONE: Record<PaletteTone, string> = {
  task: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300",
  project: "bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300",
  method: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300",
  sequence: "bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300",
  goal: "bg-cyan-50 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-300",
  event: "bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300",
  feed: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300",
  inventory: "bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-300",
  note: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300",
  person: "bg-pink-50 text-pink-600 dark:bg-pink-900/30 dark:text-pink-300",
  funding: "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300",
  link: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300",
  datahub: "bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300",
  molecule: "bg-lime-50 text-lime-600 dark:bg-lime-900/30 dark:text-lime-300",
  purchase: "bg-yellow-50 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-300",
};
/** The default chip for commands / sequence-nav / artifacts / the search-all
 *  row (everything that is not a typed cross-app record). */
const CHIP_DEFAULT = "bg-surface-sunken text-sky-600 dark:text-sky-300";

/** The icon, label, optional sub, and right-side hint for ONE palette item,
 *  branched by kind. Keeps the row markup uniform across commands, sequences,
 *  and results. */
function paletteRowParts(item: PaletteItem): {
  iconName: Parameters<typeof Icon>[0]["name"];
  label: string;
  sub?: string;
  /** Right-aligned shortcut or "Open" affordance. */
  hint?: string;
  /** The object type, when this row is a cross-app record. Absent for
   *  commands / sequence-nav / artifacts, which keep the default sky chip. */
  tone?: PaletteTone;
} {
  if (item.kind === "command") {
    return {
      iconName: item.command.iconName,
      label: item.command.label,
      sub: item.command.detail,
      hint: item.command.shortcut,
    };
  }
  if (item.kind === "sequence") {
    return {
      iconName: item.sequence.iconName,
      label: item.sequence.label,
      sub: item.sequence.detail,
    };
  }
  if (item.kind === "object") {
    return {
      iconName: item.entry.iconName,
      label: item.entry.label,
      sub: item.entry.meta,
      hint: "Open",
      tone: item.entry.type,
    };
  }
  if (item.kind === "searchAll") {
    return {
      iconName: "search",
      label: `Search everything for "${item.query}"`,
      sub: "Open the full search with filters",
      hint: "Search",
    };
  }
  if (item.kind === "nav") {
    return {
      iconName: item.item.iconName,
      label: item.item.label,
      sub: item.item.detail,
      hint: "Open",
      tone: item.item.tone,
    };
  }
  if (item.kind === "subpick") {
    return {
      iconName: item.item.iconName,
      label: item.item.label,
      sub: item.item.detail,
      hint: "Pick",
      tone: item.item.tone,
    };
  }
  return {
    iconName: item.artifact.iconName,
    label: item.artifact.label,
    sub: item.artifact.detail,
    hint: "Open",
  };
}

/** The "On this sequence" context card (empty query) or its slim one-line
 *  header (while typing). Display only, never a selectable row. Self-hides
 *  with no context. */
function ContextCard({
  context,
  slim,
}: {
  context: PaletteContext | undefined;
  slim: boolean;
}) {
  if (!context) return null;

  if (slim) {
    return (
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-meta text-foreground-muted">
        <Icon
          name={context.circular ? "moleculeCircular" : "moleculeLinear"}
          className="h-3.5 w-3.5 flex-none text-sky-600 dark:text-sky-300"
        />
        <span className="truncate font-medium text-foreground">{context.name}</span>
        <span className="truncate">{context.meta}</span>
      </div>
    );
  }

  return (
    <div className="px-3 pb-1 pt-2">
      <div className="px-1 pb-1 text-[10px] font-extrabold uppercase tracking-wide text-foreground-muted">
        On this sequence
      </div>
      <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2.5 dark:border-sky-900/40 dark:bg-sky-900/20">
        <div className="flex items-center gap-2">
          <Icon
            name={context.circular ? "moleculeCircular" : "moleculeLinear"}
            className="h-4 w-4 flex-none text-sky-600 dark:text-sky-300"
          />
          <span className="truncate text-body font-semibold text-foreground">
            {context.name}
          </span>
        </div>
        <div className="mt-1 pl-6 text-meta text-foreground-muted">{context.meta}</div>
        {context.organism ? (
          <div className="mt-1 flex items-center gap-1.5 pl-6 text-meta italic text-foreground-muted">
            <span
              className="h-2 w-2 flex-none rounded-sm"
              style={{ background: context.organismSwatch ?? "#0284c7" }}
            />
            {context.organism}
          </div>
        ) : null}
        {context.selection ? (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-meta font-medium text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
            <Icon name="ruler" className="h-3 w-3 flex-none" />
            <span>
              Selection {context.selection.lo}..{context.selection.hi} (
              {context.selection.len} nt)
              {context.selection.tm != null
                ? `, Tm ${context.selection.tm.toFixed(1)} C`
                : ""}
              {context.selection.gc != null
                ? `, ${context.selection.gc.toFixed(0)}% GC`
                : ""}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The GENERIC context card (step 3, the per-page contract). The page-agnostic
 *  equivalent of the sequence ContextCard, driven by a PaletteContextCard the
 *  active page supplies. Self-hides with no card. */
function GenericContextCard({
  card,
  slim,
}: {
  card: PaletteContextCard | undefined;
  slim: boolean;
}) {
  if (!card) return null;

  if (slim) {
    return (
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-meta text-foreground-muted">
        <Icon
          name={card.iconName}
          className="h-3.5 w-3.5 flex-none text-sky-600 dark:text-sky-300"
        />
        <span className="truncate font-medium text-foreground">{card.title}</span>
        {card.meta ? <span className="truncate">{card.meta}</span> : null}
        {card.selection ? (
          <span className="truncate">{card.selection.text}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="px-3 pb-1 pt-2">
      <div className="px-1 pb-1 text-[10px] font-extrabold uppercase tracking-wide text-foreground-muted">
        In view
      </div>
      <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2.5 dark:border-sky-900/40 dark:bg-sky-900/20">
        <div className="flex items-center gap-2">
          <Icon
            name={card.iconName}
            className="h-4 w-4 flex-none text-sky-600 dark:text-sky-300"
          />
          <span className="truncate text-body font-semibold text-foreground">
            {card.title}
          </span>
        </div>
        {card.meta ? (
          <div className="mt-1 pl-6 text-meta text-foreground-muted">{card.meta}</div>
        ) : null}
        {card.chips && card.chips.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
            {card.chips.map((chip, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-meta font-medium text-foreground-muted ${
                  chip.italic ? "italic" : ""
                }`}
              >
                {chip.swatch ? (
                  <span
                    className="h-2 w-2 flex-none rounded-sm"
                    style={{ background: chip.swatch }}
                  />
                ) : null}
                {chip.label}
              </span>
            ))}
          </div>
        ) : null}
        {card.selection ? (
          <div className="mt-2 flex items-center gap-2 border-t border-sky-100 pt-2 text-meta font-medium text-foreground dark:border-sky-900/40">
            <Icon
              name={card.selection.iconName}
              className="h-3.5 w-3.5 flex-none text-sky-600 dark:text-sky-300"
            />
            <span className="truncate">{card.selection.text}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: EditorCommand[];
  /** The live selection kind, so the empty-query Suggested group is biased.
   *  Sequence-editor only; generic pages omit it (defaults to "none"). */
  selectionKind?: SelectionKind;
  /** Whether the open sequence carries an organism (biases Suggested too). */
  hasOrganism?: boolean;
  /** The "On this sequence" context card data (open sequence + live selection).
   *  Absent in older callers / tests; the card just self-hides then. */
  context?: PaletteContext;
  /** BeakerSearch website-wide (step 3), the GENERIC per-page contract a
   *  non-sequence page supplies. */
  contextCard?: PaletteContextCard;
  suggestedIds?: string[];
  suggestedHint?: string;
  navGroups?: PaletteNavGroup[];
  /** Query-aware interpretation rows (step 3 seam), e.g. "Go to <typed date>". */
  interpretQuery?: (query: string) => PaletteNavGroup[];
  /** The OTHER sequences in the open collection, to jump to. Default empty. */
  sequences?: SequenceNavItem[];
  /** The latest saved results for the open sequence, newest first. Default
   *  empty. */
  artifacts?: ArtifactNavItem[];
  /** The collection name, for the "Jump to a sequence" group hint. */
  collectionLabel?: string;
  /** BeakerSearch global object search, chunk 2. The flat cross-app index the
   *  palette ranks (debounced, 120 ms) into the per-type object groups. Default
   *  empty. */
  objectIndex?: GlobalIndexEntry[];
  /** Jump to a cross-app object record (the provider pushes its deep-link href,
   *  closes the palette, and records it in the Recent-records MRU). Absent
   *  disables object navigation. */
  onNavigateObject?: (entry: GlobalIndexEntry) => void;
  /** BeakerSearch global object search, chunk 3. Hand the live query off to the
   *  full faceted /search. Absent hides the trailing "Search everything" row. */
  onSearchEverything?: (query: string) => void;
  /** BeakerSearch global object search, chunk 4. The cross-app Recent-records
   *  MRU, already resolved to live entries in MRU order by the provider.
   *  Rendered only in the empty-query view. Default empty. */
  recentEntries?: GlobalIndexEntry[];
  /** BeakerSearch v1 AI escalation. When present, shows the "Ask BeakerBot"
   *  row. Absent on non-shell callers (the editor's own tests). */
  onEscalate?: (query: string) => void;
  /** BeakerSearch v2 Phase 2. The current display mode: "search" (default,
   *  result rows) or "ask" (BeakerBot conversation in place). Controlled by the
   *  provider; absent non-shell callers leave the morph dormant. */
  askMode?: "search" | "ask";
  /** Switch the palette into Ask mode (e.g. from the Ask BeakerBot row). */
  onEnterAskMode?: () => void;
  /** Switch the palette back to search mode (the back-to-search control). */
  onExitAskMode?: () => void;
}

/** The BeakerSearch centered modal. Renders nothing when closed. */
export function CommandPalette({
  open,
  onClose,
  commands,
  selectionKind = "none",
  hasOrganism = false,
  context,
  contextCard,
  suggestedIds,
  suggestedHint,
  navGroups = EMPTY_NAV_GROUPS,
  interpretQuery,
  sequences = EMPTY_SEQUENCES,
  artifacts = EMPTY_ARTIFACTS,
  collectionLabel,
  objectIndex = EMPTY_OBJECT_INDEX,
  onNavigateObject,
  onSearchEverything,
  recentEntries = EMPTY_OBJECT_INDEX,
  onEscalate,
  askMode = "search",
  onEnterAskMode,
  onExitAskMode,
}: CommandPaletteProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Adaptive dodge state. When the spotlight points at a page element and it
  // would occlude the surface, we switch from the default centered CSS class to
  // an absolutely positioned corner. null = centered (default).
  const [dodgeStyle, setDodgeStyle] = useState<React.CSSProperties | null>(null);
  // Ref to the surface element so we can read its live rect for occlusion tests.
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // Tracks which corner is currently active to avoid jitter (only update state
  // when the farthest corner actually changes).
  const lastCornerRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Surface is closed: clear any dodge and reset tracking.
      setDodgeStyle(null);
      lastCornerRef.current = null;
      return;
    }

    const computeDodge = (rect: SpotlightRect | null) => {
      if (!rect) {
        // Spotlight dismissed: glide back to center.
        setDodgeStyle(null);
        lastCornerRef.current = null;
        return;
      }

      // Determine the surface's current rect. When the surface is centered the
      // CSS places it at inset-x-0 top-[12vh], so we fall back to a synthetic
      // centered rect when the ref is not yet measured.
      const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
      const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
      const surfaceEl = surfaceRef.current;
      const surfaceRect = surfaceEl
        ? (surfaceEl.getBoundingClientRect() as { left: number; top: number; width: number; height: number })
        : {
            left: Math.max(0, (vw - Math.min(600, vw)) / 2),
            top: vh * 0.12,
            width: Math.min(600, vw),
            height: DODGE_SURFACE_H,
          };

      if (!wouldOcclude(surfaceRect, rect)) {
        // No occlusion: return to center if we were dodging.
        setDodgeStyle(null);
        lastCornerRef.current = null;
        return;
      }

      const { corner, left, top } = farthestCorner(
        rect,
        { width: vw, height: vh },
        DODGE_SURFACE_W,
        DODGE_SURFACE_H,
      );

      // Only update state when the corner changes, to avoid jitter on rapid
      // scroll re-track notifications.
      if (corner === lastCornerRef.current) return;
      lastCornerRef.current = corner;

      setDodgeStyle({
        // Override the centered inset-x-0 / top-[12vh] with an exact position.
        inset: "unset",
        left: `${left}px`,
        top: `${top}px`,
        // Limit width so the surface does not overflow on narrow viewports.
        width: `min(${DODGE_SURFACE_W}px, calc(100vw - 40px))`,
        maxWidth: `min(${DODGE_SURFACE_W}px, calc(100vw - 40px))`,
      });
    };

    const unsub = subscribeSpotlight(computeDodge);
    return unsub;
  }, [open]);

  // Fluid morph blur (fun pass, 2026-06-12). Whenever the surface RESHAPES, a
  // dodge corner change or the Ask-mode grow, briefly blur it so the chat
  // softens away while the box morphs into its new shape and slides, then
  // sharpens back as it settles. The 420ms clear sits just past the 0.4s morph.
  // The mount guard skips the initial open so first paint does not blur.
  const [morphing, setMorphing] = useState(false);
  const morphMountRef = useRef(false);
  useEffect(() => {
    if (!morphMountRef.current) {
      morphMountRef.current = true;
      return;
    }
    setMorphing(true);
    const t = window.setTimeout(() => setMorphing(false), 420);
    return () => window.clearTimeout(t);
  }, [dodgeStyle, askMode]);

  // Riding BeakerBot mascot (Option C, 2026-06-12). One LIVING mascot rides the
  // top edge of the surface. It is rendered as a SIBLING of the surface (below)
  // so the morph blur never touches it, it stays crisp while the box softens.
  // Its left/top track the surface's resolved TOP edge and travel on the SAME
  // spring curve as the box; while morphing it lifts + leans into the direction
  // of travel, then plays a settle bob on arrival. Port of the feel prototyped
  // in docs/mockups/beakersearch-fluid-dodge-demo.html.
  const [riderPos, setRiderPos] = useState<{ left: number; top: number } | null>(
    null,
  );
  // Lean direction during travel: -1 left, 1 right, 0 none. Cleared on settle.
  const [riderLean, setRiderLean] = useState<-1 | 0 | 1>(0);
  // Drives the one-shot landing bob; toggled on each arrival.
  const [riderLanding, setRiderLanding] = useState(false);
  const riderPrevLeftRef = useRef<number | null>(null);

  // The mascot is only chrome for the chat. Thinking animation reads `sending`
  // from the conversation store so the rider bobs while BeakerBot works.
  const aiSending = useConversationStore((s) => s.sending);

  // Recompute the rider's top-edge target whenever the surface could have moved
  // (open, mode change, dodge corner change, viewport resize / scroll). We read
  // the surface's resolved rect after layout so the rider tracks the REAL edge
  // rather than a synthetic guess. rAF defers the read until the new layout is
  // committed; the rider then springs to it on the same curve as the box.
  useEffect(() => {
    if (!open || askMode !== "ask") {
      setRiderPos(null);
      riderPrevLeftRef.current = null;
      return;
    }
    let raf = 0;
    const place = () => {
      const el = surfaceRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Perch near the UPPER-LEFT corner of the box (not center), riding a touch
      // higher than before since the mascot is now larger.
      const left = r.left + 30;
      const top = r.top - 22;
      const prev = riderPrevLeftRef.current;
      if (prev != null) {
        const delta = left - prev;
        setRiderLean(delta > 2 ? 1 : delta < -2 ? -1 : 0);
      }
      riderPrevLeftRef.current = left;
      setRiderPos({ left, top });
    };
    // Place now (start rect) and again after the morph settles (target rect),
    // so the rider ends exactly on the box's resolved top edge.
    raf = window.requestAnimationFrame(place);
    const settle = window.setTimeout(place, 440);
    const onViewport = () => place();
    window.addEventListener("resize", onViewport);
    window.addEventListener("scroll", onViewport, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      window.removeEventListener("resize", onViewport);
      window.removeEventListener("scroll", onViewport, true);
    };
  }, [open, askMode, dodgeStyle, morphing]);

  // When the morph finishes, drop the lean and play the one-shot settle bob.
  useEffect(() => {
    if (morphing || askMode !== "ask") return;
    setRiderLean(0);
    setRiderLanding(true);
    const t = window.setTimeout(() => setRiderLanding(false), 440);
    return () => window.clearTimeout(t);
  }, [morphing, askMode]);

  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  // BeakerSearch v2 (sub-flow framework, chunk 1). The open picker STACK. [] is
  // the root / normal palette; the top of the stack is the active picker stage.
  const [subStack, setSubStack] = useState<PaletteSubflow[]>([]);
  const [inlineAnchorKey, setInlineAnchorKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // The element focused before the palette opened, restored on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const pathname = usePathname();
  // Starts false; the first pathname-effect run (mount) flips it to true and
  // exits early, so only genuine route changes after mount trigger the clear.
  const clearOnNavRef = useRef(false);

  const typing = query.trim() !== "";

  // BeakerSearch v2 Phase 3: command-mode routing. A query that starts with ">"
  // switches to command mode. The leading ">" and any immediately following
  // space are stripped to produce the bare filter text used for fuzzy matching.
  // An empty ">" (bare prefix only) shows all commands.
  const isCommandMode = query.startsWith(">");
  const commandQuery = isCommandMode ? query.slice(1).replace(/^ /, "") : query;

  // Global command groups (the "Go to X" + "App" layer). In DEFAULT mode these
  // are stripped from the command list before building results so they never
  // crowd the work view. In COMMAND mode the full commands list is passed (only
  // the command groups are shown and the work sources are suppressed below).
  const GLOBAL_GROUPS: ReadonlySet<string> = new Set(["Go to", "App"]);
  const defaultModeCommands = useMemo(
    () => commands.filter((c) => !GLOBAL_GROUPS.has(c.group)),
    // GLOBAL_GROUPS is stable (module-level constant recreated per render but
    // the Set membership never changes). We only depend on commands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commands],
  );

  // BeakerSearch global object search, chunk 2. The cross-app object ranking
  // is DEBOUNCED (120 ms) so each keystroke does not re-rank the whole index.
  // In command mode we pass a dummy empty query to the ranker because we show
  // NO work results there; the debouncedQuery is still computed on the raw
  // input so typing in default mode continues to rank correctly.
  const debouncedQuery = useDebouncedValue(query, 120);
  const objectGroups = useMemo<PaletteGroup[]>(() => {
    if (!onNavigateObject || isCommandMode) return EMPTY_PALETTE_GROUPS;
    const ranked = rankGlobalEntries(objectIndex, debouncedQuery, {
      now: Date.now(),
    });
    if (ranked.length === 0) return EMPTY_PALETTE_GROUPS;
    return ranked.map((group) => ({
      title: objectGroupTitle(group.type),
      items: group.entries.map((entry) => ({
        kind: "object" as const,
        entry,
        onRun: () => onNavigateObject(entry),
      })),
    }));
  }, [objectIndex, debouncedQuery, onNavigateObject, isCommandMode]);

  // BeakerSearch global object search, chunk 4. The cross-app Recent-records
  // MRU, wired through the same jump path as the ranked object rows. Hidden
  // in command mode (commands lead, not work objects).
  const recentRecords = useMemo<PaletteItem[]>(() => {
    if (!onNavigateObject || recentEntries.length === 0 || isCommandMode) {
      return EMPTY_RECENT_RECORDS;
    }
    return recentEntries.map((entry) => ({
      kind: "object" as const,
      entry,
      onRun: () => onNavigateObject(entry),
    }));
  }, [recentEntries, onNavigateObject, isCommandMode]);

  // Grouped + flat heterogeneous results for the current query and selection
  // context. The trailing "Search everything" handoff row (chunk 3) is appended
  // LAST so it always sits at the very bottom.
  //
  // Command mode: pass only the full commands list (all groups), suppress all
  // work sources (sequences, artifacts, navGroups, objectGroups, recentRecords),
  // and use commandQuery as the filter text. The builder shows only matching
  // command groups, which is exactly the desired "Go to / App" view.
  //
  // Default mode: pass commands with the global "Go to" / "App" groups stripped,
  // pass all work sources, use the raw query.
  const groups = useMemo(() => {
    if (isCommandMode) {
      const base = buildPaletteResultsForQuery(
        {
          commands,
          // Suppress all work sources in command mode.
          sequences: EMPTY_SEQUENCES,
          artifacts: EMPTY_ARTIFACTS,
          collectionLabel: undefined,
          selectionKind: "none",
          hasOrganism: false,
          suggestedIds: [],
          navGroups: EMPTY_NAV_GROUPS,
          objectGroups: EMPTY_PALETTE_GROUPS,
          recentRecords: EMPTY_RECENT_RECORDS,
        },
        commandQuery,
      );
      return base;
    }

    const base = buildPaletteResultsForQuery(
      {
        commands: defaultModeCommands,
        sequences,
        artifacts,
        collectionLabel,
        selectionKind,
        hasOrganism,
        suggestedIds,
        suggestedHint,
        navGroups,
        interpretQuery,
        objectGroups,
        recentRecords,
      },
      query,
    );
    const trimmed = query.trim();
    if (trimmed === "" || !onSearchEverything) return base;
    const searchAllGroup: PaletteGroup = {
      title: "More",
      items: [
        {
          kind: "searchAll" as const,
          query: trimmed,
          onRun: () => onSearchEverything(trimmed),
        },
      ],
    };
    return [...base, searchAllGroup];
  }, [
    isCommandMode,
    commandQuery,
    commands,
    defaultModeCommands,
    sequences,
    artifacts,
    collectionLabel,
    selectionKind,
    hasOrganism,
    suggestedIds,
    suggestedHint,
    navGroups,
    interpretQuery,
    objectGroups,
    recentRecords,
    query,
    onSearchEverything,
  ]);

  // BeakerSearch v2 (sub-flow framework, chunk 1). The active picker stage.
  const topSubflow = subStack.length > 0 ? subStack[subStack.length - 1] : null;
  const inSubflow = topSubflow != null;
  const subMode: "inline" | "stack" | null = !topSubflow
    ? null
    : subStack.length === 1 && inlineAnchorKey != null
      ? "inline"
      : "stack";

  const subItems = useMemo<PaletteItem[]>(() => {
    if (!topSubflow) return [];
    return filterSubflowItems(topSubflow.items, query).map((navItem) => ({
      kind: "subpick" as const,
      item: navItem,
      onPick: () => {},
    }));
  }, [topSubflow, query]);

  const restingGroups = useMemo<PaletteGroup[]>(() => {
    if (subMode !== "inline") return EMPTY_PALETTE_GROUPS;
    // The resting (empty-query) background shown while an inline sub-flow is
    // open. Mirrors the default-mode filtering: strip the global "Go to" /
    // "App" groups so they are still reachable only via ">".
    return buildPaletteResultsForQuery(
      {
        commands: defaultModeCommands,
        sequences,
        artifacts,
        collectionLabel,
        selectionKind,
        hasOrganism,
        suggestedIds,
        suggestedHint,
        navGroups,
        interpretQuery,
        objectGroups,
        recentRecords,
      },
      "",
    );
  }, [
    subMode,
    defaultModeCommands,
    sequences,
    artifacts,
    collectionLabel,
    selectionKind,
    hasOrganism,
    suggestedIds,
    suggestedHint,
    navGroups,
    interpretQuery,
    objectGroups,
    recentRecords,
  ]);

  const viewGroups = useMemo<PaletteGroup[]>(() => {
    if (!topSubflow || subMode == null) return groups;
    const pickerGroup: PaletteGroup = {
      title: topSubflow.title,
      hint: topSubflow.placeholder,
      items: subItems,
    };
    if (subMode === "stack") return [pickerGroup];
    const out: PaletteGroup[] = [];
    let spliced = false;
    for (const g of restingGroups) {
      const holdsAnchor = g.items.some(
        (it) => paletteItemKey(it) === inlineAnchorKey,
      );
      out.push(g);
      if (holdsAnchor && !spliced) {
        out.push(pickerGroup);
        spliced = true;
      }
    }
    if (!spliced) out.unshift(pickerGroup);
    return out;
  }, [topSubflow, subMode, subItems, groups, restingGroups, inlineAnchorKey]);

  const flat = useMemo(() => flattenPaletteItems(viewGroups), [viewGroups]);

  // BeakerSearch v1 AI escalation flags.
  const hasEscalation = Boolean(onEscalate);
  const totalHighlightCount = flat.length + (hasEscalation ? 1 : 0);

  // Reset the query and remember focus each time the palette opens; default the
  // highlight to the first (top-ranked) result and put the cursor in the input.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      (document.activeElement as HTMLElement | null) ?? null;
    setQuery("");
    setHighlight(0);
    setSubStack([]);
    setInlineAnchorKey(null);
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // When the user navigates to a different page, clear the typed query and any
  // open sub-flow. The modal stays open and the first run (mount) is skipped.
  useEffect(() => {
    if (!clearOnNavRef.current) {
      clearOnNavRef.current = true;
      return;
    }
    const hadFocus =
      inputRef.current != null && document.activeElement === inputRef.current;
    setQuery("");
    setHighlight(0);
    setSubStack([]);
    setInlineAnchorKey(null);
    if (!hadFocus) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [pathname]);

  // Keep the highlight in range as the filtered list shrinks.
  useEffect(() => {
    setHighlight((h) => (h >= totalHighlightCount ? 0 : h));
  }, [totalHighlightCount]);

  // Restore focus to wherever it was when the palette closes.
  useEffect(() => {
    if (open) return;
    const el = restoreFocusRef.current;
    if (!el || typeof el.focus !== "function") return;
    if (el.getAttribute?.("data-palette-no-refocus") != null) return;
    el.focus();
  }, [open]);

  // Escape closes the palette (or pops one sub-flow stage) from a WINDOW-level
  // listener so it works regardless of where focus sits.
  useEffect(() => {
    if (!open) return;
    const onWindowKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (inSubflow) popSubflow();
      else onClose();
    };
    window.addEventListener("keydown", onWindowKey);
    return () => window.removeEventListener("keydown", onWindowKey);
  // popSubflow is stable (useCallback with no deps); onClose is stable from
  // the provider (useCallback). Lint requires them in the array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inSubflow, onClose]);

  // BeakerSearch v2 (sub-flow framework, chunk 1). OPEN a sub-flow from a
  // command whose `subflow` factory is set.
  const openSubflow = useCallback((anchorKey: string, factory: () => PaletteSubflow) => {
    const sf = factory();
    const mode = resolveSubflowPresentation(sf, 1);
    setSubStack([sf]);
    setInlineAnchorKey(mode === "inline" ? anchorKey : null);
    setQuery("");
    setHighlight(0);
  }, []);

  // PICK a choice in the active stage.
  const pickSubItem = useCallback(
    (navItem: PaletteNavItem) => {
      if (!topSubflow || navItem.enabled === false) return;
      const next = topSubflow.onPick(navItem);
      if (next) {
        setSubStack((cur) => [...cur, next]);
        setInlineAnchorKey(null);
        setQuery("");
        setHighlight(0);
        return;
      }
      setSubStack([]);
      setInlineAnchorKey(null);
      onClose();
    },
    [topSubflow, onClose],
  );

  // POP one stage (Escape inside a flow, or the Back row).
  const popSubflow = useCallback(() => {
    setSubStack((cur) => cur.slice(0, -1));
    setInlineAnchorKey(null);
    setQuery("");
    setHighlight(0);
  }, []);

  const runItem = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item || !isPaletteItemEnabled(item)) return;
      if (item.kind === "command" && item.command.subflow) {
        openSubflow(paletteItemKey(item), item.command.subflow);
        return;
      }
      if (item.kind === "subpick") {
        pickSubItem(item.item);
        return;
      }
      onClose();
      runPaletteItem(item);
    },
    [onClose, openSubflow, pickSubItem],
  );

  // Move the highlight to the next RUNNABLE row, wrapping, skipping disabled
  // rows.
  const moveHighlight = useCallback(
    (dir: 1 | -1) => {
      if (totalHighlightCount === 0) return;
      let next = highlight;
      for (let step = 0; step < totalHighlightCount; step += 1) {
        next = (next + dir + totalHighlightCount) % totalHighlightCount;
        if (hasEscalation && next === 0) {
          setHighlight(next);
          return;
        }
        const flatIdx = hasEscalation ? next - 1 : next;
        if (flatIdx >= 0 && flatIdx < flat.length && isPaletteItemEnabled(flat[flatIdx])) {
          setHighlight(next);
          return;
        }
      }
    },
    [flat, highlight, hasEscalation, totalHighlightCount],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveHighlight(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveHighlight(-1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (
          inSubflow &&
          topSubflow?.onSubmitRaw &&
          query.trim() !== "" &&
          subItems.length === 0
        ) {
          const next = topSubflow.onSubmitRaw(query.trim());
          if (next) {
            setSubStack((cur) => [...cur, next]);
            setInlineAnchorKey(null);
            setQuery("");
            setHighlight(0);
          } else {
            setSubStack([]);
            setInlineAnchorKey(null);
            onClose();
          }
          return;
        }
        if (hasEscalation && highlight === 0 && onEscalate) {
          // Pass the stripped commandQuery so BeakerBot gets clean text
          // regardless of whether the user is in ">" command mode.
          onEscalate(commandQuery);
          return;
        }
        const flatIdx = hasEscalation ? highlight - 1 : highlight;
        runItem(flat[flatIdx]);
        return;
      }
    },
    [
      onClose,
      moveHighlight,
      runItem,
      flat,
      highlight,
      hasEscalation,
      onEscalate,
      query,
      commandQuery,
      inSubflow,
      topSubflow,
      subItems.length,
    ],
  );

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (!open) return;
    if (hasEscalation && highlight === 0) {
      const escRow = document.querySelector<HTMLElement>(
        "[data-cmd-escalation]",
      );
      if (escRow && typeof escRow.scrollIntoView === "function") {
        escRow.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    const list = listRef.current;
    if (!list) return;
    const flatIdx = hasEscalation ? highlight - 1 : highlight;
    const row = list.querySelector<HTMLElement>(
      `[data-cmd-index="${flatIdx}"]`,
    );
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [highlight, open, hasEscalation]);

  if (!mounted || !open) return null;

  const activeId = (() => {
    if (hasEscalation && highlight === 0) return `${baseId}-opt-escalation`;
    const flatIdx = hasEscalation ? highlight - 1 : highlight;
    return flat[flatIdx] != null
      ? `${baseId}-opt-${paletteItemKey(flat[flatIdx])}`
      : undefined;
  })();

  return createPortal(
    <>
      {/* Full-screen scrim. Clicking it closes the modal. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[78] bg-black/30 dark:bg-black/50"
      />

      {/* The centered modal surface. Wide (max 600px), near the top-third of
          the viewport so results land in the reading zone. When a spotlight is
          active and would occlude the surface, dodgeStyle overrides the
          centered position with an absolute corner placement. The transition
          covers both the normal size morph and the corner glide. */}
      <div
        ref={surfaceRef}
        role="dialog"
        aria-label="BeakerSearch"
        aria-modal="true"
        onKeyDown={onKeyDown}
        className="fixed inset-x-0 top-[12vh] z-[79] mx-auto flex w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-2xl"
        style={{
          // Grow when in Ask mode to give the conversation room.
          // ~0.4s cubic-bezier(.4,0,.2,1) matches the approved morph spec.
          maxHeight: "76vh",
          minHeight: askMode === "ask" ? "min(440px, 76vh)" : undefined,
          height: askMode === "ask" ? "min(440px, 76vh)" : undefined,
          // Fluid morph (fun pass, 2026-06-12). A springy ease-out
          // (cubic-bezier(.22,1,.36,1)) gives the size + corner glide a single
          // settling motion instead of a linear slide, and will-change promotes
          // the morphing properties to their own layer so the box reshapes
          // smoothly AS it travels on x / y rather than juddering. Same 0.4s
          // duration as the approved morph spec.
          willChange: "left, top, width, height, min-height, filter",
          // Soften the chat while the box reshapes + glides, then sharpen back.
          filter: morphing ? "blur(5px)" : "blur(0px)",
          transition:
            "min-height 0.4s cubic-bezier(.22,1,.36,1), height 0.4s cubic-bezier(.22,1,.36,1), left 0.4s cubic-bezier(.22,1,.36,1), top 0.4s cubic-bezier(.22,1,.36,1), width 0.4s cubic-bezier(.22,1,.36,1), inset 0.4s cubic-bezier(.22,1,.36,1), filter 0.32s cubic-bezier(.22,1,.36,1)",
          // Dodge override: replaces inset-x-0/top-[12vh] when a spotlight
          // target would be covered. null = centered (the CSS class wins).
          ...dodgeStyle,
        }}
      >
        {/* Ask mode body: the chat header + BeakerBotConversation.
            Fades in when askMode switches to "ask". */}
        {askMode === "ask" ? (
          <div
            key="ask-body"
            data-testid="beakersearch-ask-body"
            className="flex flex-1 flex-col overflow-hidden"
            style={{
              animation: "palette-fadein 0.2s cubic-bezier(.4,0,.2,1) both",
            }}
          >
            <style>{`
              @keyframes palette-fadein {
                from { opacity: 0; transform: translateY(5px); }
                to   { opacity: 1; transform: translateY(0); }
              }
            `}</style>
            <BeakerSearchAskHeader
              onBack={() => onExitAskMode?.()}
              onNewChat={() => useConversationStore.getState().clearConversation()}
            />
            <BeakerBotConversation className="flex-1" />
          </div>
        ) : (
          <div
            key="search-body"
            data-testid="beakersearch-search-body"
            className="flex flex-1 flex-col overflow-hidden"
          >
            {/* Search row: BeakerBot mark icon + input + CmdK hint. The icon
                is the brand anchor across the morph (same position in both
                search and ask modes). */}
            <div className="flex items-center gap-2.5 border-b border-border px-3 pb-2.5 pt-2.5">
              <BeakerBot
                pose="idle"
                animated={false}
                className="h-5 w-5 flex-none"
                ariaLabel="BeakerSearch"
              />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                placeholder={
                  inSubflow
                    ? topSubflow?.placeholder ?? "Pick one"
                    : "Search your work, or ask BeakerBot"
                }
                aria-label="BeakerSearch"
                role="combobox"
                aria-expanded="true"
                aria-controls={`${baseId}-listbox`}
                aria-activedescendant={activeId}
                autoComplete="off"
                spellCheck={false}
                className="flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-foreground-muted"
              />
              <kbd className="flex-none rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-foreground-muted">
                esc
              </kbd>
            </div>

            {/* Context cards. */}
            {subMode === "stack" ? null : (
              <>
                <ContextCard context={context} slim={typing} />
                <GenericContextCard card={contextCard} slim={typing} />
              </>
            )}

            {/* STACK mode breadcrumb + Back row. */}
            {subMode === "stack" && topSubflow ? (
              <button
                type="button"
                data-testid="beaker-subflow-back"
                onMouseDown={(e) => {
                  e.preventDefault();
                  popSubflow();
                }}
                className="flex w-full items-center gap-2 border-b border-border px-4 py-2 text-left text-meta font-medium text-foreground-muted hover:bg-surface-sunken"
              >
                <Icon name="caret" className="h-3.5 w-3.5 flex-none rotate-180" />
                <span className="truncate">
                  Back
                  <span className="ml-1.5 font-normal text-foreground-muted">
                    {topSubflow.title}
                  </span>
                </span>
              </button>
            ) : null}

            {/* Ask BeakerBot escalation row. Always present when onEscalate is
                wired; renders ABOVE the result listbox so it is always first. */}
            {onEscalate ? (
              <div
                id={`${baseId}-opt-escalation`}
                data-cmd-escalation="true"
                role="option"
                aria-selected={highlight === 0}
                aria-label={
                  commandQuery.trim()
                    ? `Ask BeakerBot about "${commandQuery.trim()}"`
                    : "Ask BeakerBot"
                }
                onMouseMove={() => setHighlight(0)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  // Pass the stripped commandQuery so BeakerBot receives clean
                  // text, not a raw ">..." string, regardless of mode.
                  onEscalate(commandQuery);
                }}
                className={`relative mx-2 mb-1 mt-1 flex cursor-pointer select-none items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  highlight === 0
                    ? "border-sky-300 bg-sky-50 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r before:bg-sky-500 dark:border-sky-700 dark:bg-sky-900/30"
                    : "border-border bg-surface-sunken hover:border-sky-200 hover:bg-sky-50/60 dark:hover:border-sky-800 dark:hover:bg-sky-900/20"
                }`}
              >
                <BeakerBot
                  pose="idle"
                  animated={false}
                  className="h-5 w-5 flex-none"
                  ariaLabel=""
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-foreground">
                    {commandQuery.trim()
                      ? <>Ask BeakerBot about <span className="font-bold text-sky-700 dark:text-sky-300">&ldquo;{commandQuery.trim()}&rdquo;</span></>
                      : "Ask BeakerBot"}
                  </span>
                  <span className="block truncate text-[11px] text-foreground-muted">
                    answer, analyze, plot, write, or guide you
                  </span>
                </span>
                <span className="flex flex-none items-center gap-1.5">
                  <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                    uses credit
                  </span>
                  <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-foreground-muted">
                    enter
                  </kbd>
                </span>
              </div>
            ) : null}

            {/* Results in a TWO-UP GRID so the surface reads wide not long,
                per the approved mockup section 1. The group label spans both
                columns. */}
            <div
              ref={listRef}
              id={`${baseId}-listbox`}
              role="listbox"
              aria-label="Commands, sequences, and results"
              className="min-h-0 flex-1 overflow-y-auto py-1"
            >
              {flat.length === 0 ? (
                <div className="px-4 py-8 text-center text-meta text-foreground-muted">
                  {inSubflow
                    ? "No matches. Press esc to go back."
                    : isCommandMode && commandQuery.trim() !== ""
                      ? "No commands match that filter."
                      : "Nothing matches that search."}
                </div>
              ) : (
                (() => {
                  let flatIndex = -1;
                  return viewGroups.map((g) => (
                    <div key={g.title}>
                      {/* Group label at full width above the grid. */}
                      <div className="flex items-center gap-2 px-4 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-normal text-foreground-muted">
                        <span>{g.title}</span>
                        {g.hint ? (
                          <span className="font-medium normal-case tracking-normal text-foreground-muted">
                            {g.hint}
                          </span>
                        ) : null}
                        <span
                          className="ml-1 h-px flex-1 bg-border/60"
                          aria-hidden="true"
                        />
                      </div>
                      {/* Two-column result grid. */}
                      <div className="grid grid-cols-2 gap-x-1 gap-y-0.5 px-2 pb-1">
                        {g.items.map((item) => {
                          flatIndex += 1;
                          const flatIdx = flatIndex;
                          const highlightIdx = hasEscalation ? flatIdx + 1 : flatIdx;
                          const isHighlighted = highlightIdx === highlight;
                          const enabled = isPaletteItemEnabled(item);
                          const key = paletteItemKey(item);
                          const parts = paletteRowParts(item);
                          return (
                            <div
                              key={key}
                              id={`${baseId}-opt-${key}`}
                              data-cmd-index={flatIdx}
                              data-cmd-id={key}
                              role="option"
                              aria-selected={isHighlighted}
                              aria-disabled={!enabled}
                              onMouseMove={() => {
                                if (enabled) setHighlight(highlightIdx);
                              }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                runItem(item);
                              }}
                              className={`relative flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 ${
                                isHighlighted
                                  ? "bg-sky-50 before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-r before:bg-sky-500 dark:bg-sky-900/30"
                                  : "hover:bg-surface-sunken"
                              } ${enabled ? "" : "cursor-default opacity-40"}`}
                            >
                              <span
                                className={`flex h-6 w-6 flex-none items-center justify-center rounded-md ${
                                  parts.tone ? CHIP_TONE[parts.tone] : CHIP_DEFAULT
                                }`}
                              >
                                <Icon name={parts.iconName} className="h-3.5 w-3.5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-body font-medium text-foreground">
                                  {parts.label}
                                </span>
                                {parts.sub ? (
                                  <span className="block truncate text-[11px] text-foreground-muted">
                                    {parts.sub}
                                  </span>
                                ) : null}
                              </span>
                              {parts.hint ? (
                                <span className="flex-none rounded-md border border-border px-1.5 py-0.5 text-[11px] font-semibold text-foreground-muted">
                                  {parts.hint}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()
              )}
            </div>

            {/* Footer. Nav key hints on the left; a faint "Type > for commands"
                hint on the right (per the approved mockup). */}
            <div className="flex items-center gap-3.5 border-t border-border px-4 py-2 text-[11px] text-foreground-muted">
              <span className="inline-flex items-center gap-1.5">
                <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-surface px-1 font-semibold text-foreground">
                  &uarr;
                </kbd>
                <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-surface px-1 font-semibold text-foreground">
                  &darr;
                </kbd>
                navigate
              </span>
              <span className="inline-flex items-center gap-1.5">
                <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-surface px-1 font-semibold text-foreground">
                  &crarr;
                </kbd>
                {inSubflow ? "pick" : "open"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-surface px-1 font-semibold text-foreground">
                  esc
                </kbd>
                {inSubflow ? "back" : "close"}
              </span>
              {/* In default mode: show the ">" discoverability hint.
                  In command mode: confirm the mode with a label. */}
              {isCommandMode ? (
                <span className="ml-auto text-[10.5px] font-semibold text-sky-600 dark:text-sky-400">
                  Commands
                </span>
              ) : (
                <span className="ml-auto text-[10.5px]">
                  Type{" "}
                  <kbd className="rounded border border-border bg-surface px-1 font-semibold">
                    &gt;
                  </kbd>{" "}
                  for commands
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* The riding BeakerBot. SIBLING of the surface so the morph blur never
          reaches it (it stays crisp while the box softens). Fixed-positioned to
          the surface's resolved top-edge coordinates, gliding on the same spring
          curve. While morphing it lifts + leans into travel; on arrival it plays
          a settle bob (riderLand keyframe in globals.css). Only present in Ask
          mode (the chat). It bobs while BeakerBot is thinking. */}
      {askMode === "ask" && riderPos ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[80]"
          style={{
            left: `${riderPos.left}px`,
            top: `${riderPos.top}px`,
            transform: "translateX(-50%)",
            willChange: "left, top",
            transition:
              "left 0.4s cubic-bezier(.22,1,.36,1), top 0.4s cubic-bezier(.22,1,.36,1)",
          }}
        >
          <div
            className={
              riderLanding && !morphing ? "beakersearch-rider-land" : undefined
            }
            style={{
              transformOrigin: "50% 90%",
              transition: "transform 0.4s cubic-bezier(.22,1,.36,1)",
              transform: morphing
                ? `translateY(-11px) rotate(${riderLean * 12}deg)`
                : "translateY(0) rotate(0deg)",
            }}
          >
            <BeakerBot
              pose={
                morphing && riderLean !== 0
                  ? "pointing"
                  : aiSending
                    ? "thinking"
                    : "idle"
              }
              direction={riderLean < 0 ? "left" : "right"}
              animated={aiSending || !morphing}
              className="h-11 w-11 flex-none drop-shadow-md"
              ariaLabel="BeakerBot"
            />
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}

export default CommandPalette;
