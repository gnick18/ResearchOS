# ResearchOS Architecture & Migration Documentation

> **Last Updated**: May 2026
> **Purpose**: Handoff document for future developers and AI models

---

## Executive Summary

ResearchOS is a research project management application that has been migrated from a FastAPI/Next.js split-stack architecture to a **fully client-side web application** using the File System Access API. The app now runs entirely in the browser with **no backend dependency**.

### Key Architecture Decisions
- **Browser Requirement**: Chrome, Edge, or Brave only (File System Access API not supported in Firefox/Safari)
- **Data Storage**: User's local file system (JSON files)
- **No Server Required**: Everything runs client-side
- **Multi-User Support**: Multiple users can share the same data folder with isolated data

---

## Architecture Overview

### Current Architecture (Post-Migration)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Browser (Chrome/Edge/Brave)                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                  Next.js 16 Frontend                          │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  React UI Components                                    │  │  │
│  │  │  - AppShell, GanttChart, TaskDetailPopup, etc.         │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  local-api.ts (API Layer - replaces backend)            │  │  │
│  │  │  - projectsApi, tasksApi, methodsApi, labApi, etc.      │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  Storage Layer                                          │  │  │
│  │  │  - JsonStore (CRUD operations)                          │  │  │
│  │  │  - file-service.ts (File System Access API)             │  │  │
│  │  │  - indexeddb-store.ts (Handle persistence)              │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                │                                    │
│                                ▼                                    │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │           Local Research Folder (User's File System)          │  │
│  │                                                                │  │
│  │   users/                                                       │  │
│  │     {username}/                                                │  │
│  │       projects/{id}.json                                       │  │
│  │       tasks/{id}.json                                          │  │
│  │       methods/{id}.json                                        │  │
│  │       goals/{id}.json                                          │  │
│  │       events/{id}.json                                         │  │
│  │       notes/{id}.json                                          │  │
│  │       dependencies/{id}.json                                   │  │
│  │       pcr_protocols/{id}.json                                  │  │
│  │       purchase_items/{id}.json                                 │  │
│  │       lab_links/{id}.json                                      │  │
│  │       Images/                                                  │  │
│  │       Files/                                                   │  │
│  │       _counters.json                                           │  │
│  │     public/                                                    │  │
│  │       methods/{id}.json        (Shared methods)                │  │
│  │       pcr_protocols/{id}.json  (Shared PCR protocols)          │  │
│  │     lab/                                                       │  │
│  │       funding_accounts/{id}.json                               │  │
│  │     _global_counters.json                                      │  │
│  │     _user_metadata.json                                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.1.6 | React framework with App Router |
| React | 19.2.3 | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4.x | Styling |
| React Query | 5.x | Server state management |
| Zustand | 5.x | Client state management |
| Zod | 3.x | Schema validation |
| date-fns | 4.x | Date manipulation |
| idb-keyval | 6.2.x | IndexedDB wrapper |
| JSZip | 3.10.x | ZIP file handling |

---

## Directory Structure

```
ResearchOS/
├── frontend/                    # PRIMARY CODEBASE
│   ├── src/
│   │   ├── app/                 # Next.js App Router pages
│   │   │   ├── page.tsx         # Home dashboard
│   │   │   ├── gantt/           # Gantt chart view
│   │   │   ├── experiments/     # Lab notes
│   │   │   ├── methods/         # Methods library
│   │   │   ├── purchases/       # Purchase tracking
│   │   │   ├── calendar/        # Calendar view
│   │   │   ├── lab/             # Lab mode (multi-user)
│   │   │   └── ...
│   │   ├── components/          # 50+ React components
│   │   │   ├── AppShell.tsx     # Main layout
│   │   │   ├── GanttChart.tsx   # Interactive Gantt
│   │   │   ├── TaskDetailPopup.tsx
│   │   │   ├── HybridMarkdownEditor.tsx
│   │   │   └── ...
│   │   └── lib/                 # Core logic
│   │       ├── local-api.ts     # API layer (1700+ lines)
│   │       ├── file-system/     # FSA integration
│   │       ├── storage/         # JsonStore class
│   │       ├── engine/          # Scheduling logic
│   │       ├── schemas/         # Zod schemas
│   │       └── ...
│   ├── public/                  # Static assets
│   └── package.json
│
├── installer/                   # Electron desktop installer (currently stale — see plans)
│   ├── src/
│   │   ├── main.js
│   │   └── renderer/
│   └── package.json
│
├── plans/                       # Feature planning documents
├── .kilo/plans/                 # Session handoff documents
└── README.md
```

---

## Key Files Reference

### Core Architecture Files

| File | Purpose |
|------|---------|
| `frontend/src/lib/local-api.ts` | **API replacement layer** - replaces all 15 FastAPI routers. Contains `projectsApi`, `tasksApi`, `methodsApi`, `labApi`, etc. (~1700 lines) |
| `frontend/src/lib/storage/json-store.ts` | **CRUD operations** - `JsonStore` class for reading/writing JSON files with auto-increment ID counters |
| `frontend/src/lib/file-system/file-service.ts` | **File System Access API wrapper** - handles directory picker, file read/write, directory iteration |
| `frontend/src/lib/file-system/file-system-context.tsx` | **React context** - provides connection state and current user to app |
| `frontend/src/lib/file-system/indexeddb-store.ts` | **Persistence** - stores directory handles and user info in IndexedDB |
| `frontend/src/lib/file-system/user-discovery.ts` | **User scanning** - discovers users from `users/` directory |
| `frontend/src/lib/schemas/index.ts` | **Zod schemas** - type definitions for all entities |

### Engine Files (Ported from Python)

| File | Purpose |
|------|---------|
| `frontend/src/lib/engine/dates.ts` | Date calculations, weekend handling, business day math |
| `frontend/src/lib/engine/shift.ts` | Dependency-aware task date shifting |

## File System Access API Integration

### How It Works

1. **User clicks "Connect Folder"**
2. **Browser shows native directory picker** (`showDirectoryPicker()`)
3. **User grants read/write permission**
4. **`fileService` stores `FileSystemDirectoryHandle`**
5. **App reads/writes JSON files directly**
6. **Handle stored in IndexedDB** for session persistence

### Key Implementation Details

```typescript
// file-service.ts - Core FSA wrapper
class FileService {
  private rootHandle: FileSystemDirectoryHandle | null = null;
  
  async connect(): Promise<boolean> {
    this.rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    return true;
  }
  
  async readJson<T>(path: string): Promise<T | null> {
    const file = await this.getFile(path);
    return JSON.parse(await file.text());
  }
  
  async writeJson(path: string, data: unknown): Promise<void> {
    // Navigate to directory, create file, write content
  }
}
```

### Browser Limitations

- **Handle not restorable** after page reload (browser security requirement)
- User must re-select folder after tab refresh/close
- **Only Chromium browsers supported** (Chrome, Edge, Brave)
- Firefox and Safari do not support File System Access API

---

## User Data Isolation

### Data Structure

Each user has their own isolated directory:

```
users/
  GrantNickles/
    projects/1.json
    tasks/1.json
    _counters.json
  TestUser/
    projects/1.json        # Different ID space!
    tasks/1.json
    _counters.json
  public/
    methods/               # Shared methods (global ID space)
  lab/
    funding_accounts/      # Lab-wide resources
  _global_counters.json    # IDs for shared entities
```

### Isolation Mechanism

The `JsonStore` class in `json-store.ts` handles user isolation:

```typescript
class JsonStore<T extends { id: number }> {
  private async getBasePath(): Promise<string> {
    const username = await getCurrentUserCached();
    return `users/${username}`;  // User-specific path
  }
  
  // For reading specific user's data (used by labApi)
  async listAllForUser(username: string): Promise<T[]> {
    const dirPath = `users/${username}/${this.entityName}`;
    // Read files from this specific user's directory
  }
}
```

### Lab Mode (Multi-User Aggregation)

Lab Mode shows data from all users. The `labApi` methods in `local-api.ts` use `discoverUsers()` to find all users and `listAllForUser()` to read each user's data:

```typescript
// labApi.getTasks() - aggregates from all users
getTasks: async () => {
  const allUsers = await discoverUsers();  // Find all user directories
  const tasks: LabTask[] = [];
  
  for (const username of allUsers) {
    const userTasks = await tasksStore.listAllForUser(username);
    // Add username attribution to each task
    tasks.push(...userTasks.map(t => ({ ...t, username })));
  }
  
  return tasks;
}
```

### Recent Fix: User Task Isolation (May 2026)

**Problem**: Lab Mode and user switching displayed all tasks from one user (GrantNickles) for every user.

**Root Cause**: `labApi` methods called `tasksStore.listAll()` which reads from the **current user's cached directory**, not from each user's individual directory.

**Solution**: 
1. Added `listAllForUser(username)` method to `JsonStore` class
2. Updated all `labApi` methods to use `discoverUsers()` + `listAllForUser()` pattern
3. Files modified:
   - `frontend/src/lib/storage/json-store.ts` - Added `listAllForUser()`
   - `frontend/src/lib/local-api.ts` - Updated `labApi.getTasks()`, `getProjects()`, `getExperiments()`, `getPurchases()`, `getUserTasks()`, `getUserProjects()`, `getNotes()`, `getMethods()`, `getUserPurchaseItems()`

---

## Counter System

Three-tier counter system for ID generation:

### Per-User Counters (`_counters.json`)
```json
{
  "projects": 5,
  "tasks": 42,
  "methods": 12
}
```
Each user has their own ID space for most entities.

### Public Counters (`users/public/_counters.json`)
For shared methods and PCR protocols.

### Global Counters (`users/_global_counters.json`)
For entities that need unique IDs across users (public methods, etc.).

---

## API Layer Structure

`local-api.ts` exports API objects that mirror the old FastAPI routers:

```typescript
export const projectsApi = {
  list: async (): Promise<Project[]>,
  get: async (id: number): Promise<Project | null>,
  create: async (data: ProjectCreate): Promise<Project>,
  update: async (id: number, data: ProjectUpdate): Promise<Project | null>,
  delete: async (id: number): Promise<void>,
  // ...
};

export const tasksApi = { /* ... */ };
export const methodsApi = { /* ... */ };
export const goalsApi = { /* ... */ };
export const eventsApi = { /* ... */ };
export const labApi = { /* ... */ };
export const usersApi = { /* ... */ };
export const settingsApi = { /* ... */ };
```

### Import Pattern

All components import from `@/lib/local-api`:

```typescript
import { projectsApi, tasksApi } from '@/lib/local-api';

// Usage
const projects = await projectsApi.list();
const task = await tasksApi.get(1);
```

---

## State Management

### React Query (Server State)

```typescript
// providers.tsx
const queryClient = new QueryClient();

// In components
const { data: projects } = useQuery({
  queryKey: ['projects'],
  queryFn: () => projectsApi.list(),
});
```

### Cache Invalidation on User Switch

```typescript
// providers.tsx - Invalidate all queries when user changes
useEffect(() => {
  if (currentUser) {
    queryClient.invalidateQueries();
  }
}, [currentUser]);
```

### Zustand (Client State)

```typescript
// storage/user-store.ts
export const useUserStore = create<UserState>((set) => ({
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),
}));
```

---

## Development Workflow

### Starting the App

```bash
cd frontend
npm install
npm run dev      # Starts on http://localhost:3000
```

No backend required!

### Building for Production

```bash
cd frontend
npm run build    # Static export
```

### Running Tests

```bash
cd frontend
npm test         # Uses vitest

# Or specific test file
npx vitest run src/lib/engine/dates.test.ts
```

### Linting

```bash
cd frontend
npm run lint
```

---

## Migration Status

### Completed
- [x] All 15 FastAPI routers replaced by `local-api.ts`
- [x] Pydantic schemas converted to Zod
- [x] Python scheduling engine ported to TypeScript
- [x] File System Access API integration
- [x] User discovery and login
- [x] CRUD operations functional
- [x] Gantt chart rendering
- [x] Markdown editor with image support
- [x] User data isolation in Lab Mode

### Remaining Work
- [ ] Test all CRUD operations for edge cases
- [ ] Clean up debug console.log statements

### Known Limitations
- Handle requires re-selection after page reload (browser security)
- Only Chromium browsers supported
- Sharing functionality is stubbed (returns empty arrays)

---

## Common Issues & Solutions

### Issue: User data not displaying after switch
**Solution**: Clear `currentUserCache` and invalidate React Query cache. See `file-system-context.tsx` and `providers.tsx`.

### Issue: "TypeMismatchError" when reading files
**Solution**: `getHandleByPath()` now tries `getFileHandle()` when `getDirectoryHandle()` fails. See `file-service.ts`.

### Issue: Gantt chart crash on tasks without dates
**Solution**: Filter tasks to exclude those without valid dates. See `GanttChart.tsx`.

### Issue: Lab Mode shows wrong user's data
**Solution**: Use `listAllForUser()` instead of `listAll()` in `labApi` methods. See recent fix in `local-api.ts`.

---

## Key React Components

| Component | Purpose |
|-----------|---------|
| `AppShell` | Main layout with navigation sidebar |
| `GanttChart` | Interactive Gantt visualization with drag-drop |
| `TaskDetailPopup` | Full-featured task editing modal |
| `TaskModal` | Quick task creation modal |
| `HybridMarkdownEditor` | Rich text editor with image support |
| `ResearchFolderSetupNew` | Folder connection flow |
| `UserLoginScreen` | User selection/login interface |
| `LabSearchPanel` | Multi-user search interface |
| `MethodsPanel` | Methods library browser |

---

## Pages (App Router)

| Route | File | Purpose |
|-------|------|---------|
| `/` | `app/page.tsx` | Home dashboard |
| `/gantt` | `app/gantt/page.tsx` | Gantt chart view |
| `/experiments` | `app/experiments/page.tsx` | Lab notes |
| `/methods` | `app/methods/page.tsx` | Methods library |
| `/purchases` | `app/purchases/page.tsx` | Purchase tracking |
| `/results` | `app/results/page.tsx` | Results editor |
| `/calendar` | `app/calendar/page.tsx` | Calendar view |
| `/search` | `app/search/page.tsx` | Search interface |
| `/links` | `app/links/page.tsx` | Lab links |
| `/pcr` | `app/pcr/page.tsx` | PCR protocols |
| `/lab` | `app/lab/page.tsx` | Lab mode (all users) |

---

## Schema Definitions

All entity schemas are defined in `frontend/src/lib/schemas/index.ts` using Zod:

```typescript
export const ProjectSchema = z.object({
  id: z.number(),
  name: z.string(),
  weekend_active: z.boolean(),
  tags: z.array(z.string()).nullable(),
  color: z.string().nullable(),
  created_at: z.string(),
  sort_order: z.number(),
  is_archived: z.boolean(),
  archived_at: z.string().nullable(),
  owner: z.string(),
  shared_with: z.array(z.string()),
});

export const TaskSchema = z.object({
  id: z.number(),
  project_id: z.number(),
  name: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  duration_days: z.number(),
  is_complete: z.boolean(),
  is_high_level: z.boolean(),
  task_type: z.enum(['experiment', 'purchase', 'list']),
  // ... more fields
});
```

---

## Future Considerations

1. **Sharing**: Implement real sharing functionality (currently stubbed)
2. **Performance**: Consider lazy loading for large datasets
3. **Mobile**: File System Access API not available on mobile browsers

---

## Contact & Support

For questions or issues:
- Open an issue on GitHub
- Check `plans/` directory for feature-specific documentation
- Check `.kilo/plans/` for session handoff documents
