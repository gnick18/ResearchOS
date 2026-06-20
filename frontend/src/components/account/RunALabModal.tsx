"use client";

// Account hub: self-serve Solo/Free -> lab-head switch modal.
//
// This is the THIRD DOOR to becoming a lab head (distinct from LabProvisionResume
// which is operator-staged, and LabCreateResume which runs after fresh-OAuth new-
// signup). It is a self-serve, in-session conversion for an already-signed-in Free
// or Solo user who decides to run a lab.
//
// Steps:
//   1. What changes (plain-language explainer with price from catalog.ts).
//   2. Lab details (labName, institution, piDisplay prefilled from profile).
//   3. Folder handling (fresh folder / convert in place / pick another).
//   4. Confirm + create (calls createLabLocal + patchUserSettings + publishLabRemote
//      in-session, no new genesis logic, same sequence LabCreateResume uses).
//
// LOCKED fork decisions (from the spec, Grant approved):
//   - Fork C: default is Choice A (fresh lab folder), non-destructive.
//   - Fork D: state permanence on confirm; lab-leave is a separate concern.
//   - Fork E: shown for both Free and Solo users.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";
import { PLAN_PRICES } from "@/lib/billing/catalog";
import { createLabLocal, publishLabRemote } from "@/lib/lab/lab-create";
import {
  patchUserSettings,
} from "@/lib/settings/user-settings";
import { savePendingGenesis } from "@/lib/lab/lab-genesis-pending";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import MigrateToSoloModal from "@/components/lab/MigrateToSoloModal";

// ---------------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------------

type Step = "intro" | "details" | "folder" | "creating" | "done";
type FolderChoice = "fresh" | "inplace" | "other";

interface RunALabModalProps {
  open: boolean;
  onClose: () => void;
  /** The signed-in session email (required for createLabLocal). */
  oauthEmail: string;
  /** Current username in the connected folder, used for patchUserSettings. */
  currentUser: string | null;
  /** Display name from the account profile, for prefilling piDisplay. */
  displayName: string | null;
  /** Affiliation from the account profile, for prefilling institution. */
  affiliation: string | null;
  /** Called after the lab is created locally (before relay publish completes). */
  onCreated?: () => void;
}

// ---------------------------------------------------------------------------
// Modal body
// ---------------------------------------------------------------------------

export default function RunALabModal({
  open,
  onClose,
  oauthEmail,
  currentUser,
  displayName,
  affiliation,
  onCreated,
}: RunALabModalProps) {
  const {
    isConnected,
    availableUsers,
    connect,
    initializeFolder,
  } = useFileSystem();
  const userCount = availableUsers.length;

  const [step, setStep] = useState<Step>("intro");
  const [labName, setLabName] = useState("");
  const [institution, setInstitution] = useState(affiliation ?? "");
  const [piDisplay, setPiDisplay] = useState(displayName ?? "");
  const [folderChoice, setFolderChoice] = useState<FolderChoice>("fresh");
  const [error, setError] = useState<string | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);
  // Track publish status for the "publishing" banner after creation.
  const [publishState, setPublishState] = useState<"pending" | "ok" | "partial">("ok");

  function resetAndClose() {
    setStep("intro");
    setLabName("");
    setInstitution(affiliation ?? "");
    setPiDisplay(displayName ?? "");
    setFolderChoice("fresh");
    setError(null);
    onClose();
  }

  // Is the currently connected folder multi-user? If so, in-place conversion
  // routes to MigrateToSoloModal, not in-place flip.
  const isMultiUser = isConnected && (userCount ?? 0) >= 2;

  async function handleConfirm() {
    if (!currentUser) {
      setError("No connected folder user found. Connect a data folder first.");
      return;
    }
    if (!oauthEmail) {
      setError("Your sign-in session has no verified email. Sign out and back in.");
      return;
    }

    const identity = getSessionIdentity();
    if (!identity) {
      setError("Your data key is not available on this device. Set it up on the Account page and retry.");
      return;
    }

    setStep("creating");
    setError(null);

    try {
      // Step 1: create lab locally (pure, no network).
      const { labId, created } = createLabLocal({
        username: currentUser,
        identity,
        oauthEmail,
        labName: labName.trim() || undefined,
        institution: institution.trim() || undefined,
        piDisplay: piDisplay.trim() || undefined,
      });

      // Step 2: persist lab_head + lab_id so the folder flips to lab mode.
      await patchUserSettings(currentUser, {
        account_type: "lab_head",
        lab_id: labId,
      });

      // Persist genesis so LabGenesisPublishRetry can resume if the relay call
      // below fails (the user is a lab head locally regardless).
      await savePendingGenesis(currentUser, {
        labId,
        record: created.record,
        envelope: created.envelope,
        branding: {
          labName: labName.trim() || undefined,
          piDisplay: piDisplay.trim() || undefined,
        },
      });

      // Signal the parent early -- the user is now a lab head locally.
      onCreated?.();

      // Step 3: folder action.
      if (folderChoice === "fresh") {
        // Open the OS picker to create / connect a new folder.
        const ok = await connect();
        if (ok) {
          await initializeFolder();
        }
      }
      // "inplace" requires no action: patchUserSettings already flips lab mode.
      // "other" lets the user connect manually after the modal closes.

      // Step 4: publish to relay (retryable; non-blocking).
      setPublishState("pending");
      publishLabRemote(labId, created, {
        labName: labName.trim() || undefined,
        institution: institution.trim() || undefined,
        piDisplayName: piDisplay.trim() || currentUser,
      }).then((result) => {
        setPublishState(result.ok ? "ok" : "partial");
      }).catch(() => {
        setPublishState("partial");
      });

      setStep("done");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong. Try again.",
      );
      setStep("details");
    }
  }

  // If the user chose in-place but the folder is multi-user, redirect to
  // MigrateToSoloModal first.
  if (showMigrate && currentUser) {
    return (
      <MigrateToSoloModal
        primaryUser={currentUser}
        onClose={() => setShowMigrate(false)}
        onComplete={() => {
          setShowMigrate(false);
          // After migration the folder is solo, so in-place is now safe.
        }}
      />
    );
  }

  return (
    <LivingPopup
      open={open}
      onClose={step === "creating" ? () => {} : resetAndClose}
      label="Run a lab"
      widthClassName="max-w-lg"
      padded
      blur
      closeOnScrimClick={step !== "creating"}
      showClose={step !== "creating" && step !== "done"}
    >
      {step === "intro" && <IntroStep onNext={() => setStep("details")} onClose={resetAndClose} />}
      {step === "details" && (
        <DetailsStep
          labName={labName}
          setLabName={setLabName}
          institution={institution}
          setInstitution={setInstitution}
          piDisplay={piDisplay}
          setPiDisplay={setPiDisplay}
          onBack={resetAndClose}
          onNext={() => setStep("folder")}
        />
      )}
      {step === "folder" && (
        <FolderStep
          isConnected={isConnected}
          isMultiUser={isMultiUser}
          folderChoice={folderChoice}
          setFolderChoice={setFolderChoice}
          onShowMigrate={() => setShowMigrate(true)}
          onBack={() => setStep("details")}
          onConfirm={() => void handleConfirm()}
          error={error}
        />
      )}
      {step === "creating" && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-action border-t-transparent" />
          <p className="text-body font-semibold text-foreground">Creating your lab...</p>
          <p className="text-meta text-foreground-muted">This takes just a moment.</p>
        </div>
      )}
      {step === "done" && (
        <DoneStep
          labName={labName}
          publishState={publishState}
          onClose={resetAndClose}
        />
      )}
    </LivingPopup>
  );
}

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------

function IntroStep({
  onNext,
  onClose,
}: {
  onNext: () => void;
  onClose: () => void;
}) {
  const lab = PLAN_PRICES.lab;
  return (
    <div className="space-y-4">
      <h2 className="text-title font-bold text-foreground">Run a lab</h2>
      <p className="text-body text-foreground-muted">
        A lab-head account lets you invite researchers, pool storage and budget,
        run the lab dashboard, and host your lab web home. Your personal notes
        stay yours. You can do this now and invite people later.
      </p>
      <div className="rounded-xl border border-border bg-surface-sunken p-4 text-meta text-foreground-muted">
        <span className="font-semibold text-foreground">{lab.base}</span>
        {lab.baseSuffix} founding lock-in, plus cloud usage at {lab.usageMarkup}x.
        Billing is off during the beta, so no charge until launch.
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onNext}
          className="ros-btn-raise rounded-lg bg-brand-action px-5 py-2 text-body font-semibold text-white"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-5 py-2 text-body font-medium text-foreground-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action";

function DetailsStep({
  labName,
  setLabName,
  institution,
  setInstitution,
  piDisplay,
  setPiDisplay,
  onBack,
  onNext,
}: {
  labName: string;
  setLabName: (v: string) => void;
  institution: string;
  setInstitution: (v: string) => void;
  piDisplay: string;
  setPiDisplay: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-title font-bold text-foreground">Lab details</h2>
      <p className="text-meta text-foreground-muted">
        These appear on your lab page. You can change them any time in Settings.
      </p>
      <label className="block">
        <span className="text-meta font-semibold text-foreground-muted">Lab name</span>
        <input
          className={`${inputCls} mt-1`}
          value={labName}
          onChange={(e) => setLabName(e.target.value)}
          placeholder="Nickles Lab"
          autoFocus
        />
      </label>
      <label className="block">
        <span className="text-meta font-semibold text-foreground-muted">Institution</span>
        <input
          className={`${inputCls} mt-1`}
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          placeholder="University of Wisconsin-Madison"
        />
      </label>
      <label className="block">
        <span className="text-meta font-semibold text-foreground-muted">Your name (as PI)</span>
        <input
          className={`${inputCls} mt-1`}
          value={piDisplay}
          onChange={(e) => setPiDisplay(e.target.value)}
          placeholder="Dr. Grant Nickles"
        />
      </label>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onNext}
          className="ros-btn-raise rounded-lg bg-brand-action px-5 py-2 text-body font-semibold text-white"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-border px-5 py-2 text-body font-medium text-foreground-muted"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function FolderStep({
  isConnected,
  isMultiUser,
  folderChoice,
  setFolderChoice,
  onShowMigrate,
  onBack,
  onConfirm,
  error,
}: {
  isConnected: boolean;
  isMultiUser: boolean;
  folderChoice: FolderChoice;
  setFolderChoice: (c: FolderChoice) => void;
  onShowMigrate: () => void;
  onBack: () => void;
  onConfirm: () => void;
  error: string | null;
}) {
  const allChoices: Array<{ id: FolderChoice; title: string; desc: string; show: boolean }> = [
    {
      id: "fresh" as FolderChoice,
      title: "Create a fresh folder for the lab (recommended)",
      desc: "Start the lab in its own new folder. Your current solo folder stays exactly as it is, personal and untouched.",
      show: true,
    },
    {
      id: "inplace" as FolderChoice,
      title: "Convert the connected folder in place",
      desc: isMultiUser
        ? "This folder has multiple users. Split your personal data out first, then convert."
        : "Make this connected folder your lab folder. Your existing notes become the lab starting content.",
      show: isConnected,
    },
    {
      id: "other" as FolderChoice,
      title: "I will point the app at a different folder after this",
      desc: "Close this dialog, connect the folder you want to use, then re-open to finish.",
      show: true,
    },
  ];
  const choices = allChoices.filter((c) => c.show);

  return (
    <div className="space-y-4">
      <h2 className="text-title font-bold text-foreground">Where should the lab live?</h2>
      <p className="text-meta text-foreground-muted">
        Choose which folder becomes your lab. This is non-destructive: your
        personal solo data is not moved unless you choose to.
      </p>

      <div className="space-y-2">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              if (c.id === "inplace" && isMultiUser) {
                onShowMigrate();
                return;
              }
              setFolderChoice(c.id);
            }}
            className={`w-full rounded-xl border p-4 text-left transition-colors ${
              folderChoice === c.id && !(c.id === "inplace" && isMultiUser)
                ? "border-brand-action bg-brand-action/5"
                : "border-border bg-surface hover:border-brand-action/50"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                  folderChoice === c.id && !(c.id === "inplace" && isMultiUser)
                    ? "border-brand-action bg-brand-action"
                    : "border-border"
                }`}
              />
              <div className="min-w-0">
                <div className="text-body font-semibold text-foreground">{c.title}</div>
                <div className="mt-0.5 text-meta text-foreground-muted">{c.desc}</div>
                {c.id === "inplace" && isMultiUser && (
                  <span className="mt-1 inline-block text-meta font-semibold text-amber-700">
                    Tap to split your data first
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-meta text-amber-800 dark:border-amber-800/30 dark:bg-amber-900/15 dark:text-amber-300">
        Creating a lab is permanent. A lab record will be published so people
        can find and join your lab. You can leave the lab or create more folders
        at any time, but the lab itself remains in the directory.
      </div>

      {error && (
        <p role="alert" className="text-meta text-rose-600">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onConfirm}
          className="ros-btn-raise rounded-lg bg-brand-action px-5 py-2 text-body font-semibold text-white"
        >
          Create my lab
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-border px-5 py-2 text-body font-medium text-foreground-muted"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function DoneStep({
  labName,
  publishState,
  onClose,
}: {
  labName: string;
  publishState: "pending" | "ok" | "partial";
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-title font-bold text-foreground">
        {labName ? `${labName} is ready` : "Your lab is ready"}
      </h2>
      <p className="text-body text-foreground-muted">
        You are now a lab head. Invite researchers from the Lab Overview in the
        app, and manage your lab page from Settings.
      </p>
      {publishState === "pending" && (
        <p className="text-meta text-foreground-muted">
          Publishing your lab to the directory...
        </p>
      )}
      {publishState === "partial" && (
        <p className="text-meta text-amber-700 dark:text-amber-400">
          Lab created, still finishing directory publish. It will retry
          automatically in the background.
        </p>
      )}
      {publishState === "ok" && (
        <p className="text-meta text-emerald-700 dark:text-emerald-400">
          Lab published to the researcher directory.
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="ros-btn-raise rounded-lg bg-brand-action px-5 py-2 text-body font-semibold text-white"
        >
          Done
        </button>
      </div>
    </div>
  );
}
