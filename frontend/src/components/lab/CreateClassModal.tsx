"use client";

// Class Mode (CM-P2A): the "Create a class" modal launched from the folder
// switcher.
//
// A class IS a lab IS a folder. This modal collects a class name (e.g.
// "Genetics 410 Spring") and an optional term, then calls provisionClassFolder
// to mint a fresh app-managed OPFS class folder where the current account is the
// instructor (head). The current folder is never touched. On success the
// provisioner has already switched the active folder to the new class, so this
// just refreshes the switcher list and closes.
//
// Account-agnostic (Grant 2026-06-19): the multi-folder substrate is
// account-agnostic, so a SOLO user can create and hold a class exactly like a
// lab head, alongside their other folders. This modal therefore makes NO
// lab-head check. The only gate is CLASS_MODE_ENABLED, applied by the caller.
//
// Durability (design addendum H4): an OPFS class folder is browser-evictable.
// provisionClassFolder requests persistent storage and returns its grant state.
// When the grant was denied we surface a non-blocking warning that says WHY
// (the browser may evict the data) and points the instructor at connecting a
// real disk folder later. The class is still created either way.
//
// House style: no emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import { runCreateClass } from "@/lib/lab/create-class-flow";

type Phase = "form" | "creating" | "warn" | "error";

export default function CreateClassModal({
  onClose,
  /** Called after a class is created so the parent can refresh its folder list.
   *  The active folder is already switched by the provisioner. */
  onCreated,
}: {
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [error, setError] = useState("");

  const canSubmit = name.trim().length > 0 && phase === "form";

  async function onCreate() {
    if (!canSubmit) return;
    setPhase("creating");
    setError("");

    try {
      const result = await runCreateClass({ name, term });

      if (!result.ok) {
        setError(result.message);
        setPhase("error");
        return;
      }

      // The provisioner already switched the active folder to the new class.
      onCreated?.();

      if (!result.persisted) {
        // Non-blocking durability warning (H4). The class exists; we just tell the
        // instructor WHY the data could be evicted and what to do about it.
        setPhase("warn");
        return;
      }

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  return (
    <LivingPopup
      open
      onClose={phase === "creating" ? () => {} : onClose}
      label="Create a class"
      widthClassName="max-w-lg"
      padded
      showClose={phase !== "creating"}
      closeOnEscape={phase !== "creating"}
      closeOnScrimClick={phase !== "creating"}
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="text-brand-sky">
            <Icon name="userPlus" className="h-6 w-6" />
          </span>
          <h2 className="text-title font-semibold text-foreground">
            Create a class
          </h2>
        </div>

        {(phase === "form" || phase === "creating") && (
          <>
            <p className="text-body text-foreground-muted">
              A class is its own teaching folder, kept separate from your
              research. You are the instructor, and students you invite join as
              members. Nothing in your current folder is changed.
            </p>

            <label className="flex flex-col gap-1.5">
              <span className="text-meta font-medium text-foreground">
                Class name
              </span>
              <input
                type="text"
                value={name}
                autoFocus
                disabled={phase === "creating"}
                placeholder="Genetics 410"
                aria-label="Class name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onCreate();
                  }
                }}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground outline-none focus:border-accent disabled:opacity-50"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-meta font-medium text-foreground">
                Term <span className="text-foreground-muted">(optional)</span>
              </span>
              <input
                type="text"
                value={term}
                disabled={phase === "creating"}
                placeholder="Spring 2026"
                aria-label="Term"
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onCreate();
                  }
                }}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground outline-none focus:border-accent disabled:opacity-50"
              />
            </label>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={phase === "creating"}
                className="ros-btn-neutral px-4 py-2 text-body text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onCreate()}
                disabled={!canSubmit}
                className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-body text-white transition-colors hover:bg-brand-action/90 disabled:opacity-50"
              >
                {phase === "creating" ? "Creating..." : "Create class"}
              </button>
            </div>
          </>
        )}

        {phase === "warn" && (
          <>
            <div className="flex gap-3">
              <span className="mt-0.5 shrink-0 text-brand-action">
                <Icon name="alert" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-body font-medium text-foreground">
                  Your class is ready, but storage is not guaranteed
                </p>
                <p className="mt-0.5 text-meta text-foreground-muted">
                  This browser did not grant persistent storage, so it could
                  clear the class data if it runs low on space. To keep the class
                  safe, connect it to a real folder on your disk from the folder
                  switcher later.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={onClose}
                className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-body text-white transition-colors hover:bg-brand-action/90"
              >
                Got it
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="flex gap-3">
              <span className="mt-0.5 shrink-0 text-brand-action">
                <Icon name="alert" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-body font-medium text-foreground">
                  We could not create the class
                </p>
                <p className="mt-0.5 text-meta text-foreground-muted">
                  {error}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="ros-btn-neutral px-4 py-2 text-body text-foreground"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setPhase("form")}
                className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-body text-white transition-colors hover:bg-brand-action/90"
              >
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    </LivingPopup>
  );
}
