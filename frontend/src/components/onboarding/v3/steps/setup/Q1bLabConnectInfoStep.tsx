import { useEffect } from "react";

interface Q1bProps {
  setNextDisabled: (disabled: boolean) => void;
}

/**
 * Q1b (lab only): informational step explaining the shared-folder
 * connect pattern. No input, no persistence. Next is always enabled.
 *
 * Wiki link target: `/wiki/getting-started/welcome-wizard`. A dedicated
 * `/wiki/getting-started/lab-mode` page does not exist yet; the wiki
 * manager will route this in P6. The link is intentionally written as
 * a plain anchor (not a Next.js Link) so the wizard portal doesn't
 * fight the App Router router push when the user clicks through.
 */
export default function Q1bLabConnectInfoStep({ setNextDisabled }: Q1bProps) {
  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);

  return (
    <div data-step-id="setup-q1b" className="space-y-3">
      <p className="text-sm text-gray-700 leading-relaxed">
        How lab members connect: each person installs ResearchOS, picks the
        same shared folder you just chose, and signs in as themselves. The
        storage provider (Drive, OneDrive, Box) handles the sync. ResearchOS
        only reads and writes the files in that folder.
      </p>
      <p className="text-sm text-gray-700 leading-relaxed">
        No accounts, no server, no central database. Everyone&apos;s
        ResearchOS sees the same files because the folder is shared at the
        storage layer.
      </p>
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
