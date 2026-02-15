# Refresh Bug Diagnosis: UI Not Updating After Mutations

## Symptom
When tasks are moved (drag in Gantt chart), deleted, methods are moved to new folders, or other changes are made, the change succeeds on the backend but the frontend UI does not update. A full page refresh shows the correct state, confirming the backend is correct. Issue persists in incognito mode. **Bug affects ALL pages, not just Gantt** — also Methods page folder moves, etc.

## Root Causes Identified

### 🔴 Critical: `invalidateQueries` Not Reliably Triggering Refetches (PRIMARY CAUSE)

Throughout the app, mutations are followed by `queryClient.invalidateQueries(...)` — but this is causing two problems:

**Problem A: `invalidateQueries` is not being awaited.** In nearly every mutation handler, the pattern is:

```typescript
await someApi.update(...);
queryClient.invalidateQueries({ queryKey: ["methods"] }); // NOT awaited
setDraggedMethod(null); // state change fires immediately
```

The `invalidateQueries` call returns a Promise, but it's never awaited. The subsequent state changes (`setDraggedMethod(null)`, `onClose()`, etc.) trigger a re-render **before the refetch completes**. The component re-renders with the OLD cached data. In React 19's aggressive automatic batching, the refetch completion state update may get batched or deferred, causing the stale data to persist visually.

**Problem B: `staleTime: 5000` + `invalidateQueries` interaction.** The QueryClient is configured with `staleTime: 5 * 1000` in [`providers.tsx:12`](frontend/src/lib/providers.tsx:12). In TanStack Query v5, `invalidateQueries` marks queries as stale and triggers a background refetch — but the refetch result is a **background update**. If React 19's automatic batching defers or coalesces the state update from the refetch with other state changes, the UI may not reflect the new data immediately.

**Evidence:** This pattern appears everywhere and affects ALL query types:
- [`methods/page.tsx:132`](frontend/src/app/methods/page.tsx:132) — method folder move: `invalidateQueries` not awaited
- [`TaskDetailPopup.tsx:741`](frontend/src/components/TaskDetailPopup.tsx:741) — task delete: `invalidateQueries` not awaited + `onClose()` fires immediately
- [`TaskDetailPopup.tsx:653`](frontend/src/components/TaskDetailPopup.tsx:653) — task update: `invalidateQueries` not awaited
- [`TaskDetailPopup.tsx:914`](frontend/src/components/TaskDetailPopup.tsx:914) — subtask toggle: not awaited
- Many more across all components

**The fix:** Replace all `invalidateQueries` calls with **`await queryClient.refetchQueries()`** — this forces an immediate refetch AND awaits it, ensuring the cache is updated with fresh data BEFORE any state changes trigger re-renders.

### 🟡 High: No Backend Cache-Control Headers

The FastAPI backend in [`main.py`](backend/app/main.py) has no cache-control middleware. While browsers don't typically cache API responses aggressively, the absence of explicit `Cache-Control: no-store` headers means:
- Within a single session (even incognito), the browser MAY return a cached response for identical GET URLs
- When React Query refetches `/api/methods` or `/api/tasks/by-project/1`, the browser could serve the cached response from the initial page load
- This would cause the refetch to return stale data, making `invalidateQueries` appear to "not work"

### 🟡 Medium: Stale Closure in `["tasks"]` queryFn (tasks-specific)

The `["tasks"]` query is defined in 4 components with the same key but different `queryFn` implementations. Three close over `projects` from a parent query; one fetches inline. This is a secondary issue that compounds the primary problem for task-related mutations. See details below.

| Component | Closure Issue |
|---|---|
| [`gantt/page.tsx:45`](frontend/src/app/gantt/page.tsx:45) | Closes over `projects` |
| [`page.tsx:98`](frontend/src/app/page.tsx:98) | Closes over `projects` |
| [`DailyTasksSidebar.tsx:27`](frontend/src/components/DailyTasksSidebar.tsx:27) | Closes over `projects` |
| [`TaskDetailPopup.tsx:527`](frontend/src/components/TaskDetailPopup.tsx:527) | Fetches inline — different behavior |

### 🟡 Medium: GanttChart Experiment Colors Effect Loop (Gantt-specific)

[`GanttChart.tsx:703-741`](frontend/src/components/GanttChart.tsx:703) has a `useEffect` that fires on every task change, updates experiment colors via API, then triggers ANOTHER refetch. This creates a refetch loop that can interfere with normal mutation → refetch flow.

## Fix Plan

### Fix 1: Replace `invalidateQueries` with `await refetchQueries` Everywhere (HIGHEST PRIORITY)

This is the **single most impactful fix**. Change every instance of:
```typescript
queryClient.invalidateQueries({ queryKey: ["methods"] });
```
to:
```typescript
await queryClient.refetchQueries({ queryKey: ["methods"] });
```

`refetchQueries` forces an immediate fetch from the server and returns a Promise. Awaiting it ensures the cache has fresh data BEFORE any subsequent state changes re-render the component.

**Scope:** All files that call `invalidateQueries`:
- [`frontend/src/components/TaskDetailPopup.tsx`](frontend/src/components/TaskDetailPopup.tsx) — ~25 instances
- [`frontend/src/app/methods/page.tsx`](frontend/src/app/methods/page.tsx) — ~6 instances
- [`frontend/src/components/GanttChart.tsx`](frontend/src/components/GanttChart.tsx) — already uses `refetchQueries` ✓
- [`frontend/src/components/BulkMoveModal.tsx`](frontend/src/components/BulkMoveModal.tsx) — 2 instances
- [`frontend/src/components/TaskModal.tsx`](frontend/src/components/TaskModal.tsx) — 2 instances
- [`frontend/src/components/ProjectDetailPopup.tsx`](frontend/src/components/ProjectDetailPopup.tsx) — 4 instances
- [`frontend/src/components/HighLevelGoalModal.tsx`](frontend/src/components/HighLevelGoalModal.tsx) — 1 instance
- [`frontend/src/components/HighLevelGoalSidebar.tsx`](frontend/src/components/HighLevelGoalSidebar.tsx) — 2 instances
- [`frontend/src/components/DeviationModal.tsx`](frontend/src/components/DeviationModal.tsx) — 2 instances
- [`frontend/src/components/ExperimentPanel.tsx`](frontend/src/components/ExperimentPanel.tsx) — 4 instances
- [`frontend/src/components/PurchaseEditor.tsx`](frontend/src/components/PurchaseEditor.tsx) — 2 instances
- [`frontend/src/components/SidebarTree.tsx`](frontend/src/components/SidebarTree.tsx) — 2 instances
- [`frontend/src/components/MethodTabs.tsx`](frontend/src/components/MethodTabs.tsx) — ~8 instances
- [`frontend/src/app/page.tsx`](frontend/src/app/page.tsx) — 2 instances
- [`frontend/src/app/calendar/page.tsx`](frontend/src/app/calendar/page.tsx) — 3 instances
- [`frontend/src/app/pcr/page.tsx`](frontend/src/app/pcr/page.tsx) — 3 instances
- [`frontend/src/app/results/page.tsx`](frontend/src/app/results/page.tsx) — 1 instance

### Fix 2: Add Cache-Control Headers to Backend

Add middleware to [`backend/app/main.py`](backend/app/main.py) to prevent HTTP caching:

```python
@app.middleware("http")
async def add_cache_headers(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response
```

### Fix 3: Add Cache-Busting to Axios Requests

Configure the axios instance in [`frontend/src/lib/api.ts`](frontend/src/lib/api.ts) to prevent browser caching:

```typescript
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api",
  headers: {
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
  },
});
```

### Fix 4: Centralize the `["tasks"]` queryFn

Move the task-fetching logic to a shared function in [`api.ts`](frontend/src/lib/api.ts) that does NOT close over component state:

```typescript
export const fetchAllTasks = async () => {
  const projects = await projectsApi.list();
  const results = await Promise.all(
    projects.map((p) => tasksApi.listByProject(p.id))
  );
  return results.flat();
};
```

### Fix 5: Fix Experiment Colors Effect

Rewrite [`GanttChart.tsx:703-741`](frontend/src/components/GanttChart.tsx:703) to avoid triggering refetches on every render cycle.

## Implementation Priority

1. **Fix 1** — Replace `invalidateQueries` with `await refetchQueries` (fixes the global issue)
2. **Fix 2+3** — Cache-control headers + axios cache busting (defense in depth)
3. **Fix 4** — Centralize tasks queryFn (fixes task-specific stale closure)
4. **Fix 5** — Fix experiment colors effect (fixes Gantt-specific refetch loop)
