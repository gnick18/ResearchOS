import { z } from "zod";

export const SharedUserSchema = z.object({
  username: z.string(),
  permission: z.enum(["view", "edit"]).default("edit"),
});

export const ShareRequestSchema = z.object({
  username: z.string(),
  permission: z.enum(["view", "edit"]).default("edit"),
  include_chain: z.boolean().default(false),
});

export const SharedItemEntrySchema = z.object({
  id: z.number(),
  owner: z.string(),
  permission: z.string(),
  shared_at: z.string(),
});

export const NotificationSchema = z.object({
  id: z.string(),
  type: z.enum(["task_shared", "method_shared", "project_shared"]),
  from_user: z.string(),
  item_type: z.enum(["task", "method", "project"]),
  item_id: z.number(),
  item_name: z.string(),
  permission: z.string(),
  created_at: z.string(),
  read: z.boolean().default(false),
});

export const ProjectSchema = z.object({
  id: z.number(),
  name: z.string(),
  weekend_active: z.boolean().default(false),
  tags: z.array(z.string()).nullable(),
  color: z.string().nullable(),
  created_at: z.string(),
  sort_order: z.number().default(0),
  is_archived: z.boolean().default(false),
  archived_at: z.string().nullable(),
  owner: z.string().default(""),
  shared_with: z.array(SharedUserSchema).default([]),
});

export const ProjectCreateSchema = z.object({
  name: z.string(),
  weekend_active: z.boolean().default(false),
  tags: z.array(z.string()).optional().nullable(),
  color: z.string().optional().nullable(),
});

export const ProjectUpdateSchema = z.object({
  name: z.string().optional(),
  weekend_active: z.boolean().optional(),
  tags: z.array(z.string()).optional().nullable(),
  color: z.string().optional().nullable(),
  sort_order: z.number().optional(),
  is_archived: z.boolean().optional(),
  archived_at: z.string().optional().nullable(),
});

export const SubTaskSchema = z.object({
  id: z.string(),
  text: z.string(),
  is_complete: z.boolean().default(false),
});

export const TaskMethodAttachmentSchema = z.object({
  method_id: z.number(),
  pcr_gradient: z.string().nullable(),
  pcr_ingredients: z.string().nullable(),
  variation_notes: z.string().nullable(),
});

export const TaskSchema = z.object({
  id: z.number(),
  project_id: z.number(),
  name: z.string(),
  start_date: z.string(),
  duration_days: z.number().min(1),
  end_date: z.string(),
  is_high_level: z.boolean().default(false),
  is_complete: z.boolean().default(false),
  task_type: z.enum(["experiment", "purchase", "list"]).default("list"),
  weekend_override: z.boolean().nullable(),
  method_id: z.number().nullable(),
  method_ids: z.array(z.number()).default([]),
  deviation_log: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  sort_order: z.number().default(0),
  experiment_color: z.string().nullable(),
  sub_tasks: z.array(SubTaskSchema).nullable(),
  pcr_gradient: z.string().nullable(),
  pcr_ingredients: z.string().nullable(),
  method_attachments: z.array(TaskMethodAttachmentSchema).default([]),
  owner: z.string().default(""),
  shared_with: z.array(SharedUserSchema).default([]),
  inherited_from_project: z.number().nullable().optional(),
  is_shared_with_me: z.boolean().default(false).optional(),
});

export const TaskCreateSchema = z.object({
  project_id: z.number().optional().nullable(),
  name: z.string(),
  start_date: z.string(),
  duration_days: z.number().min(1).default(1),
  is_high_level: z.boolean().default(false),
  task_type: z.enum(["experiment", "purchase", "list"]).default("list"),
  weekend_override: z.boolean().optional().nullable(),
  method_id: z.number().optional().nullable(),
  method_ids: z.array(z.number()).optional(),
  tags: z.array(z.string()).optional().nullable(),
  sort_order: z.number().default(0),
  experiment_color: z.string().optional().nullable(),
  sub_tasks: z.array(SubTaskSchema).optional().nullable(),
  pcr_gradient: z.string().optional().nullable(),
  pcr_ingredients: z.string().optional().nullable(),
  method_attachments: z.array(TaskMethodAttachmentSchema).optional(),
});

export const TaskUpdateSchema = z.object({
  project_id: z.number().optional(),
  name: z.string().optional(),
  start_date: z.string().optional(),
  duration_days: z.number().min(1).optional(),
  is_high_level: z.boolean().optional(),
  is_complete: z.boolean().optional(),
  task_type: z.enum(["experiment", "purchase", "list"]).optional(),
  weekend_override: z.boolean().optional().nullable(),
  method_id: z.number().optional().nullable(),
  method_ids: z.array(z.number()).optional(),
  deviation_log: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  sort_order: z.number().optional(),
  experiment_color: z.string().optional().nullable(),
  sub_tasks: z.array(SubTaskSchema).optional().nullable(),
  pcr_gradient: z.string().optional().nullable(),
  pcr_ingredients: z.string().optional().nullable(),
  method_attachments: z.array(TaskMethodAttachmentSchema).optional(),
});

export const TaskMoveRequestSchema = z.object({
  new_start_date: z.string(),
  confirmed: z.boolean().default(false),
});

export const DependencySchema = z.object({
  id: z.number(),
  parent_id: z.number(),
  child_id: z.number(),
  dep_type: z.enum(["FS", "SS", "SF"]),
});

export const DependencyCreateSchema = z.object({
  parent_id: z.number(),
  child_id: z.number(),
  dep_type: z.enum(["FS", "SS", "SF"]),
});

export const ShiftedTaskSchema = z.object({
  task_id: z.number(),
  name: z.string(),
  old_start: z.string(),
  new_start: z.string(),
  old_end: z.string(),
  new_end: z.string(),
});

export const ShiftWarningSchema = z.object({
  task_id: z.number(),
  name: z.string(),
  message: z.string(),
});

export const ShiftResultSchema = z.object({
  affected_tasks: z.array(ShiftedTaskSchema),
  warnings: z.array(ShiftWarningSchema),
  requires_confirmation: z.boolean().default(false),
});

export const SmartGoalSchema = z.object({
  id: z.string(),
  text: z.string(),
  is_complete: z.boolean().default(false),
});

export const HighLevelGoalSchema = z.object({
  id: z.number(),
  project_id: z.number().nullable(),
  name: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  color: z.string().nullable(),
  smart_goals: z.array(SmartGoalSchema).default([]),
  is_complete: z.boolean().default(false),
  created_at: z.string(),
});

export const HighLevelGoalCreateSchema = z.object({
  project_id: z.number().optional().nullable(),
  name: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  color: z.string().optional().nullable(),
  smart_goals: z.array(SmartGoalSchema).optional(),
});

export const HighLevelGoalUpdateSchema = z.object({
  name: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  color: z.string().optional().nullable(),
  smart_goals: z.array(SmartGoalSchema).optional(),
  is_complete: z.boolean().optional(),
});

export const MethodAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  attachment_type: z.enum(["markdown", "pdf", "pcr"]),
  path: z.string(),
  order: z.number(),
});

export const MethodSchema = z.object({
  id: z.number(),
  name: z.string(),
  github_path: z.string().nullable(),
  method_type: z.enum(["markdown", "pdf", "pcr"]).nullable(),
  folder_path: z.string().nullable(),
  parent_method_id: z.number().nullable(),
  tags: z.array(z.string()).nullable(),
  attachments: z.array(MethodAttachmentSchema).default([]),
  is_public: z.boolean().default(false),
  created_by: z.string().nullable(),
  owner: z.string().default(""),
  shared_with: z.array(SharedUserSchema).default([]),
});

export const MethodCreateSchema = z.object({
  name: z.string(),
  github_path: z.string().optional().nullable(),
  method_type: z.enum(["markdown", "pdf", "pcr"]).optional(),
  folder_path: z.string().optional().nullable(),
  parent_method_id: z.number().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  attachments: z.array(MethodAttachmentSchema).optional(),
  is_public: z.boolean().default(false),
});

export const MethodUpdateSchema = z.object({
  name: z.string().optional(),
  github_path: z.string().optional().nullable(),
  method_type: z.enum(["markdown", "pdf", "pcr"]).optional().nullable(),
  folder_path: z.string().optional().nullable(),
  parent_method_id: z.number().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  attachments: z.array(MethodAttachmentSchema).optional(),
  is_public: z.boolean().optional(),
});

export const PCRStepSchema = z.object({
  name: z.string(),
  temperature: z.number(),
  duration: z.string(),
});

export const PCRCycleSchema = z.object({
  repeats: z.number(),
  steps: z.array(PCRStepSchema),
});

export const PCRGradientSchema = z.object({
  initial: z.array(PCRStepSchema).default([]),
  cycles: z.array(PCRCycleSchema).default([]),
  final: z.array(PCRStepSchema).default([]),
  hold: PCRStepSchema.nullable(),
});

export const PCRIngredientSchema = z.object({
  id: z.string(),
  name: z.string(),
  concentration: z.string(),
  amount_per_reaction: z.string(),
  checked: z.boolean().optional(),
});

export const PCRProtocolSchema = z.object({
  id: z.number(),
  name: z.string(),
  gradient: PCRGradientSchema,
  ingredients: z.array(PCRIngredientSchema),
  notes: z.string().nullable(),
  is_public: z.boolean().default(false),
  created_by: z.string().nullable(),
});

export const PCRProtocolCreateSchema = z.object({
  name: z.string(),
  gradient: PCRGradientSchema,
  ingredients: z.array(PCRIngredientSchema),
  notes: z.string().optional().nullable(),
  folder_path: z.string().optional().nullable(),
  is_public: z.boolean().optional(),
});

export const PCRProtocolUpdateSchema = z.object({
  name: z.string().optional(),
  gradient: PCRGradientSchema.optional(),
  ingredients: z.array(PCRIngredientSchema).optional(),
  notes: z.string().optional().nullable(),
  is_public: z.boolean().optional(),
});

export const EventSchema = z.object({
  id: z.number(),
  title: z.string(),
  event_type: z.enum(["conference", "deadline", "meeting", "other"]).default("conference"),
  start_date: z.string(),
  end_date: z.string().nullable(),
  location: z.string().nullable(),
  url: z.string().nullable(),
  notes: z.string().nullable(),
  color: z.string().nullable(),
});

export const EventCreateSchema = z.object({
  title: z.string(),
  event_type: z.enum(["conference", "deadline", "meeting", "other"]).default("conference"),
  start_date: z.string(),
  end_date: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
});

export const EventUpdateSchema = z.object({
  title: z.string().optional(),
  event_type: z.enum(["conference", "deadline", "meeting", "other"]).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
});

export const PurchaseItemSchema = z.object({
  id: z.number(),
  task_id: z.number(),
  item_name: z.string(),
  quantity: z.number(),
  link: z.string().nullable(),
  cas: z.string().nullable(),
  price_per_unit: z.number(),
  shipping_fees: z.number(),
  total_price: z.number(),
  notes: z.string().nullable(),
  funding_string: z.string().nullable(),
});

export const PurchaseItemCreateSchema = z.object({
  task_id: z.number(),
  item_name: z.string(),
  quantity: z.number(),
  link: z.string().optional().nullable(),
  cas: z.string().optional().nullable(),
  price_per_unit: z.number().default(0),
  shipping_fees: z.number().default(0),
  notes: z.string().optional().nullable(),
  funding_string: z.string().optional().nullable(),
});

export const PurchaseItemUpdateSchema = z.object({
  item_name: z.string().optional(),
  quantity: z.number().optional(),
  link: z.string().optional().nullable(),
  cas: z.string().optional().nullable(),
  price_per_unit: z.number().optional(),
  shipping_fees: z.number().optional(),
  notes: z.string().optional().nullable(),
  funding_string: z.string().optional().nullable(),
});

export const FundingAccountSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  total_budget: z.number(),
  spent: z.number(),
  remaining: z.number(),
});

export const FundingAccountCreateSchema = z.object({
  name: z.string(),
  description: z.string().optional().nullable(),
  total_budget: z.number().default(0),
});

export const FundingAccountUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  total_budget: z.number().optional(),
});

export const LabLinkSchema = z.object({
  id: z.number(),
  title: z.string(),
  url: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  color: z.string().nullable(),
  preview_image_url: z.string().nullable(),
  sort_order: z.number().default(0),
  created_at: z.string(),
});

export const LabLinkCreateSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  preview_image_url: z.string().optional().nullable(),
});

export const LabLinkUpdateSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  preview_image_url: z.string().optional().nullable(),
  sort_order: z.number().optional(),
});

export const NoteEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  content: z.string().default(""),
  created_at: z.string(),
  updated_at: z.string(),
});

export const NoteSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().default(""),
  is_running_log: z.boolean().default(false),
  is_shared: z.boolean().default(false),
  entries: z.array(NoteEntrySchema).default([]),
  created_at: z.string(),
  updated_at: z.string(),
  username: z.string(),
});

export const NoteCreateSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  is_running_log: z.boolean().default(false),
  is_shared: z.boolean().default(false),
  entries: z.array(z.object({
    title: z.string(),
    date: z.string(),
    content: z.string().optional().default(""),
  })).optional(),
});

export const NoteUpdateSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  is_shared: z.boolean().optional(),
});

export const ImageMetadataSchema = z.object({
  id: z.number(),
  filename: z.string(),
  original_filename: z.string().nullable(),
  path: z.string(),
  experiment_id: z.number(),
  experiment_name: z.string(),
  project_id: z.number().nullable(),
  project_name: z.string().nullable(),
  uploaded_at: z.string(),
  file_size: z.number(),
  file_type: z.string(),
  folder: z.string(),
});

export const FileMetadataSchema = z.object({
  id: z.number(),
  filename: z.string(),
  original_filename: z.string().nullable(),
  path: z.string(),
  experiment_id: z.number(),
  experiment_name: z.string(),
  project_id: z.number().nullable(),
  project_name: z.string().nullable(),
  uploaded_at: z.string(),
  file_size: z.number(),
  file_type: z.string(),
  folder: z.string(),
  attachment_type: z.enum(["notes", "results"]),
});

export const CatalogItemSchema = z.object({
  id: z.number(),
  item_name: z.string(),
  link: z.string().nullable(),
  cas: z.string().nullable(),
  price_per_unit: z.number(),
});

export type SharedUser = z.infer<typeof SharedUserSchema>;
export type ShareRequest = z.infer<typeof ShareRequestSchema>;
export type SharedItemEntry = z.infer<typeof SharedItemEntrySchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
export type SubTask = z.infer<typeof SubTaskSchema>;
export type TaskMethodAttachment = z.infer<typeof TaskMethodAttachmentSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;
export type TaskMoveRequest = z.infer<typeof TaskMoveRequestSchema>;
export type Dependency = z.infer<typeof DependencySchema>;
export type DependencyCreate = z.infer<typeof DependencyCreateSchema>;
export type ShiftedTask = z.infer<typeof ShiftedTaskSchema>;
export type ShiftWarning = z.infer<typeof ShiftWarningSchema>;
export type ShiftResult = z.infer<typeof ShiftResultSchema>;
export type SmartGoal = z.infer<typeof SmartGoalSchema>;
export type HighLevelGoal = z.infer<typeof HighLevelGoalSchema>;
export type HighLevelGoalCreate = z.infer<typeof HighLevelGoalCreateSchema>;
export type HighLevelGoalUpdate = z.infer<typeof HighLevelGoalUpdateSchema>;
export type MethodAttachment = z.infer<typeof MethodAttachmentSchema>;
export type Method = z.infer<typeof MethodSchema>;
export type MethodCreate = z.infer<typeof MethodCreateSchema>;
export type MethodUpdate = z.infer<typeof MethodUpdateSchema>;
export type PCRStep = z.infer<typeof PCRStepSchema>;
export type PCRCycle = z.infer<typeof PCRCycleSchema>;
export type PCRGradient = z.infer<typeof PCRGradientSchema>;
export type PCRIngredient = z.infer<typeof PCRIngredientSchema>;
export type PCRProtocol = z.infer<typeof PCRProtocolSchema>;
export type PCRProtocolCreate = z.infer<typeof PCRProtocolCreateSchema>;
export type PCRProtocolUpdate = z.infer<typeof PCRProtocolUpdateSchema>;
export type Event = z.infer<typeof EventSchema>;
export type EventCreate = z.infer<typeof EventCreateSchema>;
export type EventUpdate = z.infer<typeof EventUpdateSchema>;
export type PurchaseItem = z.infer<typeof PurchaseItemSchema>;
export type PurchaseItemCreate = z.infer<typeof PurchaseItemCreateSchema>;
export type PurchaseItemUpdate = z.infer<typeof PurchaseItemUpdateSchema>;
export type FundingAccount = z.infer<typeof FundingAccountSchema>;
export type FundingAccountCreate = z.infer<typeof FundingAccountCreateSchema>;
export type FundingAccountUpdate = z.infer<typeof FundingAccountUpdateSchema>;
export type LabLink = z.infer<typeof LabLinkSchema>;
export type LabLinkCreate = z.infer<typeof LabLinkCreateSchema>;
export type LabLinkUpdate = z.infer<typeof LabLinkUpdateSchema>;
export type NoteEntry = z.infer<typeof NoteEntrySchema>;
export type Note = z.infer<typeof NoteSchema>;
export type NoteCreate = z.infer<typeof NoteCreateSchema>;
export type NoteUpdate = z.infer<typeof NoteUpdateSchema>;
export type ImageMetadata = z.infer<typeof ImageMetadataSchema>;
export type FileMetadata = z.infer<typeof FileMetadataSchema>;
export type CatalogItem = z.infer<typeof CatalogItemSchema>;
