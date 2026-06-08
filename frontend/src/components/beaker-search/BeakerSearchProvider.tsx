"use client";

// sequence editor master. BeakerSearch step 1, the APP-SHELL provider.
//
// BeakerSearch began as the sequence editor's Cmd-K palette, owned entirely by
// SequenceEditView. Step 1 lifted that ownership up to the app shell so the same
// one palette can serve every page. Step 2a adds the always-present GLOBAL layer
// (cross-page navigation + safe app commands), so Cmd-K and the front-door pill
// now open the palette on EVERY page, not just pages that register a source.
// The provider owns the open / close state and the global Cmd-K listener, and
// renders the existing CommandPalette from the EFFECTIVE source (the active page
// source merged with the global layer, or a global-only synthetic source).
//
// The model.
//   - ONE provider, mounted once high in the tree (lib/providers.tsx), so it
//     covers every route and every pre-login surface, exactly like the
//     ContextMenuProvider it sits beside.
//   - Pages register a BeakerSearchSource via useBeakerSearchSource while they
//     are mounted. The sources are a STACK (an array); the ACTIVE page source is
//     the last one registered (most-recently-mounted surface wins).
//     registerSource replaces-by-id then appends so the newest is always last;
//     unregisterSource removes by id.
//   - The GLOBAL layer (useGlobalCommands) is built right here under the router +
//     theme and is ALWAYS present. The palette renders [...page.commands,
//     ...globalCommands] so the page's own context LEADS and the global reach
//     ("Go to" + "App") trails below (COMMAND_GROUP_ORDER puts them last). With
//     no page source, a synthetic global-only source keeps the palette open
//     everywhere.
//   - The global Cmd-K / Ctrl-K listener ALWAYS toggles the palette and always
//     preventDefaults the shortcut, on every page. This is the intended step-2a
//     change (Grant wants Cmd-K everywhere); the global layer guarantees there is
//     always something to show.
//   - useBeakerSearch() gives triggers (the rail doorway, the front-door pill)
//     openPalette / closePalette / togglePalette plus hasSource (whether the
//     CURRENT page contributed its own source, distinct from the global layer).
//
// The CommandPalette is imported from @/components/sequences/CommandPalette and
// is NOT moved in this step. Relocating it into beaker-search/ is a future step.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
// BeakerSearch website-wide (step 4), the app-wide mouse-awareness primitive.
import { beakerTargetKeyOf } from "./beaker-hover";
// BeakerSearch v3. The "Re-check page" action re-captures the page context on
// demand (pointer + selection + route). These pure helpers turn the raw values
// into the friendly labels the dock's captured-context card shows.
import {
  prettyPointer,
  prettyRoute,
  selectionExcerpt,
  type CapturedContext,
} from "./captured-context";
// Imported from the sequences tree for this step; relocation into beaker-search/
// is a future step (see the file header).
import { CommandPalette, type DockControl } from "@/components/sequences/CommandPalette";
// BeakerSearch global object search, chunk 2. activePageTypeForPath maps the
// current route to the object type the page hosts as its own entity, so the
// palette drops that type's global group (on-page de-dup).
import { activePageTypeForPath } from "./global-source";
import type { BeakerSearchSource } from "./types";
// BeakerSearch step 2a, the always-present global layer. The global commands are
// built under the router + theme here in the provider, then MERGED beneath the
// active page source so every palette shows the page's own items first and the
// global "Go to" + "App" reach below.
import { useGlobalCommands } from "./useGlobalCommands";
// BeakerSearch global object search, chunk 1. Mounting the index hook here runs
// its one-time, fire-and-forget prefetch of the four canonical loaders on shell
// mount (decision 2, eager-once), so Cmd-K finds a record by name even on a page
// the user has not visited this session. Chunk 2 feeds the returned index into
// the palette as the cross-app NAVIGATE source; for chunk 1 the value is unused
// and only the prefetch + warm-cache subscription are wired.
import { useGlobalObjectIndex } from "./useGlobalObjectIndex";
// BeakerSearch global object search, chunk 4. The per-user Recent-records MRU.
// The pure list math (push + resolve + parse) lives in recent-records.ts; the
// provider owns the localStorage read/write and resolves the stored refs against
// the live index for the empty-query "Recent records" group.
import {
  RECENT_RECORDS_CAP,
  parseRecentRefs,
  pushRecentRef,
  resolveRecentRefs,
  type RecentRef,
} from "./recent-records";
import type { GlobalIndexEntry } from "./global-index";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/** The trigger-facing API, for the rail doorway and the front-door pill. */
export interface BeakerSearchApi {
  /** Whether the palette is currently open. */
  open: boolean;
  /** Open the palette. Always meaningful as of step 2a, the always-present global
   *  layer guarantees the palette has content on every page. */
  openPalette: () => void;
  /** Close the palette. */
  closePalette: () => void;
  /** Toggle the palette. */
  togglePalette: () => void;
  /** Whether the CURRENT page registered its own source (distinct from the
   *  always-present global layer). Triggers can use it to tell "this page feeds
   *  BeakerSearch its own context" from "global-only". Not a gate on opening. */
  hasSource: boolean;
}

/** The source-registration API, for useBeakerSearchSource. Kept internal to the
 *  module; pages use the hook, not these directly. */
interface BeakerSearchRegistry {
  registerSource: (source: BeakerSearchSource) => void;
  unregisterSource: (id: string) => void;
}

const BeakerSearchApiContext = createContext<BeakerSearchApi | null>(null);
const BeakerSearchRegistryContext = createContext<BeakerSearchRegistry | null>(
  null,
);
// BeakerSearch website-wide (step 4). The `data-beaker-target` key of the last
// tagged element hovered before the palette opened, snapshot on open, null while
// closed. Source hooks read it via useBeakerHoveredKey and resolve it to the
// hovered entity. A plain string context (not in the API) so triggers do not
// re-render on hover-key changes.
const BeakerSearchHoverContext = createContext<string | null>(null);

export function BeakerSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // The latest `open`, read by the global Cmd/Ctrl+K handler without
  // re-subscribing the listener on every open / close.
  const openRef = useRef(open);
  openRef.current = open;
  // BeakerSearch v3. The dock publishes its collapsed / tucked sub-state plus the
  // expand / untuck actions into this ref (see CommandPalette's dockControlRef).
  // The provider owns open / close; this ref lets the Cmd/Ctrl+K handler consult
  // the sub-state so it RESTORES a collapsed or tucked dock instead of closing it.
  const dockControlRef = useRef<DockControl | null>(null);
  // The source STACK. The last element is the active source (most-recently
  // registered surface wins).
  const [sources, setSources] = useState<BeakerSearchSource[]>([]);

  // BeakerSearch website-wide (step 4), app-wide mouse-awareness. A global
  // pointer listener records the `data-beaker-target` key of the last TAGGED
  // element the pointer was over, into a ref. It updates ONLY on a tagged
  // ancestor (beakerTargetKeyOf returns non-null), so moving the pointer onto the
  // palette / scrim / untagged chrome never clears the last real target. On open
  // the ref is snapshot into hoveredKey state (a stable value for the open
  // session), cleared on close. Source hooks read it via useBeakerHoveredKey.
  const lastHoveredKeyRef = useRef<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // BeakerSearch v3. The display-ready page context captured by the last
  // re-check (or the open-time snapshot), shown in the dock's context card.
  const [capturedContext, setCapturedContext] = useState<CapturedContext>({
    route: null,
    pointer: null,
    selection: null,
  });
  useEffect(() => {
    const onPointerOver = (e: Event) => {
      const key = beakerTargetKeyOf(e.target);
      if (key != null) lastHoveredKeyRef.current = key;
    };
    window.addEventListener("pointerover", onPointerOver, { passive: true });
    return () => window.removeEventListener("pointerover", onPointerOver);
  }, []);

  const registerSource = useCallback((source: BeakerSearchSource) => {
    // Replace any existing entry with this id, then append so the newest is last.
    setSources((cur) => [...cur.filter((s) => s.id !== source.id), source]);
  }, []);

  const unregisterSource = useCallback((id: string) => {
    setSources((cur) => cur.filter((s) => s.id !== id));
  }, []);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);
  const togglePalette = useCallback(() => setOpen((cur) => !cur), []);

  // The always-present GLOBAL layer (cross-page nav + safe app commands). Built
  // under the router + theme so its handlers can push routes and flip the theme.
  const globalCommands = useGlobalCommands();

  // The cross-app object index (chunk 1, a thin reader over the four canonical
  // caches plus the eager-once shell-mount prefetch). Chunk 2 feeds it into the
  // palette as the global NAVIGATE source; the palette ranks + debounces it
  // against its own query. Mounting here also keeps the prefetch running on shell
  // mount.
  const objectIndex = useGlobalObjectIndex();
  const router = useRouter();
  const pathname = usePathname();
  // The object type the current route hosts as its own primary entity, so the
  // palette suppresses that type's global group (on-page de-dup, the page source
  // already surfaces those records with richer rows). Null on routes that host
  // none of the four core types.
  const activePageType = useMemo(
    () => activePageTypeForPath(pathname),
    [pathname],
  );

  // BeakerSearch v3. Re-capture the page context on demand. This re-reads (a) the
  // current pointer / hover target (re-setting the same hoveredKey existing page
  // consumers bias on, so they re-bias for free), (b) the live text selection,
  // and (c) the current route, then refreshes the captured-context card. This
  // replaces v2's open-only snapshot, the user can refresh the bias whenever the
  // page state changes without reopening the dock.
  const recheckPageContext = useCallback(() => {
    const key = lastHoveredKeyRef.current;
    setHoveredKey(key);
    const selText =
      typeof window !== "undefined" && window.getSelection
        ? window.getSelection()?.toString() ?? null
        : null;
    setCapturedContext({
      route: prettyRoute(pathname),
      pointer: prettyPointer(key),
      selection: selectionExcerpt(selText),
    });
  }, [pathname]);

  // Capture once on open (the v2 baseline snapshot), then clear the per-open
  // hovered key on close. Re-check refreshes it on demand while open.
  useEffect(() => {
    if (open) recheckPageContext();
    else setHoveredKey(null);
  }, [open, recheckPageContext]);

  // BeakerSearch v3. The re-check shortcut is a plain "r", handled inside the
  // dock (CommandPalette) where the floating / tucked state lives. It fires only
  // while the dock is open AND floating (not tucked, not closed) AND focus is
  // parked on nothing, so typing "r" in the search box or in a page widget is
  // never stolen. The label is set here for the dock's button to render.
  const recheckShortcutLabel = "R";
  // The per-user Recent-records MRU (chunk 4). A client-only localStorage list,
  // keyed by the current user so a profile switch never leaks another user's
  // recents, holding the last few globally-opened core records. Loaded on mount /
  // user switch; null user (logged out) keeps it empty.
  const { currentUser } = useCurrentUser();
  const recentStorageKey = currentUser ? `beakerSearchRecent:${currentUser}` : null;
  const [recentRefs, setRecentRefs] = useState<RecentRef[]>([]);
  useEffect(() => {
    if (!recentStorageKey || typeof window === "undefined") {
      setRecentRefs([]);
      return;
    }
    setRecentRefs(parseRecentRefs(window.localStorage.getItem(recentStorageKey)));
  }, [recentStorageKey]);

  // Jump to a cross-app object record, then close the palette and record it in
  // the MRU. The href is a complete deep-link the target page reads on mount; the
  // MRU stores only the {type, key} reference, re-resolved against the live index
  // for the empty-query recents (so the row stays fresh and a deleted record
  // drops out). Persist best-effort, a full or disabled localStorage never breaks
  // the jump.
  const navigateToObject = useCallback(
    (entry: GlobalIndexEntry) => {
      router.push(entry.href);
      setOpen(false);
      if (!recentStorageKey || typeof window === "undefined") return;
      setRecentRefs((prev) => {
        const next = pushRecentRef(
          prev,
          { type: entry.type, key: entry.key },
          RECENT_RECORDS_CAP,
        );
        try {
          window.localStorage.setItem(recentStorageKey, JSON.stringify(next));
        } catch {
          // localStorage full or disabled; the in-memory MRU still updates.
        }
        return next;
      });
    },
    [router, recentStorageKey],
  );

  // Resolve the stored refs to live index entries (MRU order, missing dropped)
  // for the empty-query "Recent records" group.
  const recentEntries = useMemo(
    () => resolveRecentRefs(recentRefs, objectIndex),
    [recentRefs, objectIndex],
  );
  // BeakerSearch global object search, chunk 3. Hand the live query off to the
  // full faceted /search via ?keywords=, which /search reads on mount to seed its
  // box and run the search, then close the palette. The escape hatch for a query
  // the inline results do not fully cover.
  const searchEverything = useCallback(
    (q: string) => {
      router.push(`/search?keywords=${encodeURIComponent(q)}`);
      setOpen(false);
    },
    [router],
  );

  const activePage = sources.length > 0 ? sources[sources.length - 1] : null;
  // A page source is still reported via hasSource for any trigger that wants to
  // know whether the current surface contributed its own context. The palette,
  // however, is now ALWAYS available because the global layer is always present.
  const hasSource = activePage != null;

  // The GLOBAL Cmd-K / Ctrl-K listener. As of step 2a the global layer is ALWAYS
  // present, so the palette opens on EVERY page (Grant wants Cmd-K everywhere).
  // The listener no longer gates on hasSource; it always preventDefaults the
  // shortcut so the app palette wins over the browser. The synthetic global-only
  // source below keeps the palette renderable even on a page that registers no
  // source of its own.
  //
  // BeakerSearch v3 made the dock collapsible and tuckable, so a plain toggle is
  // no longer right. Cmd/Ctrl+K now means "bring BeakerSearch to me":
  //   - closed            -> open it (wherever it was left).
  //   - open + collapsed  -> expand it (do NOT close).
  //   - open + tucked     -> untuck / restore it (do NOT close).
  //   - open + visible    -> close it.
  // The collapsed / tucked sub-state lives in the dock (CommandPalette), which
  // publishes it here via dockControlRef. Escape and the X button stay full-close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Plain Cmd/Ctrl+K. Shift is reserved for the v3 re-check chord
      // (Cmd/Ctrl+Shift+K), so it must not also act here.
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        if (!openRef.current) {
          setOpen(true);
          return;
        }
        // Open, so consult the dock's sub-state. A collapsed or tucked dock is
        // restored (untuck first, then expand) and stays open; both can be set
        // at once, so both are reversed. A fully visible dock closes.
        const ctrl = dockControlRef.current;
        if (ctrl && (ctrl.collapsed || ctrl.tucked)) {
          if (ctrl.tucked) ctrl.untuck();
          if (ctrl.collapsed) ctrl.expand();
          return;
        }
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The EFFECTIVE source the palette renders. The defining step-2a change, the
  // palette shows the active page source's items AND the global items together,
  // page commands FIRST so a page's own context leads and the global reach
  // trails (COMMAND_GROUP_ORDER puts "Go to" / "App" after the page groups).
  //
  //   - With an active page source, commands = [...page.commands, ...global],
  //     and the page's context / sequences / artifacts / selection ride along
  //     unchanged, so Sequences keeps its full palette and just gains the global
  //     rows below.
  //   - With NO page source, a synthetic global-only source so the palette still
  //     opens everywhere, commands = global, selectionKind "none", no organism,
  //     no context / sequences / artifacts.
  const effectiveSource = useMemo<BeakerSearchSource>(() => {
    if (activePage != null) {
      return {
        ...activePage,
        commands: [...activePage.commands, ...globalCommands],
      };
    }
    return {
      id: "beaker-search-global",
      commands: globalCommands,
      selectionKind: "none",
      hasOrganism: false,
    };
  }, [activePage, globalCommands]);

  const api = useMemo<BeakerSearchApi>(
    () => ({ open, openPalette, closePalette, togglePalette, hasSource }),
    [open, openPalette, closePalette, togglePalette, hasSource],
  );

  const registry = useMemo<BeakerSearchRegistry>(
    () => ({ registerSource, unregisterSource }),
    [registerSource, unregisterSource],
  );

  return (
    <BeakerSearchApiContext.Provider value={api}>
      <BeakerSearchRegistryContext.Provider value={registry}>
        <BeakerSearchHoverContext.Provider value={hoveredKey}>
          {children}
        {/* The one shared palette, rendered from the EFFECTIVE source (the active
            page merged with the always-present global layer, or the synthetic
            global-only source). It is therefore renderable on every page. The
            palette portals to the body, so it sits here without affecting
            layout. */}
        <CommandPalette
          open={open}
          onClose={closePalette}
          commands={effectiveSource.commands}
          selectionKind={effectiveSource.selectionKind}
          hasOrganism={effectiveSource.hasOrganism}
          context={effectiveSource.context}
          contextCard={effectiveSource.contextCard}
          suggestedIds={effectiveSource.suggestedIds}
          suggestedHint={effectiveSource.suggestedHint}
          navGroups={effectiveSource.navGroups}
          interpretQuery={effectiveSource.interpretQuery}
          sequences={effectiveSource.sequences}
          artifacts={effectiveSource.artifacts}
          collectionLabel={effectiveSource.collectionLabel}
          objectIndex={objectIndex}
          activePageType={activePageType}
          onNavigateObject={navigateToObject}
          onSearchEverything={searchEverything}
          recentEntries={recentEntries}
          capturedContext={capturedContext}
          onRecheck={recheckPageContext}
          recheckShortcutLabel={recheckShortcutLabel}
          dockControlRef={dockControlRef}
        />
        </BeakerSearchHoverContext.Provider>
      </BeakerSearchRegistryContext.Provider>
    </BeakerSearchApiContext.Provider>
  );
}

/** Read the `data-beaker-target` key of the element hovered before the palette
 *  opened (null while the palette is closed, or when nothing tagged was hovered).
 *  A per-page source hook calls this and resolves the key (via
 *  parseBeakerTargetKey) to the hovered entity for its own kinds. Safe to call
 *  outside the provider, it returns null rather than throwing, so a page can read
 *  it unconditionally even before the provider mounts. */
export function useBeakerHoveredKey(): string | null {
  return useContext(BeakerSearchHoverContext);
}

/** Trigger hook for the rail doorway and the front-door pill. Throws when used
 *  outside the provider, since a trigger must live under the app shell. */
export function useBeakerSearch(): BeakerSearchApi {
  const ctx = useContext(BeakerSearchApiContext);
  if (ctx == null) {
    throw new Error("useBeakerSearch must be used within a BeakerSearchProvider");
  }
  return ctx;
}

/** The registry hook, used by useBeakerSearchSource. Throws when used outside the
 *  provider, since a page that registers a source must live under the app shell. */
export function useBeakerSearchRegistry(): BeakerSearchRegistry {
  const ctx = useContext(BeakerSearchRegistryContext);
  if (ctx == null) {
    throw new Error(
      "useBeakerSearchSource must be used within a BeakerSearchProvider",
    );
  }
  return ctx;
}
