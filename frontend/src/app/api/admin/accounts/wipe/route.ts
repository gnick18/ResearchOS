// Operator-only FULL ACCOUNT WIPE (POST /api/admin/accounts/wipe).
//
// Body: { ownerKey?, email?, deptId?, institutionId?, confirm: true }. Refuses
// unless confirm === true. Deletes every cloud-side row the resolved identity
// owns across billing, the directory, relay, collab, the lab-site / BYO tables,
// and the slug registry, then deletes the Stripe customer so a saved card does
// not linger. Local files on the person's own computer are never touched, there
// is nothing server-side for them. Gated on ADMIN_EMAILS. Idempotent.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { requireOperator } from "@/lib/sharing/operator-access";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import { performWipe, resolveWipeTarget } from "@/lib/admin/account-wipe";

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

  if (input.confirm !== true) {
    return json(400, { error: "confirm must be true to wipe an account" });
  }

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
    const result = await performWipe(target);
    return json(200, result);
  } catch {
    return json(500, { error: "wipe failed" });
  }
}
