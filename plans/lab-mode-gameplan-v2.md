# Lab Mode Feature - Implementation Gameplan v2

## Overview

Lab Mode is a special "view-only" login that provides access to view, search, and export all data across all users in the system. This is designed for PIs, lab managers, and students to find notes from each other or review work from past researchers.

---

## Current Implementation Status (Updated)

### ✅ Fully Implemented

#### Backend Infrastructure
- User metadata system with `_user_metadata.json` (colors, created_at)
- Color assignment algorithm with 20 distinct colors
- User deletion with two-step confirmation
- User rename with metadata sync
- "lab" in reserved usernames
- Lab API router (`/api/lab/*`) with endpoints:
  - `GET /api/lab/users` - List all users with metadata
  - `GET /api/lab/tasks` - All tasks across users (excl. goals)
  - `GET /api/lab/projects` - All projects across users
  - `GET /api/lab/methods` - All methods across users
  - `GET /api/lab/experiments` - All experiment tasks
  - `GET /api/lab/purchases` - All purchase tasks
  - `GET /api/lab/search` - Cross-user search
- High-level goals excluded from all Lab endpoints

#### Frontend - Login
- Lab Mode button on login screen
- Disabled/grayed out when no users exist
- Auto-creates lab user folder on login

#### Frontend - Lab Page ([`frontend/src/app/lab/page.tsx`](frontend/src/app/lab/page.tsx))
- Tab structure: GANTT, Experiments, Purchases, Search
- Stats display (Total Users, Projects, Experiments, Purchases)
- User filter integration across all views

#### Frontend - Draggable User Filter Button ([`frontend/src/components/LabUserFilterButton.tsx`](frontend/src/components/LabUserFilterButton.tsx))
- Floating button positioned fixed on screen
- Draggable to reposition (position saved in localStorage)
- Shows count of selected users
- Click to expand into circle icons
- All users selected by default
- Users sorted by created_at (oldest first)
- Toggle select/deselect all button
- Border around selected users
- Click user to toggle visibility

#### Frontend - Lab GANTT Chart ([`frontend/src/components/LabGanttChart.tsx`](frontend/src/components/LabGanttChart.tsx))
- Read-only GANTT chart showing all users' tasks
- **User colors** for task bars (not project colors)
- List tasks hidden from GANTT
- High-level goals excluded
- Username indicator on each task bar
- View mode selector (1W, 2W, 3W, 1M, 3M, 6M, 1Y)
- "Navigate to Tasks" button when tasks are outside visible date range
- Click opens LabTaskDetailPopup

#### Frontend - Lab Experiments Panel ([`frontend/src/components/LabExperimentsPanel.tsx`](frontend/src/components/LabExperimentsPanel.tsx))
- Shows all experiments from selected users
- Organized by username AND project name
- Grouped view and table view options
- User colors for visual attribution
- Click to view details in LabTaskDetailPopup

#### Frontend - Lab Purchases Panel ([`frontend/src/components/LabPurchasesPanel.tsx`](frontend/src/components/LabPurchasesPanel.tsx))
- Shows all purchases from selected users
- Organized by username AND project name
- Grouped view and table view options
- User colors for visual attribution
- Click to view details in LabTaskDetailPopup

#### Frontend - Lab Search Panel ([`frontend/src/components/LabSearchPanel.tsx`](frontend/src/components/LabSearchPanel.tsx))
- Cross-user search
- Task type filters (experiment, purchase, list)
- User attribution in results
- Search includes lists (as required)

#### Frontend - Lab Task Detail Popup ([`frontend/src/components/LabTaskDetailPopup.tsx`](frontend/src/components/LabTaskDetailPopup.tsx))
- Read-only task detail view
- Shows user attribution
- "View Only" badge

---

## Tab Structure

```
Lab Mode Page
├── GANTT Tab
│   └── Lab GANTT Chart
│       ├── User-colored task bars
│       ├── No lists shown
│       └── Read-only
├── Experiments Tab
│   └── Experiments List
│       ├── Grouped by username, then project
│       ├── User attribution
│       └── Read-only
├── Purchases Tab
│   └── Purchases Table
│       ├── Grouped by username, then project
│       ├── User attribution
│       └── Read-only
└── Search Tab
    └── Cross-user Search
        ├── Includes lists
        └── User attribution
```

---

## Privacy Controls Summary

| Data Type | Shown in Lab Mode | Notes |
|-----------|-------------------|-------|
| High-level Goals | ❌ NO | Private to each user |
| Regular Tasks | ✅ YES | Shown in GANTT, Search |
| List Tasks | ❌ GANTT, ✅ Search | Hidden from GANTT, searchable |
| Experiments | ✅ YES | Dedicated tab + GANTT |
| Purchases | ✅ YES | Dedicated tab |
| Projects | ✅ YES | With user colors |
| Methods | ✅ YES | Searchable |

---

## Files Created/Modified

### New Files Created
1. `frontend/src/components/LabGanttChart.tsx` - Read-only GANTT for Lab Mode
2. `frontend/src/components/LabPurchasesPanel.tsx` - Purchases view
3. `frontend/src/components/LabExperimentsPanel.tsx` - Experiments view

### Files Modified
1. `frontend/src/app/lab/page.tsx` - Restructured tabs, added new views
2. `backend/app/routers/lab.py` - Added purchases endpoint
3. `frontend/src/lib/api.ts` - Added API functions for new endpoints

---

## Testing Checklist

### User Filter Button
- [x] Button is draggable and position persists
- [x] Clicking toggles expanded state
- [x] Users sorted by created_at (oldest first)
- [x] Select/Deselect All works correctly
- [x] Selected users have border
- [x] Unselected users are faded
- [x] Filter applies to all views (GANTT, Experiments, Purchases, Search)

### GANTT View
- [x] Shows all tasks from selected users
- [x] Task bars use user colors (not project colors)
- [x] List tasks are hidden
- [x] High-level goals are hidden
- [x] Clicking task opens read-only detail popup
- [x] No drag/drop functionality
- [x] No dependency creation
- [x] "Navigate to Tasks" button when tasks outside date range

### Experiments View
- [x] Shows all experiments from selected users
- [x] Organized by username AND project name
- [x] User attribution with user colors
- [x] Read-only detail view

### Purchases View
- [x] Shows all purchases from selected users
- [x] Organized by username AND project name
- [x] User attribution with user colors
- [x] Read-only detail view

### Search
- [x] Searches across all selected users
- [x] Includes list tasks in results
- [x] High-level goals excluded
- [x] User attribution shown

### Privacy
- [x] High-level goals never visible anywhere
- [x] All data is read-only (no edit buttons)
- [x] No create/delete functionality

---

## Known Issues / Debugging

### GANTT Chart Not Displaying

If the GANTT chart shows "No tasks to display" or "No tasks in the current date range":

1. **Check if tasks exist**: The diagnostic message shows `Total tasks: X | Selected users: Y | Filtered: Z`
2. **Check date range**: Tasks may be scheduled outside the current view. Use the "Navigate to Tasks" button.
3. **Check user selection**: Make sure users are selected in the floating filter button.
4. **Check task types**: List tasks are hidden from GANTT (but searchable).

The GANTT chart includes a "Navigate to Tasks" button that appears when tasks exist but are outside the visible date range. Clicking it will adjust the GANTT start date to show the earliest tasks.

---

## Summary

The Lab Mode feature is now **fully implemented** with:
- ✅ Backend infrastructure complete
- ✅ User metadata and colors working
- ✅ Draggable user filter button implemented
- ✅ GANTT chart view with user colors
- ✅ Dedicated Experiments view (organized by username AND project)
- ✅ Dedicated Purchases view (organized by username AND project)
- ✅ Search functionality working (includes lists)
- ✅ Read-only task detail popup
- ✅ High-level goals excluded from all views
- ✅ List tasks hidden from GANTT but searchable
