"use client";

// Lab-tier Phase 7a: the role-aware, blocking on-connect migration gate.
//
// When a real (non-demo) user connects a folder that is still multi-user, this
// greets them with a blocking choice so the migration is discoverable instead of
// buried in Settings:
//   - the OWNER (main user) is offered "Convert this folder to mine" (they keep
//     it, everyone else is packaged into portable copies),
//   - a LABMATE is offered "Take my data to my own folder" (they export just
//     themselves and leave, the shared folder stays intact for the rest).
// Both can choose "Keep it shared for now", which dismisses the gate for this
// session (it returns on the next launch until the folder is converted).
//
// Nothing is ever deleted, and nothing happens without an explicit confirm on
// the following preview screen. Mounted in the signed-in providers branch, so it
// never fires in demo / wiki-capture mode.
//
// House style: no emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import { usePathname } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabMode } from "@/hooks/useIsLabMode";
import { isOperatorSurface } from "@/lib/routes/operator-surface";
import MigrateToSoloModal from "./MigrateToSoloModal";
import SelfExportModal from "./SelfExportModal";

const DISMISS_KEY = "ros_migration_gate_dismissed_v1";

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export default function MigrationGate() {
  const { currentUser, mainUser } = useCurrentUser();
  const isLabMode = useIsLabMode() ?? false;
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());
  const [mode, setMode] = useState<"convert" | "selfexport" | null>(null);

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* sessionStorage unavailable, in-memory dismiss still applies */
    }
    setDismissed(true);
  };
  const onComplete = () => {
    dismiss();
    setMode(null);
  };

  // Operator surfaces (admin + LLC business) are carved out from every gate.
  if (isOperatorSurface(pathname)) return null;

  // Only for a real, signed-in user in a multi-user folder.
  if (!currentUser || !isLabMode) return null;

  // A chosen flow takes over (its own confirm + progress + result).
  if (mode === "convert") {
    return <MigrateToSoloModal primaryUser={currentUser} onClose={() => setMode(null)} onComplete={onComplete} />;
  }
  if (mode === "selfexport") {
    return <SelfExportModal username={currentUser} onClose={() => setMode(null)} onComplete={onComplete} />;
  }

  if (dismissed) return null;

  // No designated main user => treat the connecting user as the owner so the
  // folder can always be converted by someone.
  const isOwner = mainUser == null || currentUser === mainUser;

  return (
    <LivingPopup
      open
      onClose={() => {}}
      label={isOwner ? "Make this your own folder" : "This is a shared lab folder"}
      widthClassName="max-w-xl"
      padded
      elevated
      showClose={false}
      closeOnEscape={false}
      closeOnScrimClick={false}
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="text-brand-sky">
            <Icon name="users" className="h-6 w-6" />
          </span>
          <h2 className="text-title font-semibold text-foreground">
            {isOwner ? "Make this your own folder" : "This is a shared lab folder"}
          </h2>
        </div>

        {isOwner ? (
          <>
            <p className="text-body text-foreground">
              ResearchOS now works best as one folder per person, and this folder is still set up for several people.
              You can convert it into your own single-user folder, which is faster and simpler to work in.
            </p>
            <p className="text-meta text-foreground-muted">
              Everyone else is packaged into a portable copy you can hand them, their originals move to a recoverable
              Trash, and your own data is untouched. You will see exactly what moves before anything happens, and
              nothing is deleted.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={dismiss}
                className="px-4 py-2 text-body rounded-lg border border-border text-foreground hover:bg-surface-raised"
              >
                Keep it shared for now
              </button>
              <button type="button" onClick={() => setMode("convert")} className="btn-brand px-4 py-2 text-body rounded-lg">
                Convert this folder to mine
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-body text-foreground">
              ResearchOS now works best as one folder per person, and you are sharing this folder with others. You
              can take your own data into your own folder to work solo, and everyone else keeps this folder as it is.
            </p>
            <p className="text-meta text-foreground-muted">
              Your data is copied into a portable folder you open as your own workspace, and your originals move to a
              recoverable Trash here. You will see exactly what moves before anything happens, and nothing is deleted.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={dismiss}
                className="px-4 py-2 text-body rounded-lg border border-border text-foreground hover:bg-surface-raised"
              >
                Keep working here for now
              </button>
              <button type="button" onClick={() => setMode("selfexport")} className="btn-brand px-4 py-2 text-body rounded-lg">
                Take my data to my own folder
              </button>
            </div>
          </>
        )}
      </div>
    </LivingPopup>
  );
}
