"use client";

// seq nav bot — the HISTORY tab panel.
//
// There is no persisted per-sequence edit/version history surface yet: the
// editor keeps an in-memory undo/redo stack (use-sequence-editor) but does not
// record a durable, browsable timeline, and cloning-step history is a future
// phase. Rather than invent fake entries we render a calm empty state.
//
// TODO(seq Phase 3 — cloning history): wire a real timeline here. Candidates:
//   - a durable per-sequence edit log (timestamped checkpoints on Save), and/or
//   - the cloning-operation history once the cloning engine lands (ligations,
//     digests, PCR products) so each derived construct shows its provenance.
// Until then this panel intentionally shows NO data.
//
// Inline SVG only (no emoji); no em-dashes.

function IconHistory({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

export default function SequenceHistoryPanel() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-white px-8 text-center">
      <IconHistory className="h-10 w-10 text-gray-300" />
      <p className="mt-3 text-sm font-medium text-gray-600">Edit history will appear here</p>
      <p className="mt-1 max-w-xs text-xs text-gray-400">
        A timeline of saved checkpoints and cloning steps for this sequence is on
        the way. For now, use Undo and Redo to step through your current edits.
      </p>
    </div>
  );
}
