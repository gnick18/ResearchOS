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
  useState,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
// Imported from the sequences tree for this step; relocation into beaker-search/
// is a future step (see the file header).
import { CommandPalette } from "@/components/sequences/CommandPalette";
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

export function BeakerSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // The source STACK. The last element is the active source (most-recently
  // registered surface wins).
  const [sources, setSources] = useState<BeakerSearchSource[]>([]);

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
  // The listener no longer gates on hasSource; it always toggles and always
  // preventDefaults the shortcut so the app palette wins over the browser. The
  // synthetic global-only source below keeps the palette renderable even on a
  // page that registers no source of its own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((cur) => !cur);
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
        />
      </BeakerSearchRegistryContext.Provider>
    </BeakerSearchApiContext.Provider>
  );
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
