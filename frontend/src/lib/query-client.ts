/**
 * Module-level singleton `QueryClient` for the app.
 *
 * Shared by `lib/providers.tsx`'s top-level `QueryClientProvider` AND
 * by non-React-tree consumers that need to invalidate / refetch
 * queries (e.g. the onboarding-v4 cursor scripts that fire
 * programmatic API calls outside the component tree — see
 * `GanttDependenciesStep`'s chained-deps cascade-reschedule).
 *
 * Created once at module load. Defaults match the previous in-component
 * `useState(() => new QueryClient(...))` init in providers.tsx
 * (`staleTime: 0`, no `refetchOnWindowFocus`), so query behavior is
 * unchanged for consumers that already used the client via context.
 *
 * Why a separate file (not just an export from providers.tsx): pulling
 * `providers.tsx` into a non-React-tree caller would drag in
 * `FileSystemProvider`, `V4MountForUser`, the onboarding orchestrator,
 * and a dozen other module-load side effects. The cursor scripts that
 * need the client should be able to import it from a small, dependency-
 * free module. Tests that exercise step bodies (which import this file
 * transitively) get a fast, lightweight import.
 */
import { QueryClient } from "@tanstack/react-query";

export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  },
});
