// Operator metrics endpoint (powers the /admin dashboard).
//
// GET /api/admin/metrics
//
// Gated on the signed-in OAuth email being in ADMIN_EMAILS. Anyone else gets a
// 404 (not a 403, so the endpoint's existence is not advertised). Returns
// AGGREGATE directory + relay stats only, never any email or per-user data, the
// directory stores peppered hashes anyway.
//
// Reads env: SHARING_ENABLED, ADMIN_EMAILS, DATABASE_URL, plus the AUTH_* vars
// used by the session.

import { auth } from "@/lib/sharing/auth";
import { isAdminEmail } from "@/lib/sharing/admin";
import {
  ensureOrcidSchema,
  ensureProfileSchema,
  ensureSchema,
  getDirectoryMetrics,
} from "@/lib/sharing/directory/db";
import { ensureRelaySchema, getRelayMetrics } from "@/lib/sharing/relay/db";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  // Admin gate. No session email, or an email not on the allow-list, is a 404.
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return json(404, { error: "not found" });
  }

  await ensureSchema();
  await ensureProfileSchema();
  await ensureOrcidSchema();
  await ensureRelaySchema();

  let directory;
  let relay;
  try {
    [directory, relay] = await Promise.all([
      getDirectoryMetrics(),
      getRelayMetrics(),
    ]);
  } catch {
    return json(500, { error: "metrics failed" });
  }

  return json(200, { directory, relay });
}
