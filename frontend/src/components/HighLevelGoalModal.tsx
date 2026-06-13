"use client";

import { useCallback, useState, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { goalsApi } from "@/lib/local-api";
import { useAppStore } from "@/lib/store";
import type { SmartGoal, HighLevelGoal, Project } from "@/lib/types";
import DynamicAnimation from "./DynamicAnimation";
import Tooltip from "./Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { StampsRow } from "./AttributionChip";

interface HighLevelGoalModalProps {
  /** Controlled open state. The parent always renders the modal and toggles
   *  this so LivingPopup can play its exit animation on close. Defaults to
   *  true so any caller (or test) that always-mounts the modal keeps working
   *  without threading the prop. */
  open?: boolean;
  projects: Project[];
  onClose: () => void;
  editingGoal?: HighLevelGoal | null;
  onDeleteGoal?: (goal: HighLevelGoal) => void;
}

const GOAL_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#ec4899", // pink
];

export default function HighLevelGoalModal({
  open = true,
  projects,
  onClose,
  editingGoal,
  onDeleteGoal,
}: HighLevelGoalModalProps) {
  const queryClient = useQueryClient();
  const isEditing = !!editingGoal;
  
  // Get the selected animation type from the store
  const animationType = useAppStore((s) => s.animationType);

  const [name, setName] = useState(editingGoal?.name || "");
  // null represents "Personal" category, otherwise it's a project ID
  const [projectId, setProjectId] = useState<number | null>(
    editingGoal?.project_id ?? null
  );
  const [startDate, setStartDate] = useState(editingGoal?.start_date || "");
  const [endDate, setEndDate] = useState(editingGoal?.end_date || "");
  const [color, setColor] = useState(editingGoal?.color || GOAL_COLORS[0]);
  const [smartGoals, setSmartGoals] = useState<SmartGoal[]>(editingGoal?.smart_goals || []);
  const [newSmartGoalText, setNewSmartGoalText] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingSmartGoalId, setEditingSmartGoalId] = useState<string | null>(null);
  const [editingSmartGoalText, setEditingSmartGoalText] = useState("");
  
  // Celebration animation state
  const [celebrationPosition, setCelebrationPosition] = useState<{ x: number; y: number } | null>(null);
  const checkboxRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const editInputRef = useRef<HTMLInputElement | null>(null);
  
  // Stable callback for animation completion to prevent re-triggering
  const handleAnimationComplete = useCallback(() => {
    setCelebrationPosition(null);
  }, []);

  // Draft persistence for new goals (not editing). Skip when editing an
  // existing goal -- the server copy IS the source of truth there.
  const GOAL_DRAFT_KEY = "researchos:draft:new-goal";
  const hasGoalContent = !isEditing && name.trim().length > 0;
  const { clearDraft: clearGoalDraft } = useDraftPersistence(
    GOAL_DRAFT_KEY,
    { name, startDate, endDate, color },
    hasGoalContent,
    {
      onRestore: (saved) => {
        if (!saved.name?.trim()) return;
        setName(saved.name ?? "");
        if (saved.startDate) setStartDate(saved.startDate);
        if (saved.endDate) setEndDate(saved.endDate);
        if (saved.color) setColor(saved.color);
      },
    },
  );
  useUnsavedChangesGuard(hasGoalContent);

  // Only own projects are selectable. Goals are always current-user-owned;
  // cross-owner goal creation was never supported, so a shared-in project
  // in the dropdown would just be a dead option (the underlying `<select>`
  // value is bare `p.id`, which collides with own projects of the same id).
  const ownProjects = useMemo(
    () => projects.filter((p) => !p.is_shared_with_me),
    [projects],
  );
  const hasSharedProjects = useMemo(
    () => projects.some((p) => p.is_shared_with_me),
    [projects],
  );

  // Calculate days remaining
  const daysRemaining = useMemo(() => {
    if (!endDate) return null;
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  }, [endDate]);

  const handleAddSmartGoal = useCallback(() => {
    if (!newSmartGoalText.trim()) return;
    const newGoal: SmartGoal = {
      id: `sg-${Date.now()}`,
      text: newSmartGoalText.trim(),
      is_complete: false,
    };
    setSmartGoals([...smartGoals, newGoal]);
    setNewSmartGoalText("");
  }, [newSmartGoalText, smartGoals]);

  const handleToggleSmartGoal = useCallback((id: string, event?: React.ChangeEvent<HTMLInputElement>) => {
    // Use the checkbox's new checked value to determine direction
    // event.target.checked is the NEW state after the click
    const isNowComplete = event?.target?.checked;
    
    // Only trigger celebration when marking as complete (not when unchecking)
    if (isNowComplete === true && event) {
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      setCelebrationPosition({ x: rect.left + rect.width / 2, y: rect.top });
    }
    
    setSmartGoals(smartGoals.map(sg => 
      sg.id === id ? { ...sg, is_complete: !sg.is_complete } : sg
    ));
  }, [smartGoals]);

  const handleDeleteSmartGoal = useCallback((id: string) => {
    setSmartGoals(smartGoals.filter(sg => sg.id !== id));
  }, [smartGoals]);

  const handleStartEditSmartGoal = useCallback((sg: SmartGoal) => {
    setEditingSmartGoalId(sg.id);
    setEditingSmartGoalText(sg.text);
    // Focus the input after a short delay to allow the render to complete
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  }, []);

  const handleSaveEditSmartGoal = useCallback(() => {
    if (!editingSmartGoalId || !editingSmartGoalText.trim()) {
      setEditingSmartGoalId(null);
      setEditingSmartGoalText("");
      return;
    }
    setSmartGoals(smartGoals.map(sg => 
      sg.id === editingSmartGoalId ? { ...sg, text: editingSmartGoalText.trim() } : sg
    ));
    setEditingSmartGoalId(null);
    setEditingSmartGoalText("");
  }, [editingSmartGoalId, editingSmartGoalText, smartGoals]);

  const handleCancelEditSmartGoal = useCallback(() => {
    setEditingSmartGoalId(null);
    setEditingSmartGoalText("");
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    // projectId can be null for personal goals
    if (!name.trim() || !startDate || !endDate) return;

    setSaving(true);
    try {
      if (isEditing && editingGoal) {
        await goalsApi.update(editingGoal.id, {
          name: name.trim(),
          start_date: startDate,
          end_date: endDate,
          color,
          smart_goals: smartGoals,
        });
      } else {
        await goalsApi.create({
          project_id: projectId,  // Can be null for personal goals
          name: name.trim(),
          start_date: startDate,
          end_date: endDate,
          color,
          smart_goals: smartGoals,
        });
      }
      await queryClient.refetchQueries({ queryKey: ["goals"] });
      if (!isEditing) clearGoalDraft();
      onClose();
    } catch (err) {
      console.error("Failed to save goal:", err);
      alert("Failed to save goal");
    } finally {
      setSaving(false);
    }
  }, [name, startDate, endDate, projectId, color, smartGoals, isEditing, editingGoal, queryClient, onClose, clearGoalDraft]);

  return (
    <>
    <LivingPopup
      open={open}
      onClose={onClose}
      label={isEditing ? "Edit high-level goal" : "New high-level goal"}
      widthClassName="max-w-lg"
      card={false}
      fillHeight
    >
      <form
        onSubmit={handleSubmit}
        className="bg-surface-raised rounded-xl shadow-2xl w-full p-6 overflow-y-auto max-h-full"
      >
        <h3 className="text-heading font-semibold text-foreground mb-4">
          {isEditing ? "Edit High-Level Goal" : "New High-Level Goal"}
        </h3>

        <div className="space-y-4">
          {/* Project */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Category
            </label>
            <select
              value={projectId === null ? "personal" : projectId}
              onChange={(e) => setProjectId(e.target.value === "personal" ? null : Number(e.target.value))}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isEditing}
            >
              <option value="personal">Personal</option>
              {ownProjects.map((p) => (
                <option key={`${p.owner}:${p.id}`} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {hasSharedProjects && (
              <p className="text-meta text-foreground-muted mt-1">
                Shared projects aren&apos;t listed here. Goals are always your own; open the shared project to track work there.
              </p>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Goal Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Complete thesis chapter"
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-meta font-medium text-foreground-muted mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-meta font-medium text-foreground-muted mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Days remaining indicator */}
          {daysRemaining !== null && (
            <div className={`text-body font-medium ${
              daysRemaining < 0 
                ? "text-red-600 dark:text-red-300" 
                : daysRemaining < 7 
                  ? "text-orange-600 dark:text-orange-300" 
                  : "text-green-600 dark:text-green-300"
            }`}>
              {daysRemaining < 0 
                ? `${Math.abs(daysRemaining)} days overdue` 
                : daysRemaining === 0 
                  ? "Due today!" 
                  : `${daysRemaining} days remaining`}
            </div>
          )}

          {/* Color picker */}
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-2">
              Color
            </label>
            <div className="flex gap-2">
              {GOAL_COLORS.map((c) => (
                <Tooltip key={c} label={`Use color ${c}`} placement="bottom">
                  <button
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Use color ${c}`}
                    className={`w-8 h-8 rounded-full transition-transform ${
                      color === c ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""
                    }`}
                    style={{ backgroundColor: c }}
                  />
                </Tooltip>
              ))}
            </div>
          </div>

          {/* SMART Goals */}
          <div className="border-t border-border pt-4">
            <label className="block text-meta font-medium text-foreground-muted mb-2">
              SMART Sub-Goals
            </label>
            
            {/* Existing SMART goals */}
            <div className="space-y-2 mb-3">
              {smartGoals.map((sg) => (
                <div
                  key={sg.id}
                  className={`flex items-center gap-2 p-2 rounded-lg border ${
                    sg.is_complete 
                      ? "bg-green-50 dark:bg-green-500/15 border-green-200 dark:border-green-500/30" 
                      : "bg-surface-sunken border-border"
                  }`}
                >
                  <input
                    ref={(el) => { checkboxRefs.current[sg.id] = el; }}
                    type="checkbox"
                    checked={sg.is_complete}
                    onChange={(e) => handleToggleSmartGoal(sg.id, e)}
                    className="w-4 h-4 text-green-600 dark:text-green-300 border-border rounded focus:ring-green-500"
                  />
                  {editingSmartGoalId === sg.id ? (
                    <input
                      ref={(el) => { editInputRef.current = el; }}
                      type="text"
                      value={editingSmartGoalText}
                      onChange={(e) => setEditingSmartGoalText(e.target.value)}
                      onBlur={handleSaveEditSmartGoal}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSaveEditSmartGoal();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          handleCancelEditSmartGoal();
                        }
                      }}
                      className="flex-1 px-2 py-1 text-body border border-blue-300 dark:border-blue-500/30 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <span 
                      className={`flex-1 text-body cursor-pointer ${
                        sg.is_complete ? "text-green-700 dark:text-green-300 line-through" : "text-foreground"
                      }`}
                      onDoubleClick={() => handleStartEditSmartGoal(sg)}
                      title="Double-click to edit"
                    >
                      {sg.text}
                    </span>
                  )}
                  <Tooltip label="Delete sub-goal" placement="bottom">
                    <button
                      type="button"
                      onClick={() => handleDeleteSmartGoal(sg.id)}
                      className="text-foreground-muted hover:text-red-500 text-meta"
                    >
                      ✕
                    </button>
                  </Tooltip>
                </div>
              ))}
            </div>

            {/* Add new SMART goal */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newSmartGoalText}
                onChange={(e) => setNewSmartGoalText(e.target.value)}
                placeholder="Add a sub-goal..."
                className="flex-1 px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddSmartGoal();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleAddSmartGoal}
                disabled={!newSmartGoalText.trim()}
                className="px-3 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>

          {/* Progress indicator */}
          {smartGoals.length > 0 && (
            <div className="bg-surface-sunken rounded-lg p-3">
              <div className="flex justify-between text-meta text-foreground-muted mb-1">
                <span>Progress</span>
                <span>{smartGoals.filter(sg => sg.is_complete).length} / {smartGoals.length} complete</span>
              </div>
              <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-300"
                  style={{
                    width: `${(smartGoals.filter(sg => sg.is_complete).length / smartGoals.length) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* VCP R3 attribution stamps (VCP R3 attribution stamps,
              2026-05-26): goal stamps row. Goals carry `created_at`
              already and now `last_edited_by` / `last_edited_at`. The
              creator field is `owner` (added in R1b unified sharing). */}
          {isEditing && editingGoal && (
            <StampsRow
              createdBy={editingGoal.owner}
              createdAt={editingGoal.created_at}
              lastEditedBy={editingGoal.last_edited_by}
              lastEditedAt={editingGoal.last_edited_at}
            />
          )}
        </div>

        <div className="flex gap-3 justify-between mt-6">
          <div>
            {isEditing && onDeleteGoal && editingGoal && (
              <button
                type="button"
                onClick={() => onDeleteGoal(editingGoal)}
                className="px-4 py-2 text-body text-red-600 dark:text-red-300 hover:text-white hover:bg-red-600 border border-red-300 dark:border-red-500/30 rounded-lg transition-colors"
              >
                Delete Goal
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-body text-foreground-muted hover:text-foreground rounded-lg hover:bg-surface-sunken transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim() || !startDate || !endDate}
              className="px-4 py-2 text-body text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : isEditing ? "Update Goal" : "Create Goal"}
            </button>
          </div>
        </div>
      </form>
    </LivingPopup>

      {/* Celebration burst, OUTSIDE the popup. The animation layers use
          `fixed inset-0`, but LivingPopup's card carries a transform (the
          zoom), which would make those fixed layers resolve against the card
          and get clipped by its overflow. Rendering here (a sibling of the
          popup) keeps the full-screen layer, and the z-[450] wrapper lifts it
          above the popup root (z-400) so the burst pops over the modal. */}
      {celebrationPosition && (
        <div className="fixed inset-0 z-[450] pointer-events-none">
          <DynamicAnimation
            type={animationType}
            x={celebrationPosition.x}
            y={celebrationPosition.y}
            onComplete={handleAnimationComplete}
          />
        </div>
      )}
    </>
  );
}
