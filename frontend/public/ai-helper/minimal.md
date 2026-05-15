## §1 Identity & role

> _Section pending — chip 2 will fill this in._

## §4 Entity schemas (minimal)

Top-of-mind entities only. See the full variant for every type, including methods sub-protocols, sharing, notifications, and demo wiring.

```typescript
export interface Project {
  id: number;
  name: string;
  weekend_active: boolean;
  tags: string[] | null;
  color: string | null;
  created_at: string;
  sort_order: number;
  is_archived: boolean;
  archived_at: string | null;
  owner: string;
  shared_with: SharedUser[];
  // Read-time overlay fields — set by fetchAllProjectsIncludingShared when
  // the receiver of a shared project loads it. Never persisted to disk.
  is_shared_with_me?: boolean;
  shared_permission?: "view" | "edit";
}

export interface Task {
  id: number;
  project_id: number;
  name: string;
  start_date: string; // ISO date string YYYY-MM-DD
  duration_days: number;
  // Derived/cached: computeEndDate(start_date, duration_days, false). Stored
  // on disk for cache friendliness but always validated/recomputed at the
  // local-api boundary — never trust it as the source of truth.
  end_date: string;
  is_high_level: boolean;
  is_complete: boolean;
  task_type: "experiment" | "purchase" | "list";
  weekend_override: boolean | null;
  method_ids: number[];  // List of method IDs attached to this task
  deviation_log: string | null;
  tags: string[] | null;
  sort_order: number;
  experiment_color: string | null;
  sub_tasks: SubTask[] | null;
  // Per-method PCR data lives on each TaskMethodAttachment below.
  method_attachments: TaskMethodAttachment[];
  // Sharing fields
  owner: string;
  shared_with: SharedUser[];
  inherited_from_project?: number | null;
  is_shared_with_me?: boolean;  // True if this task is shared WITH the current user (not owned by them)
  shared_permission?: "view" | "edit";  // Only set when is_shared_with_me=true; the level the receiver was granted
  /**
   * Cross-owner project host — null/undefined means the task only appears in
   * `project_id` (its native project, in its own owner's namespace). When set,
   * the task ALSO appears in the destination owner's project Gantt/timeline.
   * The task file itself stays in this task's owner directory; only the
   * destination project's `<id>-hosted.json` manifest changes on share.
   * See `frontend/src/lib/sharing/project-hosting.ts` for the contract.
   */
  external_project?: ExternalProjectRef | null;
}

export interface Method {
  id: number;
  name: string;
  source_path: string | null;
  method_type: "markdown" | "pdf" | "pcr" | null;
  folder_path: string | null;
  parent_method_id: number | null;
  tags: string[] | null;
  is_public: boolean;
  created_by: string | null;
  // Sharing fields
  owner: string;
  shared_with: SharedUser[];
  // Read-time overlay fields — set by fetchAllMethodsIncludingShared when
  // the receiver of a shared method loads it. Never persisted to disk.
  is_shared_with_me?: boolean;
  shared_permission?: "view" | "edit";
}

export interface PurchaseItem {
  id: number;
  task_id: number;
  item_name: string;
  quantity: number;
  link: string | null;
  cas: string | null;
  price_per_unit: number;
  shipping_fees: number;
  total_price: number;
  notes: string | null;
  funding_string: string | null;  // New field for funding account
  vendor: string | null;
  category: string | null;
}
```

## §7 Common workflows

> _Section pending — chip 2 will fill this in._

## §8 Behavior & response style

> _Section pending — chip 2 will fill this in._

## §10 Wiki navigation

Flat index of every wiki page (extracted from `WIKI_NAV` in `frontend/src/lib/wiki/nav.ts`). When a user asks "is there a doc for X?", consult this table first.

| Page | Path |
| --- | --- |
| Quickstart | `/wiki` |
| Getting Started | `/wiki/getting-started` |
| Browser Requirements | `/wiki/getting-started/browser-requirements` |
| Connecting Your Folder | `/wiki/getting-started/connecting-your-folder` |
| Creating a User | `/wiki/getting-started/creating-a-user` |
| Demo Mode | `/wiki/getting-started/demo-mode` |
| Shared Lab Accounts | `/wiki/shared-lab-accounts` |
| OneDrive | `/wiki/shared-lab-accounts/onedrive` |
| Google Drive | `/wiki/shared-lab-accounts/google-drive` |
| Dropbox | `/wiki/shared-lab-accounts/dropbox` |
| iCloud Drive | `/wiki/shared-lab-accounts/icloud` |
| Features | `/wiki/features` |
| Home & Projects | `/wiki/features/home` |
| Gantt Chart | `/wiki/features/gantt` |
| Experiments & Notes | `/wiki/features/experiments` |
| The Markdown Editor | `/wiki/features/markdown-editor` |
| Methods Library | `/wiki/features/methods` |
| PCR Protocols | `/wiki/features/pcr` |
| Purchases & Funding | `/wiki/features/purchases` |
| Calendar | `/wiki/features/calendar` |
| Lab Mode | `/wiki/features/lab-mode` |
| Activity | `/wiki/features/lab-mode/activity` |
| Combined GANTT | `/wiki/features/lab-mode/gantt` |
| Lab-wide purchases | `/wiki/features/lab-mode/purchases` |
| Cross-user lists | `/wiki/features/lab-mode/cross-user-lists` |
| The user filter | `/wiki/features/lab-mode/user-filter` |
| Search | `/wiki/features/search` |
| Lab Links | `/wiki/features/links` |
| Results (moved) | `/wiki/features/results` |
| Settings | `/wiki/features/settings` |
| Notifications & Inbox | `/wiki/features/notifications` |
| Integrations | `/wiki/integrations` |
| Telegram Bot | `/wiki/integrations/telegram` |
| Calendar Feeds | `/wiki/integrations/calendar-feeds` |
| LabArchives | `/wiki/integrations/labarchives` |

## §11 Build metadata

- **Variant:** `minimal`
- **Helper version:** `2`
- **Schema hash:** `a65063cfaed24daac531c92092effe4a3bb9a78d08ceaeb4f56c86d1baa4f41e`
- **Built at:** `2026-05-15T20:01:24.162Z`
- **Built from commit:** `97ffdb30153db5d0cfea41b99ce66cc55ca0483b`

_Generated by `scripts/build-ai-helper.mjs`. Do not edit by hand — run `npm run --prefix frontend ai-helper:refresh` to rebuild and commit._
