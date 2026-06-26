// Operator control to gift BeakerBot AI credit (tokens) to an account, NO Stripe.
//
// POST /api/admin/ai-credit  { email, tokens }  add tokens to the target
//   account's AI balance and return the new balance.
//
// Gift by EMAIL, never by a raw key. The AI ledger is keyed by ownerKeyForEmail,
// the peppered hash of the canonical email, the SAME key /api/billing/ai-status
// and /api/ai/chat derive from the signed-in user's email to read and charge the
// balance. The operator does not know that hash, and any other key (a sharing
// fingerprint, a dept id) would land the credit on a phantom owner so the user
// would still 403. So the route takes the email and computes ownerKeyForEmail
// server-side, which guarantees the gift lands on the exact key the user is
// charged against and their dry-balance 403 actually clears.
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
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";

export const runtime = "nodejs";

async function gate(): Promise<Response | null> {
  const blocked = await requireOperator();
  if (blocked) return blocked;
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const blocked = await gate();
  if (blocked) return blocked;

  let body: { email?: unknown; tokens?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  // A minimal shape check, one @ with text on each side. The hash is computed on
  // the canonical email so case and whitespace do not matter, this guards only
  // against an obviously-empty or non-email value.
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { error: "a valid email is required" });
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

  // Resolve the ledger key from the email. This is the SAME derivation
  // ai-status and ai-chat use, so the gift lands on the key the user is charged
  // against. A null means DIRECTORY_HMAC_PEPPER is missing, a server misconfig,
  // so answer 503 (not a 500) and do not pretend the gift was applied.
  const ownerKey = ownerKeyForEmailSafe(email);
  if (!ownerKey) {
    return json(503, {
      error: "billing is not configured on this server",
    });
  }

  try {
    const balance = await giftTokens(ownerKey, tokens);
    return json(200, { ok: true, email, balance });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "gift failed";
    return json(500, { error: msg });
  }
}
