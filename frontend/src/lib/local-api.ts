import { JsonStore, getPublicStore, getLabStore, AttachmentMetadataStore, getCurrentUserCached, clearCurrentUserCache } from "./storage/json-store";
import { fileService } from "./file-system/file-service";
import { getCurrentUser, getMainUser, storeCurrentUser, storeMainUser, clearCurrentUser } from "./file-system/indexeddb-store";
import { shiftTask } from "./engine/shift";
import { formatDate, parseDate } from "./engine/dates";
import { canonicalEndDate, computeTaskEndDate } from "./tasks/end-date";
import { discoverUsers } from "./file-system/user-discovery";
import { ensureLabUserMetadata, fallbackUserColor, setUserMetadataField, getUserMetadata, type UserMetadataEntry } from "./file-system/user-metadata";
import JSZip from "jszip";
import type {
  Project,
  ProjectCreate,
  ProjectUpdate,
  Task,
  TaskCreate,
  TaskUpdate,
  TaskMoveRequest,
  Dependency,
  DependencyCreate,
  Method,
  MethodCreate,
  MethodUpdate,
  Event,
  EventCreate,
  EventUpdate,
  HighLevelGoal,
  HighLevelGoalCreate,
  HighLevelGoalUpdate,
  SmartGoal,
  PCRProtocol,
  PCRProtocolCreate,
  PCRProtocolUpdate,
  PurchaseItem,
  PurchaseItemCreate,
  PurchaseItemUpdate,
  FundingAccount,
  FundingAccountCreate,
  FundingAccountUpdate,
  LabLink,
  LabLinkCreate,
  LabLinkUpdate,
  Note,
  NoteCreate,
  NoteUpdate,
  NoteEntry,
  NoteComment,
  ImageMetadata,
  FileMetadata,
  CatalogItem,
  ShiftResult,
  SharedUser,
  ShareRequest,
  SharedItemEntry,
  Notification,
  SharedItemNotification,
  EventReminderNotification,
} from "./schemas";

const projectsStore = new JsonStore<Project>("projects");
const tasksStore = new JsonStore<Task>("tasks");
const dependenciesStore = new JsonStore<Dependency>("dependencies");
const methodsStore = new JsonStore<Method>("methods");
const publicMethodsStore = getPublicStore<Method>("methods");
const eventsStore = new JsonStore<Event>("events");
const goalsStore = new JsonStore<HighLevelGoal>("goals");
const pcrStore = new JsonStore<PCRProtocol>("pcr_protocols");
const publicPcrStore = getPublicStore<PCRProtocol>("pcr_protocols");
const purchaseItemsStore = new JsonStore<PurchaseItem>("purchase_items");
const catalogStore = new JsonStore<CatalogItem>("item_catalog");
const labLinksStore = new JsonStore<LabLink>("lab_links");
const notesStore = new JsonStore<Note>("notes");
const fundingAccountsStore = getLabStore<FundingAccount>("funding_accounts");
const imageMetadataStore = new AttachmentMetadataStore<ImageMetadata>("Images");
const fileMetadataStore = new AttachmentMetadataStore<FileMetadata>("Files");

async function loadLabUsers(): Promise<{
  usernames: string[];
  metadata: Record<string, UserMetadataEntry>;
}> {
  const usernames = await discoverUsers();
  const metadata = await ensureLabUserMetadata(usernames);
  return { usernames, metadata };
}

function colorFor(
  metadata: Record<string, { color: string; created_at: string }>,
  username: string,
): string {
  return metadata[username]?.color ?? fallbackUserColor(username);
}

export const projectsApi = {
  list: async (): Promise<Project[]> => {
    return projectsStore.listAll();
  },

  listWithShared: async (): Promise<Project[]> => {
    return projectsStore.listAll();
  },

  get: async (id: number, owner?: string): Promise<Project | null> => {
    return owner ? projectsStore.getForUser(id, owner) : projectsStore.get(id);
  },

  create: async (data: ProjectCreate): Promise<Project> => {
    const now = new Date().toISOString();
    const project = await projectsStore.create({
      name: data.name,
      weekend_active: data.weekend_active ?? false,
      tags: data.tags ?? null,
      color: data.color ?? null,
      created_at: now,
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      owner: "",
      shared_with: [],
    });
    return project;
  },

  // When `owner` is set (receiver of a shared project with permission "edit"),
  // the write lands in the owner's directory instead of the current user's.
  update: async (id: number, data: ProjectUpdate, owner?: string): Promise<Project | null> => {
    return owner ? projectsStore.updateForUser(id, data, owner) : projectsStore.update(id, data);
  },

  // Delete is intentionally NOT owner-routed: only the original owner should
  // be able to destroy the file. Mirrors the convention in tasksApi.
  delete: async (id: number): Promise<void> => {
    await projectsStore.delete(id);
  },

  reorder: async (projectIds: number[]): Promise<void> => {
    for (let i = 0; i < projectIds.length; i++) {
      await projectsStore.update(projectIds[i], { sort_order: i });
    }
  },

  archive: async (id: number, isArchived: boolean, owner?: string): Promise<Project | null> => {
    const archivedAt = isArchived ? new Date().toISOString() : null;
    const patch = { is_archived: isArchived, archived_at: archivedAt };
    return owner
      ? projectsStore.updateForUser(id, patch, owner)
      : projectsStore.update(id, patch);
  },
};

// Reads/writes route to the owner's directory when `owner` is provided —
// used by the receiver of a shared task with permission "edit". Without
// `owner`, falls back to the current user's directory (the usual case).
async function getTaskForCaller(id: number, owner?: string): Promise<Task | null> {
  const raw = owner ? await tasksStore.getForUser(id, owner) : await tasksStore.get(id);
  return raw ? normalizeTaskRecord(raw) : null;
}
async function updateTaskForCaller(id: number, data: Partial<Task>, owner?: string): Promise<Task | null> {
  return owner ? tasksStore.updateForUser(id, data, owner) : tasksStore.update(id, data);
}

// Legacy single-method shape: tasks created before multi-method support stored
// the linked method as `method_id` (singular). We've since moved to
// `method_ids` (plural). Files on disk for those old tasks still have
// `method_id` populated and `method_ids: []`. This helper promotes the legacy
// field into the new shape in memory so downstream code can rely on
// `method_ids` exclusively. Files self-heal on the next write since the
// JsonStore spread keeps unknown keys but our writers no longer emit
// `method_id` — over time, edited tasks lose the field naturally. For a
// one-shot disk cleanup, see `tasksApi.repairMethodLinks`.
function normalizeTaskRecord(raw: Task): Task {
  const legacy = raw as Task & { method_id?: number | null };
  if (
    (!raw.method_ids || raw.method_ids.length === 0) &&
    typeof legacy.method_id === "number"
  ) {
    return { ...raw, method_ids: [legacy.method_id] };
  }
  return raw;
}

export const tasksApi = {
  listByProject: async (projectId: number): Promise<Task[]> => {
    const tasks = await tasksStore.query({ project_id: projectId });
    return tasks.map(computeTaskEndDate);
  },

  get: async (id: number, owner?: string): Promise<Task | null> => {
    const task = await getTaskForCaller(id, owner);
    if (!task) return null;
    // Backfill the `owner` field with whichever directory the task was read
    // from. `owner` is set when reading a shared task from the actual owner's
    // dir; otherwise it's the current user's. Older tasks have `owner: ""`
    // on disk; without this their per-user results path would resolve to
    // `users//results/...`.
    const effectiveOwner = owner ?? (await getCurrentUserCached()) ?? "";
    return computeTaskEndDate(withOwnerFallback(task, effectiveOwner));
  },
  
  create: async (data: {
    project_id?: number | null;
    name: string;
    start_date: string;
    duration_days?: number;
    is_high_level?: boolean;
    task_type?: "experiment" | "purchase" | "list";
    weekend_override?: boolean | null;
    method_ids?: number[];
    tags?: string[];
    sort_order?: number;
    experiment_color?: string | null;
    sub_tasks?: Array<{ id: string; text: string; is_complete: boolean }>;
    pcr_gradient?: string | null;
    pcr_ingredients?: string | null;
    method_attachments?: Array<{ method_id: number; pcr_gradient?: string | null; pcr_ingredients?: string | null; variation_notes?: string | null }>;
  }): Promise<Task> => {
    const durationDays = data.duration_days || 1;
    const endDate = canonicalEndDate({ start_date: data.start_date, duration_days: durationDays });

    // Record the creator as the owner. The file lives under their dir already,
    // but downstream code (per-user results paths, shared-task routing) reads
    // the field directly, so persisting it avoids relying on the directory
    // location later.
    const currentUser = (await getCurrentUserCached()) ?? "";

    const task = await tasksStore.create({
      project_id: data.project_id ?? 0,
      name: data.name,
      start_date: data.start_date,
      duration_days: durationDays,
      end_date: endDate,
      is_high_level: data.is_high_level ?? false,
      is_complete: false,
      task_type: data.task_type ?? "list",
      weekend_override: data.weekend_override ?? null,
      method_ids: data.method_ids ?? [],
      deviation_log: null,
      tags: data.tags ?? null,
      sort_order: data.sort_order ?? 0,
      experiment_color: data.experiment_color ?? null,
      sub_tasks: data.sub_tasks ?? null,
      method_attachments: (data.method_attachments ?? []).map((a) => ({
        method_id: a.method_id,
        pcr_gradient: a.pcr_gradient ?? null,
        pcr_ingredients: a.pcr_ingredients ?? null,
        variation_notes: a.variation_notes ?? null,
      })),
      owner: currentUser,
      shared_with: [],
    });
    return task;
  },
  
  update: async (id: number, data: TaskUpdate, owner?: string): Promise<Task | null> => {
    const existing = await getTaskForCaller(id, owner);
    if (!existing) return null;

    // Always recompute. end_date is derived from (start_date, duration_days),
    // so any update — even one that doesn't touch those fields — should rewrite
    // it. Otherwise a previously-corrupted end_date persists across edits to
    // unrelated fields like name or is_complete.
    const endDate = canonicalEndDate({
      start_date: data.start_date ?? existing.start_date,
      duration_days: data.duration_days ?? existing.duration_days,
    });

    return updateTaskForCaller(id, { ...data, end_date: endDate }, owner);
  },

  // Note: delete is intentionally not owner-routed — only the task's owner
  // should remove the file. Receivers with edit permission can modify the
  // task but not destroy it.
  delete: async (id: number): Promise<void> => {
    await tasksStore.delete(id);
  },

  listByMethod: async (methodId: number): Promise<Task[]> => {
    const allTasks = await tasksStore.listAll();
    return allTasks.filter((t) => t.method_ids?.includes(methodId));
  },

  move: async (id: number, data: TaskMoveRequest, owner?: string): Promise<ShiftResult> => {
    const newStartDate = parseDate(data.new_start_date);
    return shiftTask(id, newStartDate, data.confirmed ?? false, owner);
  },
  
  replicate: async (id: number, count: number, offsetDays: number): Promise<Task[]> => {
    const original = await tasksStore.get(id);
    if (!original) return [];
    
    const created: Task[] = [];
    for (let i = 1; i <= count; i++) {
      const newStart = new Date(parseDate(original.start_date));
      newStart.setDate(newStart.getDate() + offsetDays * i);
      
      const startStr = formatDate(newStart);
      const newTask = await tasksStore.create({
        ...original,
        start_date: startStr,
        end_date: canonicalEndDate({ start_date: startStr, duration_days: original.duration_days }),
        is_complete: false,
      });
      created.push(newTask);
    }
    return created;
  },
  
  resetPcr: async (id: number, methodId?: number, owner?: string): Promise<Task | null> => {
    const task = await getTaskForCaller(id, owner);
    if (!task) return null;

    if (methodId) {
      const attachments = task.method_attachments?.map((a) => {
        if (a.method_id === methodId) {
          return { ...a, pcr_gradient: null, pcr_ingredients: null };
        }
        return a;
      });
      return updateTaskForCaller(id, { method_attachments: attachments }, owner);
    }

    return updateTaskForCaller(id, {
      method_attachments: task.method_attachments?.map((a) => ({
        ...a,
        pcr_gradient: null,
        pcr_ingredients: null,
      })),
    }, owner);
  },

  addMethod: async (taskId: number, methodId: number, owner?: string): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const methodIds = [...(task.method_ids || [])];
    if (!methodIds.includes(methodId)) {
      methodIds.push(methodId);
    }

    const attachments = [...(task.method_attachments || [])];
    if (!attachments.find((a) => a.method_id === methodId)) {
      attachments.push({
        method_id: methodId,
        pcr_gradient: null,
        pcr_ingredients: null,
        variation_notes: null,
      });
    }

    return updateTaskForCaller(taskId, { method_ids: methodIds, method_attachments: attachments }, owner);
  },

  removeMethod: async (taskId: number, methodId: number, owner?: string): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const methodIds = (task.method_ids || []).filter((id) => id !== methodId);
    const attachments = (task.method_attachments || []).filter((a) => a.method_id !== methodId);

    return updateTaskForCaller(taskId, { method_ids: methodIds, method_attachments: attachments }, owner);
  },

  /**
   * One-shot disk-level cleanup: walks every task owned by the current user
   * and promotes any legacy top-level `method_id` into `method_ids` if the
   * new array is empty. Writes back so the on-disk JSON gets the new shape.
   *
   * The lazy `normalizeTaskRecord` already covers in-memory reads, so this
   * function is purely for users who want the disk shape cleaned up
   * eagerly (and for confidence that all legacy task records have been
   * migrated). Returns counts so the UI can show a summary.
   *
   * Only touches tasks under `users/{currentUser}/tasks/`. Tasks belonging
   * to other users (shared-with-me) are not modified, even if the caller
   * has edit permission — they self-heal next time the owner edits.
   */
  repairMethodLinks: async (): Promise<{ scanned: number; repaired: number; alreadyCorrect: number; failed: number }> => {
    const tasks = await tasksStore.listAll();
    let repaired = 0;
    let alreadyCorrect = 0;
    let failed = 0;
    for (const raw of tasks) {
      const legacy = raw as Task & { method_id?: number | null };
      const needsPromotion =
        (!raw.method_ids || raw.method_ids.length === 0) &&
        typeof legacy.method_id === "number";
      const hasLegacyKey = "method_id" in (raw as Record<string, unknown>);
      if (!needsPromotion && !hasLegacyKey) {
        alreadyCorrect += 1;
        continue;
      }
      try {
        const next: Task = needsPromotion
          ? { ...raw, method_ids: [legacy.method_id as number] }
          : raw;
        // Drop the legacy field from the persisted shape.
        const persisted: Record<string, unknown> = { ...next };
        delete persisted.method_id;
        await tasksStore.save(raw.id, persisted as Task);
        repaired += 1;
      } catch (err) {
        console.warn(`[repairMethodLinks] failed to repair task ${raw.id}:`, err);
        failed += 1;
      }
    }
    return { scanned: tasks.length, repaired, alreadyCorrect, failed };
  },

  updateMethodPcr: async (
    taskId: number,
    methodId: number,
    data: { pcr_gradient?: string; pcr_ingredients?: string },
    owner?: string
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const attachments = (task.method_attachments || []).map((a) => {
      if (a.method_id === methodId) {
        return { ...a, ...data };
      }
      return a;
    });

    return updateTaskForCaller(taskId, { method_attachments: attachments }, owner);
  },

  saveVariationNote: async (
    taskId: number,
    methodId: number,
    variationNotes: string,
    owner?: string
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const attachments = (task.method_attachments || []).map((a) => {
      if (a.method_id === methodId) {
        return { ...a, variation_notes: variationNotes };
      }
      return a;
    });

    return updateTaskForCaller(taskId, { method_attachments: attachments }, owner);
  },
  
  checkDuplicate: async (
    projectId: number,
    name: string,
    taskType: string,
    excludeTaskId?: number
  ): Promise<{ has_duplicate: boolean; matching_tasks: Task[] }> => {
    const tasks = await tasksStore.query({ project_id: projectId, task_type: taskType as Task["task_type"] });
    const matching = tasks.filter((t) => 
      t.name.toLowerCase() === name.toLowerCase() && 
      t.id !== excludeTaskId
    );
    return {
      has_duplicate: matching.length > 0,
      matching_tasks: matching,
    };
  },
  
  convertType: async (
    id: number,
    newTaskType: "experiment" | "purchase" | "list",
    owner?: string
  ): Promise<Task | null> => {
    return updateTaskForCaller(id, { task_type: newTaskType }, owner);
  },
};

export const dependenciesApi = {
  list: async (projectId?: number): Promise<Dependency[]> => {
    if (projectId) {
      const tasks = await tasksStore.query({ project_id: projectId });
      const taskIds = new Set(tasks.map((t) => t.id));
      const allDeps = await dependenciesStore.listAll();
      return allDeps.filter(
        (d) => taskIds.has(d.parent_id) && taskIds.has(d.child_id)
      );
    }
    return dependenciesStore.listAll();
  },
  
  create: async (data: DependencyCreate): Promise<Dependency> => {
    return dependenciesStore.create(data);
  },
  
  delete: async (id: number): Promise<void> => {
    await dependenciesStore.delete(id);
  },
};

// Legacy field name: `source_path` was previously called `github_path` back
// when method content lived in a GitHub repo. Files on disk for old methods
// still carry `github_path` populated and `source_path` missing. This helper
// promotes the legacy field in memory so downstream code can rely on
// `source_path` exclusively. For one-shot disk cleanup, see
// `methodsApi.repairSourcePaths`.
function normalizeMethodRecord(raw: Method): Method {
  const legacy = raw as Method & { github_path?: string | null };
  if (raw.source_path == null && typeof legacy.github_path === "string") {
    return { ...raw, source_path: legacy.github_path };
  }
  return raw;
}

export const methodsApi = {
  list: async (): Promise<Method[]> => {
    const privateMethods = await methodsStore.listAll();
    const publicMethods = await publicMethodsStore.listAll();

    const marked = [
      ...privateMethods.map((m) => normalizeMethodRecord({ ...m, is_public: false })),
      ...publicMethods.map((m) => normalizeMethodRecord({ ...m, is_public: true })),
    ];
    return marked;
  },

  // When `owner` is set, the read targets the owner's private methods dir
  // (used by receivers viewing a shared method). Public methods live in the
  // shared `users/public/` store and are never owner-routed.
  get: async (id: number, owner?: string): Promise<Method | null> => {
    if (owner) {
      const ownerMethod = await methodsStore.getForUser(id, owner);
      if (ownerMethod) return normalizeMethodRecord({ ...ownerMethod, is_public: false });
      return null;
    }
    const method = await methodsStore.get(id);
    if (method) return normalizeMethodRecord({ ...method, is_public: false });

    const publicMethod = await publicMethodsStore.get(id);
    if (publicMethod) return normalizeMethodRecord({ ...publicMethod, is_public: true });

    return null;
  },

  create: async (data: MethodCreate): Promise<Method> => {
    if (data.is_public) {
      return publicMethodsStore.create({
        ...data,
        source_path: data.source_path ?? null,
        method_type: data.method_type ?? null,
        folder_path: data.folder_path ?? null,
        parent_method_id: data.parent_method_id ?? null,
        tags: data.tags ?? null,
        created_by: null,
        owner: "",
        shared_with: [],
      });
    }

    return methodsStore.create({
      ...data,
      source_path: data.source_path ?? null,
      method_type: data.method_type ?? null,
      folder_path: data.folder_path ?? null,
      parent_method_id: data.parent_method_id ?? null,
      tags: data.tags ?? null,
      is_public: false,
      created_by: null,
      owner: "",
      shared_with: [],
    });
  },

  // When `owner` is set (receiver of a shared method with permission "edit"),
  // the write lands in the owner's private methods dir. Public methods are
  // shared globally and are never owner-routed.
  update: async (id: number, data: MethodUpdate, owner?: string): Promise<Method | null> => {
    if (owner) {
      return methodsStore.updateForUser(id, data, owner);
    }
    let method = await methodsStore.get(id);
    if (method) {
      return methodsStore.update(id, data);
    }

    method = await publicMethodsStore.get(id);
    if (method) {
      return publicMethodsStore.update(id, data);
    }

    return null;
  },

  getChildren: async (id: number): Promise<Method[]> => {
    const allMethods = await methodsApi.list();
    return allMethods.filter((m) => m.parent_method_id === id);
  },

  getExperiments: async (id: number): Promise<MethodExperiment[]> => {
    const tasks = await tasksStore.listAll();
    return tasks.filter((t) => t.method_ids?.includes(id) && t.task_type === "experiment").map((t) => ({
      id: t.id,
      name: t.name,
      project_id: t.project_id,
      start_date: t.start_date,
      duration_days: t.duration_days,
      end_date: t.end_date,
      is_complete: t.is_complete,
      task_type: t.task_type,
      experiment_color: t.experiment_color,
      variation_notes: null,
    }));
  },

  // Forks always land in the current user's library — "make my own copy" is
  // the whole point. The owner arg only routes the read of the source method
  // so a receiver editing a shared method can still fork it.
  fork: async (
    id: number,
    data: { new_name: string; new_source_path: string; deviations: string },
    owner?: string
  ): Promise<Method> => {
    const original = await methodsApi.get(id, owner);
    if (!original) throw new Error("Method not found");

    return methodsStore.create({
      ...original,
      name: data.new_name,
      source_path: data.new_source_path,
      parent_method_id: id,
      is_public: false,
    });
  },

  saveDeviation: async (data: { task_id: number; deviations: string }): Promise<Task | null> => {
    return tasksStore.update(data.task_id, { deviation_log: data.deviations });
  },

  // Delete is intentionally NOT owner-routed: only the original owner should
  // be able to destroy the file. Mirrors the convention in tasksApi.
  delete: async (id: number): Promise<void> => {
    await methodsStore.delete(id);
    await publicMethodsStore.delete(id);
  },

  /**
   * One-shot disk-level cleanup: walks every method (private + public) and
   * rewrites any record that still carries the legacy `github_path` field
   * into the new `source_path` shape, dropping the legacy key. The lazy
   * `normalizeMethodRecord` covers in-memory reads already; this is for
   * eagerly tidying the on-disk JSON for confidence and cleaner files.
   */
  repairSourcePaths: async (): Promise<{ scanned: number; repaired: number; alreadyCorrect: number; failed: number }> => {
    const records: Array<{ method: Method; store: typeof methodsStore | typeof publicMethodsStore }> = [];
    for (const m of await methodsStore.listAll()) records.push({ method: m, store: methodsStore });
    for (const m of await publicMethodsStore.listAll()) records.push({ method: m, store: publicMethodsStore });

    let repaired = 0;
    let alreadyCorrect = 0;
    let failed = 0;
    for (const { method, store } of records) {
      const legacy = method as Method & { github_path?: string | null };
      const hasLegacyKey = "github_path" in (method as Record<string, unknown>);
      const needsPromotion = method.source_path == null && typeof legacy.github_path === "string";
      if (!needsPromotion && !hasLegacyKey) {
        alreadyCorrect += 1;
        continue;
      }
      try {
        const next: Method = needsPromotion
          ? { ...method, source_path: legacy.github_path as string }
          : method;
        const persisted: Record<string, unknown> = { ...next };
        delete persisted.github_path;
        await store.save(method.id, persisted as Method);
        repaired += 1;
      } catch (err) {
        console.warn(`[repairSourcePaths] failed to repair method ${method.id}:`, err);
        failed += 1;
      }
    }
    return { scanned: records.length, repaired, alreadyCorrect, failed };
  },
};

export const eventsApi = {
  list: async (): Promise<Event[]> => {
    return eventsStore.listAll();
  },
  
  get: async (id: number): Promise<Event | null> => {
    return eventsStore.get(id);
  },
  
  create: async (data: EventCreate): Promise<Event> => {
    return eventsStore.create({
      ...data,
      event_type: data.event_type ?? "conference",
      end_date: data.end_date ?? null,
      start_time: data.start_time ?? null,
      end_time: data.end_time ?? null,
      location: data.location ?? null,
      url: data.url ?? null,
      notes: data.notes ?? null,
      color: data.color ?? null,
    });
  },
  
  update: async (id: number, data: EventUpdate): Promise<Event | null> => {
    return eventsStore.update(id, data);
  },
  
  delete: async (id: number): Promise<void> => {
    await eventsStore.delete(id);
  },
};

export const goalsApi = {
  list: async (): Promise<HighLevelGoal[]> => {
    return goalsStore.listAll();
  },
  
  get: async (id: number): Promise<HighLevelGoal | null> => {
    return goalsStore.get(id);
  },
  
  create: async (data: HighLevelGoalCreate): Promise<HighLevelGoal> => {
    return goalsStore.create({
      project_id: data.project_id ?? null,
      name: data.name,
      start_date: data.start_date,
      end_date: data.end_date,
      color: data.color ?? null,
      smart_goals: data.smart_goals ?? [],
      is_complete: false,
      created_at: new Date().toISOString(),
    });
  },
  
  update: async (id: number, data: HighLevelGoalUpdate): Promise<HighLevelGoal | null> => {
    return goalsStore.update(id, data);
  },
  
  delete: async (id: number): Promise<void> => {
    await goalsStore.delete(id);
  },
  
  addSmartGoal: async (id: number, smartGoal: { id: string; text: string; is_complete: boolean }): Promise<HighLevelGoal | null> => {
    const goal = await goalsStore.get(id);
    if (!goal) return null;
    
    const smartGoals = [...(goal.smart_goals || []), smartGoal];
    return goalsStore.update(id, { smart_goals: smartGoals });
  },
  
  toggleSmartGoal: async (id: number, smartGoalId: string, isComplete: boolean): Promise<HighLevelGoal | null> => {
    const goal = await goalsStore.get(id);
    if (!goal) return null;
    
    const smartGoals = (goal.smart_goals || []).map((sg) => {
      if (sg.id === smartGoalId) {
        return { ...sg, is_complete: isComplete };
      }
      return sg;
    });
    return goalsStore.update(id, { smart_goals: smartGoals });
  },
  
  deleteSmartGoal: async (id: number, smartGoalId: string): Promise<HighLevelGoal | null> => {
    const goal = await goalsStore.get(id);
    if (!goal) return null;
    
    const smartGoals = (goal.smart_goals || []).filter((sg) => sg.id !== smartGoalId);
    return goalsStore.update(id, { smart_goals: smartGoals });
  },
};

export const pcrApi = {
  list: async (): Promise<PCRProtocol[]> => {
    const privateProtocols = await pcrStore.listAll();
    const publicProtocols = await publicPcrStore.listAll();
    
    return [
      ...privateProtocols.map((p) => ({ ...p, is_public: false })),
      ...publicProtocols.map((p) => ({ ...p, is_public: true })),
    ];
  },
  
  get: async (id: number): Promise<PCRProtocol | null> => {
    const protocol = await pcrStore.get(id);
    if (protocol) return { ...protocol, is_public: false };
    
    const publicProtocol = await publicPcrStore.get(id);
    if (publicProtocol) return { ...publicProtocol, is_public: true };
    
    return null;
  },
  
  create: async (data: PCRProtocolCreate): Promise<PCRProtocol> => {
    const isPublic = data.is_public ?? false;
    if (isPublic) {
      return publicPcrStore.create({
        name: data.name,
        gradient: data.gradient,
        ingredients: data.ingredients,
        notes: data.notes ?? null,
        is_public: true,
        created_by: null,
      });
    }
    
    return pcrStore.create({
      name: data.name,
      gradient: data.gradient,
      ingredients: data.ingredients,
      notes: data.notes ?? null,
      is_public: false,
      created_by: null,
    });
  },
  
  update: async (id: number, data: PCRProtocolUpdate): Promise<PCRProtocol | null> => {
    let protocol = await pcrStore.get(id);
    if (protocol) {
      return pcrStore.update(id, data);
    }
    
    protocol = await publicPcrStore.get(id);
    if (protocol) {
      return publicPcrStore.update(id, data);
    }
    
    return null;
  },
  
  delete: async (id: number): Promise<void> => {
    await pcrStore.delete(id);
    await publicPcrStore.delete(id);
  },
  
  getDefaultGradient: async () => {
    return {
      initial: [{ name: "Initial Denaturation", temperature: 95, duration: "2 min" }],
      cycles: [{
        repeats: 30,
        steps: [
          { name: "Denaturation", temperature: 95, duration: "20 sec" },
          { name: "Annealing", temperature: 60, duration: "20 sec" },
          { name: "Extension", temperature: 72, duration: "1 min" },
        ],
      }],
      final: [{ name: "Final Extension", temperature: 72, duration: "5 min" }],
      hold: { name: "Hold", temperature: 4, duration: "Indef." },
    };
  },
  
  getDefaultIngredients: async () => {
    return [
      { id: "1", name: "Template DNA", concentration: "10 ng/uL", amount_per_reaction: "1", checked: false },
      { id: "2", name: "Forward Primer", concentration: "10 uM", amount_per_reaction: "0.5", checked: false },
      { id: "3", name: "Reverse Primer", concentration: "10 uM", amount_per_reaction: "0.5", checked: false },
      { id: "4", name: "dNTPs", concentration: "10 mM", amount_per_reaction: "0.5", checked: false },
      { id: "5", name: "Buffer", concentration: "10X", amount_per_reaction: "2.5", checked: false },
      { id: "6", name: "Polymerase", concentration: "5 U/uL", amount_per_reaction: "0.25", checked: false },
      { id: "7", name: "Water", concentration: "-", amount_per_reaction: "to 25", checked: false },
    ];
  },
};

export const purchasesApi = {
  listByTask: async (taskId: number): Promise<PurchaseItem[]> => {
    const items = await purchaseItemsStore.query({ task_id: taskId });
    return items.map(item => ({
      ...item,
      total_price: item.total_price ?? (item.price_per_unit ?? 0) * item.quantity + (item.shipping_fees ?? 0),
    }));
  },
  
  listAll: async (): Promise<PurchaseItem[]> => {
    const items = await purchaseItemsStore.listAll();
    return items.map(item => ({
      ...item,
      total_price: item.total_price ?? (item.price_per_unit ?? 0) * item.quantity + (item.shipping_fees ?? 0),
    }));
  },
  
  create: async (data: PurchaseItemCreate): Promise<PurchaseItem> => {
    const total = (data.price_per_unit ?? 0) * data.quantity + (data.shipping_fees ?? 0);
    return purchaseItemsStore.create({
      ...data,
      link: data.link ?? null,
      cas: data.cas ?? null,
      price_per_unit: data.price_per_unit ?? 0,
      shipping_fees: data.shipping_fees ?? 0,
      total_price: total,
      notes: data.notes ?? null,
      funding_string: data.funding_string ?? null,
    });
  },
  
  update: async (id: number, data: PurchaseItemUpdate): Promise<PurchaseItem | null> => {
    const existing = await purchaseItemsStore.get(id);
    if (!existing) return null;
    
    const pricePerUnit = data.price_per_unit ?? existing.price_per_unit;
    const quantity = data.quantity ?? existing.quantity;
    const shippingFees = data.shipping_fees ?? existing.shipping_fees;
    const total = pricePerUnit * quantity + shippingFees;
    
    return purchaseItemsStore.update(id, { ...data, total_price: total });
  },
  
  delete: async (id: number): Promise<void> => {
    await purchaseItemsStore.delete(id);
  },
  
  searchCatalog: async (q: string): Promise<CatalogItem[]> => {
    const items = await catalogStore.listAll();
    const query = q.toLowerCase();
    return items.filter(
      (item) =>
        item.item_name.toLowerCase().includes(query) ||
        (item.cas?.toLowerCase().includes(query) ?? false)
    );
  },
  
  updateCatalogItem: async (id: number, data: Partial<CatalogItem>): Promise<CatalogItem | null> => {
    return catalogStore.update(id, data);
  },
  
  createCatalogItem: async (data: Partial<CatalogItem>): Promise<CatalogItem> => {
    return catalogStore.create({
      item_name: data.item_name ?? "",
      link: data.link ?? null,
      cas: data.cas ?? null,
      price_per_unit: data.price_per_unit ?? 0,
    });
  },
  
  listFundingAccounts: async (): Promise<FundingAccount[]> => {
    return fundingAccountsStore.listAll();
  },
  
  createFundingAccount: async (data: FundingAccountCreate): Promise<FundingAccount> => {
    return fundingAccountsStore.create({
      ...data,
      description: data.description ?? null,
      total_budget: data.total_budget ?? 0,
      spent: 0,
      remaining: data.total_budget ?? 0,
    });
  },
  
  updateFundingAccount: async (id: number, data: FundingAccountUpdate): Promise<FundingAccount | null> => {
    const existing = await fundingAccountsStore.get(id);
    if (!existing) return null;
    
    const totalBudget = data.total_budget ?? existing.total_budget;
    return fundingAccountsStore.update(id, {
      ...data,
      remaining: totalBudget - existing.spent,
    });
  },
  
  deleteFundingAccount: async (id: number): Promise<void> => {
    await fundingAccountsStore.delete(id);
  },
  
  getFundingSummary: async () => {
    const accounts = await fundingAccountsStore.listAll();
    const totalBudget = accounts.reduce((sum, a) => sum + a.total_budget, 0);
    const totalSpent = accounts.reduce((sum, a) => sum + a.spent, 0);
    
    return {
      accounts,
      total_budget: totalBudget,
      total_spent: totalSpent,
      total_remaining: totalBudget - totalSpent,
      uncategorized_spent: 0,
    };
  },
};

export const labLinksApi = {
  list: async (): Promise<LabLink[]> => {
    return labLinksStore.listAll();
  },
  
  get: async (id: number): Promise<LabLink | null> => {
    return labLinksStore.get(id);
  },
  
  create: async (data: LabLinkCreate): Promise<LabLink> => {
    return labLinksStore.create({
      ...data,
      description: data.description ?? null,
      category: data.category ?? null,
      color: data.color ?? null,
      preview_image_url: data.preview_image_url ?? null,
      sort_order: 0,
      created_at: new Date().toISOString(),
    });
  },
  
  update: async (id: number, data: LabLinkUpdate): Promise<LabLink | null> => {
    return labLinksStore.update(id, data);
  },
  
  delete: async (id: number): Promise<void> => {
    await labLinksStore.delete(id);
  },
  
  getPreview: async (url: string): Promise<{ title: string; description: string | null; image: string | null; site_name: string | null }> => {
    return {
      title: url,
      description: null,
      image: null,
      site_name: null,
    };
  },
};

export const notesApi = {
  list: async (): Promise<Note[]> => {
    return notesStore.listAll();
  },
  
  get: async (id: number): Promise<Note | null> => {
    return notesStore.get(id);
  },
  
  create: async (data: { title: string; description?: string; is_running_log?: boolean; is_shared?: boolean; entries?: Array<{ title: string; date: string; content?: string }> }): Promise<Note> => {
    const now = new Date().toISOString();
    const entries: NoteEntry[] = (data.entries ?? []).map((e) => ({
      id: crypto.randomUUID(),
      title: e.title,
      date: e.date,
      content: e.content ?? "",
      created_at: now,
      updated_at: now,
    }));
    
    return notesStore.create({
      title: data.title,
      description: data.description ?? "",
      is_running_log: data.is_running_log ?? false,
      is_shared: data.is_shared ?? false,
      entries,
      comments: [],
      created_at: now,
      updated_at: now,
      username: "",
    });
  },
  
  update: async (id: number, data: NoteUpdate): Promise<Note | null> => {
    const updated = await notesStore.update(id, {
      ...data,
      updated_at: new Date().toISOString(),
    });
    return updated;
  },
  
  delete: async (id: number): Promise<void> => {
    await notesStore.delete(id);
  },
  
  addEntry: async (noteId: number, data: { title: string; date: string; content?: string }): Promise<Note | null> => {
    const note = await notesStore.get(noteId);
    if (!note) return null;
    
    const now = new Date().toISOString();
    const newEntry: NoteEntry = {
      id: crypto.randomUUID(),
      title: data.title,
      date: data.date,
      content: data.content ?? "",
      created_at: now,
      updated_at: now,
    };
    
    const entries = [...(note.entries || []), newEntry];
    return notesStore.update(noteId, { entries, updated_at: now });
  },
  
  updateEntry: async (noteId: number, entryId: string, data: { title?: string; date?: string; content?: string }): Promise<Note | null> => {
    const note = await notesStore.get(noteId);
    if (!note) return null;
    
    const now = new Date().toISOString();
    const entries = (note.entries || []).map((e) => {
      if (e.id === entryId) {
        return { ...e, ...data, updated_at: now };
      }
      return e;
    });
    
    return notesStore.update(noteId, { entries, updated_at: now });
  },
  
  deleteEntry: async (noteId: number, entryId: string): Promise<Note | null> => {
    const note = await notesStore.get(noteId);
    if (!note) return null;
    
    const entries = (note.entries || []).filter((e) => e.id !== entryId);
    return notesStore.update(noteId, { entries, updated_at: new Date().toISOString() });
  },
  
  reorderEntries: async (noteId: number, entryIds: string[]): Promise<Note | null> => {
    const note = await notesStore.get(noteId);
    if (!note) return null;

    const entriesMap = new Map((note.entries || []).map((e) => [e.id, e]));
    const entries = entryIds.map((id) => entriesMap.get(id)).filter(Boolean) as NoteEntry[];

    return notesStore.update(noteId, { entries, updated_at: new Date().toISOString() });
  },

  // Append a comment to a shared note. Lab-mode (#13): the viewer is usually
  // a different user than the note owner, so we read/write through the
  // owner's directory directly — same cross-user pattern as shared tasks.
  // Append-only by design; no edit. Author must be a real username, not "lab".
  addComment: async (
    noteId: number,
    ownerUsername: string,
    text: string,
    author: string,
  ): Promise<Note | null> => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const note = await notesStore.getForUser(noteId, ownerUsername);
    if (!note) return null;
    const newComment: NoteComment = {
      id: crypto.randomUUID(),
      author,
      text: trimmed,
      created_at: new Date().toISOString(),
    };
    const comments = [...(note.comments || []), newComment];
    return notesStore.updateForUser(
      noteId,
      { comments, updated_at: new Date().toISOString() },
      ownerUsername,
    );
  },

  // Remove a comment. Only the comment's author can call this — the UI
  // enforces that, but the API doesn't (caller-trusted, like every other
  // path in this app's local-only model).
  deleteComment: async (
    noteId: number,
    ownerUsername: string,
    commentId: string,
  ): Promise<Note | null> => {
    const note = await notesStore.getForUser(noteId, ownerUsername);
    if (!note) return null;
    const comments = (note.comments || []).filter((c) => c.id !== commentId);
    return notesStore.updateForUser(
      noteId,
      { comments, updated_at: new Date().toISOString() },
      ownerUsername,
    );
  },
};

export const attachmentsApi = {
  /**
   * Search the data folder for image files whose name contains the given
   * substring. Walks the actual filesystem so it finds files in every place
   * an image might live — canonical task/method dirs, the legacy per-user
   * tree, and any `users_backup_*` snapshot. Results are ranked so canonical
   * destinations surface first, which is what users almost always want.
   *
   * Used by the broken-image popup in LiveMarkdownEditor when a markdown
   * image reference can't be resolved.
   */
  searchImageByFilename: async (filename: string) => {
    const needle = (filename.split("/").pop() ?? filename).toLowerCase();
    if (!needle) return { search_term: filename, matches: [], count: 0 };

    type Hit = { path: string; filename: string; match_type: string; rank: number };
    const hits: Hit[] = [];

    const scanDir = async (dirPath: string, rank: number): Promise<void> => {
      let names: string[] = [];
      try {
        names = await fileService.listFiles(dirPath);
      } catch {
        return;
      }
      for (const name of names) {
        if (name.startsWith(".") || name === "_metadata.json") continue;
        if (!name.toLowerCase().includes(needle)) continue;
        hits.push({
          path: `${dirPath}/${name}`,
          filename: name,
          match_type: name.toLowerCase() === needle ? "exact" : "filename",
          rank,
        });
      }
    };

    // Recurse, capped, since legacy `users/{user}/Images/` and the backup
    // snapshots can have arbitrary date-named subfolders.
    const scanRecursive = async (dirPath: string, rank: number, depthRemaining = 5): Promise<void> => {
      if (depthRemaining < 0) return;
      await scanDir(dirPath, rank);
      let subdirs: string[] = [];
      try {
        subdirs = await fileService.listDirectories(dirPath);
      } catch {
        return;
      }
      for (const sub of subdirs) {
        await scanRecursive(`${dirPath}/${sub}`, rank, depthRemaining - 1);
      }
    };

    try {
      const tasks = await fileService.listDirectories("results");
      for (const t of tasks) await scanDir(`results/${t}/Images`, 0);
    } catch { /* results/ may not exist yet */ }

    try {
      const methods = await fileService.listDirectories("methods");
      for (const m of methods) await scanDir(`methods/${m}/Images`, 0);
    } catch { /* methods/ may not exist yet */ }

    try {
      const users = await fileService.listDirectories("users");
      for (const u of users) await scanRecursive(`users/${u}/Images`, 1);
    } catch { /* users/ may not exist */ }

    try {
      const rootDirs = await fileService.listDirectories("");
      for (const r of rootDirs) {
        if (!r.startsWith("users_backup_")) continue;
        let backupUsers: string[] = [];
        try {
          backupUsers = await fileService.listDirectories(r);
        } catch { continue; }
        for (const u of backupUsers) await scanRecursive(`${r}/${u}/Images`, 2);
      }
    } catch { /* root listing may fail in some environments */ }

    const seen = new Set<string>();
    const unique = hits.filter((h) => {
      if (seen.has(h.path)) return false;
      seen.add(h.path);
      return true;
    });
    unique.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.match_type !== b.match_type) return a.match_type === "exact" ? -1 : 1;
      return a.filename.localeCompare(b.filename);
    });
    const top = unique.slice(0, 20);

    return {
      search_term: filename,
      matches: top.map(({ path, filename: fn, match_type }) => ({ path, filename: fn, match_type })),
      count: top.length,
    };
  },
};

// ── Sharing helpers ──────────────────────────────────────────────────────────

type ItemType = "task" | "method" | "project";

interface SharedManifest {
  version: number;
  projects: SharedItemEntry[];
  tasks: SharedItemEntry[];
  methods: SharedItemEntry[];
}

interface NotificationFile {
  version: number;
  notifications: Notification[];
}

const PERMISSION_DEFAULT = "edit";

function emptyManifest(): SharedManifest {
  return { version: 1, projects: [], tasks: [], methods: [] };
}

function emptyNotifications(): NotificationFile {
  return { version: 1, notifications: [] };
}

async function readSharedWithMe(username: string): Promise<SharedManifest> {
  const path = `users/${username}/_shared_with_me.json`;
  const data = await fileService.readJson<Partial<SharedManifest>>(path);
  return {
    version: data?.version ?? 1,
    projects: data?.projects ?? [],
    tasks: data?.tasks ?? [],
    methods: data?.methods ?? [],
  };
}

async function writeSharedWithMe(username: string, data: SharedManifest): Promise<void> {
  await fileService.writeJson(`users/${username}/_shared_with_me.json`, data);
}

async function readNotificationsFile(username: string): Promise<NotificationFile> {
  const path = `users/${username}/_notifications.json`;
  const data = await fileService.readJson<Partial<NotificationFile>>(path);
  return {
    version: data?.version ?? 1,
    notifications: data?.notifications ?? [],
  };
}

async function writeNotificationsFile(username: string, data: NotificationFile): Promise<void> {
  await fileService.writeJson(`users/${username}/_notifications.json`, data);
}

function notificationTypeFor(itemType: ItemType): SharedItemNotification["type"] {
  if (itemType === "task") return "task_shared";
  if (itemType === "method") return "method_shared";
  return "project_shared";
}

function sharedListKey(itemType: ItemType): "tasks" | "methods" | "projects" {
  if (itemType === "task") return "tasks";
  if (itemType === "method") return "methods";
  return "projects";
}

async function addReceiverShare(
  receiver: string,
  itemType: ItemType,
  entry: SharedItemEntry,
  notificationName: string
): Promise<void> {
  const manifest = await readSharedWithMe(receiver);
  const list = manifest[sharedListKey(itemType)];
  const idx = list.findIndex((e) => e.id === entry.id && e.owner === entry.owner);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  await writeSharedWithMe(receiver, manifest);

  const notifs = await readNotificationsFile(receiver);
  notifs.notifications.push({
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: notificationTypeFor(itemType),
    from_user: entry.owner,
    item_type: itemType,
    item_id: entry.id,
    item_name: notificationName,
    permission: entry.permission,
    created_at: entry.shared_at,
    read: false,
  });
  await writeNotificationsFile(receiver, notifs);
}

async function removeReceiverShare(
  receiver: string,
  itemType: ItemType,
  itemId: number,
  owner: string
): Promise<void> {
  const manifest = await readSharedWithMe(receiver);
  const key = sharedListKey(itemType);
  const before = manifest[key].length;
  manifest[key] = manifest[key].filter((e) => !(e.id === itemId && e.owner === owner));
  if (manifest[key].length !== before) {
    await writeSharedWithMe(receiver, manifest);
  }
}

interface ShareableEntity {
  shared_with?: Array<{ username: string; permission: string }> | null;
  name?: string;
}

function upsertSharedWith<T extends ShareableEntity>(
  entity: T,
  username: string,
  permission: string
): T {
  const list = entity.shared_with ?? [];
  const idx = list.findIndex((s) => s.username === username);
  if (idx >= 0) list[idx] = { username, permission };
  else list.push({ username, permission });
  return { ...entity, shared_with: list };
}

function removeSharedWith<T extends ShareableEntity>(entity: T, username: string): T {
  const list = (entity.shared_with ?? []).filter((s) => s.username !== username);
  return { ...entity, shared_with: list };
}

/**
 * Walk the dependency graph upstream from `taskId` (parents/ancestors).
 * Sharing a task with `include_chain` shares everything it depends on too,
 * so the receiver sees a self-contained subgraph.
 */
async function getTaskAncestors(taskId: number): Promise<number[]> {
  const deps = await dependenciesStore.listAll();
  const parentsByChild = new Map<number, number[]>();
  for (const d of deps) {
    const arr = parentsByChild.get(d.child_id) ?? [];
    arr.push(d.parent_id);
    parentsByChild.set(d.child_id, arr);
  }
  const visited = new Set<number>([taskId]);
  const order: number[] = [taskId];
  const queue = [taskId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const parent of parentsByChild.get(id) ?? []) {
      if (!visited.has(parent)) {
        visited.add(parent);
        order.push(parent);
        queue.push(parent);
      }
    }
  }
  return order;
}

// ── Sharing API ──────────────────────────────────────────────────────────────

export const sharingApi = {
  shareTask: async (
    taskId: number,
    data: { username: string; permission?: "view" | "edit"; include_chain?: boolean }
  ): Promise<{
    status: string;
    item_id: number;
    shared_with: string;
    permission: string;
    chain_shared_count?: number;
  }> => {
    const currentUser = await getCurrentUserCached();
    const permission = data.permission ?? PERMISSION_DEFAULT;
    if (data.username === currentUser) {
      throw new Error("Cannot share a task with yourself");
    }
    const ids = data.include_chain ? await getTaskAncestors(taskId) : [taskId];
    const sharedAt = new Date().toISOString();
    let count = 0;
    for (const id of ids) {
      const task = await tasksStore.get(id);
      if (!task) continue;
      const updated = upsertSharedWith(task, data.username, permission);
      await tasksStore.save(id, updated);
      await addReceiverShare(
        data.username,
        "task",
        { id, owner: currentUser, permission, shared_at: sharedAt },
        task.name
      );
      count += 1;
    }
    return {
      status: "ok",
      item_id: taskId,
      shared_with: data.username,
      permission,
      chain_shared_count: data.include_chain ? count : undefined,
    };
  },

  unshareTask: async (
    taskId: number,
    username: string
  ): Promise<{ status: string; item_id: number; shared_with: string }> => {
    const currentUser = await getCurrentUserCached();
    const task = await tasksStore.get(taskId);
    if (task) {
      const updated = removeSharedWith(task, username);
      await tasksStore.save(taskId, updated);
    }
    await removeReceiverShare(username, "task", taskId, currentUser);
    return { status: "ok", item_id: taskId, shared_with: username };
  },

  getTaskDependencyChain: async (
    taskId: number
  ): Promise<{ task_id: number; chain_task_ids: number[]; chain_count: number }> => {
    const chain = await getTaskAncestors(taskId);
    return { task_id: taskId, chain_task_ids: chain, chain_count: chain.length };
  },

  shareMethod: async (
    methodId: number,
    data: { username: string; permission?: "view" | "edit" }
  ): Promise<{ status: string; item_id: number; shared_with: string; permission: string }> => {
    const currentUser = await getCurrentUserCached();
    const permission = data.permission ?? PERMISSION_DEFAULT;
    if (data.username === currentUser) {
      throw new Error("Cannot share a method with yourself");
    }
    const method = await methodsStore.get(methodId);
    if (!method) throw new Error(`Method ${methodId} not found in current user's library`);
    const updated = upsertSharedWith(method, data.username, permission);
    await methodsStore.save(methodId, updated);
    await addReceiverShare(
      data.username,
      "method",
      { id: methodId, owner: currentUser, permission, shared_at: new Date().toISOString() },
      method.name
    );
    return { status: "ok", item_id: methodId, shared_with: data.username, permission };
  },

  unshareMethod: async (
    methodId: number,
    username: string
  ): Promise<{ status: string; item_id: number; shared_with: string }> => {
    const currentUser = await getCurrentUserCached();
    const method = await methodsStore.get(methodId);
    if (method) {
      const updated = removeSharedWith(method, username);
      await methodsStore.save(methodId, updated);
    }
    await removeReceiverShare(username, "method", methodId, currentUser);
    return { status: "ok", item_id: methodId, shared_with: username };
  },

  shareProject: async (
    projectId: number,
    data: { username: string; permission?: "view" | "edit" }
  ): Promise<{ status: string; item_id: number; shared_with: string; permission: string }> => {
    const currentUser = await getCurrentUserCached();
    const permission = data.permission ?? PERMISSION_DEFAULT;
    if (data.username === currentUser) {
      throw new Error("Cannot share a project with yourself");
    }
    const project = await projectsStore.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found in current user's workspace`);
    const updated = upsertSharedWith(project, data.username, permission);
    await projectsStore.save(projectId, updated);
    await addReceiverShare(
      data.username,
      "project",
      { id: projectId, owner: currentUser, permission, shared_at: new Date().toISOString() },
      project.name
    );
    return { status: "ok", item_id: projectId, shared_with: data.username, permission };
  },

  unshareProject: async (
    projectId: number,
    username: string
  ): Promise<{ status: string; item_id: number; shared_with: string }> => {
    const currentUser = await getCurrentUserCached();
    const project = await projectsStore.get(projectId);
    if (project) {
      const updated = removeSharedWith(project, username);
      await projectsStore.save(projectId, updated);
    }
    await removeReceiverShare(username, "project", projectId, currentUser);
    return { status: "ok", item_id: projectId, shared_with: username };
  },

  getSharedWithMe: async (): Promise<{
    projects: SharedItemEntry[];
    tasks: SharedItemEntry[];
    methods: SharedItemEntry[];
  }> => {
    const currentUser = await getCurrentUserCached();
    const manifest = await readSharedWithMe(currentUser);
    return { projects: manifest.projects, tasks: manifest.tasks, methods: manifest.methods };
  },

  getNotifications: async (
    unreadOnly: boolean = false
  ): Promise<{ notifications: Notification[]; unread_count: number }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    const all = file.notifications;
    const notifications = unreadOnly ? all.filter((n) => !n.read) : all;
    const unread_count = all.filter((n) => !n.read).length;
    return { notifications, unread_count };
  },

  markNotificationRead: async (
    notificationId: string
  ): Promise<{ status: string; notification_id: string }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    const idx = file.notifications.findIndex((n) => n.id === notificationId);
    if (idx >= 0) {
      file.notifications[idx] = { ...file.notifications[idx], read: true };
      await writeNotificationsFile(currentUser, file);
    }
    return { status: "ok", notification_id: notificationId };
  },

  markAllNotificationsRead: async (): Promise<{ status: string; dismissed_count: number }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    let count = 0;
    file.notifications = file.notifications.map((n) => {
      if (!n.read) {
        count += 1;
        return { ...n, read: true };
      }
      return n;
    });
    if (count > 0) {
      await writeNotificationsFile(currentUser, file);
    }
    return { status: "ok", dismissed_count: count };
  },

  /**
   * Remove a single notification from the user's notifications file.
   * Unlike markNotificationRead this fully deletes the entry — callers want
   * the inbox empty, not just acknowledged.
   */
  dismissNotification: async (
    notificationId: string
  ): Promise<{ status: string; notification_id: string }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    file.notifications = file.notifications.filter((n) => n.id !== notificationId);
    await writeNotificationsFile(currentUser, file);
    return { status: "ok", notification_id: notificationId };
  },

  /** Clear every notification in the inbox. Returns how many were cleared. */
  dismissAllNotifications: async (): Promise<{ status: string; dismissed_count: number }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    const count = file.notifications.length;
    if (count > 0) {
      file.notifications = [];
      await writeNotificationsFile(currentUser, file);
    }
    return { status: "ok", dismissed_count: count };
  },

  /** Clear notifications already marked read; leave unread ones in place. */
  dismissReadNotifications: async (): Promise<{ status: string; dismissed_count: number }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    const before = file.notifications.length;
    file.notifications = file.notifications.filter((n) => !n.read);
    const removed = before - file.notifications.length;
    if (removed > 0) {
      await writeNotificationsFile(currentUser, file);
    }
    return { status: "ok", dismissed_count: removed };
  },

  /**
   * Append a calendar event reminder to the user's notifications file. Used
   * by the ReminderRunner when a scheduled timeout fires. Returns the new
   * notification so callers can also surface an OS-level Notification API
   * popup if the user has granted permission.
   */
  createEventReminder: async (
    input: Omit<EventReminderNotification, "id" | "type" | "created_at" | "read">
  ): Promise<EventReminderNotification> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    const notification: EventReminderNotification = {
      ...input,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "event_reminder",
      created_at: new Date().toISOString(),
      read: false,
    };
    file.notifications.push(notification);
    await writeNotificationsFile(currentUser, file);
    return notification;
  },
};

function labTaskFrom(
  t: Task,
  username: string,
  userColor: string,
): LabTask {
  const task = computeTaskEndDate(t);
  return {
    id: task.id,
    name: task.name,
    project_id: task.project_id,
    start_date: task.start_date,
    duration_days: task.duration_days,
    end_date: task.end_date,
    is_complete: task.is_complete,
    task_type: task.task_type,
    username: task.owner || username,
    user_color: userColor,
    experiment_color: task.experiment_color,
    method_ids: task.method_ids || [],
    notes: task.deviation_log,
  };
}

export const labApi = {
  getUsers: async (): Promise<{ users: LabUser[] }> => {
    const { usernames, metadata } = await loadLabUsers();
    const users: LabUser[] = usernames.map((username) => ({
      username,
      color: colorFor(metadata, username),
      created_at: metadata[username]?.created_at ?? null,
    }));
    return { users };
  },

  getTasks: async (params?: { exclude_goals?: boolean; usernames?: string }): Promise<LabTask[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const tasks: LabTask[] = [];

    for (const username of usernames) {
      const userTasks = await tasksStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      for (const t of userTasks) {
        tasks.push(labTaskFrom(t, username, userColor));
      }
    }

    return tasks;
  },

  getProjects: async (params?: { usernames?: string }): Promise<LabProject[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const projects: LabProject[] = [];

    for (const username of usernames) {
      const userProjects = await projectsStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      for (const p of userProjects) {
        projects.push({
          id: p.id,
          name: p.name,
          color: p.color || "#3b82f6",
          username: p.owner || username,
          user_color: userColor,
          is_archived: p.is_archived || false,
        });
      }
    }

    return projects;
  },

  getMethods: async (): Promise<LabMethod[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const methods: LabMethod[] = [];

    for (const username of usernames) {
      const userMethods = await methodsStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      for (const m of userMethods) {
        methods.push({
          id: m.id,
          name: m.name,
          username: m.owner || username,
          user_color: userColor,
          is_public: false,
        });
      }
    }

    const publicMethods = await publicMethodsStore.listAll();
    for (const m of publicMethods) {
      methods.push({
        id: m.id,
        name: m.name,
        username: m.owner || "public",
        user_color: "#6b7280",
        is_public: true,
      });
    }

    return methods;
  },

  getMethodFolders: async (): Promise<string[]> => {
    return [];
  },

  // #14: lab-wide goals view. Returns each user's HighLevelGoals annotated
  // with username + color, skipping any user who opted out via
  // _user_metadata.json (hide_goals_from_lab). Used by the Roadmaps tab.
  //
  // Privacy contract: personal goals (project_id === null) are NEVER
  // exposed to lab mode. Only project-scoped goals propagate. The
  // hide_goals_from_lab flag is the additional opt-out for project goals.
  getGoals: async (): Promise<LabGoal[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const out: LabGoal[] = [];
    for (const username of usernames) {
      if (metadata[username]?.hide_goals_from_lab) continue;
      const userGoals = await goalsStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      for (const g of userGoals) {
        if (g.project_id === null) continue; // personal goal, never shared
        out.push({
          id: g.id,
          name: g.name,
          project_id: g.project_id,
          start_date: g.start_date,
          end_date: g.end_date,
          is_complete: g.is_complete,
          color: g.color,
          smart_goals: g.smart_goals || [],
          username,
          user_color: userColor,
        });
      }
    }
    return out;
  },

  getExperiments: async (params?: { usernames?: string }): Promise<LabTask[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const tasks: LabTask[] = [];

    for (const username of usernames) {
      const userTasks = await tasksStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      for (const t of userTasks) {
        if (t.task_type !== "experiment") continue;
        tasks.push(labTaskFrom(t, username, userColor));
      }
    }

    return tasks;
  },

  getPurchases: async (params?: { usernames?: string }): Promise<LabTask[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const tasks: LabTask[] = [];

    for (const username of usernames) {
      const userTasks = await tasksStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      for (const t of userTasks) {
        if (t.task_type !== "purchase") continue;
        tasks.push(labTaskFrom(t, username, userColor));
      }
    }

    return tasks;
  },

  search: async (params: {
    q?: string;
    usernames?: string;
    task_types?: string;
    date_from?: string;
    date_to?: string;
    project_id?: number;
    method_id?: number;
    method_folder?: string;
    completion_status?: "all" | "complete" | "incomplete";
  }): Promise<{ results: LabSearchResult[]; total_count: number }> => {
    const q = (params.q ?? "").trim().toLowerCase();
    const usernamesFilter = params.usernames
      ? new Set(params.usernames.split(",").map((s) => s.trim()).filter(Boolean))
      : null;
    const taskTypes = params.task_types
      ? new Set(params.task_types.split(",").map((s) => s.trim()).filter(Boolean))
      : null;
    const dateFrom = params.date_from || null;
    const dateTo = params.date_to || null;
    const projectId = typeof params.project_id === "number" ? params.project_id : null;
    const methodId = typeof params.method_id === "number" ? params.method_id : null;
    const completion = params.completion_status ?? "all";

    const { usernames: allUsernames, metadata } = await loadLabUsers();
    const targetUsernames = usernamesFilter
      ? allUsernames.filter((u) => usernamesFilter.has(u))
      : allUsernames;

    const results: LabSearchResult[] = [];

    const previewFrom = (text: string): string => {
      if (!q) return text.slice(0, 160);
      const idx = text.toLowerCase().indexOf(q);
      if (idx === -1) return text.slice(0, 160);
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + q.length + 80);
      return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
    };

    // Tasks
    for (const username of targetUsernames) {
      const userColor = colorFor(metadata, username);
      const userTasks = await tasksStore.listAllForUser(username);
      for (const raw of userTasks) {
        if (raw.is_high_level) continue; // lab mode never surfaces goals
        if (taskTypes && !taskTypes.has(raw.task_type)) continue;
        if (projectId !== null && raw.project_id !== projectId) continue;
        if (methodId !== null && !(raw.method_ids || []).includes(methodId)) continue;
        if (completion === "complete" && !raw.is_complete) continue;
        if (completion === "incomplete" && raw.is_complete) continue;

        const task = computeTaskEndDate(raw);
        if (dateFrom && task.end_date < dateFrom) continue;
        if (dateTo && task.start_date > dateTo) continue;

        let matchField: string = "filter";
        let matchPreview = "";

        if (q) {
          const name = task.name?.toLowerCase() ?? "";
          const tags = (task.tags ?? []).join(" ").toLowerCase();
          const deviation = (task.deviation_log ?? "").toLowerCase();
          if (name.includes(q)) {
            matchField = "name";
          } else if (tags.includes(q)) {
            matchField = "tags";
            matchPreview = previewFrom((task.tags ?? []).join(", "));
          } else if (deviation.includes(q)) {
            matchField = "deviation_log";
            matchPreview = previewFrom(task.deviation_log ?? "");
          } else {
            continue; // no text match
          }
        }

        results.push({
          type: "task",
          id: task.id,
          name: task.name,
          username: task.owner || username,
          user_color: userColor,
          match_field: matchField,
          match_preview: matchPreview,
        });
      }
    }

    // Projects & methods only matter when not filtering to a specific task type.
    if (!taskTypes) {
      for (const username of targetUsernames) {
        const userColor = colorFor(metadata, username);

        const userProjects = await projectsStore.listAllForUser(username);
        for (const p of userProjects) {
          if (projectId !== null && p.id !== projectId) continue;
          if (q && !p.name.toLowerCase().includes(q)) continue;
          results.push({
            type: "project",
            id: p.id,
            name: p.name,
            username: p.owner || username,
            user_color: userColor,
            match_field: q ? "name" : "filter",
            match_preview: "",
          });
        }

        if (projectId === null) {
          const userMethods = await methodsStore.listAllForUser(username);
          for (const m of userMethods) {
            if (methodId !== null && m.id !== methodId) continue;
            if (q && !m.name.toLowerCase().includes(q)) continue;
            results.push({
              type: "method",
              id: m.id,
              name: m.name,
              username: m.owner || username,
              user_color: userColor,
              match_field: q ? "name" : "filter",
              match_preview: "",
            });
          }
        }
      }
    }

    return { results, total_count: results.length };
  },

  getUserTasks: async (username: string): Promise<LabTask[]> => {
    const metadata = await ensureLabUserMetadata([username]);
    const userColor = colorFor(metadata, username);
    const tasks = await tasksStore.listAllForUser(username);
    return tasks.map((t) => labTaskFrom(t, username, userColor));
  },

  getUserProjects: async (username: string): Promise<LabProject[]> => {
    const metadata = await ensureLabUserMetadata([username]);
    const userColor = colorFor(metadata, username);
    const projects = await projectsStore.listAllForUser(username);
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color || "#3b82f6",
      username: p.owner || username,
      user_color: userColor,
      is_archived: p.is_archived || false,
    }));
  },

  getUserPurchaseItems: async (username: string, taskId: number): Promise<PurchaseItem[]> => {
    const items = await purchaseItemsStore.listAllForUser(username);
    return items.filter((item) => item.task_id === taskId).map((item) => ({
      ...item,
      total_price: item.total_price ?? (item.price_per_unit ?? 0) * item.quantity + (item.shipping_fees ?? 0),
    }));
  },

  getAllPurchaseItems: async (
    params?: { shared_only?: boolean },
  ): Promise<Array<PurchaseItem & { username: string }>> => {
    const usernames = await discoverUsers();
    const items: Array<PurchaseItem & { username: string }> = [];
    for (const username of usernames) {
      const userItems = await purchaseItemsStore.listAllForUser(username);
      for (const item of userItems) {
        items.push({
          ...item,
          username,
          total_price:
            item.total_price ??
            (item.price_per_unit ?? 0) * item.quantity + (item.shipping_fees ?? 0),
        });
      }
    }
    return items;
  },

  getNotes: async (params?: { usernames?: string; shared_only?: boolean }): Promise<Note[]> => {
    const usernames = await discoverUsers();
    const notes: Note[] = [];

    for (const username of usernames) {
      const userNotes = await notesStore.listAllForUser(username);
      for (const note of userNotes) {
        notes.push({ ...note, username: note.username || username });
      }
    }

    if (params?.shared_only) {
      return notes.filter((n) => n.is_shared);
    }
    return notes;
  },

  getUserNotes: async (username: string): Promise<Note[]> => {
    const notes = await notesStore.listAllForUser(username);
    return notes.map((n) => ({ ...n, username: n.username || username }));
  },
};

export const usersApi = {
  list: async (): Promise<{ users: string[]; current_user: string }> => {
    if (!fileService.isConnected()) {
      return { users: [], current_user: "" };
    }
    
    const usersDir = await fileService.getDirectory("users");
    if (!usersDir) {
      return { users: [], current_user: "" };
    }
    
    const skipDirs = new Set(["public", "lab", "_no_user_", "_global_counters.json", "_user_metadata.json"]);
    const users: string[] = [];
    
    for await (const entry of (usersDir as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()) {
      if (entry.kind === "directory" && !skipDirs.has(entry.name)) {
        users.push(entry.name);
      }
    }
    
    const currentUser = await getCurrentUser();
    return { users: users.sort(), current_user: currentUser || "" };
  },
  
  login: async (username: string): Promise<{ status: string; current_user: string }> => {
    clearCurrentUserCache();
    await storeCurrentUser(username);
    return { status: "ok", current_user: username };
  },

  create: async (username: string): Promise<{ status: string; current_user: string; created: boolean }> => {
    clearCurrentUserCache();
    await storeCurrentUser(username);
    return { status: "ok", current_user: username, created: true };
  },
  
  validate: async (): Promise<{ valid: boolean; current_user: string }> => {
    const currentUser = await getCurrentUser();
    if (currentUser) {
      return { valid: true, current_user: currentUser };
    }
    return { valid: false, current_user: "" };
  },
  
  rename: async (oldUsername: string, newUsername: string): Promise<{ status: string; old_username: string; new_username: string }> => {
    const sanitized = newUsername.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    if (!sanitized) throw new Error("New username is empty or contains only invalid characters");
    if (sanitized === oldUsername) {
      return { status: "ok", old_username: oldUsername, new_username: sanitized };
    }
    const root = fileService.getDirectoryHandle();
    if (!root) throw new Error("File system not connected");
    const usersDir = await fileService.getDirectory("users");
    if (!usersDir) throw new Error("users/ directory not found");

    const usersHandle = usersDir as unknown as {
      getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<FileSystemDirectoryHandle>;
      removeEntry: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
      values: () => AsyncIterable<FileSystemHandle>;
    };

    // Refuse to overwrite an existing user directory.
    try {
      await usersHandle.getDirectoryHandle(sanitized);
      throw new Error(`User '${sanitized}' already exists`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("already exists")) throw err;
      // NotFoundError is expected — proceed.
    }

    const sourceDir = await usersHandle.getDirectoryHandle(oldUsername);
    const targetDir = await usersHandle.getDirectoryHandle(sanitized, { create: true });

    const copyTree = async (
      from: FileSystemDirectoryHandle,
      to: FileSystemDirectoryHandle
    ): Promise<void> => {
      const fromIterable = from as unknown as { values: () => AsyncIterable<FileSystemHandle> };
      const toHandle = to as unknown as {
        getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FileSystemFileHandle>;
        getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<FileSystemDirectoryHandle>;
      };
      for await (const entry of fromIterable.values()) {
        if (entry.kind === "file") {
          const srcFile = await (entry as FileSystemFileHandle).getFile();
          const dest = await toHandle.getFileHandle(entry.name, { create: true });
          const writable = await dest.createWritable();
          await writable.write(await srcFile.arrayBuffer());
          await writable.close();
        } else if (entry.kind === "directory") {
          const subDest = await toHandle.getDirectoryHandle(entry.name, { create: true });
          await copyTree(entry as FileSystemDirectoryHandle, subDest);
        }
      }
    };

    await copyTree(sourceDir, targetDir);
    await usersHandle.removeEntry(oldUsername, { recursive: true });

    // If renaming the current user, keep them logged in under the new name.
    const current = await getCurrentUser();
    if (current === oldUsername) {
      clearCurrentUserCache();
      await storeCurrentUser(sanitized);
    }
    const main = await getMainUser();
    if (main === oldUsername) {
      await storeMainUser(sanitized);
    }

    return { status: "ok", old_username: oldUsername, new_username: sanitized };
  },

  logout: async (): Promise<{ status: string; message: string }> => {
    clearCurrentUserCache();
    await clearCurrentUser();
    return { status: "ok", message: "Logged out" };
  },
  
  getMainUser: async (): Promise<{ main_user: string; current_user: string }> => {
    const [mainUser, currentUser] = await Promise.all([
      getMainUser(),
      getCurrentUser(),
    ]);
    return { main_user: mainUser || "", current_user: currentUser || "" };
  },
  
  setMainUser: async (username: string): Promise<{ status: string; main_user: string }> => {
    await storeMainUser(username);
    return { status: "ok", main_user: username };
  },
  
  archive: async (username: string): Promise<Blob> => {
    if (!fileService.isConnected()) {
      throw new Error("File system not connected");
    }
    
    const usersDir = await fileService.getDirectory("users");
    if (!usersDir) {
      throw new Error("Users directory not found");
    }
    
    const userDir = await (usersDir as any).getDirectoryHandle(username, { create: false });
    if (!userDir) {
      throw new Error(`User '${username}' not found`);
    }
    
    const zip = new JSZip();
    
    const addFolderToZip = async (dirHandle: FileSystemDirectoryHandle, zipFolder: JSZip) => {
      for await (const entry of (dirHandle as any).values()) {
        if (entry.kind === "file") {
          const file = await entry.getFile();
          const content = await file.arrayBuffer();
          zipFolder.file(entry.name, content);
        } else if (entry.kind === "directory") {
          const subFolder = zipFolder.folder(entry.name);
          if (subFolder) {
            await addFolderToZip(entry, subFolder);
          }
        }
      }
    };
    
    await addFolderToZip(userDir, zip);
    
    return await zip.generateAsync({ type: "blob" });
  },
  
  delete: async (username: string, confirmationStep: number, acknowledgedWarning: boolean): Promise<{ status: string; deleted_username: string; message: string }> => {
    if (!fileService.isConnected()) {
      return { status: "error", deleted_username: "", message: "File system not connected" };
    }
    
    if (!acknowledgedWarning) {
      return { status: "error", deleted_username: "", message: "Warning must be acknowledged" };
    }
    
    if (confirmationStep === 1) {
      return { 
        status: "warning", 
        deleted_username: "", 
        message: `This will remove all data for user '${username}'. Please acknowledge and proceed to step 2.` 
      };
    }
    
    if (confirmationStep === 2) {
      try {
        const usersDir = await fileService.getDirectory("users");
        if (!usersDir) {
          return { status: "error", deleted_username: "", message: "Users directory not found" };
        }
        
        await (usersDir as any).removeEntry(username, { recursive: true });
        
        return { 
          status: "ok", 
          deleted_username: username, 
          message: `User '${username}' has been deleted successfully` 
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to delete user";
        return { status: "error", deleted_username: "", message: errorMessage };
      }
    }
    
    return { status: "error", deleted_username: "", message: "Invalid confirmation step" };
  },

  // #14: lab visibility preference. When true, this user's goals are hidden
  // from the lab-mode Roadmaps tab (and the lab GANTT once goals land
  // there). Stored in users/_user_metadata.json.
  getHideGoalsFromLab: async (username: string): Promise<boolean> => {
    const md = await getUserMetadata(username);
    return Boolean(md?.hide_goals_from_lab);
  },
  setHideGoalsFromLab: async (username: string, hide: boolean): Promise<boolean> => {
    const updated = await setUserMetadataField(username, "hide_goals_from_lab", hide);
    return Boolean(updated?.hide_goals_from_lab);
  },
};

async function readBlobAsText(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
}

async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const filesApi = {
  readFile: async (path: string): Promise<{ path: string; content: string; sha: string; html_url: string }> => {
    const blob = await fileService.readFileAsBlob(path);
    if (!blob) throw new Error(`File not found: ${path}`);
    const content = await readBlobAsText(blob);
    const sha = await sha1Hex(content);
    return { path, content, sha, html_url: "" };
  },
  writeFile: async (path: string, content: string, _message?: string): Promise<{ path: string; sha: string }> => {
    const blob = new Blob([content], { type: "text/plain" });
    await fileService.writeFileFromBlob(path, blob);
    const sha = await sha1Hex(content);
    return { path, sha };
  },
  uploadImage: async (path: string, base64Content: string, _message?: string): Promise<ImageUploadResponse> => {
    const binaryString = atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    await fileService.writeFileFromBlob(path, new Blob([bytes]));
    const sha = await sha1Hex(base64Content);
    const parts = path.split("/");
    const filename = parts[parts.length - 1] ?? "";
    const folder = parts.length >= 2 ? parts[parts.length - 2] : "";
    const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1) : "";
    return {
      id: 0,
      path,
      sha,
      download_url: "",
      file_size: bytes.length,
      warning: "",
      added_to_gitignore: false,
      filename,
      original_filename: filename,
      folder,
      file_type: ext,
    };
  },
  listDirectory: async (path?: string): Promise<Array<{ name: string; path: string; type: "file" | "dir"; size: number }>> => {
    if (!path) return [];
    const files = await fileService.listFiles(path);
    return files.map((name) => ({ name, path: `${path}/${name}`, type: "file" as const, size: 0 }));
  },
  deleteDirectory: async (path: string): Promise<{ status: string }> => {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return { status: "not_found" };
    const parentPath = parts.slice(0, -1).join("/");
    const parent = parentPath
      ? await fileService.getDirectory(parentPath)
      : fileService.getDirectoryHandle();
    if (!parent) return { status: "not_found" };
    try {
      await (parent as unknown as { removeEntry: (name: string, opts?: { recursive?: boolean }) => Promise<void> }).removeEntry(parts[parts.length - 1], { recursive: true });
      return { status: "deleted" };
    } catch {
      return { status: "not_found" };
    }
  },
};

// Fire-and-forget heal pass: when on-disk end_date doesn't match the canonical
// derived value, rewrite the file. Runs after the read so the caller isn't
// blocked. Failures are logged but never propagated — a heal-write that fails
// just means the same fix runs again on the next read.
async function persistEndDateHealForOwn(stale: Task[]): Promise<void> {
  for (const fixed of stale) {
    try {
      await tasksStore.save(fixed.id, fixed);
    } catch (err) {
      console.warn(`[end_date heal] failed to persist task ${fixed.id}:`, err);
    }
  }
}

async function persistEndDateHealForOwner(stale: Array<{ task: Task; owner: string }>): Promise<void> {
  for (const { task, owner } of stale) {
    try {
      await tasksStore.saveForUser(task.id, task, owner);
    } catch (err) {
      console.warn(`[end_date heal] failed to persist shared task ${owner}/${task.id}:`, err);
    }
  }
}

export const fetchAllTasks = async () => {
  const tasks = await tasksStore.listAll();
  const currentUser = await getCurrentUserCached();
  const stale: Task[] = [];
  const out = tasks.map((raw) => {
    const fixed = computeTaskEndDate(raw);
    if (fixed !== raw) stale.push(fixed);
    return normalizeTaskRecord(withOwnerFallback(fixed, currentUser));
  });
  if (stale.length > 0) {
    void persistEndDateHealForOwn(stale);
  }
  return out;
};

// Older tasks were written with `owner: ""`. Reading from
// `users/{currentUser}/tasks/{id}.json` is unambiguous about who owns them,
// so we backfill the field in memory. The on-disk file is left alone (a
// migration script can fix it later). Without this, anything keying off
// `task.owner` — like the per-user results path — would compute `users//...`.
function withOwnerFallback(task: Task, currentUser: string | null): Task {
  if (task.owner) return task;
  return { ...task, owner: currentUser ?? "" };
}

interface SharedWithMeManifest {
  version?: number;
  tasks?: Array<{ id: number; owner: string; permission?: string; shared_at?: string }>;
}

export const fetchAllTasksIncludingShared = async () => {
  const ownTasks = await tasksStore.listAll();
  const currentUserForOwn = await getCurrentUserCached();
  const ownTasksWithOwner = ownTasks.map((t) => withOwnerFallback(t, currentUserForOwn));

  const sharedTasks: Task[] = [];
  // Track shared tasks whose end_date needs healing, keyed by owner so the
  // write-back lands in the right user directory.
  const sharedToHeal: Array<{ task: Task; owner: string }> = [];
  try {
    const currentUser = currentUserForOwn;
    const manifest = await fileService.readJson<SharedWithMeManifest>(
      `users/${currentUser}/_shared_with_me.json`
    );
    const entries = manifest?.tasks ?? [];
    for (const entry of entries) {
      // Per-user ID spaces mean a shared task's numeric id can collide with one
      // of the viewer's own tasks. Both are surfaced; downstream code keys off
      // `taskKey(task)` (in `frontend/src/lib/types.ts`) to disambiguate.
      const task = await fileService.readJson<Task>(
        `users/${entry.owner}/tasks/${entry.id}.json`
      );
      if (!task) continue;
      const permission = entry.permission === "view" ? "view" : "edit";
      const withOwner = {
        ...task,
        owner: entry.owner,
        is_shared_with_me: true,
        shared_permission: permission,
      } as Task;
      sharedTasks.push(withOwner);
      // Only attempt heal-write for shared tasks the viewer is allowed to edit.
      // The raw on-disk task (sans the is_shared_with_me / shared_permission
      // overlays) is what gets persisted.
      if (permission === "edit") {
        const expected = canonicalEndDate(task);
        if (task.end_date !== expected) {
          sharedToHeal.push({ task: { ...task, end_date: expected }, owner: entry.owner });
        }
      }
    }
  } catch (err) {
    console.warn("[fetchAllTasksIncludingShared] failed to load shared tasks:", err);
  }

  const ownStale: Task[] = [];
  const merged = [...ownTasksWithOwner, ...sharedTasks].map((raw) => {
    const fixed = computeTaskEndDate(raw);
    // Only heal own (non-shared) entries here. Shared-task heals were captured
    // separately above so they get routed to the owner's directory.
    if (fixed !== raw && !raw.is_shared_with_me) ownStale.push(fixed);
    return normalizeTaskRecord(fixed);
  });

  if (ownStale.length > 0) void persistEndDateHealForOwn(ownStale);
  if (sharedToHeal.length > 0) void persistEndDateHealForOwner(sharedToHeal);

  // Guardrail: composite keys must be unique across the merged list. Hitting
  // this means the keying scheme is inconsistent somewhere upstream.
  if (process.env.NODE_ENV !== "production") {
    const seen = new Set<string>();
    for (const t of merged) {
      const ns = t.is_shared_with_me ? (t.owner || "shared") : "self";
      const key = `${ns}:${t.id}`;
      if (seen.has(key)) {
        console.error(`[fetchAllTasksIncludingShared] duplicate composite key: ${key}`);
      }
      seen.add(key);
    }
  }

  return merged;
};

// Mirror of `fetchAllTasksIncludingShared` for methods. Reads the receiver's
// `_shared_with_me.json` manifest and pulls each shared method from the
// owner's private dir, overlaying `is_shared_with_me` / `shared_permission` /
// `owner` at read time. Public methods are already surfaced by
// `methodsApi.list`; this only adds the receiver-shared private ones.
export const fetchAllMethodsIncludingShared = async (): Promise<Method[]> => {
  const ownMethods = await methodsApi.list();

  const sharedMethods: Method[] = [];
  try {
    const currentUser = await getCurrentUserCached();
    const manifest = await fileService.readJson<SharedManifest>(
      `users/${currentUser}/_shared_with_me.json`
    );
    const entries = manifest?.methods ?? [];
    for (const entry of entries) {
      const method = await fileService.readJson<Method>(
        `users/${entry.owner}/methods/${entry.id}.json`
      );
      if (!method) continue;
      const permission = entry.permission === "view" ? "view" : "edit";
      const withOverlay = {
        ...method,
        owner: entry.owner,
        is_public: false,
        is_shared_with_me: true,
        shared_permission: permission,
      } as Method;
      sharedMethods.push(withOverlay);
    }
  } catch (err) {
    console.warn("[fetchAllMethodsIncludingShared] failed to load shared methods:", err);
  }

  return [...ownMethods, ...sharedMethods];
};

// Mirror of `fetchAllTasksIncludingShared` for projects.
export const fetchAllProjectsIncludingShared = async (): Promise<Project[]> => {
  const ownProjects = await projectsStore.listAll();

  const sharedProjects: Project[] = [];
  try {
    const currentUser = await getCurrentUserCached();
    const manifest = await fileService.readJson<SharedManifest>(
      `users/${currentUser}/_shared_with_me.json`
    );
    const entries = manifest?.projects ?? [];
    for (const entry of entries) {
      const project = await fileService.readJson<Project>(
        `users/${entry.owner}/projects/${entry.id}.json`
      );
      if (!project) continue;
      const permission = entry.permission === "view" ? "view" : "edit";
      const withOverlay = {
        ...project,
        owner: entry.owner,
        is_shared_with_me: true,
        shared_permission: permission,
      } as Project;
      sharedProjects.push(withOverlay);
    }
  } catch (err) {
    console.warn("[fetchAllProjectsIncludingShared] failed to load shared projects:", err);
  }

  return [...ownProjects, ...sharedProjects];
};

export type {
  Project,
  ProjectCreate,
  ProjectUpdate,
  Task,
  TaskCreate,
  TaskUpdate,
  TaskMoveRequest,
  Dependency,
  DependencyCreate,
  Method,
  MethodCreate,
  MethodUpdate,
  Event,
  EventCreate,
  EventUpdate,
  HighLevelGoal,
  HighLevelGoalCreate,
  HighLevelGoalUpdate,
  SmartGoal,
  PCRProtocol,
  PCRProtocolCreate,
  PCRProtocolUpdate,
  PurchaseItem,
  PurchaseItemCreate,
  PurchaseItemUpdate,
  FundingAccount,
  FundingAccountCreate,
  FundingAccountUpdate,
  LabLink,
  LabLinkCreate,
  LabLinkUpdate,
  Note,
  NoteCreate,
  NoteUpdate,
  NoteComment,
  ImageMetadata,
  FileMetadata,
  CatalogItem,
  ShiftResult,
  SharedUser,
  ShareRequest,
  SharedItemEntry,
  Notification,
};

export interface LabUser {
  username: string;
  color: string;
  created_at: string | null;
}

export interface LabTask {
  id: number;
  name: string;
  project_id: number;
  start_date: string;
  duration_days: number;
  end_date: string;
  is_complete: boolean;
  task_type: string;
  username: string;
  user_color: string;
  experiment_color: string | null;
  method_ids: number[];
  notes: string | null;
}

export interface LabProject {
  id: number;
  name: string;
  color: string;
  username: string;
  user_color: string;
  is_archived: boolean;
}

export interface LabMethod {
  id: number;
  name: string;
  username: string;
  user_color: string;
  is_public: boolean;
}

export interface LabGoal {
  id: number;
  name: string;
  project_id: number | null;
  start_date: string;
  end_date: string;
  is_complete: boolean;
  color: string | null;
  smart_goals: SmartGoal[];
  username: string;
  user_color: string;
}

export interface LabSearchResult {
  type: string;
  id: number;
  name: string;
  username: string;
  user_color: string;
  match_field: string;
  match_preview: string;
}

export interface DuplicateCheckResult {
  has_duplicate: boolean;
  matching_tasks: Array<{
    id: number;
    name: string;
    task_type: string;
    start_date: string;
    is_complete: boolean;
  }>;
}

export interface ImageUploadResponse {
  id: number;
  path: string;
  sha: string;
  download_url: string;
  file_size: number;
  warning?: string;
  added_to_gitignore: boolean;
  filename: string;
  original_filename: string;
  folder: string;
  file_type: string;
}

export interface MethodExperiment {
  id: number;
  name: string;
  project_id: number;
  start_date: string;
  duration_days: number;
  end_date: string;
  is_complete: boolean;
  task_type: string;
  experiment_color: string | null;
  variation_notes: string | null;
}
