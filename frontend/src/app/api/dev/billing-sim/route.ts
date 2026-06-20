// Backend billing simulator. Seeds a fake lab scenario (a PI + members, storage,
// activity, an optional plan, an optional gift) straight into the billing tables
// and runs the REAL enforcement decision by email, so the whole lab-shared-pool
// model can be tested without devices, OAuth, invite links, or Stripe checkout.
// The "check" action calls the exact functions owner-state calls, so it is the
// real logic, just driven by email + seeded data instead of a pubkey.
//
// POST /api/dev/billing-sim   body { action, ... }
//   { action: "scenario", piEmail, piStorageMb?, piWritesK?, plan?, giftGb?,
//     giftWritesM?, giftExpiresAt?, members?: [{ email, storageMb?, writesK? }] }
//   { action: "check", email }
//   { action: "reset", emails: [string] }
//
// GATE: operator session (isAdminEmail) OR a BILLING_SIM_SECRET bearer (so it can
// be curled headless). 404 otherwise, and 404 in production unless the secret is
// set, so it can never seed real prod data by accident. It MUTATES billing tables,
// keep the secret unset in real prod.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { isAdminEmail } from "@/lib/sharing/admin";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { isBillingEnabled } from "@/lib/billing/config";
import {
  ensureBillingSchema,
  setPlan,
} from "@/lib/billing/db";
import { resolveModelAPlanId } from "@/lib/billing/model-a/resolve";
import { modelACapState } from "@/lib/billing/model-a/enforcement";
import {
  ensureLabSchema,
  enrollMemberActive,
  resolveBillingOwner,
} from "@/lib/billing/lab";
import { ensureGrantsSchema, issueGrant } from "@/lib/billing/grants";
import { currentWritePeriod } from "@/lib/billing/period";
import {
  ensureDocSizesSchema,
  ensureOwnerWritesSchema,
  getLabPoolUsage,
  getLabPoolWrites,
  getSql,
  incrementOwnerWrites,
  upsertDocSize,
} from "@/lib/collab/server/db";

export const runtime = "nodejs";

const MB = 1024 * 1024;
const GB = 1024 ** 3;
const M = 1_000_000;

async function gate(req: Request): Promise<Response | null> {
  // INERT BY DEFAULT: the route does nothing unless BILLING_SIM_SECRET is set, so
  // it can never seed fake data into real prod by accident. When the secret is
  // set, allow either a matching bearer (headless curl) or an operator session.
  const secret = process.env.BILLING_SIM_SECRET;
  if (!secret) return json(404, { error: "not found" });
  const got = req.headers.get("authorization");
  if (got === `Bearer ${secret}`) return null;
  const session = await auth();
  if (isAdminEmail(session?.user?.email)) return null;
  return json(404, { error: "not found" });
}

/** Sets an owner's collab-pool bytes via one synthetic sim doc. */
async function setStorage(ownerKey: string, mb: number): Promise<void> {
  await ensureDocSizesSchema();
  await upsertDocSize({
    docId: `sim:${ownerKey}`,
    ownerHash: ownerKey,
    bytes: Math.max(0, Math.round(mb * MB)),
  });
}

/** Sets an owner's writes for THIS period (clears then sets). */
async function setWrites(ownerKey: string, writes: number): Promise<void> {
  await ensureOwnerWritesSchema();
  const period = currentWritePeriod();
  const sql = getSql();
  await sql`DELETE FROM collab_owner_writes WHERE owner_hash = ${ownerKey} AND period = ${period}`;
  if (writes > 0) await incrementOwnerWrites(ownerKey, Math.round(writes), period);
}

export async function POST(req: Request): Promise<Response> {
  const blocked = await gate(req);
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid json" });
  }
  const action = body.action;

  try {
    await ensureLabSchema();
    // The sim writes billing rows (setPlan -> plan_id) too, so forward-migrate
    // the billing schema as well; without this a dev DB on the old schema 500s
    // with "column plan_id does not exist".
    await ensureBillingSchema();

    if (action === "scenario") {
      const piEmail = String(body.piEmail ?? "").trim();
      if (!piEmail) return json(400, { error: "piEmail required" });
      const piKey = ownerKeyForEmail(piEmail);

      await setStorage(piKey, Number(body.piStorageMb ?? 0));
      await setWrites(piKey, Number(body.piWritesK ?? 0) * 1000);

      if (typeof body.plan === "string" && body.plan) {
        await setPlan(piKey, body.plan);
      }
      const giftGb = Number(body.giftGb ?? 0);
      const giftWritesM = Number(body.giftWritesM ?? 0);
      if (giftGb > 0 || giftWritesM > 0) {
        await ensureGrantsSchema();
        await issueGrant({
          ownerKey: piKey,
          bonusBytes: Math.round(giftGb * GB),
          bonusWrites: Math.round(giftWritesM * M),
          label: `sim:${piEmail}`,
          note: "billing-sim",
          expiresAt:
            typeof body.giftExpiresAt === "string" ? body.giftExpiresAt : null,
        });
      }

      const members = Array.isArray(body.members) ? body.members : [];
      const seeded: string[] = [];
      for (const m of members) {
        const mm = m as { email?: unknown; storageMb?: unknown; writesK?: unknown };
        const email = String(mm.email ?? "").trim();
        if (!email) continue;
        const key = ownerKeyForEmail(email);
        await enrollMemberActive(piKey, key, email);
        await setStorage(key, Number(mm.storageMb ?? 0));
        await setWrites(key, Number(mm.writesK ?? 0) * 1000);
        seeded.push(email);
      }

      return json(200, { ok: true, piEmail, members: seeded });
    }

    if (action === "check") {
      const email = String(body.email ?? "").trim();
      if (!email) return json(400, { error: "email required" });
      const ownerKey = ownerKeyForEmail(email);
      const billingOwner = await resolveBillingOwner(ownerKey);
      const period = currentWritePeriod();
      // Model A: enforcement is the monthly $ cap, not storage byte / activity
      // write ceilings. The sim surfaces the cap state so it mirrors the real
      // owner-state route logic that the DO actually consults.
      const planId = await resolveModelAPlanId(billingOwner);
      const [usage, writes, capState] = await Promise.all([
        getLabPoolUsage(billingOwner),
        getLabPoolWrites(billingOwner, period),
        modelACapState(billingOwner, period, { planId, labCount: 1 }),
      ]);
      return json(200, {
        email,
        billingOwnerIsLab: billingOwner !== ownerKey,
        period,
        planId,
        storageUsedMb: +(usage / MB).toFixed(1),
        writesUsed: writes,
        projectedCents: capState.projectedCents,
        capCents: capState.capCents,
        over: capState.over,
        reason: capState.reason,
        wouldBlock: capState.over,
        enforcementLive: isBillingEnabled(),
      });
    }

    if (action === "reset") {
      const emails = Array.isArray(body.emails) ? body.emails : [];
      const sql = getSql();
      const period = currentWritePeriod();
      for (const e of emails) {
        const key = ownerKeyForEmail(String(e).trim());
        await sql`DELETE FROM collab_doc_sizes WHERE doc_id = ${`sim:${key}`}`;
        await sql`DELETE FROM collab_owner_writes WHERE owner_hash = ${key} AND period = ${period}`;
        await sql`DELETE FROM billing_lab_members WHERE lab_owner_key = ${key} OR member_owner_key = ${key}`;
        await sql`DELETE FROM billing_grants WHERE owner_key = ${key} AND note = 'billing-sim'`;
        await setPlan(key, "free").catch(() => {});
      }
      return json(200, { ok: true, reset: emails.length });
    }

    return json(400, { error: "unknown action" });
  } catch (e) {
    return json(500, { error: "sim failed", detail: String(e) });
  }
}
