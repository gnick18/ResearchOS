"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  getLastError,
  clearLastError,
  generateGitHubIssueUrl,
  getBrowserInfo,
  type ErrorInfo,
  type FeedbackType,
} from "@/lib/error-reporting";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import FileDropzone from "@/components/ui/FileDropzone";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefilledError?: ErrorInfo | null;
}

// An attached screenshot lives only in in-memory component state — the app
// is local-first with no server, so images are never uploaded, written to
// the research folder, or persisted anywhere. They exist only to be copied
// to the user's own clipboard so they can paste them into the GitHub issue
// on the next screen. (feedback-screenshots bot)
interface AttachedImage {
  id: string;
  blob: Blob;
  /** Object URL for the thumbnail preview. Revoked on remove / unmount. */
  previewUrl: string;
  /** Display name when available (file picker / pasted file), else a default. */
  name: string;
}

let imageIdCounter = 0;
function nextImageId(): string {
  imageIdCounter += 1;
  return `img-${imageIdCounter}-${Date.now()}`;
}

const TYPE_STORAGE_KEY = "researchos:feedback-type-last";

const TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature request" },
  { value: "feedback", label: "General feedback" },
];

function readStoredType(): FeedbackType | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TYPE_STORAGE_KEY);
    if (raw === "bug" || raw === "feature" || raw === "feedback") return raw;
    return null;
  } catch {
    return null;
  }
}

function writeStoredType(value: FeedbackType): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TYPE_STORAGE_KEY, value);
  } catch {
    // localStorage can throw in private mode / quota — preference just won't persist.
  }
}

export default function FeedbackModal({ isOpen, onClose, prefilledError }: FeedbackModalProps) {
  const [type, setType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState(false);

  // Attached screenshots (in-memory only) + drag-hover affordance.
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  // When the user submits with images attached, we don't close the modal
  // immediately. The clipboard can hold only ONE image at a time, so we
  // transition to a "last step" confirmation that keeps the thumbnails +
  // per-image Copy buttons reachable. `null` = still in the compose state.
  const [confirmStep, setConfirmStep] = useState<null | { copyOk: boolean }>(null);
  // id of the image whose per-thumbnail Copy button just fired (for the
  // transient "Copied" affordance on that specific thumbnail).
  const [copiedImageId, setCopiedImageId] = useState<string | null>(null);
  const [clipboardError, setClipboardError] = useState<string | null>(null);

  const errorInfo = prefilledError || getLastError();

  // Snapshot errorInfo when the modal opens. errorInfo itself is
  // recomputed on every render (prefilledError || getLastError() is a
  // non-stable expression), so including it in the reset effect's deps
  // re-fires the reset on unrelated re-renders and wipes any text the
  // user has typed. Stash the latest value in a ref that's only
  // mutated inside an effect, then read it from the reset effect.
  // (feedback polish R1)
  const errorInfoRef = useRef<ErrorInfo | null>(null);
  useEffect(() => {
    errorInfoRef.current = errorInfo;
  }, [errorInfo]);

  // Keep a ref to the live images so the unmount cleanup can revoke every
  // object URL without re-subscribing on each add/remove. Reading state in
  // a cleanup closure would capture a stale snapshot.
  const imagesRef = useRef<AttachedImage[]>([]);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // Revoke every outstanding object URL when the modal unmounts so previews
  // don't leak. Per-image revokes happen on remove; this catches the rest.
  useEffect(() => {
    return () => {
      for (const img of imagesRef.current) URL.revokeObjectURL(img.previewUrl);
    };
  }, []);

  // Reset form whenever the modal (re)opens. If the open was triggered by an
  // error, lock the type to "bug" so the user sees the error context they
  // came to report; otherwise restore their last-used preference.
  useEffect(() => {
    if (!isOpen) return;
    const snapshot = errorInfoRef.current;
    // Revoke any URLs left from a prior session before clearing the list.
    for (const img of imagesRef.current) URL.revokeObjectURL(img.previewUrl);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset form when modal opens (sync state to prop transition)
    setTitle("");
    setDescription("");
    setCopied(false);
    setImages([]);
    setIsDragging(false);
    setConfirmStep(null);
    setCopiedImageId(null);
    setClipboardError(null);
    setType(snapshot ? "bug" : readStoredType() ?? "bug");
  }, [isOpen]);

  // Add image blobs (from drop / paste / file picker) to in-memory state.
  // Non-image blobs are ignored so a stray text paste / file drop is a no-op.
  const addImageBlobs = useCallback((blobs: Array<{ blob: Blob; name?: string }>) => {
    const additions: AttachedImage[] = [];
    for (const { blob, name } of blobs) {
      if (!blob.type.startsWith("image/")) continue;
      additions.push({
        id: nextImageId(),
        blob,
        previewUrl: URL.createObjectURL(blob),
        name: name?.trim() || "screenshot",
      });
    }
    if (additions.length > 0) setImages((prev) => [...prev, ...additions]);
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  if (!isOpen) return null;

  const handleTypeChange = (next: FeedbackType) => {
    setType(next);
    writeStoredType(next);
  };

  // Bug is the only type that surfaces auto-captured error context. Once the
  // user switches away, they've explicitly opted out of attaching the error.
  const showErrorPreview = type === "bug" && !!errorInfo;
  const payloadErrorInfo = type === "bug" ? errorInfo : null;

  // A non-empty description is required to file an issue. Whitespace-
  // only descriptions count as empty — `trim()` strips newlines too,
  // so a user mashing Enter doesn't fool the gate. (feedback polish R1)
  const isDescriptionValid = description.trim().length > 0;
  const hasImages = images.length > 0;

  // Copy a single image blob to the clipboard so the user can paste it into
  // the GitHub description (GitHub uploads images on paste). Guarded so a
  // clipboard rejection surfaces a friendly message instead of throwing.
  // Returns true on success. Plain function (not a hook) so it can live
  // below the early `if (!isOpen)` return alongside the other handlers.
  const copyImageToClipboard = async (img: AttachedImage): Promise<boolean> => {
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error("Clipboard image write is not available in this browser.");
      }
      await navigator.clipboard.write([
        new ClipboardItem({ [img.blob.type]: img.blob }),
      ]);
      return true;
    } catch (err) {
      console.error("Failed to copy image to clipboard:", err);
      setClipboardError(
        "Could not copy the image automatically. Right-click the thumbnail to copy it, or drag it into the GitHub description.",
      );
      return false;
    }
  };

  const handleCopyImage = async (img: AttachedImage) => {
    setClipboardError(null);
    const ok = await copyImageToClipboard(img);
    if (ok) {
      setCopiedImageId(img.id);
      setTimeout(() => setCopiedImageId((cur) => (cur === img.id ? null : cur)), 2000);
    }
  };

  const handleSubmit = async () => {
    if (!isDescriptionValid) return;
    const url = generateGitHubIssueUrl({
      type,
      title,
      description,
      errorInfo: payloadErrorInfo,
      hasScreenshots: hasImages,
    });
    window.open(url, "_blank");
    clearLastError();

    // No images: keep today's behavior — open the issue and close.
    if (!hasImages) {
      onClose();
      return;
    }

    // Images attached: the clipboard holds only ONE image at a time, so we
    // can't stuff them all in at once. Auto-copy the first image and switch
    // to a short "last step" confirmation that keeps the thumbnails + Copy
    // buttons reachable for any additional images. Done closes the modal.
    setClipboardError(null);
    const ok = await copyImageToClipboard(images[0]);
    setConfirmStep({ copyOk: ok });
  };

  const handleCopy = async () => {
    const url = generateGitHubIssueUrl({
      type,
      title,
      description,
      errorInfo: payloadErrorInfo,
      hasScreenshots: hasImages,
    });
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Drag-and-drop onto the modal body.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    addImageBlobs(files.map((f) => ({ blob: f, name: f.name })));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear when leaving the drop surface itself, not a child.
    if (e.currentTarget === e.target) setIsDragging(false);
  };

  // Paste anywhere in the modal. Pull image items out of the clipboard data.
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const blobs: Array<{ blob: Blob; name?: string }> = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) blobs.push({ blob: file, name: file.name });
      }
    }
    if (blobs.length > 0) {
      e.preventDefault();
      addImageBlobs(blobs);
    }
  };

  const heading =
    type === "bug"
      ? "Report an Issue"
      : type === "feature"
      ? "Request a Feature"
      : "Send Feedback";

  const descriptionLabel =
    type === "bug"
      ? "What were you trying to do?"
      : type === "feature"
      ? "What feature would you like? Why is it useful?"
      : "What's on your mind?";

  const descriptionPlaceholder =
    type === "bug"
      ? "Describe what happened and what you expected..."
      : type === "feature"
      ? "Describe the feature and how it would help..."
      : "Share anything — thoughts, suggestions, praise, complaints...";

  const submitLabel =
    type === "bug"
      ? "Create GitHub Issue"
      : type === "feature"
      ? "Submit Feature Request"
      : "Submit Feedback";

  return (
    <LivingPopup
      open={isOpen}
      onClose={onClose}
      label="Feedback"
      widthClassName="max-w-lg"
      card={false}
      fillHeight
    >
      <div
        className="relative bg-surface-overlay rounded-2xl shadow-2xl w-full overflow-hidden flex flex-col max-h-full"
        onPaste={confirmStep ? undefined : handlePaste}
        onDragOver={confirmStep ? undefined : handleDragOver}
        onDragLeave={confirmStep ? undefined : handleDragLeave}
        onDrop={confirmStep ? undefined : handleDrop}
      >
        {/* Drag overlay: a dashed sky frame while a file is hovering the
            modal, so it's obvious where to drop. (feedback-screenshots bot) */}
        {isDragging && !confirmStep && (
          <div className="absolute inset-0 z-10 m-2 rounded-xl border-2 border-dashed border-sky-400 bg-sky-50/80 dark:bg-sky-500/15 flex items-center justify-center pointer-events-none">
            <p className="text-body font-medium text-sky-700 dark:text-sky-300">Drop images to attach</p>
          </div>
        )}

        {confirmStep ? (
          <div className="flex flex-col">
            <div className="p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-100 dark:bg-green-500/15">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-heading font-bold text-foreground">Last step: add your screenshots</h2>
                  <p className="text-meta text-foreground-muted">The GitHub issue opened in a new tab</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {clipboardError ? (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 p-3">
                  <p className="text-body text-amber-800 dark:text-amber-300">{clipboardError}</p>
                </div>
              ) : (
                <div className="rounded-lg bg-green-50 dark:bg-green-500/15 border border-green-200 dark:border-green-500/30 p-3">
                  <p className="text-body text-green-800 dark:text-green-300">
                    {images.length === 1
                      ? "Your screenshot is on the clipboard. Switch to the GitHub tab and paste it into the description (Cmd/Ctrl+V) under the Screenshots heading."
                      : "The first screenshot is on the clipboard. Switch to the GitHub tab and paste it (Cmd/Ctrl+V) under the Screenshots heading."}
                  </p>
                </div>
              )}

              {images.length > 1 && (
                <p className="text-meta text-foreground-muted">
                  The clipboard holds one image at a time. After pasting the first, come back here and use the Copy button on each remaining screenshot, then paste it into GitHub. Repeat for all of them.
                </p>
              )}

              <div className="grid grid-cols-3 gap-3">
                {images.map((img, idx) => (
                  <div
                    key={img.id}
                    className="relative group rounded-lg border border-border overflow-hidden bg-surface-sunken"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- ephemeral in-memory object URL, never a network asset */}
                    <img src={img.previewUrl} alt={img.name} className="w-full h-20 object-cover" />
                    <div className="absolute bottom-0 inset-x-0 flex items-center justify-between gap-1 bg-black/60 px-1.5 py-1">
                      <span className="text-meta text-white">{idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyImage(img)}
                        className="text-meta font-medium text-white hover:text-green-300 transition-colors flex items-center gap-0.5"
                      >
                        {copiedImageId === img.id ? (
                          <>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Copied
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-border bg-surface-sunken flex justify-end">
              <button
                onClick={onClose}
                className="ros-btn-raise px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
        <>
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Type-specific icon. The warning triangle reads as
                  "alert" (red, urgent) — fine for bug reports but
                  off-tone for feature requests and general feedback.
                  Bug keeps the triangle so the user reads the modal
                  as the bug-report surface; feature gets a lightbulb
                  (idea); feedback gets a chat bubble (send-us-a-
                  note). (feedback polish R1) */}
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  type === "bug"
                    ? "bg-red-100 dark:bg-red-500/15"
                    : type === "feature"
                    ? "bg-amber-100 dark:bg-amber-500/15"
                    : "bg-blue-100 dark:bg-blue-500/15"
                }`}
              >
                {type === "bug" ? (
                  <svg
                    className="w-5 h-5 text-red-600 dark:text-red-300"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                ) : type === "feature" ? (
                  <svg
                    className="w-5 h-5 text-amber-600 dark:text-amber-300"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5 text-blue-600 dark:text-blue-300"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                )}
              </div>
              <div>
                <h2 className="text-heading font-bold text-foreground">{heading}</h2>
                <p className="text-meta text-foreground-muted">Help us improve ResearchOS</p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-body font-medium text-foreground mb-1.5">
              Type
            </label>
            <div
              role="radiogroup"
              aria-label="Feedback type"
              className="inline-flex rounded-lg border border-border bg-surface-sunken p-0.5 ros-seg-track"
            >
              {TYPE_OPTIONS.map((opt) => {
                const selected = type === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleTypeChange(opt.value)}
                    className={`px-3 py-1.5 text-body rounded-md transition-colors ${
                      selected
                        ? "bg-surface-raised text-foreground ros-seg-active font-medium"
                        : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {type !== "feedback" && (
            <div>
              <label className="block text-body font-medium text-foreground mb-1.5">
                {type === "bug" ? "Title (optional)" : "Feature title"}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  type === "bug"
                    ? "Short summary of the issue"
                    : "Short summary of the feature"
                }
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-body font-medium text-foreground mb-1.5">
              {descriptionLabel}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={descriptionPlaceholder}
              rows={type === "feedback" ? 5 : 3}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            {/* Empty descriptions create unactionable issues — gate the
                Submit button on a non-empty description and surface a
                small hint so the disabled state isn't a mystery.
                (feedback polish R1) */}
            {!isDescriptionValid && (
              <p className="mt-1.5 text-meta text-foreground-muted">
                Tell us a bit more so we can act on this.
              </p>
            )}
          </div>

          {showErrorPreview && (
            <div>
              <label className="block text-body font-medium text-foreground mb-1.5">
                Error Details
              </label>
              <div className="bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg p-3 max-h-32 overflow-y-auto">
                <p className="text-body text-red-800 dark:text-red-300 font-mono break-all">
                  {errorInfo!.message}
                </p>
                {errorInfo!.stack && (
                  <pre className="text-meta text-red-600 dark:text-red-300 mt-2 whitespace-pre-wrap">
                    {errorInfo!.stack.split("\n").slice(0, 5).join("\n")}
                  </pre>
                )}
              </div>
            </div>
          )}

          {type === "bug" && (
            <div className="bg-surface-sunken rounded-lg p-3">
              <p className="text-meta text-foreground-muted">
                <span className="font-medium">Browser:</span> {getBrowserInfo()}
              </p>
            </div>
          )}

          {/* Screenshot attach area. Available for every feedback type.
              Images live in in-memory state only (no server, no folder
              write); on submit the user copies them to their clipboard and
              pastes them into the GitHub description. (feedback-screenshots
              bot) */}
          <div>
            <label className="block text-body font-medium text-foreground mb-1.5">
              Screenshots (optional)
            </label>
            <FileDropzone
              multiple
              accept="image/*"
              icon="camera"
              label="Drop, paste, or click to add images"
              hint="PNG, JPG, screenshots"
              ariaLabel="Attach screenshot images"
              onReject={(message) => setClipboardError(message)}
              onFiles={(files) =>
                addImageBlobs(files.map((f) => ({ blob: f, name: f.name })))
              }
            />
            <p className="mt-1.5 text-meta text-foreground-muted">
              Screenshots help us act on your report. You will paste them into GitHub on the next screen.
            </p>

            {clipboardError && (
              <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 p-2.5">
                <p className="text-meta text-amber-800 dark:text-amber-300">{clipboardError}</p>
              </div>
            )}

            {images.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-3">
                {images.map((img) => (
                  <div
                    key={img.id}
                    className="relative group rounded-lg border border-border overflow-hidden bg-surface-sunken"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- ephemeral in-memory object URL, never a network asset */}
                    <img src={img.previewUrl} alt={img.name} className="w-full h-20 object-cover" />

                    <Tooltip label="Remove" placement="top">
                      <button
                        type="button"
                        onClick={() => removeImage(img.id)}
                        aria-label={`Remove ${img.name}`}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </Tooltip>

                    <div className="absolute bottom-0 inset-x-0 flex justify-center bg-black/60 py-1">
                      <Tooltip label="Copy this image to the clipboard" placement="top">
                        <button
                          type="button"
                          onClick={() => handleCopyImage(img)}
                          aria-label={`Copy ${img.name} to clipboard`}
                          className="text-meta font-medium text-white hover:text-green-300 transition-colors flex items-center gap-0.5"
                        >
                          {copiedImageId === img.id ? (
                            <>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Copied
                            </>
                          ) : (
                            <>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              Copy
                            </>
                          )}
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-meta text-foreground-muted">
            Clicking &quot;{submitLabel}&quot; will open a new tab where you can review and submit on GitHub.
            You&apos;ll need a GitHub account.
          </p>
        </div>

        <div className="p-4 border-t border-border bg-surface-sunken flex gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCopy}
            className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg transition-colors flex items-center gap-2"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4 text-green-600 dark:text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy Link
              </>
            )}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isDescriptionValid}
            className="ros-btn-raise flex-1 px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            {submitLabel}
          </button>
        </div>
        </>
        )}
      </div>
    </LivingPopup>
  );
}
