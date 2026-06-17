// Operator-only account roster (GET /api/admin/accounts).
//
// Returns three lists, solo users, labs, and departments/institutions, each a
// thin summary the operator Accounts panel renders. Gated on ADMIN_EMAILS via
// requireOperator, so anyone not on the allow-list gets a 404 (the endpoint's
// existence is not advertised). Never returns a plaintext email.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { requireOperator } from "@/lib/sharing/operator-access";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import { buildRoster } from "@/lib/admin/account-roster";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const blocked = await requireOperator();
  if (blocked) return blocked;

  try {
    const roster = await buildRoster();
    return json(200, roster);
  } catch {
    return json(500, { error: "roster failed" });
  }
}
