"""Pydantic request/response schemas for ResearchOS API."""

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# ── Shared Access (used across multiple entities) ───────────────────────────────


class SharedUser(BaseModel):
    """Represents a user with shared access to an item."""
    username: str
    permission: str = "edit"  # "view" or "edit"


class ShareRequest(BaseModel):
    """Request to share an item with a user."""
    username: str
    permission: str = "edit"  # "view" or "edit"
    include_chain: bool = False  # For tasks: share entire dependency chain


class SharedItemEntry(BaseModel):
    """Entry in a user's shared_with_me registry."""
    id: int  # Item ID
    owner: str  # Username of owner
    permission: str  # "view" or "edit"
    shared_at: datetime


class Notification(BaseModel):
    """A notification for a user."""
    id: str  # UUID
    type: str  # "task_shared", "method_shared", "project_shared"
    from_user: str  # Username who shared
    item_type: str  # "task", "method", "project"
    item_id: int
    item_name: str
    permission: str  # "view" or "edit"
    created_at: datetime
    read: bool = False


# ── Projects ──────────────────────────────────────────────────────────────────


class ProjectCreate(BaseModel):
    name: str
    weekend_active: bool = False
    tags: Optional[List[str]] = None
    color: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    weekend_active: Optional[bool] = None
    tags: Optional[List[str]] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None
    is_archived: Optional[bool] = None
    archived_at: Optional[datetime] = None


class ProjectOut(BaseModel):
    id: int
    name: str
    weekend_active: bool
    tags: Optional[List[str]]
    color: Optional[str]
    created_at: datetime
    sort_order: int = 0
    is_archived: bool = False
    archived_at: Optional[datetime] = None
    owner: str = ""  # Username of project owner
    shared_with: List[SharedUser] = []  # Users with access to entire project

    model_config = {"from_attributes": True}


# ── Tasks ─────────────────────────────────────────────────────────────────────


class SubTask(BaseModel):
    id: str
    text: str
    is_complete: bool = False


class TaskMethodAttachment(BaseModel):
    """Represents a method attached to a task with its own PCR data copy."""
    method_id: int
    # PCR method copy fields - stored as JSON strings (only for PCR methods)
    pcr_gradient: Optional[str] = None  # JSON string of PCRGradient
    pcr_ingredients: Optional[str] = None  # JSON string of List[PCRIngredient]
    # Variation notes - markdown content documenting method variations for this experiment
    variation_notes: Optional[str] = None  # Markdown string with timestamped entries


class TaskMethodAttachmentCreate(BaseModel):
    method_id: int


class VariationNoteRequest(BaseModel):
    """Request to save variation notes for a method attachment."""
    variation_notes: str  # Markdown content with timestamped entries


class TaskCreate(BaseModel):
    project_id: Optional[int] = None
    name: str
    start_date: date
    duration_days: int = Field(ge=1)
    is_high_level: bool = False
    task_type: str = "list"  # "experiment", "purchase", or "list"
    weekend_override: Optional[bool] = None
    method_id: Optional[int] = None  # Deprecated: use method_ids instead
    method_ids: Optional[List[int]] = None  # List of method IDs attached to this task
    tags: Optional[List[str]] = None
    sort_order: int = 0
    experiment_color: Optional[str] = None  # Darker color for experiment tasks
    sub_tasks: Optional[List[SubTask]] = None
    # PCR method copy fields - stored as JSON strings (deprecated, use method_attachments)
    pcr_gradient: Optional[str] = None  # JSON string of PCRGradient
    pcr_ingredients: Optional[str] = None  # JSON string of List[PCRIngredient]
    # New: method attachments with individual PCR data
    method_attachments: Optional[List[TaskMethodAttachment]] = None


class TaskUpdate(BaseModel):
    project_id: Optional[int] = None
    name: Optional[str] = None
    start_date: Optional[date] = None
    duration_days: Optional[int] = Field(default=None, ge=1)
    is_high_level: Optional[bool] = None
    is_complete: Optional[bool] = None
    task_type: Optional[str] = None
    weekend_override: Optional[bool] = None
    method_id: Optional[int] = None  # Deprecated
    method_ids: Optional[List[int]] = None  # List of method IDs attached to this task
    deviation_log: Optional[str] = None
    tags: Optional[List[str]] = None
    sort_order: Optional[int] = None
    experiment_color: Optional[str] = None
    sub_tasks: Optional[List[SubTask]] = None
    # PCR method copy fields - stored as JSON strings (deprecated)
    pcr_gradient: Optional[str] = None  # JSON string of PCRGradient
    pcr_ingredients: Optional[str] = None  # JSON string of List[PCRIngredient]
    # New: method attachments with individual PCR data
    method_attachments: Optional[List[TaskMethodAttachment]] = None


class TaskOut(BaseModel):
    id: int
    project_id: int
    name: str
    start_date: date
    duration_days: int
    end_date: date  # computed field
    is_high_level: bool
    is_complete: bool
    task_type: str
    weekend_override: Optional[bool]
    method_id: Optional[int] = None  # Deprecated: first method in method_ids for backwards compat
    method_ids: List[int] = []  # List of method IDs attached to this task
    deviation_log: Optional[str]
    tags: Optional[List[str]]
    sort_order: int
    experiment_color: Optional[str] = None
    sub_tasks: Optional[List[SubTask]] = None
    # PCR method copy fields - stored as JSON strings (deprecated, use method_attachments)
    pcr_gradient: Optional[str] = None  # JSON string of PCRGradient
    pcr_ingredients: Optional[str] = None  # JSON string of List[PCRIngredient]
    # New: method attachments with individual PCR data
    method_attachments: List[TaskMethodAttachment] = []
    # Sharing fields
    owner: str = ""  # Username of task owner
    shared_with: List[SharedUser] = []  # Users with direct access (not via project)
    inherited_from_project: Optional[int] = None  # If shared via project, the project ID

    model_config = {"from_attributes": True}


class TaskMoveRequest(BaseModel):
    new_start_date: date
    confirmed: bool = False


class TaskReplicateRequest(BaseModel):
    count: int = Field(ge=1, le=100)
    offset_days: int = Field(ge=0)


# ── High-Level Goals ──────────────────────────────────────────────────────────


class SmartGoal(BaseModel):
    id: str
    text: str
    is_complete: bool = False


class HighLevelGoalCreate(BaseModel):
    project_id: Optional[int] = None  # None for personal goals
    name: str
    start_date: date
    end_date: date
    color: Optional[str] = None
    smart_goals: List[SmartGoal] = []


class HighLevelGoalUpdate(BaseModel):
    name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    color: Optional[str] = None
    smart_goals: Optional[List[SmartGoal]] = None
    is_complete: Optional[bool] = None


class HighLevelGoalOut(BaseModel):
    id: int
    project_id: Optional[int] = None  # None for personal goals
    name: str
    start_date: date
    end_date: date
    color: Optional[str]
    smart_goals: List[SmartGoal]
    is_complete: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Dependencies ──────────────────────────────────────────────────────────────


class DependencyCreate(BaseModel):
    parent_id: int
    child_id: int
    dep_type: str = Field(pattern=r"^(FS|SS|SF)$")


class DependencyOut(BaseModel):
    id: int
    parent_id: int
    child_id: int
    dep_type: str

    model_config = {"from_attributes": True}


# ── Shift Result ──────────────────────────────────────────────────────────────


class ShiftedTask(BaseModel):
    task_id: int
    name: str
    old_start: date
    new_start: date
    old_end: date
    new_end: date


class ShiftWarning(BaseModel):
    task_id: int
    name: str
    message: str


class ShiftResult(BaseModel):
    affected_tasks: List[ShiftedTask]
    warnings: List[ShiftWarning]
    requires_confirmation: bool = False


# ── Events (Calendar) ─────────────────────────────────────────────────────────


class EventCreate(BaseModel):
    title: str
    event_type: str = "conference"  # "conference", "deadline", "meeting", "other"
    start_date: date
    end_date: Optional[date] = None
    location: Optional[str] = None
    url: Optional[str] = None
    notes: Optional[str] = None
    color: Optional[str] = None


class EventUpdate(BaseModel):
    title: Optional[str] = None
    event_type: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    location: Optional[str] = None
    url: Optional[str] = None
    notes: Optional[str] = None
    color: Optional[str] = None


class EventOut(BaseModel):
    id: int
    title: str
    event_type: str
    start_date: date
    end_date: Optional[date]
    location: Optional[str]
    url: Optional[str]
    notes: Optional[str]
    color: Optional[str]

    model_config = {"from_attributes": True}


# ── PCR Methods ───────────────────────────────────────────────────────────────


class PCRStep(BaseModel):
    name: str
    temperature: float
    duration: str


class PCRCycle(BaseModel):
    repeats: int
    steps: List[PCRStep]


class PCRGradient(BaseModel):
    initial: List[PCRStep] = []
    cycles: List[PCRCycle] = []  # Changed from singular 'cycle' to plural 'cycles' to match frontend
    final: List[PCRStep] = []
    hold: Optional[PCRStep] = None


class PCRIngredient(BaseModel):
    id: str
    name: str
    concentration: str
    amount_per_reaction: str
    checked: bool = False  # For lab checklist feature


class PCRProtocolCreate(BaseModel):
    name: str
    gradient: PCRGradient
    ingredients: List[PCRIngredient]
    notes: Optional[str] = None
    folder_path: Optional[str] = None  # Add folder_path support


class PCRProtocolUpdate(BaseModel):
    name: Optional[str] = None
    gradient: Optional[PCRGradient] = None
    ingredients: Optional[List[PCRIngredient]] = None
    notes: Optional[str] = None


class PCRProtocolOut(BaseModel):
    id: int
    name: str
    gradient: PCRGradient
    ingredients: List[PCRIngredient]
    notes: Optional[str]

    model_config = {"from_attributes": True}


# ── Lab Links ─────────────────────────────────────────────────────────────────


class LabLinkCreate(BaseModel):
    title: str
    url: str
    description: Optional[str] = None
    category: Optional[str] = None
    color: Optional[str] = None
    preview_image_url: Optional[str] = None


class LabLinkUpdate(BaseModel):
    title: Optional[str] = None
    url: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    color: Optional[str] = None
    preview_image_url: Optional[str] = None
    sort_order: Optional[int] = None


class LabLinkOut(BaseModel):
    id: int
    title: str
    url: str
    description: Optional[str]
    category: Optional[str]
    color: Optional[str]
    preview_image_url: Optional[str] = None
    sort_order: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Attachment Metadata ────────────────────────────────────────────────────────


class ImageMetadataEntry(BaseModel):
    """Metadata entry for a single image."""
    id: int
    filename: str
    original_filename: Optional[str] = None  # Original filename before timestamp prefix
    path: str  # Relative path from data repo root: Images/Mar-04-2026-Exp-Name/file.png
    experiment_id: int
    experiment_name: str
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    uploaded_at: datetime
    file_size: int  # Size in bytes
    file_type: str  # MIME type
    folder: str  # Folder name: Mar-04-2026-Exp-Name


class ImageMetadataCreate(BaseModel):
    """Request to create image metadata."""
    filename: str
    original_filename: Optional[str] = None
    experiment_id: int
    experiment_name: str
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    file_size: int
    file_type: str


class ImageMetadataOut(BaseModel):
    """Response for image metadata."""
    id: int
    filename: str
    original_filename: Optional[str] = None
    path: str
    experiment_id: int
    experiment_name: str
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    uploaded_at: datetime
    file_size: int
    file_type: str
    folder: str

    model_config = {"from_attributes": True}


class FileMetadataEntry(BaseModel):
    """Metadata entry for a single file (PDFs, attachments, etc.)."""
    id: int
    filename: str
    original_filename: Optional[str] = None  # Original filename before timestamp prefix
    path: str  # Relative path from data repo root: Files/Mar-04-2026-Exp-Name/file.pdf
    experiment_id: int
    experiment_name: str
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    uploaded_at: datetime
    file_size: int  # Size in bytes
    file_type: str  # MIME type
    folder: str  # Folder name: Mar-04-2026-Exp-Name
    attachment_type: str  # "notes" or "results"


class FileMetadataCreate(BaseModel):
    """Request to create file metadata."""
    filename: str
    original_filename: Optional[str] = None
    experiment_id: int
    experiment_name: str
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    file_size: int
    file_type: str
    attachment_type: str  # "notes" or "results"


class FileMetadataOut(BaseModel):
    """Response for file metadata."""
    id: int
    filename: str
    original_filename: Optional[str] = None
    path: str
    experiment_id: int
    experiment_name: str
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    uploaded_at: datetime
    file_size: int
    file_type: str
    folder: str
    attachment_type: str

    model_config = {"from_attributes": True}


# ── Attachment Upload ──────────────────────────────────────────────────────────


class AttachmentUploadRequest(BaseModel):
    """Request to upload an image or file attachment."""
    experiment_id: int
    experiment_name: str
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    experiment_date: date  # Used to generate folder name
    attachment_type: str = "notes"  # "notes" or "results" (only for files)
    base64_content: str  # Base64-encoded file content
    original_filename: str  # Original filename from user's computer


class AttachmentUploadResponse(BaseModel):
    """Response after uploading an attachment."""
    id: int
    filename: str
    original_filename: str
    path: str
    folder: str
    file_size: int
    file_type: str
    warning: Optional[str] = None  # Warning about large files
    added_to_gitignore: bool = False  # True if file was excluded from git


# ── Meeting Notes ───────────────────────────────────────────────────────────────


class NoteEntry(BaseModel):
    """A single entry within a note (for running logs)."""
    id: str  # UUID
    title: str  # e.g., "Week 1 Meeting" or date string
    date: date  # User-chosen date for this entry
    content: str = ""  # Markdown content
    created_at: datetime
    updated_at: datetime


class NoteEntryCreate(BaseModel):
    """Request to create a new note entry."""
    title: str
    date: date
    content: str = ""


class NoteEntryUpdate(BaseModel):
    """Request to update a note entry."""
    title: Optional[str] = None
    date: Optional[date] = None
    content: Optional[str] = None


class NoteCreate(BaseModel):
    """Request to create a new note."""
    title: str
    description: str = ""
    is_running_log: bool = False  # If true, has multiple entries
    is_shared: bool = False  # If true, visible to other lab members
    entries: List[NoteEntryCreate] = []  # Initial entries


class NoteUpdate(BaseModel):
    """Request to update note metadata."""
    title: Optional[str] = None
    description: Optional[str] = None
    is_shared: Optional[bool] = None


class NoteOut(BaseModel):
    """Response for a note."""
    id: int
    title: str
    description: str
    is_running_log: bool
    is_shared: bool
    entries: List[NoteEntry]
    created_at: datetime
    updated_at: datetime
    username: str  # Owner username

    model_config = {"from_attributes": True}


class NoteEntriesReorderRequest(BaseModel):
    """Request to reorder entries within a note."""
    entry_ids: List[str]  # New order of entry IDs
