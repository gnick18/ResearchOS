"use client";

// sequence editor master. BeakerSearch step 1, the APP-SHELL provider.
//
// BeakerSearch began as the sequence editor's Cmd-K palette, owned entirely by
// SequenceEditView. Step 1 lifted that ownership up to the app shell so the
// same one palette can serve every page. Step 2a adds the always-present GLOBAL
// layer (cross-page navigation + safe app commands), so Cmd-K and the front-
// door pill now open the palette on EVERY page, not just pages that register a
// source. The provider owns the open / close state and the global Cmd-K
// listener, and renders the existing CommandPalette from the EFFECTIVE source
// (the active page source merged with the global layer, or a global-only
// synthetic source).
//
// BeakerSearch v2 (Phase 2): the provider also owns the palette's Ask/Search
// mode toggle (`askMode`). When escalateToBeakerBot is called (enter on the
// ask row), the palette morphs INTO the conversation instead of opening a
// separate dock. The conversation state is shared across both surfaces via the
// persistent conversation store.
//
// BeakerSearch v4 (ai centered-redesign bot, 2026-06-11): the floating dock
// machinery is GONE. Cmd/Ctrl+K is a plain toggle (closed -> open, open ->
// close). No dockControlRef, no collapsed/tucked sub-state, no hover snapshot,
// no on-page de-dup bias, no hoveredKey context.
//
// The model.
//   - ONE provider, mounted once high in the tree (lib/providers.tsx), so it
//     covers every route and every pre-login surface.
//   - Pages register a BeakerSearchSource via useBeakerSearchSource while
//     they are mounted. The sources are a STACK; the ACTIVE page source is the
//     last one registered (most-recently-mounted surface wins).
//   - The GLOBAL layer (useGlobalCommands) is built right here under the
//     router + theme and is ALWAYS present. The palette renders
//     [...page.commands, ...globalCommands] so the page's own context LEADS.
//   - The global Cmd-K / Ctrl-K listener ALWAYS toggles the palette on every
//     page.
//   - useBeakerSearch() gives triggers openPalette / closePalette /
//     togglePalette plus hasSource (whether the CURRENT page contributed its
//     own source, distinct from the global layer).
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
// Imported from the sequences tree for this step; relocation into beaker-search/
// is a future step (see the file header).
import { CommandPalette } from "@/components/sequences/CommandPalette";
import type { BeakerSearchSource } from "./types";
// BeakerSearch step 2a, the always-present global layer. The global commands
// are built under the router + theme here in the provider, then MERGED beneath
// the active page source so every palette shows the page's own items first
// and the global "Go to" + "App" reach below.
import { useGlobalCommands } from "./useGlobalCommands";
// BeakerSearch v2 AI escalation (Phase 2). The palette morphs into the
// conversation in place (the morph), and the message bridge seeds the query
// into the persistent conversation store.
import { sendToBeakerBot } from "@/components/ai/message-bridge";
// BeakerSearch global object search, chunk 1. Mounting the index hook here
// runs its one-time, fire-and-forget prefetch of the four canonical loaders on
// shell mount (decision 2, eager-once), so Cmd-K finds a record by name even
// on a page the user has not visited this session.
import { useGlobalObjectIndex } from "./useGlobalObjectIndex";
// BeakerSearch global object search, chunk 4. The per-user Recent-records MRU.
import {
  RECENT_RECORDS_CAP,
  parseRecentRefs,
  pushRecentRef,
  resolveRecentRefs,
  type RecentRef,
} from "./recent-records";
import type { GlobalIndexEntry } from "./global-index";
import { useCurrentUser } from "@/hooks/useCurrentUser";
// BeakerBot AI is ACCOUNT-ONLY (Grant's lock). The provider reads canUseAI and
// passes aiLocked to the palette so the escalation row can render an in-palette
// discovery upsell instead of a dead escalation for solo/locked accounts.
// (bug fix: 2026-06-13)
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";

/** The trigger-facing API, for the rail doorway and the front-door pill. */
export interface BeakerSearchApi {
  /** Whether the palette is currently open. */
  open: boolean;
  /** Open the palette. Always meaningful as of step 2a, the always-present
   *  global layer guarantees the palette has content on every page. */
  openPalette: () => void;
  /** Close the palette. */
  closePalette: () => void;
  /** Toggle the palette. */
  togglePalette: () => void;
  /** Whether the CURRENT page registered its own source (distinct from the
   *  always-present global layer). Triggers can use it to tell "this page
   *  feeds BeakerSearch its own context" from "global-only". Not a gate on
   *  opening. */
  hasSource: boolean;
  /** Open the palette directly in Ask mode, resuming the persisted BeakerBot
   *  conversation. No query is seeded. This is the FAB's action: tapping the
   *  floating summon button opens BeakerBot without launching a search. */
  openBeakerBot: () => void;
}

/** The source-registration API, for useBeakerSearchSource. Kept internal to
 *  the module; pages use the hook, not these directly. */
interface BeakerSearchRegistry {
  registerSource: (source: BeakerSearchSource) => void;
  unregisterSource: (id: string) => void;
}

const BeakerSearchApiContext = createContext<BeakerSearchApi | null>(null);
const BeakerSearchRegistryContext = createContext<BeakerSearchRegistry | null>(
  null,
);

/** The next palette state when the Cmd/Ctrl+J BeakerBot shortcut fires, from the
 *  current open + askMode. Already open in Ask toggles closed (back to Search so
 *  the next open starts fresh); otherwise it opens in Ask (from closed, or flips
 *  Search -> Ask). Pure, so the shortcut logic is unit-tested without the
 *  provider's hook machinery. */
export function nextBeakerBotShortcutState(
  open: boolean,
  askMode: "search" | "ask",
): { open: boolean; askMode: "search" | "ask" } {
  if (open && askMode === "ask") return { open: false, askMode: "search" };
  return { open: true, askMode: "ask" };
}

export function BeakerSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // BeakerSearch v2 Phase 2. The palette's current mode: "search" (result
  // rows) or "ask" (BeakerBot conversation in place). Reset to "search" when
  // the palette closes so the next open always starts at search.
  const [askMode, setAskMode] = useState<"search" | "ask">("search");
  // The latest `open`, read by the global Cmd/Ctrl+K handler without
  // re-subscribing the listener on every open / close.
  const openRef = useRef(open);
  openRef.current = open;
  // The latest `askMode`, read by the global Cmd/Ctrl+J handler so it can decide
  // whether to toggle closed (already in Ask) or flip to Ask, without
  // re-subscribing the listener on every mode change.
  const askModeRef = useRef(askMode);
  askModeRef.current = askMode;
  // The source STACK. The last element is the active source (most-recently
  // registered surface wins).
  const [sources, setSources] = useState<BeakerSearchSource[]>([]);

  const registerSource = useCallback((source: BeakerSearchSource) => {
    // Replace any existing entry with this id, then append so the newest is
    // last.
    setSources((cur) => [...cur.filter((s) => s.id !== source.id), source]);
  }, []);

  const unregisterSource = useCallback((id: string) => {
    setSources((cur) => cur.filter((s) => s.id !== id));
  }, []);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => {
    setOpen(false);
    // Reset to search mode when the palette closes so the next open starts
    // fresh.
    setAskMode("search");
  }, []);
  const togglePalette = useCallback(() => setOpen((cur) => !cur), []);

  // Phase 4: the FAB opens the palette directly in Ask mode, resuming the
  // persisted conversation. No query is seeded (the user just wants to
  // continue the chat). The palette stays in Ask mode until the user presses
  // back-to-search or closes it.
  const openBeakerBot = useCallback(() => {
    setOpen(true);
    setAskMode("ask");
  }, []);

  // The always-present GLOBAL layer (cross-page nav + safe app commands).
  const globalCommands = useGlobalCommands();

  // The cross-app object index (chunk 1, a thin reader over the four canonical
  // caches plus the eager-once shell-mount prefetch). Chunk 2 feeds it into
  // the palette as the global NAVIGATE source.
  const objectIndex = useGlobalObjectIndex();
  const router = useRouter();

  // AI gate: when canUseAI is false (solo/locked/demo), pass aiLocked=true to
  // the palette so its escalation row shows the account-setup upsell instead of
  // trying to start a BeakerBot conversation. escalateToBeakerBot itself is
  // unchanged; it is simply never reached from the palette in the locked state.
  const { canUseAI } = useAccountCapabilities();

  // BeakerSearch global object search, chunk 4. The per-user Recent-records
  // MRU. A client-only localStorage list, keyed by the current user so a
  // profile switch never leaks another user's recents.
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

  // Jump to a cross-app object record, then close the palette and record it
  // in the MRU.
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

  // BeakerSearch global object search, chunk 3. Hand the live query off to
  // the full faceted /search via ?keywords=, then close the palette.
  const searchEverything = useCallback(
    (q: string) => {
      router.push(`/search?keywords=${encodeURIComponent(q)}`);
      setOpen(false);
    },
    [router],
  );

  // BeakerSearch v2 Phase 2 AI escalation (the morph). The palette STAYS open
  // and switches into Ask mode; the search body cross-fades to the
  // conversation. The query is seeded via the message bridge. Back-to-search
  // returns to search mode without clearing the conversation.
  //
  // On the "duplicate chat from one send" dev report (2026-06-13): this is an
  // event callback, so it fires once per Enter/click and React StrictMode (on
  // by default in dev, off in prod) does NOT double-invoke it. The send layer
  // is idempotent under a StrictMode bridge double-mount too: message-bridge's
  // flushQueue clears the queued message before delivering, and store send()
  // guards concurrent calls and binds the thread on the first message only. One
  // escalation always creates exactly one thread, verified in a prod build and
  // pinned by beakerbot-escalation-single-thread.test.tsx (StrictMode + cold
  // queue cases). The dev report was a double-submit, not a code double-fire.
  const escalateToBeakerBot = useCallback((q: string) => {
    setAskMode("ask");
    void sendToBeakerBot(q.trim());
    // NOTE: the palette stays open (no setOpen(false)).
  }, []);

  const activePage = sources.length > 0 ? sources[sources.length - 1] : null;
  const hasSource = activePage != null;

  // The GLOBAL Cmd-K / Ctrl-K listener. As of step 2a the global layer is
  // ALWAYS present, so the palette opens on EVERY page. v4 simplifies this to
  // a plain toggle (no collapsed/tucked sub-state to consult).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        // Cmd/Ctrl+K toggles the palette in Search mode (the existing behavior).
        e.preventDefault();
        setOpen((cur) => !cur);
        // If closing, reset to search mode so the next open starts fresh.
        if (openRef.current) setAskMode("search");
      } else if (key === "j") {
        // Cmd/Ctrl+J opens BeakerBot directly in Ask mode, skipping Search. When
        // it is already open in Ask it toggles closed; when open in Search it
        // flips to Ask; when closed it opens in Ask. Mirrors openBeakerBot (the
        // FAB), so a locked / demo state is handled by the palette the same way.
        e.preventDefault();
        const next = nextBeakerBotShortcutState(
          openRef.current,
          askModeRef.current,
        );
        setOpen(next.open);
        setAskMode(next.askMode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The EFFECTIVE source the palette renders. With an active page source,
  // commands = [...page.commands, ...global]. With NO page source, a synthetic
  // global-only source so the palette still opens everywhere.
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
    () => ({ open, openPalette, closePalette, togglePalette, hasSource, openBeakerBot }),
    [open, openPalette, closePalette, togglePalette, hasSource, openBeakerBot],
  );

  const registry = useMemo<BeakerSearchRegistry>(
    () => ({ registerSource, unregisterSource }),
    [registerSource, unregisterSource],
  );

  return (
    <BeakerSearchApiContext.Provider value={api}>
      <BeakerSearchRegistryContext.Provider value={registry}>
        {children}
        {/* The one shared palette, rendered from the EFFECTIVE source (the
            active page merged with the always-present global layer, or the
            synthetic global-only source). It is therefore renderable on every
            page. The palette portals to the body, so it sits here without
            affecting layout. */}
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
          onNavigateObject={navigateToObject}
          onSearchEverything={searchEverything}
          recentEntries={recentEntries}
          onEscalate={escalateToBeakerBot}
          aiLocked={!canUseAI}
          askMode={askMode}
          onEnterAskMode={() => setAskMode("ask")}
          onExitAskMode={() => setAskMode("search")}
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

/** Non-throwing variant for surfaces that may mount WITHOUT the app shell (e.g.
 *  the LiveMarkdownEditor renders inside the BeakerBot Canvas and the method
 *  create / compound / variation panels, which are not always under the
 *  provider). Returns null instead of throwing so a "summon BeakerBot" control
 *  can render only when the provider is genuinely present and stay inert
 *  otherwise. */
export function useOptionalBeakerSearch(): BeakerSearchApi | null {
  return useContext(BeakerSearchApiContext);
}

/** The registry hook, used by useBeakerSearchSource. Throws when used outside
 *  the provider, since a page that registers a source must live under the app
 *  shell. */
export function useBeakerSearchRegistry(): BeakerSearchRegistry {
  const ctx = useContext(BeakerSearchRegistryContext);
  if (ctx == null) {
    throw new Error(
      "useBeakerSearchSource must be used within a BeakerSearchProvider",
    );
  }
  return ctx;
}
