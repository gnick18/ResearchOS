# Serverless Migration - Session Handoff

## Project Overview
ResearchOS is being migrated from a FastAPI/Next.js split-stack to a serverless local-first architecture using the File System Access API. The app now runs entirely client-side with no backend dependency.

## Current Status: Working

The app successfully:
- Connects to a local research folder
- Discovers and lists users from the file system
- Allows user switching
- Reads and displays user data (notes, projects, tasks, etc.)
- Gantt chart renders correctly

## Session Work Completed

### Bug Fix 1: User Data Not Displaying After Switch
**Root causes**:
1. `json-store.ts` caches `currentUser` in a module-level variable that wasn't cleared on user switch
2. React Query caches didn't include the user in query keys, so stale data was returned

**Fixes applied**:
- `frontend/src/lib/file-system/file-system-context.tsx`: Import `clearCurrentUserCache` and call it in `setCurrentUser()`
- `frontend/src/lib/providers.tsx`: Added `useEffect` to invalidate all React Query queries when `currentUser` changes

### Bug Fix 2: File Read Error
**Error**: `TypeMismatchError: The path supplied exists, but was not an entry of requested type`

**Root cause**: In `file-service.ts`, `getHandleByPath()` tried `getDirectoryHandle()` first for each path segment. When reading a file like `notes/9.json`, it failed on `getDirectoryHandle("9.json")` and returned `null` instead of trying `getFileHandle()`.

**Fix**: Added fallback to try `getFileHandle()` when `getDirectoryHandle()` fails for the last path segment.

### Bug Fix 3: Gantt Chart Crash
**Error**: `Cannot read properties of undefined (reading 'split')` in `parseLocalDate()`

**Root cause**: Some tasks loaded from JSON files may have missing `start_date` or `end_date` fields.

**Fix**: 
- Added filter in `filteredTasks` to exclude tasks without valid dates
- Added null check in `parseLocalDate()` as safeguard

## Files Modified This Session

1. `frontend/src/lib/file-system/file-system-context.tsx`
   - Added import for `clearCurrentUserCache`
   - Call `clearCurrentUserCache()` at start of `setCurrentUser()`

2. `frontend/src/lib/providers.tsx`
   - Added useEffect to invalidate queries when currentUser changes

3. `frontend/src/lib/file-system/file-service.ts`
   - Fixed `getHandleByPath()` to try `getFileHandle()` when `getDirectoryHandle()` fails

4. `frontend/src/components/GanttChart.tsx`
   - Filter tasks to exclude those without valid dates
   - Added null check in `parseLocalDate()`

## Architecture Summary

### Folder Structure
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

### Key Files
- `frontend/src/lib/file-system/file-service.ts` - FileSystemAccess API wrapper
- `frontend/src/lib/storage/json-store.ts` - CRUD operations with ID counters
- `frontend/src/lib/local-api.ts` - Replaces all 15 FastAPI routers
- `frontend/src/lib/file-system/file-system-context.tsx` - React context for connection state

## Remaining Work

### High Priority
1. Test all CRUD operations - create/edit/delete for projects, tasks, methods, etc.
2. Test image handling in markdown editor
3. Test dependency shifting in Gantt chart

### Medium Priority
4. Git sync with isomorphic-git for GitHub backup
5. Lab Mode - verify aggregated view of all users' data

### Deferred
6. Remove backend/ directory when ready
7. Remove debug console.log statements

## Known Issues
- Debug console.log statements still in code
- Page reloads require re-selecting folder (FileSystemDirectoryHandle can't be restored - by design)
