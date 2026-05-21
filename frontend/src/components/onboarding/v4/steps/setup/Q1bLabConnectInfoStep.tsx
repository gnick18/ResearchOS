import { useEffect } from "react";
import type { SetupStepProps } from "./types";

/**
 * Q1b (lab only): explains how to connect to the lab's shared folder
 * based on Q1a's storage pick. No input, no persistence. Next is
 * always enabled, this step is informational.
 *
 * Reads `feature_picks.lab_storage` to tailor the install instructions
 * + recommended path. For the three cloud providers (google_drive,
 * onedrive, box) shows a three-path decision: (1) already set up,
 * (2) need to install, (3) temp local folder for now.
 *
 * Note on in-wizard folder-switching: triggering the FSA directory
 * picker mid-wizard requires tearing down file-system context plus
 * re-initialization, which would either kill the wizard's resume state
 * or interrupt the user's flow in unpredictable ways. Honest path:
 * tell the user to install the provider, close and re-open ResearchOS,
 * then pick the lab folder when prompted. If they want to keep going
 * now, the temp-local option keeps the wizard alive on the current
 * folder with migration deferred.
 *
 * v4 port: identical to v3's latest three-path Q1bLabConnectInfoStep
 * (the redesigned version Grant signed off on), mounted under the v4
 * tour controller's modal-setup surface per L9.
 */

interface ProviderInfo {
  name: string;
  installUrl: string;
}

const PROVIDER_INFO: Record<string, ProviderInfo> = {
  google_drive: {
    name: "Google Drive",
    installUrl: "https://www.google.com/drive/download/",
  },
  onedrive: {
    name: "OneDrive",
    installUrl: "https://www.microsoft.com/microsoft-365/onedrive/download",
  },
  box: {
    name: "Box",
    installUrl: "https://www.box.com/resources/downloads",
  },
};

export default function Q1bLabConnectInfoStep({
  sidecar,
  setNextDisabled,
}: SetupStepProps) {
  const storage = sidecar?.feature_picks?.lab_storage ?? null;

  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);

  // Local-only or deferred: no cloud-provider setup needed. Skip the
  // three-path decision and show a short note.
  if (storage === "local") {
    return (
      <div data-step-id="setup-q1b" className="space-y-3">
        <p className="text-sm text-gray-700 leading-relaxed">
          You picked local-disk-only. Each lab member will point their
          ResearchOS at the same folder on a shared file system (NFS, SMB,
          a network drive, etc.). The OS handles the file sharing;
          ResearchOS just reads and writes the files.
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">
          No accounts, no server, no central database. Everyone&apos;s
          ResearchOS sees the same files because the folder lives somewhere
          they all have access to.
        </p>
      </div>
    );
  }

  if (storage === "deferred" || storage === null || storage === undefined) {
    return (
      <div data-step-id="setup-q1b" className="space-y-3">
        <p className="text-sm text-gray-700 leading-relaxed">
          Got it. You can configure the lab&apos;s shared storage later
          from Settings or the wiki. For now, ResearchOS will keep working
          on the folder you already picked.
        </p>
        <p className="text-xs text-gray-500">
          When you&apos;re ready, the long version lives at{" "}
          <a
            href="/wiki/getting-started/welcome-wizard"
            target="_blank"
            rel="noreferrer"
            className="text-sky-600 hover:text-sky-700 underline"
          >
            the wiki page on lab setup
          </a>
          .
        </p>
      </div>
    );
  }

  const provider = PROVIDER_INFO[storage];
  if (!provider) {
    return (
      <div data-step-id="setup-q1b" className="space-y-3">
        <p className="text-sm text-gray-700 leading-relaxed">
          Lab storage configured. You can continue.
        </p>
      </div>
    );
  }

  return (
    <div data-step-id="setup-q1b" className="space-y-4">
      <p className="text-sm text-gray-700 leading-relaxed">
        How {provider.name} works with ResearchOS: each lab member
        installs the {provider.name} desktop client, syncs the lab&apos;s
        shared folder locally, and points ResearchOS at that folder. The
        client handles the sync; ResearchOS just reads and writes files.
      </p>

      <div className="space-y-3">
        {/* Path 1: already set up */}
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-1">
          <h4 className="text-sm font-semibold text-emerald-900">
            Already pointed at the lab&apos;s {provider.name} folder
          </h4>
          <p className="text-xs text-emerald-800 leading-relaxed">
            You&apos;re set. Continue the walkthrough on this folder.
            Other lab members can join by installing {provider.name},
            syncing the same shared folder locally, and pointing their
            ResearchOS at it.
          </p>
        </div>

        {/* Path 2: need to install (recommended) */}
        <div className="rounded-md border border-sky-300 bg-sky-50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-sky-900">
              Need to install {provider.name} first
            </h4>
            <span className="text-[10px] uppercase tracking-wide font-medium text-sky-700 bg-sky-100 px-2 py-0.5 rounded">
              Recommended
            </span>
          </div>
          <p className="text-xs text-sky-800 leading-relaxed">
            For the cleanest setup: skip out of the walkthrough now,{" "}
            <a
              href={provider.installUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline hover:text-sky-900"
            >
              install {provider.name}
            </a>
            , sync the lab&apos;s shared folder locally, then restart
            ResearchOS and pick that folder when prompted. The walkthrough
            will auto-fire on first connect, and you can re-run it any
            time from Settings.
          </p>
          <p className="text-xs text-sky-800 leading-relaxed">
            Use the &quot;I&apos;ve got it from here&quot; link at the top
            of any step to exit, or use the third option below to keep
            going on a temporary local folder.
          </p>
        </div>

        {/* Path 3: temp local folder, migrate later */}
        <div className="rounded-md border border-gray-200 bg-white p-3 space-y-1">
          <h4 className="text-sm font-semibold text-gray-900">
            Use a temporary local folder for now, migrate later
          </h4>
          <p className="text-xs text-gray-700 leading-relaxed">
            Keep going on the folder you already picked. When the
            lab&apos;s {provider.name} folder is ready, you can migrate
            by copying the contents of{" "}
            <code className="text-[11px] bg-gray-100 px-1 rounded">
              users/
            </code>{" "}
            (and any other top-level files you&apos;ve created) into the
            new shared folder, then restart ResearchOS pointing at it.
          </p>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Want the long version?{" "}
        <a
          href="/wiki/getting-started/welcome-wizard"
          target="_blank"
          rel="noreferrer"
          className="text-sky-600 hover:text-sky-700 underline"
        >
          Open the wiki page on lab setup
        </a>
        .
      </p>
    </div>
  );
}
