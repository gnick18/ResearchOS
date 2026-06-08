// Module-level hand-off between a capture preview and the annotate editor, the
// same pattern bulk-batch.ts uses for the camera-roll batch. Route params are
// length-limited and ugly for a long file:// uri, so the caller stashes the
// target uri here, navigates to /annotate, the editor takes it on mount, and on
// save the editor stashes the result back for the caller to take on focus
// return. The flow is immediate (stash -> navigate -> consume) so a module-level
// holder is enough. House style: no em-dashes, no emojis, no mid-sentence colons.
import type { AnnotationDoc } from '@/lib/annotations';

let pendingTarget: string | null = null;
let pendingResult: { uri: string; doc: AnnotationDoc } | null = null;

// Caller stashes the image uri to annotate before pushing /annotate.
export function setAnnotateTarget(uri: string): void {
  pendingTarget = uri;
}

// The editor takes the target on mount and clears it, so a back-and-forward
// navigation does not re-open a stale target.
export function takeAnnotateTarget(): string | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}

// The editor stashes the saved doc (with the uri it belongs to) before going
// back. Cancel stashes nothing.
export function setAnnotateResult(result: { uri: string; doc: AnnotationDoc }): void {
  pendingResult = result;
}

// The caller takes the result on focus return and clears it. Returns null when
// the editor was cancelled or no edit happened.
export function takeAnnotateResult(): { uri: string; doc: AnnotationDoc } | null {
  const result = pendingResult;
  pendingResult = null;
  return result;
}
