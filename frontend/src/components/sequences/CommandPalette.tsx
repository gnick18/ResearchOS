// sequence editor master. The Cmd-K COMMAND PALETTE, now the BeakerSearch v3
// FLOATING DOCK. It began as a calm, centered modal overlay; v3 turns it into a
// small persistent, NON-MODAL capsule the user drags anywhere, collapses to a
// pill, or tucks off a side into a peek tab. The page stays fully interactive
// while the dock is open (no scrim, no focus trap, no body-scroll lock), and a
// "Re-check page" action re-captures the page context on demand instead of the
// old open-only snapshot.
//
// It still owns nothing about WHAT a search result / command does. The command
// list is built upstream from the same wired handlers the rail and menus use,
// and each command's `run` points straight at that handler. This file renders
// the list, fuzzy-filters it, drives the keyboard / focus / a11y, AND owns the
// dock's geometry (drag, collapse, tuck, persistence) via the pure dock-state
// module. The re-check action itself lives in the provider (it re-sets the
// hovered key + captures selection + route); the dock only renders the button,
// wires its shortcut, and shows the captured-context card.
//
// Icons render through <Icon> from the verified icon library (no inline svg, the
// icon-guard enforces it); the BeakerBot mark renders via the component. Voice in
// comments and copy, no em-dashes, no en-dashes, no emojis, no mid-sentence
// colons.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import BeakerBot from "@/components/BeakerBot";
import { useBeakerBotPanel } from "@/lib/ai/panel-store";
import { sendToBeakerBot } from "@/components/ai/message-bridge";
import Tooltip from "@/components/Tooltip";
import type { SelectionKind } from "@/lib/sequences/inspector-context";
import {
  DOCK_HEIGHT_FALLBACK,
  DOCK_STORAGE_KEY,
  applyArrowKey,
  clampPosition,
  fromPersisted,
  initialDockState,
  nearestSide,
  openDock,
  parsePersisted,
  reclampForViewport,
  resizeWidth,
  toPersisted,
  toggleCollapsed,
  tuckDock,
  untuckDock,
  type DockSide,
  type DockState,
  type ResizeEdge,
  type Viewport,
} from "@/components/beaker-search/dock-state";
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
// cross-app index (debounced) into per-type object groups and jumps to a record
// by its deep-link href. The ranking brain is pure (global-source.ts); the
// palette only debounces, maps to PaletteGroups, and wires the run closures.
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
/** The default chip for commands / sequence-nav / artifacts / the search-all row
 *  (everything that is not a typed cross-app record). */
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
  /** The object type, when this row is a cross-app record, so the icon chip can
   *  carry a per-type hue (Tasks amber, Projects violet, Methods emerald,
   *  Sequences sky). Absent for commands / sequence-nav / artifacts, which keep
   *  the default sky chip. */
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
    // A cross-app object (global object search, chunk 2). Reuses the uniform row,
    // the entry carries its own icon + label + meta subline, and the right-side
    // hint reads "Open" like the artifact jump (Enter jumps to its home page).
    return {
      iconName: item.entry.iconName,
      label: item.entry.label,
      sub: item.entry.meta,
      hint: "Open",
      tone: item.entry.type,
    };
  }
  if (item.kind === "searchAll") {
    // The trailing handoff to the full faceted /search (global object search,
    // chunk 3). One row, the label echoes the live query and Enter hands that
    // query off to /search with all its filters.
    return {
      iconName: "search",
      label: `Search everything for "${item.query}"`,
      sub: "Open the full search with filters",
      hint: "Search",
    };
  }
  if (item.kind === "nav") {
    // A generic page entity / result (step 3, the per-page contract). The page
    // supplies the icon, label, detail, an optional per-type tone, and the run.
    return {
      iconName: item.item.iconName,
      label: item.item.label,
      sub: item.item.detail,
      hint: "Open",
      tone: item.item.tone,
    };
  }
  if (item.kind === "subpick") {
    // BeakerSearch v2 (sub-flow framework, chunk 1). A choice row inside an open
    // picker. The wrapped nav item carries the icon / label / detail / tone, and
    // the right-side hint reads "Pick" so the action voice matches the flow.
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

/** The "On this sequence" context card (empty query) or its slim one-line header
 *  (while typing). Display only, never a selectable row. Self-hides with no
 *  context. */
function ContextCard({
  context,
  slim,
}: {
  context: PaletteContext | undefined;
  slim: boolean;
}) {
  if (!context) return null;

  if (slim) {
    // One quiet line so the user keeps their bearings while the list below is
    // ranked matches.
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
 *  active page supplies (icon + title + meta + optional chips). A full card at
 *  rest, a slim one-line header while typing. Self-hides with no card. */
function GenericContextCard({
  card,
  slim,
}: {
  card: PaletteContextCard | undefined;
  slim: boolean;
}) {
  if (!card) return null;

  if (slim) {
    // While typing, the card collapses to one line, the title, the meta, and the
    // selection folded in so the user keeps their bearings.
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

/** The handle the dock publishes UP to the provider so its global Cmd/Ctrl+K
 *  handler can RESTORE a collapsed or tucked dock (expand / untuck) instead of
 *  closing it. The dock owns the collapsed / tucked sub-state; `collapsed` /
 *  `tucked` are the live flags and `expand` / `untuck` apply the matching
 *  dock-state helper. Published into the provider's `dockControlRef`. */
export interface DockControl {
  collapsed: boolean;
  tucked: boolean;
  expand: () => void;
  untuck: () => void;
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
  /** BeakerSearch website-wide (step 3), the GENERIC per-page contract a non-
   *  sequence page supplies. The page-agnostic context card, its ordered Suggested
   *  command ids + hint, and its navigable entity / result groups. Absent on the
   *  sequence editor (which uses the typed fields above). */
  contextCard?: PaletteContextCard;
  suggestedIds?: string[];
  suggestedHint?: string;
  navGroups?: PaletteNavGroup[];
  /** Query-aware interpretation rows (step 3 seam), e.g. "Go to <typed date>". */
  interpretQuery?: (query: string) => PaletteNavGroup[];
  /** The OTHER sequences in the open collection, to jump to. Default empty. */
  sequences?: SequenceNavItem[];
  /** The latest saved results for the open sequence, newest first. Default empty. */
  artifacts?: ArtifactNavItem[];
  /** The collection name, for the "Jump to a sequence" group hint. */
  collectionLabel?: string;
  /** BeakerSearch global object search, chunk 2. The flat cross-app index the
   *  palette ranks (debounced, 120 ms) into the per-type object groups. Default
   *  empty, so the sequence editor's own tests and any non-shell caller show no
   *  objects. */
  objectIndex?: GlobalIndexEntry[];
  /** The object type the current page hosts as its own entity, whose global group
   *  is suppressed (on-page de-dup). Null suppresses nothing. */
  activePageType?: GlobalObjectType | null;
  /** Jump to a cross-app object record (the provider pushes its deep-link href,
   *  closes the palette, and records it in the Recent-records MRU). Absent
   *  disables object navigation, so no object groups or recents render. */
  onNavigateObject?: (entry: GlobalIndexEntry) => void;
  /** BeakerSearch global object search, chunk 3. Hand the live query off to the
   *  full faceted /search (the provider pushes /search?keywords= + closes).
   *  Absent hides the trailing "Search everything" row (a non-shell caller). */
  onSearchEverything?: (query: string) => void;
  /** BeakerSearch global object search, chunk 4. The cross-app Recent-records MRU,
   *  already resolved to live entries in MRU order by the provider. Rendered only
   *  in the empty-query view. Default empty. */
  recentEntries?: GlobalIndexEntry[];
  /** BeakerSearch v3. The page context captured by the last "Re-check page"
   *  (route / pointer / selection), already display-ready. The dock shows this in
   *  the captured-context card so the bias is visible. Absent renders no card. */
  capturedContext?: CapturedContext;
  /** BeakerSearch v3. Re-capture the page context on demand. The provider re-sets
   *  the hovered key (so existing page consumers re-bias) and refreshes the
   *  captured-context card. Absent hides the "Re-check page" control. */
  onRecheck?: () => void;
  /** BeakerSearch v3. The keyboard shortcut that triggers re-check, shown on the
   *  button (e.g. "R"). The dock owns the key listener (plain "r" while floating
   *  and focus is parked); the provider supplies the re-check handler + label. */
  recheckShortcutLabel?: string;
  /** BeakerSearch v3. The provider's global Cmd/Ctrl+K handler RESTORES a
   *  collapsed or tucked dock (expand / untuck) instead of closing it. The dock
   *  owns that sub-state, so it publishes a small control handle (the live flags
   *  plus expand / untuck actions) into this ref for the provider to consult.
   *  Absent on non-shell callers (the editor's own tests), which keep the plain
   *  open / close toggle. */
  dockControlRef?: { current: DockControl | null };
  /** BeakerSearch v1 AI escalation. When present, shows the "Ask BeakerBot"
   *  row at the top of the palette (index 0 in the selection model). Absent on
   *  non-shell callers (the editor's own tests) that do not have the panel
   *  mounted, so the escalation row simply does not appear there. */
  onEscalate?: (query: string) => void;
}

/** The BeakerSearch v3 floating dock. Renders nothing when closed (the geometry
 *  is preserved across opens via localStorage). */
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
  activePageType = null,
  onNavigateObject,
  onSearchEverything,
  recentEntries = EMPTY_OBJECT_INDEX,
  capturedContext,
  onRecheck,
  recheckShortcutLabel,
  dockControlRef,
  onEscalate,
}: CommandPaletteProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  // BeakerSearch v2 (sub-flow framework, chunk 1). The open picker STACK. [] is
  // the root / normal palette; the top of the stack is the active picker stage.
  // `inlineAnchorKey` is the paletteItemKey of the command the INLINE picker hangs
  // under (option B, single-stage). Null while in STACK mode (option A, the pushed
  // breadcrumb view), which is how a multi-stage flow renders after a promotion.
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

  // BeakerSearch v3. The floating-dock geometry (position, collapsed, tucked,
  // side). The brain is the pure dock-state module; here we hold the live state,
  // hydrate it from localStorage once, persist on change, and re-clamp on resize.
  // `open` is the prop above; the dock-state `open` flag is unused on this side
  // (the provider owns open/close), so we keep it in sync only for completeness.
  const [dock, setDock] = useState<DockState>(() => initialDockState());
  const dockRef = useRef<HTMLDivElement | null>(null);
  const hydratedRef = useRef(false);
  const reduceMotionRef = useRef(false);
  // The latest dock state, read by the window-level arrow-key handler without
  // re-subscribing the listener on every geometry change.
  const dockStateRef = useRef(dock);
  dockStateRef.current = dock;

  const viewport = useCallback(
    (): Viewport => ({ width: window.innerWidth, height: window.innerHeight }),
    [],
  );

  // The measured live height of the dock, so the pure geometry can keep the full
  // footprint on screen and decide top / bottom hides. Falls back before mount.
  const dockHeight = useCallback(
    () => dockRef.current?.offsetHeight ?? DOCK_HEIGHT_FALLBACK,
    [],
  );

  // Hydrate the persisted geometry once on mount (open is never persisted).
  useEffect(() => {
    if (hydratedRef.current || typeof window === "undefined") return;
    hydratedRef.current = true;
    const persisted = parsePersisted(window.localStorage.getItem(DOCK_STORAGE_KEY));
    if (persisted) setDock((cur) => ({ ...fromPersisted(persisted), open: cur.open }));
    // matchMedia is absent in some test environments (jsdom), so guard it.
    reduceMotionRef.current =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
  }, []);

  // Persist the geometry whenever it changes (best-effort, never breaks the UI).
  useEffect(() => {
    if (!hydratedRef.current || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        DOCK_STORAGE_KEY,
        JSON.stringify(toPersisted(dock)),
      );
    } catch {
      // localStorage full or disabled; the in-memory geometry still applies.
    }
  }, [dock]);

  // On each open, ensure the dock is placed + untucked-if-it-was-closed-tucked is
  // NOT forced; reopening returns it where it was left (floating or tucked side),
  // per the spec. We only ensure it has a concrete position so the first open of
  // a fresh session lands at the default top-right.
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    setDock((cur) => {
      const placed = cur.x == null ? openDock(cur, viewport()) : cur;
      return { ...placed, open: true };
    });
  }, [open, viewport]);

  // Re-clamp into the viewport on resize so a shrunk window never strands the
  // dock off-screen, and a tucked dock stays parked at its side.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setDock((cur) => reclampForViewport(cur, viewport()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [viewport]);

  // The live "Hide here" hint side while dragging near an edge (null = not near).
  const [armedSide, setArmedSide] = useState<DockSide | null>(null);
  // De-dupe armedSide so a drag only sets state when the armed wall actually
  // changes (most moves do not), keeping pointermove free of React work.
  const armedRef = useRef<DockSide | null>(null);

  // BeakerSearch v3 performance. Drag and resize are driven IMPERATIVELY while
  // the pointer is down (the element's style is mutated directly, no per-move
  // setState, no localStorage write, no offsetHeight reflow). React state is
  // committed once on release. `gesture` marks an active drag / resize so the
  // render reads the live geometry ref and disables the transition; the height
  // is measured once at gesture start instead of every move.
  const [gesture, setGesture] = useState<null | "drag" | "resize" | "settling">(null);
  const liveGeomRef = useRef<{ x: number; y: number; width: number } | null>(null);
  const gestureHeightRef = useRef(DOCK_HEIGHT_FALLBACK);
  // Bumped to cancel a pending bounce-back settle when a new gesture begins.
  const settleTokenRef = useRef(0);

  const typing = query.trim() !== "";

  // BeakerSearch global object search, chunk 2. The cross-app object ranking is
  // DEBOUNCED (120 ms) so each keystroke does not re-rank the whole index; the
  // page's own commands / sequences / artifacts stay instant on `query`. The
  // ranking, the type weights, the caps, and the on-page de-dup all live in the
  // pure rankGlobalEntries; here we only debounce, stamp `now` for the recency
  // boost, map the ranked entries to PaletteGroups, and wire each row's jump to
  // its deep-link href. Empty query yields no object groups (rankGlobalEntries
  // returns [] then; the Recent-records MRU is chunk 4). Absent onNavigateObject
  // (a non-shell caller, e.g. the editor's own tests) renders no object groups.
  const debouncedQuery = useDebouncedValue(query, 120);
  const objectGroups = useMemo<PaletteGroup[]>(() => {
    if (!onNavigateObject) return EMPTY_PALETTE_GROUPS;
    const ranked = rankGlobalEntries(objectIndex, debouncedQuery, {
      now: Date.now(),
      activePageType,
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
  }, [objectIndex, debouncedQuery, activePageType, onNavigateObject]);

  // BeakerSearch global object search, chunk 4. The cross-app Recent-records MRU,
  // built into object PaletteItems through the SAME jump path as the ranked
  // object rows, so re-opening a recent both navigates and re-promotes it in the
  // MRU. The entries are already resolved + ordered by the provider; the palette
  // only wires the run closure. Shown in the empty-query view (buildPalette uses
  // recentRecords only when the query is empty). Absent navigate handler => none.
  const recentRecords = useMemo<PaletteItem[]>(() => {
    if (!onNavigateObject || recentEntries.length === 0) return EMPTY_RECENT_RECORDS;
    return recentEntries.map((entry) => ({
      kind: "object" as const,
      entry,
      onRun: () => onNavigateObject(entry),
    }));
  }, [recentEntries, onNavigateObject]);

  // Grouped + flat heterogeneous results (commands + sequences + results + the
  // global object groups) for the current query and selection context. The
  // trailing "Search everything" handoff row (chunk 3) is appended LAST, after
  // the top-hit lead sort inside buildPaletteResultsForQuery, so it always sits
  // at the very bottom as the escape hatch to the full faceted /search. It shows
  // only while typing and only when a handler is wired (a non-shell caller omits
  // it). The trimmed query rides into both the label and the /search handoff.
  const groups = useMemo(() => {
    const base = buildPaletteResultsForQuery(
      {
        commands,
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
    commands,
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

  // BeakerSearch v2 (sub-flow framework, chunk 1). The active picker stage (top of
  // the stack) and the chosen presentation. INLINE mode = the stack holds exactly
  // one stage AND it was opened under a command row (inlineAnchorKey set), so the
  // resting page stays visible and the picker splices in under that command (option
  // B). STACK mode = a deeper / promoted / explicit-stack flow, the list is
  // replaced by the picker under a breadcrumb + Back (option A).
  const topSubflow = subStack.length > 0 ? subStack[subStack.length - 1] : null;
  const inSubflow = topSubflow != null;
  const subMode: "inline" | "stack" | null = !topSubflow
    ? null
    : subStack.length === 1 && inlineAnchorKey != null
      ? "inline"
      : "stack";

  // The picker rows for the active stage, fuzzy-filtered by the live query and
  // mapped to `subpick` items whose onPick runs the stage's onPick for that choice
  // (the palette, not the row, decides whether that completes or chains).
  const subItems = useMemo<PaletteItem[]>(() => {
    if (!topSubflow) return [];
    return filterSubflowItems(topSubflow.items, query).map((navItem) => ({
      kind: "subpick" as const,
      item: navItem,
      // The actual onPick wiring is closed over in pickSubItem below, which the
      // row's run path routes to. Here we only carry the choice; the real call is
      // made by runItem -> pickSubItem so the stack transitions stay in one place.
      onPick: () => {},
    }));
  }, [topSubflow, query]);

  // The view the palette renders, derived (the v1 `groups` path is never mutated):
  //   - ROOT (no sub-flow): exactly v1.
  //   - INLINE: the RESTING page groups (built at empty query so nothing else
  //     moves) with the filtered picker spliced in right after the anchor command's
  //     row, under the sub-flow title; the rest of the page stays visible.
  //   - STACK: ONLY the picker rows, under the breadcrumb title.
  const restingGroups = useMemo<PaletteGroup[]>(() => {
    if (subMode !== "inline") return EMPTY_PALETTE_GROUPS;
    return buildPaletteResultsForQuery(
      {
        commands,
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
    commands,
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
    // INLINE: splice the picker group in immediately after the group that holds
    // the anchor command's row. If the anchor is not found (it should always be,
    // it is a resting command), fall back to leading with the picker.
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

  // BeakerSearch v1 AI escalation flags. Declared here, immediately after flat,
  // so all downstream code (useEffects, callbacks) can reference them safely.
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
    // BeakerSearch v2, a fresh open always starts at the root (no open picker).
    setSubStack([]);
    setInlineAnchorKey(null);
    // Focus after paint so the autofocus lands on the freshly mounted input.
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // When the user navigates to a different page, clear the typed query and any
  // open sub-flow so the dock presents a fresh list for the new page. The dock
  // stays open and its geometry is unchanged. The first run of this effect is
  // the mount call (skipped via clearOnNavRef); only genuine route changes after
  // mount trigger the clear. Focus stays on the input when it already held it.
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

  // Keep the highlight in range as the filtered list shrinks; default to the top
  // result (index 0, the escalation row when present, else the first flat item)
  // whenever the query changes.
  useEffect(() => {
    setHighlight((h) => (h >= totalHighlightCount ? 0 : h));
  }, [totalHighlightCount]);

  // Restore focus to wherever it was when the palette closes.
  useEffect(() => {
    if (open) return;
    const el = restoreFocusRef.current;
    if (!el || typeof el.focus !== "function") return;
    // Openers that carry a hover/focus tooltip + focus ring (e.g. the
    // BeakerSearch pill) opt out: programmatically refocusing them after close
    // pops the tooltip and ring unbidden while the user's pointer is elsewhere.
    // They are persistent, self-labeled chrome, so letting focus fall to the
    // body is fine. Triggers reached via Cmd-K (focus was a field/body) still
    // get focus restored normally.
    if (el.getAttribute?.("data-palette-no-refocus") != null) return;
    el.focus();
  }, [open]);

  // BeakerSearch v2 (sub-flow framework, chunk 1). OPEN a sub-flow from a command
  // whose `subflow` factory is set. The picker does NOT close the palette; it
  // pushes a stage and resets the query so the input now filters the picker. The
  // HYBRID rule chooses the presentation, a single-stage flow (or one inferred
  // inline) anchors UNDER the command row (INLINE, option B); an explicit-stack
  // flow opens as the pushed breadcrumb view (STACK, option A).
  const openSubflow = useCallback((anchorKey: string, factory: () => PaletteSubflow) => {
    const sf = factory();
    const mode = resolveSubflowPresentation(sf, 1);
    setSubStack([sf]);
    setInlineAnchorKey(mode === "inline" ? anchorKey : null);
    setQuery("");
    setHighlight(0);
  }, []);

  // PICK a choice in the active stage. The stage's onPick returns void to COMPLETE
  // (the handler ran, the palette closes + the stack clears) or another
  // PaletteSubflow to CHAIN. A chain PROMOTES the flow to the STACK (a flow that
  // started inline becomes a stack when it nests), clears the inline anchor, and
  // resets query + highlight for the next stage.
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
      // COMPLETE. The handler already ran inside onPick; close + clear the stack.
      setSubStack([]);
      setInlineAnchorKey(null);
      onClose();
    },
    [topSubflow, onClose],
  );

  // POP one stage (Escape inside a flow, or the Back row). Dropping the last stage
  // returns to the root; a deeper pop resets query + highlight for the now-top
  // stage. The inline anchor only matters for the single-stage inline case, so a
  // pop back to a single stage cannot be inline (a popped flow is always a stack),
  // we clear the anchor so the remaining stage renders as the stack.
  const popSubflow = useCallback(() => {
    setSubStack((cur) => cur.slice(0, -1));
    setInlineAnchorKey(null);
    setQuery("");
    setHighlight(0);
  }, []);

  const runItem = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item || !isPaletteItemEnabled(item)) return;
      // (1) A command carrying a sub-flow OPENS the picker instead of running a
      // terminal handler, and the palette stays open.
      if (item.kind === "command" && item.command.subflow) {
        openSubflow(paletteItemKey(item), item.command.subflow);
        return;
      }
      // (2) A picker choice row routes to pickSubItem, which decides complete vs
      // chain. It NEVER calls onClose itself (pickSubItem owns that on complete).
      if (item.kind === "subpick") {
        pickSubItem(item.item);
        return;
      }
      // (3) Everything else is terminal, today's behavior, close then run.
      onClose();
      // Run AFTER closing so an action that opens its own dialog (or switches the
      // open sequence) does not fight the palette for focus.
      runPaletteItem(item);
    },
    [onClose, openSubflow, pickSubItem],
  );

  // Move the highlight to the next RUNNABLE row, wrapping, skipping disabled
  // rows. The escalation row (index 0) is always enabled. Returns the input
  // index unchanged when nothing is runnable.
  const moveHighlight = useCallback(
    (dir: 1 | -1) => {
      if (totalHighlightCount === 0) return;
      let next = highlight;
      for (let step = 0; step < totalHighlightCount; step += 1) {
        next = (next + dir + totalHighlightCount) % totalHighlightCount;
        // Escalation row (index 0) is always runnable when present.
        if (hasEscalation && next === 0) {
          setHighlight(next);
          return;
        }
        // Flat items: their highlight index is their flat-array index + 1.
        const flatIdx = hasEscalation ? next - 1 : next;
        if (flatIdx >= 0 && flatIdx < flat.length && isPaletteItemEnabled(flat[flatIdx])) {
          setHighlight(next);
          return;
        }
      }
    },
    [flat, highlight, hasEscalation, totalHighlightCount],
  );

  // Escape closes the palette (or pops one sub-flow stage) from a WINDOW-level
  // listener so it works regardless of where focus sits. The dialog-level
  // onKeyDown only fires when focus is inside the palette, and focus can land
  // elsewhere (e.g. a click on the scrim/body, or the open-focus rAF not
  // landing), which previously left Escape dead. A first Escape inside a flow
  // POPS one stage; at the root it closes. Keydown bubbles to window, so the
  // existing dialog-targeted tests still exercise this path.
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
  }, [open, inSubflow, popSubflow, onClose]);

  // Escape is handled by the window-level listener above so it works no matter
  // where focus sits. It is intentionally NOT handled here to avoid
  // double-firing (the dialog keydown also bubbles to window).
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
        // BeakerSearch v2, when a stage has a free-text completion and the query
        // matches no picker row, Enter submits the raw query (a new category name,
        // a date) instead of a dead no-op.
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
        // BeakerSearch v1 AI escalation. When the escalation row is highlighted
        // (index 0), Enter escalates to BeakerBot.
        if (hasEscalation && highlight === 0 && onEscalate) {
          onEscalate(query);
          return;
        }
        // For flat items the highlight index is offset by 1 when escalation is present.
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
      inSubflow,
      topSubflow,
      subItems.length,
    ],
  );

  // BeakerSearch v3. Dragging the dock by its header. While the pointer is down
  // the dock tracks the cursor 1:1 with NO clamping (so it never stalls near a
  // wall) and NO React state (imperative style writes only). The hide arms only
  // when the MOUSE CURSOR reaches a screen corner, then hides to that left /
  // right side; positioning near an edge no longer snaps. State commits once on
  // release (clamped back on screen, or tucked if a corner was armed).
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  // How close the MOUSE CURSOR must get to a screen edge to arm a hide to that
  // side (top / bottom / left / right). Driven by the cursor, not the dock's own
  // edge, so positioning mid-screen never snaps; pushing the cursor to any wall
  // hides toward it (the nearest wall wins in a corner).
  const EDGE_HIT = 26;
  const edgeArm = useCallback((cx: number, cy: number, vp: Viewport): DockSide | null => {
    const dl = cx;
    const dr = vp.width - cx;
    const dt = cy;
    const db = vp.height - cy;
    const min = Math.min(dl, dr, dt, db);
    if (min > EDGE_HIT) return null;
    if (min === dt) return "top";
    if (min === db) return "bottom";
    if (min === dl) return "left";
    return "right";
  }, []);

  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    // Ignore drags that start on a header control (close / collapse / hide).
    if ((e.target as HTMLElement).closest("[data-dock-act]")) return;
    const cur = dockStateRef.current;
    if (cur.tucked) return; // tucked = use the tab, not a drag.
    const el = dockRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = cur.x ?? rect.left;
    const y = cur.y ?? rect.top;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: x,
      originY: y,
    };
    // Cancel any in-flight bounce-back settle so it cannot finalize mid-drag.
    settleTokenRef.current++;
    // Measure height ONCE so pointermove never forces a layout reflow.
    gestureHeightRef.current = el.offsetHeight || DOCK_HEIGHT_FALLBACK;
    liveGeomRef.current = { x, y, width: cur.width };
    armedRef.current = null;
    // Kill any CSS transition for the duration of the drag so imperative
    // left / top changes are instant, never eased (the "won't keep up" feel).
    el.style.transition = "none";
    // Capture on the header (the element with the move/up listeners) so a fast
    // drag that outruns the dock keeps delivering events instead of stalling.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setGesture("drag");
  }, []);

  const onHeaderPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const el = dockRef.current;
      if (!el) return;
      const vp: Viewport = { width: window.innerWidth, height: window.innerHeight };
      const w = dockStateRef.current.width;
      // Track the cursor exactly, no clamp, so the dock follows 1:1 everywhere.
      const x = d.originX + (e.clientX - d.startX);
      const y = d.originY + (e.clientY - d.startY);
      liveGeomRef.current = { x, y, width: w };
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      const armed = edgeArm(e.clientX, e.clientY, vp);
      if (armed !== armedRef.current) {
        armedRef.current = armed;
        setArmedSide(armed);
      }
    },
    [edgeArm],
  );

  const onHeaderPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      dragRef.current = null;
      const header = e.currentTarget as HTMLElement;
      if (header.hasPointerCapture(e.pointerId)) header.releasePointerCapture(e.pointerId);
      const el = dockRef.current;
      if (el) el.style.transition = ""; // restore the class-based settle transition
      const vp: Viewport = { width: window.innerWidth, height: window.innerHeight };
      const h = gestureHeightRef.current;
      const w = dockStateRef.current.width;
      const x = d.originX + (e.clientX - d.startX);
      const y = d.originY + (e.clientY - d.startY);
      const armed = edgeArm(e.clientX, e.clientY, vp);
      armedRef.current = null;
      setArmedSide(null);
      if (armed) {
        liveGeomRef.current = null;
        setGesture(null);
        setDock((cur) => tuckDock(cur, armed, vp, h));
        return;
      }
      const target = clampPosition(x, y, vp, 44, h, w);
      const offScreen = target.x !== x || target.y !== y;
      if (!offScreen || reduceMotionRef.current || !el) {
        // Already fully in view (or reduced motion): commit with no animation.
        liveGeomRef.current = null;
        setGesture(null);
        setDock((cur) => ({ ...cur, x: target.x, y: target.y, tucked: false }));
        return;
      }
      // Gentle bounce back into full view. Animate imperatively from the dropped
      // (partially off-screen) position to the clamped target with an ease-out
      // overshoot, then commit state once the settle finishes. A re-render during
      // the settle reads the live ref (= target) so it never snaps.
      const token = ++settleTokenRef.current;
      liveGeomRef.current = { x: target.x, y: target.y, width: w };
      setGesture("settling");
      el.style.transition =
        "left 420ms cubic-bezier(.34,1.45,.5,1), top 420ms cubic-bezier(.34,1.45,.5,1)";
      void el.offsetWidth; // lock in the start position with the transition armed
      el.style.left = `${target.x}px`;
      el.style.top = `${target.y}px`;
      const finalize = () => {
        if (settleTokenRef.current !== token) return; // superseded by a new gesture
        settleTokenRef.current++;
        el.style.transition = "";
        liveGeomRef.current = null;
        setGesture(null);
        setDock((cur) => ({ ...cur, x: target.x, y: target.y, tucked: false }));
      };
      el.addEventListener("transitionend", finalize, { once: true });
      window.setTimeout(finalize, 460);
    },
    [edgeArm],
  );

  // Header control actions.
  const doTuck = useCallback(() => {
    const vp: Viewport = { width: window.innerWidth, height: window.innerHeight };
    const h = dockHeight();
    setDock((cur) => tuckDock(cur, nearestSide(cur, vp, h), vp, h));
  }, [dockHeight]);
  const doUntuck = useCallback(() => {
    const vp: Viewport = { width: window.innerWidth, height: window.innerHeight };
    setDock((cur) => untuckDock(cur, vp, dockHeight()));
  }, [dockHeight]);
  const doCollapse = useCallback(() => setDock((cur) => toggleCollapsed(cur)), []);
  // Expand a collapsed dock (a no-op when already expanded). Distinct from
  // doCollapse's toggle so the provider's Cmd/Ctrl+K restore can only ever open
  // the pill, never re-collapse a visible dock.
  const doExpand = useCallback(
    () => setDock((cur) => (cur.collapsed ? toggleCollapsed(cur) : cur)),
    [],
  );

  // BeakerSearch v3. Publish the dock's collapsed / tucked sub-state plus the
  // expand / untuck actions UP to the provider so its global Cmd/Ctrl+K handler
  // can RESTORE a collapsed or tucked dock instead of closing it. The provider
  // owns open / close; the dock owns this sub-state, and this ref is the seam
  // between them. Republished whenever the flags change; cleared on unmount.
  useEffect(() => {
    if (!dockControlRef) return;
    dockControlRef.current = {
      collapsed: dock.collapsed,
      tucked: dock.tucked,
      expand: doExpand,
      untuck: doUntuck,
    };
    return () => {
      dockControlRef.current = null;
    };
  }, [dockControlRef, dock.collapsed, dock.tucked, doExpand, doUntuck]);

  // BeakerSearch v3. Width resize by dragging the left or right edge. The right
  // edge grows the width with x fixed; the left edge moves x while pinning the
  // right side. Width is clamped to [MIN, MAX] and to the viewport in the pure
  // resizeWidth. Height stays content-driven (up to max-h), so only width moves.
  const resizeRef = useRef<{ pointerId: number; edge: ResizeEdge } | null>(null);
  const onResizePointerDown = useCallback(
    (edge: ResizeEdge) => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const el = dockRef.current;
      const cur = dockStateRef.current;
      const rect = el?.getBoundingClientRect();
      settleTokenRef.current++; // cancel any in-flight bounce-back settle
      resizeRef.current = { pointerId: e.pointerId, edge };
      liveGeomRef.current = {
        x: cur.x ?? rect?.left ?? 0,
        y: cur.y ?? rect?.top ?? 0,
        width: cur.width,
      };
      if (el) el.style.transition = "none";
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setGesture("resize");
    },
    [],
  );
  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r || r.pointerId !== e.pointerId) return;
    const el = dockRef.current;
    if (!el) return;
    const vp: Viewport = { width: window.innerWidth, height: window.innerHeight };
    // resizeWidth is absolute (pointer-based), so the frozen start state is the
    // correct anchor for every move; no per-move setState.
    const nz = resizeWidth(dockStateRef.current, r.edge, e.clientX, vp);
    const live = liveGeomRef.current;
    liveGeomRef.current = { x: nz.x, y: live?.y ?? (dockStateRef.current.y ?? 0), width: nz.width };
    el.style.left = `${nz.x}px`;
    el.style.width = `${nz.width}px`;
  }, []);
  const onResizePointerUp = useCallback((e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r || r.pointerId !== e.pointerId) return;
    resizeRef.current = null;
    const handle = e.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    const el = dockRef.current;
    if (el) el.style.transition = "";
    const vp: Viewport = { width: window.innerWidth, height: window.innerHeight };
    const nz = resizeWidth(dockStateRef.current, r.edge, e.clientX, vp);
    liveGeomRef.current = null;
    setGesture(null);
    setDock((cur) => ({ ...cur, x: nz.x, width: nz.width }));
  }, []);

  // BeakerSearch v3. Arrow keys hide the dock to a wall, or pull it back from
  // one. They act ONLY when focus is "parked" on nothing focusable (the document
  // body, after clicking empty page space). If focus is in the search input, the
  // dock chrome, or ANY page widget, that target keeps its own arrow keys, so we
  // never hijack the result-list Up / Down navigation, the search field, or a
  // page's own arrow handling (the sequence editor, calendar, and so on). A
  // floating dock hides toward the arrow; a tucked dock returns on the arrow
  // pointing away from the wall it sits on.
  useEffect(() => {
    if (!open) return;
    const onArrow = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (!e.key.startsWith("Arrow")) return;
      const ae = document.activeElement;
      const parked =
        !ae || ae === document.body || ae === document.documentElement;
      if (!parked) return;
      const vp: Viewport = { width: window.innerWidth, height: window.innerHeight };
      const next = applyArrowKey(dockStateRef.current, e.key, vp, dockHeight());
      if (next) {
        e.preventDefault();
        setDock(next);
      }
    };
    window.addEventListener("keydown", onArrow);
    return () => window.removeEventListener("keydown", onArrow);
  }, [open, dockHeight]);

  // BeakerSearch v3. Plain "r" re-checks the page, but only while the dock is
  // open AND floating (not tucked, not closed) AND focus is parked on nothing.
  // Same guard as the arrow keys, so typing "r" in the search box or in a page
  // widget is never stolen; a tucked dock has nothing to re-check into view.
  useEffect(() => {
    if (!open || !onRecheck) return;
    const onR = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "r") return;
      if (dockStateRef.current.tucked) return;
      const ae = document.activeElement;
      const parked =
        !ae || ae === document.body || ae === document.documentElement;
      if (!parked) return;
      e.preventDefault();
      onRecheck();
    };
    window.addEventListener("keydown", onR);
    return () => window.removeEventListener("keydown", onR);
  }, [open, onRecheck]);

  // Keep the highlighted row scrolled into view as Up / Down walk past the fold.
  // The escalation row (index 0 when present) carries data-cmd-escalation; flat
  // items carry data-cmd-index with their flat-array index (adjusted for offset).
  useEffect(() => {
    if (!open) return;
    // Escalation row is outside the listbox, scroll the dock container instead.
    if (hasEscalation && highlight === 0) {
      const escRow = dockRef.current?.querySelector<HTMLElement>(
        "[data-cmd-escalation]",
      );
      if (escRow && typeof escRow.scrollIntoView === "function") {
        escRow.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    const list = listRef.current;
    if (!list) return;
    // Flat item index is highlight - 1 when escalation is present.
    const flatIdx = hasEscalation ? highlight - 1 : highlight;
    const row = list.querySelector<HTMLElement>(
      `[data-cmd-index="${flatIdx}"]`,
    );
    // scrollIntoView is absent in some test environments (jsdom), so guard it.
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [highlight, open, hasEscalation]);

  if (!mounted || !open) return null;

  // When the escalation row is highlighted (index 0 with onEscalate present),
  // point aria-activedescendant at the escalation row element. For flat items,
  // offset the flat index by the escalation slot when escalation is present.
  const activeId = (() => {
    if (hasEscalation && highlight === 0) return `${baseId}-opt-escalation`;
    const flatIdx = hasEscalation ? highlight - 1 : highlight;
    return flat[flatIdx] != null
      ? `${baseId}-opt-${paletteItemKey(flat[flatIdx])}`
      : undefined;
  })();

  // BeakerSearch v3 geometry, resolved for render. The dock is fixed-position at
  // (x, y); tucked slides it off `side` via a transform leaving the peek tab;
  // collapsed hides everything but the header pill. The transform keeps the
  // resting position so untucking returns it at the same size.
  // During an active gesture the live geometry ref is the source of truth (the
  // pointer handlers mutate the element imperatively); a re-render mid-gesture
  // reads it so the position never snaps back. Otherwise read committed state.
  const live = gesture ? liveGeomRef.current : null;
  const left = live ? live.x : dock.x ?? 0;
  const top = live ? live.y : dock.y ?? 0;
  const renderWidth = live ? live.width : dock.width;
  const TUCK_TRANSFORM: Record<DockSide, string> = {
    right: "translateX(calc(100% + 24px))",
    left: "translateX(calc(-100% - 24px))",
    bottom: "translateY(calc(100% + 24px))",
    top: "translateY(calc(-100% - 24px))",
  };
  const tuckTransform = dock.tucked ? TUCK_TRANSFORM[dock.side] : undefined;
  // The animated chrome (a live drag / resize tracks the pointer with no
  // transition; tuck / untuck / collapse animate, unless reduced motion).
  const dragging = gesture === "drag";
  const transitionClass =
    gesture || reduceMotionRef.current
      ? ""
      : "transition-[transform,left,top] duration-300 ease-out motion-reduce:transition-none";
  // While a drag is armed against a wall, the dock pulses a ring on that edge as
  // the "let go and I will hide here" cue (static ring under reduced motion).
  const armedRingClass = armedSide
    ? "ring-2 ring-brand-action animate-pulse motion-reduce:animate-none"
    : "";
  // Which edge the hide button would tuck to (the nearest side), for its glyph +
  // tooltip. Computed from the live position against the current viewport.
  const hideSide: DockSide = nearestSide(
    dock,
    mounted
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: 0, height: 0 },
    dockHeight(),
  );

  return createPortal(
    <>
      {/* Edge hide targets, shown only while dragging. Moving the cursor to any
          screen edge hides the dock to that side; the armed edge pulses as the
          "let go and I hide" cue. Pointer-inert so they never block the page. */}
      {dragging ? (
        <>
          <div
            aria-hidden="true"
            className={`pointer-events-none fixed inset-y-0 left-0 z-[78] w-2 bg-brand-action transition-opacity ${
              armedSide === "left" ? "opacity-90 animate-pulse motion-reduce:animate-none" : "opacity-20"
            }`}
          />
          <div
            aria-hidden="true"
            className={`pointer-events-none fixed inset-y-0 right-0 z-[78] w-2 bg-brand-action transition-opacity ${
              armedSide === "right" ? "opacity-90 animate-pulse motion-reduce:animate-none" : "opacity-20"
            }`}
          />
          <div
            aria-hidden="true"
            className={`pointer-events-none fixed inset-x-0 top-0 z-[78] h-2 bg-brand-action transition-opacity ${
              armedSide === "top" ? "opacity-90 animate-pulse motion-reduce:animate-none" : "opacity-20"
            }`}
          />
          <div
            aria-hidden="true"
            className={`pointer-events-none fixed inset-x-0 bottom-0 z-[78] h-2 bg-brand-action transition-opacity ${
              armedSide === "bottom" ? "opacity-90 animate-pulse motion-reduce:animate-none" : "opacity-20"
            }`}
          />
        </>
      ) : null}

      {/* The peek tab, shown only while tucked. Clicking it pulls the dock back
          in at its same size. Left / right render a vertical wordmark, top /
          bottom a horizontal one. */}
      {dock.tucked
        ? (() => {
            const vertical = dock.side === "left" || dock.side === "right";
            const posClass: Record<DockSide, string> = {
              right: "right-0 top-1/2 -translate-y-1/2 flex-col px-1.5 py-3 rounded-l-xl border-r-0",
              left: "left-0 top-1/2 -translate-y-1/2 flex-col px-1.5 py-3 rounded-r-xl border-l-0",
              top: "top-0 left-1/2 -translate-x-1/2 flex-row px-3 py-1.5 rounded-b-xl border-t-0",
              bottom: "bottom-0 left-1/2 -translate-x-1/2 flex-row px-3 py-1.5 rounded-t-xl border-b-0",
            };
            const tipPlacement: Record<DockSide, "left" | "right" | "top" | "bottom"> = {
              right: "left",
              left: "right",
              top: "bottom",
              bottom: "top",
            };
            return (
              <Tooltip label="Show BeakerSearch" placement={tipPlacement[dock.side]}>
                <button
                  type="button"
                  onClick={doUntuck}
                  aria-label="Show BeakerSearch"
                  className={`fixed z-[79] flex items-center gap-2 border border-border bg-surface-raised shadow-2xl hover:border-brand-action ${posClass[dock.side]}`}
                >
                  <BeakerBot pose="idle" animated={false} className="h-4 w-4 flex-none" ariaLabel="" />
                  <span
                    className="text-[11px] font-extrabold tracking-wide text-foreground"
                    style={
                      vertical
                        ? {
                            writingMode: "vertical-rl",
                            transform: dock.side === "left" ? "rotate(180deg)" : undefined,
                          }
                        : undefined
                    }
                  >
                    BeakerSearch
                  </span>
                </button>
              </Tooltip>
            );
          })()
        : null}

      {/* The one dock. Non-modal: role="dialog" WITHOUT aria-modal, so it is a
          labeled region the page can ignore; there is no scrim and no focus
          trap, the page stays fully interactive while it is open. */}
      <div
        ref={dockRef}
        role="dialog"
        aria-label="BeakerSearch"
        onKeyDown={onKeyDown}
        style={{
          left: `${left}px`,
          top: `${top}px`,
          width: `${renderWidth}px`,
          transform: tuckTransform,
        }}
        className={`fixed z-[79] flex max-h-[80vh] flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-2xl ${transitionClass} ${armedRingClass}`}
      >
        {/* Width resize handles on the left and right edges. Thin grab strips
            (cursor ew-resize) that widen the dock; the rest of the header still
            drags it. Hidden while collapsed or tucked. They sit above the body
            and stopPropagation so a resize never starts a move. */}
        {!dock.collapsed && !dock.tucked ? (
          <>
            <div
              aria-hidden="true"
              onPointerDown={onResizePointerDown("left")}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              onPointerCancel={onResizePointerUp}
              className="absolute left-0 top-0 z-[82] h-full w-1.5 cursor-ew-resize hover:bg-brand-action/20"
            />
            <div
              aria-hidden="true"
              onPointerDown={onResizePointerDown("right")}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              onPointerCancel={onResizePointerUp}
              className="absolute right-0 top-0 z-[82] h-full w-1.5 cursor-ew-resize hover:bg-brand-action/20"
            />
          </>
        ) : null}
        {/* Dock header. The drag handle (whole header), the BeakerBot mark +
            wordmark, and the control cluster (hide-to-edge, collapse, close). A
            collapsed dock shows only this header; clicking it re-expands. */}
        <div
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
          onClick={(e) => {
            // Ignore clicks that land on a header control (collapse / tuck /
            // close); each owns its own onClick. Without this guard the bubbled
            // click double-toggles collapse, so the chevron's expand is undone in
            // the same event and the button looks dead. Clicking the pill body
            // (anywhere not a control) still expands.
            if ((e.target as HTMLElement).closest("[data-dock-act]")) return;
            if (dock.collapsed) setDock((cur) => toggleCollapsed(cur));
          }}
          className={`flex select-none items-center gap-2 px-3 py-2 ${
            dock.collapsed ? "" : "border-b border-border"
          } ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        >
          <BeakerBot
            pose="idle"
            animated={false}
            className="h-5 w-5 flex-none"
            ariaLabel="BeakerBot"
          />
          <span className="flex-none text-body font-semibold text-foreground">
            BeakerSearch
          </span>
          <Icon
            name="more"
            className="h-4 w-4 flex-none text-foreground-muted"
            aria-hidden
          />
          <span className="flex-1" />
          <Tooltip label={`Hide to ${hideSide} edge`}>
            <button
              type="button"
              data-dock-act="tuck"
              onClick={doTuck}
              aria-label="Hide to edge"
              className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-transparent text-foreground-muted hover:border-border hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon
                name={
                  hideSide === "left"
                    ? "chevronLeft"
                    : hideSide === "right"
                      ? "chevronRight"
                      : "chevronDown"
                }
                className={`h-4 w-4 ${hideSide === "top" ? "rotate-180" : ""}`}
              />
            </button>
          </Tooltip>
          <Tooltip label={dock.collapsed ? "Expand" : "Collapse"}>
            <button
              type="button"
              data-dock-act="collapse"
              onClick={doCollapse}
              aria-label={dock.collapsed ? "Expand BeakerSearch" : "Collapse BeakerSearch"}
              className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-transparent text-foreground-muted hover:border-border hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon
                name="chevronDown"
                className={`h-4 w-4 ${dock.collapsed ? "-rotate-90" : ""}`}
              />
            </button>
          </Tooltip>
          <Tooltip label="Close">
            <button
              type="button"
              data-dock-act="close"
              onClick={onClose}
              aria-label="Close BeakerSearch"
              className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-transparent text-foreground-muted hover:border-border hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon name="close" className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        {/* The collapsible body. Hidden entirely when collapsed (pill mode). */}
        {dock.collapsed ? null : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Search row. The input is a combobox over the result listbox below.
            The search glyph comes from the registry; no inline svg is added. */}
        <div className="flex items-center gap-2.5 px-3 pb-2 pt-2.5">
          <Icon
            name="search"
            className="h-4 w-4 flex-none text-foreground-muted"
            aria-hidden
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
                : "Search, jump, or run any tool"
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
        </div>

        {/* Re-check page. The primary affordance to re-capture the page context
            (pointer + selection + route) on demand, replacing the old open-only
            snapshot. The provider owns the capture; this button + its shortcut
            label trigger it. */}
        {onRecheck ? (
          <button
            type="button"
            data-dock-act="recheck"
            onClick={onRecheck}
            className="mx-3 mb-1 mt-1 flex items-center gap-2 rounded-lg border border-brand-action/40 bg-brand-action/10 px-3 py-1.5 text-meta font-bold text-brand-action hover:bg-brand-action/20"
          >
            <Icon name="refresh" className="h-3.5 w-3.5 flex-none" />
            <span>Re-check page</span>
            <span className="flex-1" />
            {recheckShortcutLabel ? (
              <kbd className="rounded border border-brand-action/40 bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-brand-action">
                {recheckShortcutLabel}
              </kbd>
            ) : null}
          </button>
        ) : null}

        {/* Captured context card. Shows what the last re-check captured (Route,
            Pointing at, Selection) so the result bias is visible. */}
        {capturedContext ? (
          <div className="mx-3 my-1 rounded-lg border border-dashed border-border bg-surface-sunken px-3 py-2 text-[11.5px]">
            <div className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-foreground-muted">
              Captured context
            </div>
            <div className="flex items-baseline gap-2 leading-relaxed">
              <span className="w-[64px] flex-none font-semibold text-foreground-muted">
                Route
              </span>
              <span className={capturedContext.route ? "font-semibold text-foreground" : "italic text-foreground-muted"}>
                {capturedContext.route ?? "unknown"}
              </span>
            </div>
            <div className="flex items-baseline gap-2 leading-relaxed">
              <span className="w-[64px] flex-none font-semibold text-foreground-muted">
                Pointing at
              </span>
              <span className={capturedContext.pointer ? "font-semibold text-foreground" : "italic text-foreground-muted"}>
                {capturedContext.pointer ?? "nothing yet"}
              </span>
            </div>
            <div className="flex items-baseline gap-2 leading-relaxed">
              <span className="w-[64px] flex-none font-semibold text-foreground-muted">
                Selection
              </span>
              <span className={`truncate ${capturedContext.selection ? "font-semibold text-foreground" : "italic text-foreground-muted"}`}>
                {capturedContext.selection ?? "none"}
              </span>
            </div>
          </div>
        ) : null}

        {/* The "On this sequence" context card. A full card at rest, a slim
            one-line header while typing. Display only, outside the listbox so it
            is never a selectable / highlighted row. In STACK mode the picker fills
            the view (option A), so the resting cards are hidden; INLINE keeps them
            since the page stays in context (option B). */}
        {subMode === "stack" ? null : (
          <>
            <ContextCard context={context} slim={typing} />
            <GenericContextCard card={contextCard} slim={typing} />
          </>
        )}

        {/* STACK mode breadcrumb + Back row (option A). The breadcrumb names the
            flow (e.g. "Gantt / Add a dependency from..."), and the Back row pops one
            stage (Escape does the same from the keyboard). */}
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
            wired (the shell caller passes it; non-shell callers omit it, so
            the row simply does not appear there). It renders ABOVE the result
            listbox so it is visually the first thing under the search input,
            and it is index 0 in the highlight model, which is the default on
            open. Clicking or pressing Enter while it is highlighted escalates
            the query to BeakerBot instead of navigating a result. */}
        {onEscalate ? (
          <div
            id={`${baseId}-opt-escalation`}
            data-cmd-escalation="true"
            role="option"
            aria-selected={highlight === 0}
            aria-label={
              query.trim()
                ? `Ask BeakerBot about "${query.trim()}"`
                : "Ask BeakerBot"
            }
            onMouseMove={() => setHighlight(0)}
            onMouseDown={(e) => {
              // Keep focus in the input; escalate on click.
              e.preventDefault();
              onEscalate(query);
            }}
            className={`relative mx-2 mb-1 mt-0.5 flex cursor-pointer select-none items-center gap-3 rounded-xl border px-3 py-2.5 ${
              highlight === 0
                ? "border-sky-300 bg-sky-50 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r before:bg-sky-500 dark:border-sky-700 dark:bg-sky-900/30"
                : "border-border bg-surface-sunken hover:border-sky-200 hover:bg-sky-50/60 dark:hover:border-sky-800 dark:hover:bg-sky-900/20"
            }`}
          >
            {/* The BeakerBot mark is used here so the AI escalation reads
                as BeakerBot, consistent with the approved mockup and the
                standing rule that the mascot is always BeakerBot. */}
            <BeakerBot
              pose="idle"
              animated={false}
              className="h-5 w-5 flex-none"
              ariaLabel=""
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold text-foreground">
                {query.trim()
                  ? <>Ask BeakerBot about <span className="font-bold text-sky-700 dark:text-sky-300">&ldquo;{query.trim()}&rdquo;</span></>
                  : "Ask BeakerBot"}
              </span>
              <span className="block truncate text-[11px] text-foreground-muted">
                reasons, perceives, can act
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

        {/* Result list. Grouped, scrollable, with a flat highlight cursor across
            commands, sequences, and saved results. When the AI escalation row is
            present the flat items are at highlight indices 1..N (shifted by 1). */}
        <div
          ref={listRef}
          id={`${baseId}-listbox`}
          role="listbox"
          aria-label="Commands, sequences, and results"
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {flat.length === 0 ? (
            <div className="px-4 py-8 text-center text-meta text-foreground-muted">
              {inSubflow ? "No matches. Press esc to go back." : "Nothing matches that search."}
            </div>
          ) : (
            (() => {
              // A running flat index so the highlight maps across groups.
              // When escalation is present the highlight index for a flat item
              // at flat-array position `flatIndex` is `flatIndex + 1`.
              let flatIndex = -1;
              return viewGroups.map((g) => (
                <div key={g.title}>
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
                  {g.items.map((item) => {
                    flatIndex += 1;
                    const flatIdx = flatIndex;
                    // The highlight slot for this flat item: offset by 1 when
                    // the escalation row occupies slot 0.
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
                          // Keep focus in the input; run on click.
                          e.preventDefault();
                          runItem(item);
                        }}
                        className={`relative flex cursor-pointer items-center gap-3 px-4 py-2 ${
                          isHighlighted
                            ? "bg-sky-50 before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-r before:bg-sky-500 dark:bg-sky-900/30"
                            : ""
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
              ));
            })()
          )}
        </div>

        {/* Footer hints. Compact key chips for the keyboard model, then the calm
            reach reminder. */}
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
          <span className="ml-auto">
            {inSubflow ? "Pick one to continue" : "Cmd K reaches everything"}
          </span>
        </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}

export default CommandPalette;
