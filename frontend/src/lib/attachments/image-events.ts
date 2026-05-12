/**
 * Tiny pubsub for image-related changes that should make UI components
 * re-list / refresh without prop drilling. The image strip listens here so
 * that newly-attached images (from in-app upload OR the Telegram pipeline)
 * show up immediately, and so that sidecar-caption edits propagate to
 * tooltips.
 */

type AttachedDetail = { basePath: string; relativePath: string };
type MetadataDetail = { basePath: string; filename: string };
type DeletedDetail = { basePath: string; filename: string };
type DragStartDetail = { basePath: string; filename: string; caption?: string };

const target = new EventTarget();

export const imageEvents = {
  emitAttached(detail: AttachedDetail): void {
    target.dispatchEvent(new CustomEvent("image-attached", { detail }));
  },
  onAttached(handler: (detail: AttachedDetail) => void): () => void {
    const listener = (ev: Event) => handler((ev as CustomEvent<AttachedDetail>).detail);
    target.addEventListener("image-attached", listener);
    return () => target.removeEventListener("image-attached", listener);
  },

  emitMetadataChanged(detail: MetadataDetail): void {
    target.dispatchEvent(new CustomEvent("image-metadata", { detail }));
  },
  onMetadataChanged(handler: (detail: MetadataDetail) => void): () => void {
    const listener = (ev: Event) => handler((ev as CustomEvent<MetadataDetail>).detail);
    target.addEventListener("image-metadata", listener);
    return () => target.removeEventListener("image-metadata", listener);
  },

  emitDeleted(detail: DeletedDetail): void {
    target.dispatchEvent(new CustomEvent("image-deleted", { detail }));
  },
  onDeleted(handler: (detail: DeletedDetail) => void): () => void {
    const listener = (ev: Event) => handler((ev as CustomEvent<DeletedDetail>).detail);
    target.addEventListener("image-deleted", listener);
    return () => target.removeEventListener("image-deleted", listener);
  },

  emitDragStart(detail: DragStartDetail): void {
    target.dispatchEvent(new CustomEvent("image-drag-start", { detail }));
  },
  emitDragEnd(): void {
    target.dispatchEvent(new CustomEvent("image-drag-end"));
  },
  onDragStart(handler: (detail: DragStartDetail) => void): () => void {
    const listener = (ev: Event) => handler((ev as CustomEvent<DragStartDetail>).detail);
    target.addEventListener("image-drag-start", listener);
    return () => target.removeEventListener("image-drag-start", listener);
  },
  onDragEnd(handler: () => void): () => void {
    const listener = () => handler();
    target.addEventListener("image-drag-end", listener);
    return () => target.removeEventListener("image-drag-end", listener);
  },
};
