"use client";

// Wizard step: connect the data folder, rendered embedded inside the stepper
// shell (no modal chrome of its own, the shell supplies the frame). This is the
// "embedded mode" the spec calls for: the same drag-or-click drop zone and
// empty-folder initialization as FolderConnectGate, but inline.
//
// It reuses the file-system context connect logic. When isConnected flips (a
// folder is attached and, if it was empty, initialized), the step advances via
// onConnected. An empty folder shows the initialize prompt inline, matching the
// fresh-folder handling in FolderConnectGate (so it never reintroduces the
// fresh-folder bounce). Skip is owned by the shell, which lands the user in the
// app's limited mode per Q5.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { enterDemo } from "@/lib/demo/enter-demo";
import {
  useFileSystem,
  isFileSystemAccessSupported,
} from "@/lib/file-system/file-system-context";
import BrowserNotSupported from "@/components/BrowserNotSupported";
import { Icon } from "@/components/icons";
import {
  extractDirectoryHandleFromDrop,
  describeDropExtractionError,
  type DropExtractionResult,
} from "@/lib/file-system/drop-folder";

export interface FolderStepProps {
  /** Advance once a usable folder is connected (and initialized if empty). */
  onConnected: () => void;
}

export default function FolderStep({ onConnected }: FolderStepProps) {
  const {
    connect,
    connectWithHandle,
    initializeFolder,
    isConnected,
    isLoading,
    error,
    needsInitialization,
    directoryName,
  } = useFileSystem();

  const [isDragOver, setIsDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragCounterRef = useRef(0);

  // Advance once a usable folder is connected. A still-empty folder pauses on
  // the inline initialize prompt below (isConnected is false until init runs),
  // so this only fires for a ready folder, never mid-init.
  useEffect(() => {
    if (isConnected) onConnected();
  }, [isConnected, onConnected]);

  const handleConnect = async () => {
    await connect();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragCounterRef.current += 1;
    setIsDragOver(true);
    setDropError(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const items = e.dataTransfer?.items;
    if (!items || items.length === 0) return;
    const result: DropExtractionResult = await extractDirectoryHandleFromDrop(items);
    if (result.kind === "ok") {
      setDropError(null);
      await connectWithHandle(result.handle);
      return;
    }
    setDropError(describeDropExtractionError(result.kind));
  };

  if (!isFileSystemAccessSupported()) {
    return <BrowserNotSupported />;
  }

  // Empty-folder initialize prompt, inline (no modal). Matches FolderConnectGate
  // so a brand-new empty folder does not bounce.
  if (needsInitialization) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
          Initialize this folder
        </h1>
        <p className="mb-6 mt-2 text-sm text-foreground-muted">
          {directoryName ? `${directoryName} ` : "This folder "}
          does not have the ResearchOS structure yet. Set it up to start working
          here.
        </p>
        <button
          type="button"
          onClick={() => void initializeFolder()}
          disabled={isLoading}
          className="w-full rounded-xl bg-[#1283c9] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f6fa8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Setting up..." : "Initialize folder"}
        </button>
        {error && (
          <p className="mt-3 text-xs text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center text-center">
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        Connect your data folder
      </h1>
      <p className="mb-6 mt-2 text-sm text-foreground-muted">
        Your notebook lives on your own disk. Pick an existing ResearchOS folder
        or a new empty one. You can add or change this anytime in Settings.
      </p>

      <div
        data-testid="wizard-folder-drop-zone"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative w-full overflow-hidden rounded-2xl border-2 border-dashed transition-all ${
          isDragOver
            ? "border-blue-400 bg-blue-500/15 ring-4 ring-blue-400/30"
            : "border-border hover:border-foreground-muted"
        }`}
      >
        <div className="px-6 py-9">
          <div
            className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
              isDragOver ? "bg-blue-500/25" : "bg-blue-500/15"
            }`}
          >
            <Icon
              name="folder"
              className={`h-7 w-7 transition-transform ${
                isDragOver ? "scale-110 text-blue-500" : "text-blue-400"
              }`}
            />
          </div>
          <h2 className="text-base font-bold text-foreground">
            {isDragOver
              ? "Release to connect this folder"
              : "Drag your data folder here"}
          </h2>
          {/* Always in layout (invisible on drag) so the drop box never
              shrinks under the cursor mid-drag. */}
          <div
            className={isDragOver ? "invisible" : ""}
            aria-hidden={isDragOver || undefined}
          >
              <div className="mt-5 flex items-center justify-center gap-3 text-xs text-foreground-muted">
                <span className="h-px w-10 bg-border" />
                or
                <span className="h-px w-10 bg-border" />
              </div>
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={isLoading}
                data-testid="wizard-folder-browse"
                className="ros-btn-neutral mt-3 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-foreground disabled:opacity-50"
              >
                {isLoading ? "Opening..." : "Browse for a folder"}
              </button>
              <p className="mx-auto mt-4 max-w-sm text-xs leading-relaxed text-foreground-muted">
                Chrome and Edge only. Dragging skips the file picker, which can
                stall while a cloud sync wakes up.
              </p>
          </div>
          {dropError && (
            <p
              role="alert"
              data-testid="wizard-folder-drop-error"
              className="mt-4 text-xs text-red-600"
            >
              {dropError}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      {/*
        Go-live: the folder step is unskippable (no folder = no app), so this
        permanent escape is the one way past it without connecting a folder. It
        lands on the read-only /demo workspace, the "limited mode" replacement.
        Never remove it without restoring another escape (no soft-locks).
      */}
      <p className="mt-6 text-xs text-foreground-muted">
        Not ready to pick a folder?{" "}
        <Link
          href="/demo"
          onClick={(e) => {
            e.preventDefault();
            enterDemo("", { rememberRoute: true });
          }}
          data-testid="wizard-folder-try-demo"
          className="font-semibold text-[#1283c9] hover:underline"
        >
          Try the demo instead
        </Link>
      </p>
    </div>
  );
}
