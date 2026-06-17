// Operator-only wipe DRY RUN (POST /api/admin/accounts/wipe-preview).
//
// Body: { ownerKey?, email?, deptId?, institutionId? }. Resolves the target and
// returns a per-table count of EXACTLY what the wipe would delete, plus whether a
// Stripe customer would be deleted (masked). Deletes NOTHING, it is a preview the
// confirm popup shows before the operator commits. Gated on ADMIN_EMAILS.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { requireOperator } from "@/lib/sharing/operator-access";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import { previewWipe, resolveWipeTarget } from "@/lib/admin/account-wipe";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const blocked = await requireOperator();
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json body" });
  }
  const input = (body ?? {}) as Record<string, unknown>;

  let target;
  try {
    target = resolveWipeTarget({
      ownerKey: typeof input.ownerKey === "string" ? input.ownerKey : null,
      email: typeof input.email === "string" ? input.email : null,
      deptId: typeof input.deptId === "string" ? input.deptId : null,
      institutionId:
        typeof input.institutionId === "string" ? input.institutionId : null,
    });
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : "bad target" });
  }

  try {
    const preview = await previewWipe(target);
    return json(200, preview);
  } catch {
    return json(500, { error: "preview failed" });
  }
}
