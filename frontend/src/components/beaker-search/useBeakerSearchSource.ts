// sequence editor master. BeakerSearch step 1, the per-page SOURCE hook.
//
// A page calls useBeakerSearchSource(source) while it is mounted to register its
// commands / context / entities with the shared BeakerSearch palette. Passing
// null registers nothing (e.g. the chrome-slim embedded sequence preview, where
// the palette is intentionally inert). The hook keeps the registration live for
// the lifetime of the component and cleans up on unmount or when the source
// changes.
//
// The CALLER is responsible for MEMOIZING the source object (e.g. with useMemo),
// since the registration effect is keyed on the source value. An unmemoized
// object would re-register on every render. Memoize it.
//
// Reading the registry throws when used outside the provider (same as
// useBeakerSearch), because a page that registers a source must live under the
// app shell.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useEffect } from "react";
import { useBeakerSearchRegistry } from "./BeakerSearchProvider";
import type { BeakerSearchSource } from "./types";

/** Register a BeakerSearch source while the calling component is mounted. Pass
 *  null to register nothing. Memoize the source object (see the file header). */
export function useBeakerSearchSource(source: BeakerSearchSource | null): void {
  const { registerSource, unregisterSource } = useBeakerSearchRegistry();
  useEffect(() => {
    if (source == null) return;
    registerSource(source);
    const { id } = source;
    return () => unregisterSource(id);
  }, [source, registerSource, unregisterSource]);
}
