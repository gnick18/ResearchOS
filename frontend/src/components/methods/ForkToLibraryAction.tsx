"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { forkAttachmentToLibrary } from "@/lib/methods/fork-method";
import type { Method, Task, TaskMethodAttachment } from "@/lib/types";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";

/**
 * "Save as new method" affordance shown alongside an experiment-attached
 * method viewer (MethodTabs). When a method is attached to an experiment, the
 * researcher's edits — body_override / the per-type structured overrides /
 * variation_notes — live ONLY on the task's `method_attachment`, never the
 * reusable library method. There was previously no way to promote that edited
 * version back into the library.
 *
 * This forks the attachment's *current edited content* into a brand-new,
 * fully independent library Method (via `forkAttachmentToLibrary`), linked back
 * to the source via `parent_method_id` so the explorer nests it under its base.
 * The original library method and the experiment's attachment are both left
 * untouched.
 */
export function ForkToLibraryAction({
  method,
  attachment,
  task,
  piActor,
  onForked,
  className,
}: {
  method: Method;
  attachment: TaskMethodAttachment | undefined;
  task: Task;
  /** PI capability revamp: lab head username when acting on a member's task.
   *  Forking creates a method in the CURRENT user's library either way, so
   *  this is accepted for signature parity but doesn't change routing. */
  piActor?: string;
  /** Fired with the freshly-created library method after a successful fork. */
  onForked?: (created: Method) => void;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);

  const openModal = () => {
    setName(`${method.name || "Method"} (variant)`);
    setSavedName(null);
    setOpen(true);
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
  };

  const handleConfirm = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const created = await forkAttachmentToLibrary(method, attachment, trimmed, {
        variationContextLabel: task.name,
      });
      await queryClient.refetchQueries({ queryKey: ["methods"] });
      setSavedName(created.name);
      onForked?.(created);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save as a new method.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip
        label="Copy this method's current edits into a brand-new method in your library. The original method and this experiment stay unchanged."
        placement="bottom"
      >
        <button
          type="button"
          onClick={openModal}
          className={
            className ??
            "inline-flex items-center gap-1.5 px-2.5 py-1 text-meta text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/30 rounded-lg disabled:opacity-50"
          }
        >
          <Icon name="copy" className="w-3 h-3" />
          <span>Save as new method</span>
        </button>
      </Tooltip>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-xl bg-surface-raised border border-border shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {savedName ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                    <Icon name="check" className="w-3.5 h-3.5" />
                  </span>
                  <h2 className="text-body font-semibold text-foreground">Saved to your library</h2>
                </div>
                <p className="text-meta text-foreground-muted">
                  Created <span className="font-medium text-foreground">{savedName}</span> as a new,
                  independent method. It&rsquo;s nested under the original in your method library. This
                  experiment&rsquo;s attached method is unchanged.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h2 className="text-body font-semibold text-foreground">Save as new method</h2>
                  <p className="mt-1 text-meta text-foreground-muted">
                    Promote your edits to this attached method into a brand-new method in your
                    library. The original method and this experiment stay untouched.
                  </p>
                </div>
                <label className="block text-meta text-foreground-muted space-y-1">
                  <span>New method name</span>
                  <input
                    type="text"
                    value={name}
                    autoFocus
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleConfirm();
                      if (e.key === "Escape") close();
                    }}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-raised text-foreground focus:outline-none focus:ring-1 focus:ring-brand-action"
                    placeholder="e.g. Phusion PCR (GC-rich variant)"
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className="ros-btn-neutral px-3 py-1.5 text-meta text-foreground-muted disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirm()}
                    disabled={busy || !name.trim()}
                    className="px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
                  >
                    {busy ? "Saving…" : "Create method"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
