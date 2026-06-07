// Tiny event bus decoupling the background migration runner from the toast
// surface (mirrors lib/notes/delete-toast-bus). The runner emits when a pass
// actually changed something; MigrationToast renders the quiet summary.

export interface MigrationToastPayload {
  /** Total files/records updated this pass. */
  changed: number;
}

type Listener = (payload: MigrationToastPayload) => void;

const listeners = new Set<Listener>();

export function emitMigrationsApplied(payload: MigrationToastPayload): void {
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch (err) {
      console.warn("[migration-toast-bus] listener threw", err);
    }
  }
}

export function subscribeMigrationsApplied(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
