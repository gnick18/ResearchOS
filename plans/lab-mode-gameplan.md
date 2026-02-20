# Lab Mode Feature - Implementation Gameplan

## Overview

Lab Mode is a special "view-only" login that provides access to view, search, and export all data across all users in the system. This is designed for PIs, lab managers, and students to find notes from each other or review work from past researchers.

---

## Codebase Verification: Dynamic Usernames

The existing codebase has been verified to use dynamic usernames throughout:

### Backend (`backend/app/routers/users.py`)
- ✅ Uses `settings.current_user` for all user-specific operations
- ✅ `_get_available_users()` dynamically scans the users directory
- ✅ No hardcoded username references in user management
- ⚠️ **Needs update:** `RESERVED_USERNAMES` should include `'lab'`

### Backend (`backend/app/storage.py`)
- ✅ Uses `settings.current_user` dynamically in `_data_root()`
- ✅ All store operations use dynamic paths based on current user

### Frontend (`frontend/src/lib/api.ts`)
- ✅ All API calls use the backend endpoints (no hardcoded usernames)
- ✅ User list comes from `/users` endpoint dynamically

### Frontend (`frontend/src/components/UserLoginScreen.tsx`)
- ✅ Users are loaded dynamically via `usersApi.list()`
- ✅ Login uses dynamic username from user selection
- ✅ Rename functionality updates local state dynamically

**Conclusion:** The codebase is already designed with dynamic usernames. Lab Mode implementation will:
1. Add `'lab'` to `RESERVED_USERNAMES` in `users.py`
2. Use `is_lab_user()` helper for all Lab Mode checks
3. Update user metadata on rename operations

---

## Key Features Summary

1. **Special Lab Login** - A dedicated "Lab" account with view-only permissions
2. **Cross-User Data Access** - View all tasks, methods, experiments, results across all users
3. **Draggable User Filter Button** - Floating button to filter which users' data is displayed
4. **Unique User Colors** - Each user assigned a unique color for visual identification
5. **Privacy Controls** - High-level goals are private and not shown in Lab view
6. **Gantt Chart Filtering** - List tasks hidden from Gantt but searchable
7. **User Creation Tracking** - Track when user profiles are created

---

## Phase 1: Backend - User Metadata & Lab Infrastructure

### 1.1 User Metadata Storage

**File:** `backend/app/routers/users.py`

Create a user metadata system to track:
- `created_at` - When the user profile was created
- `color` - Unique color assigned to the user for Lab view

**Implementation:**
```
data/users/_user_metadata.json
{
  "username1": {
    "created_at": "2024-01-15T10:30:00Z",
    "color": "#3b82f6"
  },
  "username2": {
    "created_at": "2024-02-20T14:45:00Z",
    "color": "#10b981"
  }
}
```

### 1.2 Color Assignment Algorithm

**File:** `backend/app/routers/users.py`

Create a function to assign unique colors when new users are created:
- Maintain a palette of distinct, visually distinguishable colors
- Assign the next available color when a user is created
- Ensure no color conflicts across users
- **Free up colors when users are deleted** (make available for reuse)

**Color Palette (20+ distinct colors):**
```python
USER_COLOR_PALETTE = [
  "#3b82f6",  # Blue
  "#10b981",  # Emerald
  "#f59e0b",  # Amber
  "#ef4444",  # Red
  "#8b5cf6",  # Purple
  "#ec4899",  # Pink
  "#06b6d4",  # Cyan
  "#84cc16",  # Lime
  "#f97316",  # Orange
  "#6366f1",  # Indigo
  "#14b8a6",  # Teal
  "#a855f7",  # Violet
  "#eab308",  # Yellow
  "#22c55e",  # Green
  "#0ea5e9",  # Sky
  "#d946ef",  # Fuchsia
  "#f43f5e",  # Rose
  "#7c3aed",  # Violet
  "#059669",  # Emerald dark
  "#2563eb",  # Blue dark
]
```

### 1.3 User Deletion with Confirmation

**File:** `backend/app/routers/users.py`

Add user deletion endpoint with two-step confirmation:
- DELETE `/api/users/{username}` requires `confirmation_step` parameter
- Step 1: Show warning about data removal from folder
- Step 2: Show warning recommending data backup
- Only proceed if both steps confirmed
- Free up the user's assigned color for reuse
- **Update `_user_metadata.json` to remove the user entry**

```python
class DeleteUserRequest(BaseModel):
    confirmation_step: int  # 1 or 2
    acknowledged_warning: bool

@router.delete("/{username}")
async def delete_user(username: str, request: DeleteUserRequest):
    # Two-step confirmation required
    # Free color assignment after deletion
    # Update user metadata
```

### 1.4 User Rename & Metadata Sync

**File:** `backend/app/routers/users.py`

The existing rename functionality needs to sync with user metadata:

When a user is renamed:
1. **Update `_user_metadata.json`** - rename the key from old username to new
2. **Preserve `created_at`** - keep the original creation date
3. **Preserve `color`** - keep the assigned color (it's tied to the user, not the name)

```python
# In _rename_user_folder(), also update metadata:
def _update_user_metadata_on_rename(old_username: str, new_username: str):
    metadata = _read_user_metadata()
    if old_username in metadata["users"]:
        # Move the user entry to the new key
        metadata["users"][new_username] = metadata["users"].pop(old_username)
        # Update color assignment
        for color, user in metadata["color_assignments"].items():
            if user == old_username:
                metadata["color_assignments"][color] = new_username
        _write_user_metadata(metadata)
```

**Reserved usernames** (cannot be created or renamed to):
- `public` - used for shared methods
- `lab` - reserved for Lab Mode account
- `.git`, `.github` - system folders

### 1.5 Lab User Detection

**File:** `backend/app/config.py`

Add a special user detection:
```python
# Reserved username for Lab Mode - stored in config, not hardcoded elsewhere
LAB_USER = "lab"  # Reserved username for Lab Mode

def is_lab_user() -> bool:
    return settings.current_user == LAB_USER
```

**Important:** Throughout the codebase, use `settings.current_user` dynamically rather than hardcoding usernames. The Lab Mode checks should use the `is_lab_user()` helper function.

### 1.6 Lab API Endpoints

**New File:** `backend/app/routers/lab.py`

Create dedicated Lab Mode endpoints:

```python
# GET /api/lab/users - List all users with metadata (colors, created_at)
# GET /api/lab/tasks - Get all tasks across all users
# GET /api/lab/projects - Get all projects across all users  
# GET /api/lab/methods - Get all methods across all users
# GET /api/lab/experiments - Get all experiment tasks across all users
# GET /api/lab/results - Get all results across all users
# GET /api/lab/search - Cross-user search endpoint
```

### 1.5 Cross-User Data Aggregation

**File:** `backend/app/storage.py`

Add functions to read data across all user directories:

```python
def get_all_users_data() -> List[Dict]:
    """Get metadata for all users."""
    
def get_tasks_for_all_users(exclude_goals: bool = True) -> List[Dict]:
    """Get tasks from all user directories, excluding high-level goals."""
    
def get_projects_for_all_users() -> List[Dict]:
    """Get projects from all user directories."""
```

### 1.6 Read-Only Enforcement

**File:** `backend/app/routers/dependencies.py`

Add middleware/dependency to block write operations for Lab user:
```python
async def require_not_lab_user():
    if settings.current_user == "lab":
        raise HTTPException(
            status_code=403, 
            detail="Lab mode is view-only. Cannot modify data."
        )
```

Apply to all POST/PUT/DELETE endpoints.

---

## Phase 2: Frontend - Lab Mode Login

### 2.1 Lab Login Option

**File:** `frontend/src/components/UserLoginScreen.tsx`

Add a special "Lab Mode" button on the login screen:
- Distinct styling (e.g., microscope icon, different color)
- **DISABLED/UNCICKABLE if no users exist yet** (grayed out with tooltip)
- Clicking it logs in as the "lab" user
- Shows description: "View all researchers' work (read-only)"

```tsx
// Check if there are any users (excluding 'lab' and 'public')
const hasUsers = users.filter(u => u !== 'lab').length > 0;

<button 
  disabled={!hasUsers}
  title={!hasUsers ? "No users exist yet" : ""}
  // ... styling
>
  Lab Mode
</button>
```

### 2.2 Lab User Auto-Creation

**File:** `backend/app/routers/users.py`

Ensure "lab" user folder exists on startup:
- Create if doesn't exist
- No need for full user folder structure (lab user reads from all users)

---

## Phase 3: Frontend - Lab Mode UI

### 3.1 Lab Mode Page Structure

**New File:** `frontend/src/app/lab/page.tsx`

Create the main Lab Mode page with:
- Full-width Gantt chart view
- Search sidebar
- User filter floating button
- Read-only task detail popups

### 3.2 Draggable User Filter Button

**New File:** `frontend/src/components/LabUserFilterButton.tsx`

Features:
- Floating button positioned fixed on screen
- Draggable to reposition (remember position in localStorage)
- Shows count of selected users
- Click to expand into circle icons
- **All users selected by default**

**Expanded State:**
- Circle icons for each user (sorted by created_at)
- User's assigned color as background
- Toggle select/deselect all button
- Click user to toggle visibility
- Border around selected users

```tsx
interface LabUserFilterButtonProps {
  users: LabUser[];
  selectedUsernames: Set<string>;
  onToggleUser: (username: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

interface LabUser {
  username: string;
  color: string;
  created_at: string;
}
```

### 3.3 Lab Gantt Chart

**Modified:** `frontend/src/components/GanttChart.tsx`

Changes for Lab Mode:
- Accept `isLabMode` prop
- Use user colors instead of project colors
- Hide list-type tasks (`task_type === "list"`)
- Show username labels on tasks
- Different styling for cross-user view

### 3.4 Lab Task Detail Popup

**New File:** `frontend/src/components/LabTaskDetailPopup.tsx`

Read-only version of TaskDetailPopup:
- No edit buttons
- No delete options
- No date changes
- Export functionality still available
- Shows "View Only" badge
- Displays which user owns the task

### 3.5 Lab Search Component

**New File:** `frontend/src/components/LabSearchPanel.tsx`

Enhanced search for Lab Mode:
- Search across all users
- Filter by user (multi-select)
- Filter by date range
- Filter by task type (experiment, purchase - include lists in search)
- Filter by method
- Results show user color and username

---

## Phase 4: Privacy & Filtering

### 4.1 High-Level Goals Exclusion

**Files:** 
- `backend/app/routers/lab.py`
- `frontend/src/app/lab/page.tsx`

Ensure high-level goals are:
- Never returned from Lab API endpoints
- Not shown in Lab Gantt chart
- Not searchable in Lab search

### 4.2 List Task Handling

**Files:**
- `frontend/src/components/GanttChart.tsx`
- `frontend/src/components/LabSearchPanel.tsx`

- List tasks hidden from Gantt chart in Lab Mode
- List tasks still searchable in Lab search
- Clear visual distinction in search results

---

## Phase 5: Export & Additional Features

### 5.1 Export Functionality with User Attribution

**File:** `frontend/src/lib/export-utils.ts`

Allow exports in Lab Mode AND individual user profiles:
- Export task details as PDF
- Export search results
- Export experiment chains
- **Include user attribution in ALL exports** (both Lab Mode and individual profiles)

**Export format includes:**
```
Exported from ResearchOS
User: [username]
Date: [export date]
Task/Project: [name]
...
```

This applies to:
- PDF exports from Lab Mode
- PDF exports from individual user profiles
- Search result exports
- Experiment chain exports

### 5.2 User Color Legend

**New File:** `frontend/src/components/LabUserLegend.tsx`

Optional sidebar/panel showing:
- All users with their colors
- Quick toggle for visibility
- User creation dates

---

## Implementation Order

### Sprint 1: Backend Foundation
1. [x] Create user metadata system (`_user_metadata.json`)
2. [x] Add `created_at` tracking for new users
3. [x] Implement color assignment algorithm with reuse on deletion
4. [x] Add user deletion endpoint with two-step confirmation
5. [x] Update rename endpoint to sync with user metadata
6. [x] Add "lab" to reserved usernames list
7. [x] Create Lab API router (`/api/lab/*`)
8. [x] Add cross-user data aggregation functions
9. [x] Implement read-only enforcement middleware

### Sprint 2: Lab Login & Basic UI
7. [x] Add Lab Mode button to login screen
8. [x] Create Lab Mode page (`/lab`)
9. [x] Implement basic cross-user data display
10. [ ] Create read-only task detail popup

### Sprint 3: User Filter System
11. [ ] Create draggable user filter button
12. [ ] Implement user selection state management
13. [x] Add user color system to frontend
14. [x] Connect filter to data display

### Sprint 4: Gantt & Search
15. [ ] Modify Gantt chart for Lab Mode
16. [ ] Hide list tasks from Lab Gantt
17. [ ] Create Lab search panel
18. [ ] Implement cross-user search

### Sprint 5: Polish & Privacy
19. [x] Ensure high-level goals are excluded
20. [ ] Add export functionality
21. [ ] Test read-only enforcement
22. [ ] UI polish and accessibility

---

## Database/Storage Schema Changes

### New File: `data/users/_user_metadata.json`

```json
{
  "version": 1,
  "users": {
    "john_doe": {
      "created_at": "2024-01-15T10:30:00Z",
      "color": "#3b82f6"
    },
    "jane_smith": {
      "created_at": "2024-02-20T14:45:00Z",
      "color": "#10b981"
    }
  },
  "color_assignments": {
    "#3b82f6": "john_doe",
    "#10b981": "jane_smith"
  }
}
```

### Migration for Existing Users

Create migration script to:
1. Scan all existing user folders
2. Assign colors to each existing user
3. Set `created_at` to folder creation time (or current time if unavailable)

---

## API Endpoints Summary

### New Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/lab/users` | List all users with metadata |
| GET | `/api/lab/tasks` | All tasks across users (excl. goals) |
| GET | `/api/lab/projects` | All projects across users |
| GET | `/api/lab/methods` | All methods across users |
| GET | `/api/lab/search` | Cross-user search |
| GET | `/api/lab/user/{username}/tasks` | Tasks for specific user |
| GET | `/api/lab/user/{username}/projects` | Projects for specific user |

### Modified Endpoints

All existing POST/PUT/DELETE endpoints should:
- Check if current user is "lab"
- Return 403 Forbidden if true

---

## Frontend Component Summary

### New Components

| Component | Purpose |
|-----------|---------|
| `LabUserFilterButton` | Draggable floating button for user selection |
| `LabTaskDetailPopup` | Read-only task detail view |
| `LabSearchPanel` | Cross-user search interface |
| `LabUserLegend` | Optional color legend sidebar |

### Modified Components

| Component | Changes |
|-----------|---------|
| `UserLoginScreen` | Add Lab Mode entry button |
| `GanttChart` | Support Lab Mode display options |
| `AppShell` | Detect and adapt for Lab Mode |

---

## Testing Checklist

- [ ] Lab user cannot create tasks
- [ ] Lab user cannot edit tasks
- [ ] Lab user cannot delete tasks
- [ ] Lab user cannot change dates
- [ ] High-level goals never visible
- [ ] List tasks hidden from Gantt
- [ ] List tasks searchable
- [ ] User colors are unique
- [ ] User filter persists across sessions
- [ ] Draggable button position saves
- [ ] Export works in Lab Mode
- [ ] Search returns correct cross-user results
- [ ] Lab Mode button disabled when no users exist
- [ ] User deletion requires two-step confirmation
- [ ] Colors freed when users deleted
- [ ] All users selected by default in filter
- [ ] Exports include user attribution (Lab Mode and individual profiles)
- [ ] User rename updates metadata (created_at preserved, color preserved)
- [ ] User rename updates color_assignments mapping
- [ ] "lab" username is reserved (cannot create or rename to "lab")
- [ ] Lab Mode uses dynamic username checks (not hardcoded)

---

## Decisions (Confirmed)

1. **Lab user creation**: ✅ Auto-created on first startup, BUT the Lab Mode button is disabled/unclickable if there are no usernames initialized yet.

2. **Color reassignment**: ✅ Colors are freed for reuse when users are deleted. Deletion requires TWO confirmation popups:
   - Popup 1: "This will remove the data from the folder the program is pointing to."
   - Popup 2: "We highly recommend copying the user's data before deleting them. Continue?"

3. **User filter default**: ✅ All users are selected by default.

4. **Export permissions**: ✅ Exports include user attribution. This applies to both Lab Mode exports AND exports from individual user profiles.

---

## Estimated Effort

| Phase | Estimated Hours |
|-------|-----------------|
| Sprint 1: Backend | 8-12 hours |
| Sprint 2: Login & UI | 6-8 hours |
| Sprint 3: User Filter | 8-10 hours |
| Sprint 4: Gantt & Search | 10-12 hours |
| Sprint 5: Polish | 4-6 hours |
| **Total** | **36-48 hours** |
