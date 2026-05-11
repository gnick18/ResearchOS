# ResearchOS Serverless Migration Status

## Overview
Migrating ResearchOS from FastAPI/Next.js split-stack to serverless local-first architecture using File System Access API. The app now runs entirely client-side with no backend dependency.

## Completed Work

### Core Infrastructure
- Added dependencies: zod, date-fns, idb-keyval, isomorphic-git
- Created file-system module with IndexedDB persistence
- Created storage module with JsonStore class for CRUD operations
- Ported engine modules (dates.ts, shift.ts) from Python
- Converted all Pydantic schemas to Zod
- Created local-api.ts replacing all 15 FastAPI routers

### Testing
- Ported test_dates.py to TypeScript (25 tests passing)
- Build succeeds with all pages compiling as static content

### UI Integration
- FileSystemProvider wraps app for connection state
- ResearchFolderSetupNew.tsx handles folder connection flow
- HybridMarkdownEditor.tsx updated to use BlobUrlResolver for local images
- All 46 files updated to use @/lib/local-api instead of @/lib/api

### Recent Bug Fixes (Just Completed)
1. **Directory iteration bug**: `for await...of` on FileSystemDirectoryHandle needed `.values()` method
2. **User validation bug**: `usersApi.validate()` was returning empty string - now reads from IndexedDB
3. **User discovery**: `usersApi.list()` now properly discovers users from file system
4. **User login/create**: Now stores current user in IndexedDB

## Key Technical Details

### Folder Structure Expected
```
{data_repo}/
  users/
    {username}/
      projects/{id}.json
      tasks/{id}.json
      dependencies/{id}.json
      methods/{id}.json
      events/{id}.json
      goals/{id}.json
      pcr_protocols/{id}.json
      purchase_items/{id}.json
      lab_links/{id}.json
      notes/{id}.json
      Images/
      Files/
      _counters.json
    public/
      methods/{id}.json
      pcr_protocols/{id}.json
    lab/
      funding_accounts/{id}.json
    _global_counters.json
```

### Three Counter System
- `_counters.json` per user for user-level IDs
- `_public_counters.json` for public method/protocol IDs  
- `_global_counters.json` for global IDs

### Image Path Support
Three patterns supported: `../../Images/*`, `./Images/*`, `Images/*`

### Browser Compatibility
File System Access API only works in Chromium browsers (Chrome, Edge, Brave)

## Current State
- App successfully connects to local folder
- User discovery works (finds Grant, FakeResearcher, KritikaChopra, GrantNickles)
- User login/selection works
- App transitions to main view after login

## Remaining Work

### High Priority
1. **Test all CRUD operations** - Verify projects, tasks, methods, etc. can be created/edited/deleted
2. **Test image handling** - Verify images load correctly in markdown editor
3. **Test Gantt chart** - Verify shift.ts dependency logic works correctly

### Medium Priority
4. **Git sync** - isomorphic-git integration for GitHub backup (git-service.ts created but not tested)
5. **Lab Mode** - Verify aggregated view of all users' data works

### Deferred
6. **Remove backend directory** - Delete backend/ when ready (deferred per user)

## Known Issues
- Debug console.log statements still in code (can be removed after testing)
- Handle persistence across page reloads requires re-selecting folder (by design - FileSystemDirectoryHandle can't be reliably restored)

## Files Created
```
frontend/src/lib/
├── file-system/
│   ├── indexeddb-store.ts      # Handle & user persistence
│   ├── file-service.ts         # FSA wrapper
│   ├── file-system-context.tsx # React context
│   └── user-discovery.ts       # User scanning
├── storage/
│   ├── json-store.ts           # CRUD + counters
│   └── user-store.ts           # Zustand user state
├── engine/
│   ├── dates.ts                # Date utilities
│   ├── dates.test.ts           # Unit tests
│   └── shift.ts                # Dependency shift
├── schemas/
│   └── index.ts                # Zod schemas
├── git/
│   └── git-service.ts          # isomorphic-git wrapper
├── utils/
│   └── blob-url-resolver.ts    # Image URL resolution
└── local-api.ts                # API replacement (1700+ lines)

frontend/src/components/
└── ResearchFolderSetupNew.tsx  # FSA-based setup
```

## Next Steps for New Agent
1. Run `npm run dev` in frontend directory
2. Test creating/editing projects and tasks
3. Test image upload and display in markdown
4. Test Gantt chart dependency shifting
5. Remove debug console.log statements after testing
6. Consider removing backend/ directory when confident
