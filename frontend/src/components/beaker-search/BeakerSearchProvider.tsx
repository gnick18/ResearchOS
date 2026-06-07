"use client";

// sequence editor master. BeakerSearch step 1, the APP-SHELL provider.
//
// BeakerSearch began as the sequence editor's Cmd-K palette, owned entirely by
// SequenceEditView. This provider lifts that ownership up to the app shell so
// the same one palette can later serve every page. For THIS step it is a pure
// relocation with zero behavior change. The provider owns the open / close
// state and the global Cmd-K listener, and renders the existing CommandPalette
// from whichever page source is registered. Sequences is the only source today.
//
// The model.
//   - ONE provider, mounted once high in the tree (lib/providers.tsx), so it
//     covers every route and every pre-login surface, exactly like the
//     ContextMenuProvider it sits beside.
//   - Pages register a BeakerSearchSource via useBeakerSearchSource while they
//     are mounted. The sources are a STACK (an array); the ACTIVE source is the
//     last one registered (most-recently-mounted surface wins). registerSource
//     replaces-by-id then appends so the newest is always last; unregisterSource
//     removes by id.
//   - The global Cmd-K / Ctrl-K listener toggles the palette, but ONLY when there
//     is an active source. With no source registered (a page that has not been
//     wired into BeakerSearch yet) the listener does NOTHING and does NOT
//     preventDefault, so the browser's native Cmd-K is preserved exactly as it
//     was before BeakerSearch existed on that page. This is the heart of the
//     zero-behavior-change guarantee for every other page.
//   - useBeakerSearch() gives triggers (the rail doorway, the front-door pill)
//     openPalette / closePalette / togglePalette plus hasSource.
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
// Imported from the sequences tree for this step; relocation into beaker-search/
// is a future step (see the file header).
import { CommandPalette } from "@/components/sequences/CommandPalette";
import type { BeakerSearchSource } from "./types";

/** The trigger-facing API, for the rail doorway and the front-door pill. */
export interface BeakerSearchApi {
  /** Whether the palette is currently open. */
  open: boolean;
  /** Open the palette (a no-op visually if there is no active source). */
  openPalette: () => void;
  /** Close the palette. */
  closePalette: () => void;
  /** Toggle the palette. */
  togglePalette: () => void;
  /** Whether any source is currently registered (so triggers can hide / disable
   *  themselves on pages with no BeakerSearch yet). */
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

  const active = sources.length > 0 ? sources[sources.length - 1] : null;
  const hasSource = active != null;

  // The GLOBAL Cmd-K / Ctrl-K listener. It only acts when there IS an active
  // source. With no source we do nothing and do NOT preventDefault, so the
  // browser's native Cmd-K stays exactly as it was on that page. The listener is
  // re-bound whenever hasSource flips so the guard reads the live value.
  useEffect(() => {
    if (!hasSource) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((cur) => !cur);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSource]);

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
        {/* The one shared palette, rendered from the active source. Open only
            when the palette is open AND a source is present. The palette portals
            to the body, so it sits here without affecting layout. */}
        {active != null ? (
          <CommandPalette
            open={open}
            onClose={closePalette}
            commands={active.commands}
            selectionKind={active.selectionKind}
            hasOrganism={active.hasOrganism}
            context={active.context}
            sequences={active.sequences}
            artifacts={active.artifacts}
            collectionLabel={active.collectionLabel}
          />
        ) : null}
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
