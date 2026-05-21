import type { Method, TaskMethodAttachment } from "@/lib/types";

/**
 * Composite `(owner, id)` key for a method record. Use anywhere a Map / Set /
 * React key would otherwise collapse two same-id different-owner records into
 * one slot (e.g. alex's private id 2 and the public id 2). Pairs with
 * `attachmentKey` below — both produce the same string for the same (owner,
 * id) pair, so an attachment's key matches the resolved method's key.
 */
export function methodKey(method: Pick<Method, "id" | "owner">): string {
  return `${method.owner}:${method.id}`;
}

/**
 * Composite key for a task method attachment, applying the same
 * owner-resolution rule as `resolveMethodForAttachment`: an explicit
 * attachment owner wins; null falls back to the task owner. Use anywhere a
 * Map / Set / React key needs to distinguish two same-id attachments whose
 * methods live in different owner namespaces.
 */
export function attachmentKey(
  attachment: Pick<TaskMethodAttachment, "method_id" | "owner">,
  taskOwner: string,
): string {
  return `${attachment.owner ?? taskOwner}:${attachment.method_id}`;
}

/**
 * Resolve a method record for a given attachment, honoring the attachment's
 * `owner` field to disambiguate against per-user id collisions (e.g. alex's
 * private method id 2 vs public method id 2). When the attachment owner is
 * non-null, match `(id, owner)` strictly. When null (legacy attachments or
 * locally-owned methods), match by id and prefer the task owner's own
 * method, falling back to the first match for backwards compatibility.
 *
 * Mirrors the helper introduced at `MethodTabs.tsx` in `3f8b42d2`; lifted to
 * this shared module so sibling render/lookup sites can apply the same
 * disambiguation without duplicating logic.
 */
export function resolveMethodForAttachment(
  attachment: Pick<TaskMethodAttachment, "method_id" | "owner"> | undefined,
  methods: Method[],
  taskOwner: string | undefined,
): Method | undefined {
  if (!attachment) return undefined;
  if (attachment.owner) {
    return methods.find(
      (m) => m.id === attachment.method_id && m.owner === attachment.owner,
    );
  }
  const candidates = methods.filter((m) => m.id === attachment.method_id);
  if (candidates.length === 0) return undefined;
  if (taskOwner) {
    const own = candidates.find((m) => m.owner === taskOwner);
    if (own) return own;
  }
  return candidates[0];
}

/**
 * Convenience for callers that iterate `task.method_ids` (bare ids) rather
 * than `task.method_attachments`. Picks the matching attachment by id and
 * defers to `resolveMethodForAttachment`. When no matching attachment exists
 * (newly-created tasks that haven't backfilled attachments yet), behaves as
 * if the attachment's `owner` were null — task-owner-first id lookup.
 */
export function resolveMethodById(
  methodId: number,
  attachments: TaskMethodAttachment[] | undefined,
  methods: Method[],
  taskOwner: string | undefined,
): Method | undefined {
  const attachment = attachments?.find((a) => a.method_id === methodId);
  return resolveMethodForAttachment(
    attachment ?? { method_id: methodId, owner: null },
    methods,
    taskOwner,
  );
}
