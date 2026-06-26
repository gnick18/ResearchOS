// Operator control to gift BeakerBot AI credit (tokens) to an account, NO Stripe.
//
// POST /api/admin/ai-credit  { ownerKey, tokens }  add tokens to the target
//   account's AI balance and return the new balance.
//
// There is no other way to put AI credit on an existing account: new accounts get
// a one-time sign-up gift, but an operator could not top up an account that ran
// dry (e.g. an account with no token row 403s on /api/ai/chat). This route fills
// that gap with a manual operator comp, mirroring the gift-premium grants route.
//
// Operator-only, gated exactly like /api/admin/grants (requireOperator, an unknown
// caller gets a 404). The gift is a deliberate manual action, so there is no
// Stripe-event idempotency, each post is its own grant. The amount is validated to
// a positive integer and clamped server-side by giftTokens (MAX_GIFT_TOKENS).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { requireOperator } from "@/lib/sharing/operator-access";
import { json } from "@/lib/sharing/directory/guard";
import { giftTokens, MAX_GIFT_TOKENS } from "@/lib/billing/ai-ledger";

export const runtime = "nodejs";

async function gate(): Promise<Response | null> {
  const blocked = await requireOperator();
  if (blocked) return blocked;
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const blocked = await gate();
  if (blocked) return blocked;

  let body: { ownerKey?: unknown; tokens?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }

  const ownerKey =
    typeof body.ownerKey === "string" ? body.ownerKey.trim() : "";
  if (!ownerKey) {
    return json(400, { error: "ownerKey is required" });
  }

  const tokens = Number(body.tokens);
  if (!Number.isInteger(tokens) || tokens <= 0) {
    return json(400, { error: "tokens must be a positive integer" });
  }
  if (tokens > MAX_GIFT_TOKENS) {
    return json(400, {
      error: `tokens must be at most ${MAX_GIFT_TOKENS}`,
    });
  }

  try {
    const balance = await giftTokens(ownerKey, tokens);
    return json(200, { ok: true, balance });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "gift failed";
    return json(500, { error: msg });
  }
}
