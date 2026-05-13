/**
 * Tiny pubsub for non-image file changes that should make UI components
 * re-list / refresh without prop drilling. The FileStrip listens here so
 * that newly-uploaded files (from in-app upload OR native OS drop) show up
 * immediately. Mirrors `imageEvents`; if image and file events ever need
 * to share callers, consider unifying into an `attachmentEvents` bus.
 */

type AttachedDetail = { basePath: string; relativePath: string };
type DeletedDetail = { basePath: string; filename: string };
type DragStartDetail = { basePath: string; filename: string };

const target = new EventTarget();

export const fileEvents = {
  emitAttached(detail: AttachedDetail): void {
    target.dispatchEvent(new CustomEvent("file-attached", { detail }));
  },
  onAttached(handler: (detail: AttachedDetail) => void): () => void {
    const listener = (ev: Event) => handler((ev as CustomEvent<AttachedDetail>).detail);
    target.addEventListener("file-attached", listener);
    return () => target.removeEventListener("file-attached", listener);
  },

  emitDeleted(detail: DeletedDetail): void {
    target.dispatchEvent(new CustomEvent("file-deleted", { detail }));
  },
  onDeleted(handler: (detail: DeletedDetail) => void): () => void {
    const listener = (ev: Event) => handler((ev as CustomEvent<DeletedDetail>).detail);
    target.addEventListener("file-deleted", listener);
    return () => target.removeEventListener("file-deleted", listener);
  },

  emitDragStart(detail: DragStartDetail): void {
    target.dispatchEvent(new CustomEvent("file-drag-start", { detail }));
  },
  emitDragEnd(): void {
    target.dispatchEvent(new CustomEvent("file-drag-end"));
  },
  onDragStart(handler: (detail: DragStartDetail) => void): () => void {
    const listener = (ev: Event) => handler((ev as CustomEvent<DragStartDetail>).detail);
    target.addEventListener("file-drag-start", listener);
    return () => target.removeEventListener("file-drag-start", listener);
  },
  onDragEnd(handler: () => void): () => void {
    const listener = () => handler();
    target.addEventListener("file-drag-end", listener);
    return () => target.removeEventListener("file-drag-end", listener);
  },
};
