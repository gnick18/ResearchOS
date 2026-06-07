/**
 * SharingServerCopyNotice
 *
 * The Option B transparency disclosure (see UNIFIED_MODEL_PHASE3C_SHARED_COLLAB).
 * When a user shares content for live collaboration, ResearchOS keeps a synced,
 * encrypted copy on its servers so collaborators see changes in real time. This
 * notice states that plainly at the moment of sharing, and reassures that
 * anything NOT shared stays only on the user's machine (local-first).
 *
 * Used in every surface that creates a server-stored shared copy (the note
 * share dialog's "In your lab" tab, the shared-notebook dialog). NOT used on the
 * "Send outside" path, which is a one-time end-to-end encrypted copy, a
 * different model with its own description.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */
export default function SharingServerCopyNotice({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      data-testid="sharing-server-copy-notice"
      className={`flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-meta leading-relaxed text-sky-800 ring-1 ring-sky-100 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/20 ${className}`}
    >
      <svg
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
      <span>
        Sharing keeps a synced, encrypted copy on ResearchOS servers so your
        collaborators see changes live. Anything you don&apos;t share stays only
        on your computer.
      </span>
    </div>
  );
}
