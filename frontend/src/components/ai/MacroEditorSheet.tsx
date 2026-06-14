"use client";

// MacroEditorSheet (BeakerAI lane, 2026-06-13).
//
// The editor for a workflow macro. Phase 4a uses it for the record path, it opens
// pre-filled with the steps captured from a finished run so the user names it and
// trims before saving. The same sheet will serve edit and author-from-scratch in
// the manager phase (4b), so it accepts an optional macroId for edit and persists
// itself (create or update), the parent just opens it and refreshes on save.
//
// Steps can be relabeled, reordered, toggled off (kept but skipped at run), or
// removed. A step whose args froze a date at capture time shows a "fixed date"
// marker, the honest face of deterministic replay. The underlying tool of each
// step is shown but not editable here.
//
// House style, no inline SVG, no emojis / em-dashes / mid-sentence colons.

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  createMacro,
  saveMacro,
  listMacros,
  slugifyMacroName,
  ensureUniqueMacroName,
  stepHasFixedDate,
  MACRO_NOISE_TOOLS,
  type MacroStep,
} from "@/lib/ai/beaker-macros-store";
import { DEFAULT_TOOLS } from "@/lib/ai/tools/registry";

// Turn a tool name into a human step label, for example "lab_digest" -> "Lab
// digest". The user can rename it after adding.
function humanizeToolName(name: string): string {
  const words = name.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function MacroEditorSheet({
  macroId,
  initialName,
  initialDescription,
  initialSteps,
  onClose,
  onSaved,
}: {
  /** Present when editing an existing macro, absent when creating a new one. */
  macroId?: number;
  initialName: string;
  initialDescription: string;
  initialSteps: MacroStep[];
  onClose: () => void;
  /** Called after a successful save so the parent can refresh its macro list. */
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [steps, setSteps] = useState<MacroStep[]>(initialSteps);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The add-step tool picker (author-from-scratch). Open state + filter query.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  // The tools a macro step may use, the registry minus the navigation and read
  // noise (same set the capture drops). Sorted by name. Computed once.
  const pickableTools = useMemo(
    () =>
      DEFAULT_TOOLS.filter((t) => !MACRO_NOISE_TOOLS.has(t.name))
        .map((t) => ({ name: t.name, description: t.description }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const filteredTools = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return pickableTools;
    return pickableTools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [pickableTools, pickerQuery]);

  const addStep = (toolName: string) => {
    setSteps((prev) => [
      ...prev,
      { tool: toolName, args: {}, label: humanizeToolName(toolName), enabled: true },
    ]);
    setPickerOpen(false);
    setPickerQuery("");
  };

  const enabledCount = steps.filter((s) => s.enabled !== false).length;
  const canSave = name.trim().length > 0 && enabledCount > 0 && !saving;

  const updateStep = (index: number, patch: Partial<MacroStep>) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  };
  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };
  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const desired = slugifyMacroName(name);
      const others = (await listMacros()).filter((m) => m.id !== macroId);
      const uniqueName = ensureUniqueMacroName(
        desired,
        others.map((m) => m.name),
      );
      const trimmedSteps = steps.map((s) => ({
        ...s,
        label: s.label.trim() || `Run ${s.tool}`,
      }));
      const saved =
        macroId !== undefined
          ? await saveMacro(macroId, {
              name: uniqueName,
              description: description.trim(),
              steps: trimmedSteps,
            })
          : await createMacro({
              name: uniqueName,
              description: description.trim(),
              steps: trimmedSteps,
            });
      if (!saved) {
        setError(
          "Could not save the macro. Connect a data folder so BeakerBot has somewhere to keep it.",
        );
        setSaving(false);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Something went wrong saving the macro. Try again.");
      setSaving(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
      data-testid="macro-editor-overlay"
      onMouseDown={(e) => {
        // Click the backdrop (not the sheet) to cancel.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-xl"
        data-testid="macro-editor-sheet"
      >
        {/* header */}
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-purple-500/15 text-purple-600 dark:text-purple-300">
            <Icon name="bolt" className="h-4 w-4" title="Macro" />
          </span>
          <span className="flex-1 text-body font-semibold text-foreground">
            {macroId !== undefined ? "Edit macro" : "Save as macro"}
          </span>
          <Tooltip label="Close" placement="bottom">
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex-none rounded p-1 text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon name="close" className="h-4 w-4" title="Close" />
            </button>
          </Tooltip>
        </div>

        {/* body */}
        <div className="flex flex-col gap-3.5 overflow-y-auto px-4 py-4">
          <label className="block">
            <span className="mb-1 block text-meta font-semibold text-foreground-muted">
              Command name
            </span>
            <div className="flex items-center rounded-md border border-border bg-surface-sunken px-2.5 py-2">
              <span className="font-semibold text-purple-600 dark:text-purple-300">
                /
              </span>
              <input
                data-testid="macro-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="monday-rollup"
                className="ml-0.5 flex-1 bg-transparent text-body text-foreground outline-none"
              />
            </div>
            <span className="mt-1 block text-[10px] text-foreground-muted">
              Saved as /{slugifyMacroName(name)}
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-meta font-semibold text-foreground-muted">
              Description
            </span>
            <input
              data-testid="macro-desc-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this macro does, in one line"
              className="w-full rounded-md border border-border bg-surface-sunken px-2.5 py-2 text-body text-foreground outline-none"
            />
          </label>

          <div>
            <span className="mb-1 block text-meta font-semibold text-foreground-muted">
              Steps, run in order
            </span>
            {steps.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-meta text-foreground-muted">
                No steps yet. Add one below, or run something with BeakerBot and
                choose Save as macro to capture a step with its exact inputs.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5" data-testid="macro-step-list">
                {steps.map((step, i) => {
                  const disabled = step.enabled === false;
                  return (
                    <div
                      key={i}
                      data-testid="macro-step-row"
                      className={`flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 ${
                        disabled ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex flex-none flex-col">
                        <button
                          type="button"
                          aria-label="Move step up"
                          disabled={i === 0}
                          onClick={() => moveStep(i, -1)}
                          className="text-foreground-muted hover:text-foreground disabled:opacity-30"
                        >
                          <Icon name="caret" className="h-3 w-3 -rotate-180" title="Up" />
                        </button>
                        <button
                          type="button"
                          aria-label="Move step down"
                          disabled={i === steps.length - 1}
                          onClick={() => moveStep(i, 1)}
                          className="text-foreground-muted hover:text-foreground disabled:opacity-30"
                        >
                          <Icon name="caret" className="h-3 w-3" title="Down" />
                        </button>
                      </div>

                      <input
                        value={step.label}
                        onChange={(e) => updateStep(i, { label: e.target.value })}
                        className="min-w-0 flex-1 bg-transparent text-meta text-foreground outline-none"
                        data-testid="macro-step-label"
                      />

                      {stepHasFixedDate(step) ? (
                        <Tooltip label="This step froze a date when recorded" placement="top">
                          <span className="flex-none rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-600 dark:text-amber-300">
                            fixed date
                          </span>
                        </Tooltip>
                      ) : null}

                      <span className="flex-none rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] text-foreground-muted">
                        {step.tool}
                      </span>

                      <Tooltip label={disabled ? "Enable step" : "Skip step"} placement="top">
                        <button
                          type="button"
                          aria-label={disabled ? "Enable step" : "Skip step"}
                          onClick={() => updateStep(i, { enabled: disabled })}
                          className="flex-none text-foreground-muted hover:text-foreground"
                        >
                          <Icon name="eye" className="h-3.5 w-3.5" title="Toggle" />
                        </button>
                      </Tooltip>

                      <Tooltip label="Remove step" placement="top">
                        <button
                          type="button"
                          aria-label="Remove step"
                          onClick={() => removeStep(i)}
                          className="flex-none text-foreground-muted hover:text-red-600"
                        >
                          <Icon name="trash" className="h-3.5 w-3.5" title="Remove" />
                        </button>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add-step picker (author-from-scratch). Lists the registry tools a
                macro may use; a chosen step starts with empty (default) args, the
                user edits the label and reorders. Record-from-chat is still how to
                capture a step with specific inputs. */}
            <div className="relative mt-1.5">
              {pickerOpen ? (
                <div
                  data-testid="macro-step-picker"
                  className="rounded-md border border-border bg-surface-raised"
                >
                  <input
                    autoFocus
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="Search tools"
                    className="w-full border-b border-border bg-transparent px-2.5 py-2 text-meta text-foreground outline-none"
                  />
                  <div className="max-h-44 overflow-y-auto py-1">
                    {filteredTools.length === 0 ? (
                      <p className="px-2.5 py-2 text-meta text-foreground-muted">
                        No tool matches.
                      </p>
                    ) : (
                      filteredTools.map((t) => (
                        <button
                          key={t.name}
                          type="button"
                          data-testid="macro-step-pick"
                          onClick={() => addStep(t.name)}
                          className="flex w-full flex-col items-start px-2.5 py-1.5 text-left hover:bg-surface-sunken"
                        >
                          <span className="text-meta font-semibold text-purple-600 dark:text-purple-300">
                            {t.name}
                          </span>
                          <span className="line-clamp-1 text-[11px] text-foreground-muted">
                            {t.description}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                  <p className="border-t border-border px-2.5 py-1.5 text-[10px] text-foreground-muted">
                    Steps added here run with default inputs. Record a run to
                    capture exact arguments.
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="macro-add-step"
                  onClick={() => setPickerOpen(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-meta font-medium text-foreground-muted hover:border-purple-400 hover:text-purple-600 dark:hover:text-purple-300"
                >
                  <Icon name="plus" className="h-3.5 w-3.5" title="" />
                  Add step
                </button>
              )}
            </div>
          </div>

          {error ? (
            <p
              data-testid="macro-editor-error"
              className="rounded-md bg-red-50 px-3 py-2 text-meta text-red-700 dark:bg-red-950/40 dark:text-red-300"
            >
              {error}
            </p>
          ) : null}
        </div>

        {/* footer */}
        <div className="flex gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            data-testid="macro-save"
            disabled={!canSave}
            onClick={() => void handleSave()}
            className="flex-1 rounded-md bg-purple-600 px-3 py-2 text-body font-semibold text-white transition-colors hover:bg-purple-700 disabled:opacity-40"
          >
            {saving ? "Saving" : "Save macro"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3.5 py-2 text-body text-foreground-muted hover:bg-surface-sunken"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
