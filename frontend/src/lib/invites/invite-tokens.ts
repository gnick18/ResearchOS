// Unified org-tree invite tokens (Neon).
//
// ONE invite primitive for every layer of the membership tree:
//   institution -> invites a department admin
//   department  -> invites a lab head
//   lab         -> invites a member        (migration is a later, careful pass)
//
// A token is an opaque, server-issued random string stored here with the layer
// it belongs to, the entity it grants membership in, and an expiry. The server
// is the trust anchor: it mints the token (only for an authenticated admin of
// that entity) and validates + single-use-redeems it on accept. This is the
// CENTRALIZED model the org tiers want, no device key, no client signature, so an
// admin can run their org from any browser. It deliberately replaces the three
// Ed25519 signed-invite copies (lab/dept/institution-invite.ts) with one table.
//
// Why opaque-token-over-signed-link is right here: the org tiers share NO
// encrypted data (org + billing only), so there is nothing for a local signing
// key to protect. The lab tier DOES share data, but its invite LINK is likewise
// only a membership token; the data-key sealing is a separate downstream step, so
// it can adopt this same primitive and keep sealing as a per-layer post-join hook.
//
// The token rides in the URL hash fragment (never sent to the server in a normal
// navigation), so it stays out of logs and the Referer header.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Invite tokens cannot reach Neon.");
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/** The membership-tree layer an invite grants entry to. */
export type InviteLayer = "lab" | "dept" | "institution";

/** Default invite lifetime: 14 days (institutional sign-off can be slow). */
export const DEFAULT_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface InviteRecord {
  token: string;
  layer: InviteLayer;
  entityId: string;
  /** Optional role to grant on join (reserved for member roles; org tiers omit). */
  role: string | null;
  expiresAt: number;
  usedAt: number | null;
}

function isLayer(v: unknown): v is InviteLayer {
  return v === "lab" || v === "dept" || v === "institution";
}

/** Generates an opaque, unguessable invite token (256 bits of entropy, hex). */
export function generateInviteToken(): string {
  return bytesToHex(randomBytes(32));
}

export async function ensureInviteSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS invite_tokens (
      token       text PRIMARY KEY,
      layer       text NOT NULL,
      entity_id   text NOT NULL,
      role        text,
      created_by  text NOT NULL,
      expires_at  timestamptz NOT NULL,
      used_at     timestamptz,
      used_by     text,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
  // Lets an admin list / revoke the live invites they have issued for an entity.
  await sql`
    CREATE INDEX IF NOT EXISTS invite_tokens_entity_idx
      ON invite_tokens (layer, entity_id)
  `;
}

/**
 * Issues a new invite token for an entity. The CALLER must already have
 * authenticated the issuer as an admin of (layer, entityId); this function does
 * not re-check authority, it only mints. Returns the token + its expiry.
 */
export async function issueInvite(params: {
  layer: InviteLayer;
  entityId: string;
  createdBy: string;
  role?: string | null;
  ttlMs?: number;
  /** Test seam for a deterministic token. */
  tokenImpl?: () => string;
}): Promise<{ token: string; expiresAt: number }> {
  const sql = getSql();
  const token = (params.tokenImpl ?? generateInviteToken)();
  const expiresAt = Date.now() + (params.ttlMs ?? DEFAULT_INVITE_TTL_MS);
  await sql`
    INSERT INTO invite_tokens (token, layer, entity_id, role, created_by, expires_at)
    VALUES (
      ${token}, ${params.layer}, ${params.entityId}, ${params.role ?? null},
      ${params.createdBy}, ${new Date(expiresAt).toISOString()}
    )
  `;
  return { token, expiresAt };
}

/**
 * Read-only lookup for the accept screen to DISPLAY what a token grants (the
 * entity it joins, expiry, whether it is spent) BEFORE the recipient signs in.
 * Never mutates. Returns null for an unknown token.
 */
export async function peekInvite(token: string): Promise<InviteRecord | null> {
  if (!token) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT token, layer, entity_id, role, expires_at, used_at
    FROM invite_tokens WHERE token = ${token} LIMIT 1
  `) as Array<{
    token: string;
    layer: string;
    entity_id: string;
    role: string | null;
    expires_at: string;
    used_at: string | null;
  }>;
  const r = rows[0];
  if (!r || !isLayer(r.layer)) return null;
  return {
    token: r.token,
    layer: r.layer,
    entityId: r.entity_id,
    role: r.role,
    expiresAt: new Date(r.expires_at).getTime(),
    usedAt: r.used_at ? new Date(r.used_at).getTime() : null,
  };
}

export type RedeemResult =
  | { ok: true; entityId: string; role: string | null }
  | { ok: false; reason: "not_found" | "wrong_layer" | "expired" | "already_used" };

/**
 * Atomically validates + single-use-redeems a token for the expected layer. The
 * UPDATE itself enforces not-expired + not-used in one statement (no read-then-
 * write race); on a miss we read back once to report a precise reason.
 */
export async function redeemInvite(params: {
  token: string;
  layer: InviteLayer;
  usedBy: string;
}): Promise<RedeemResult> {
  const sql = getSql();
  const claimed = (await sql`
    UPDATE invite_tokens
    SET used_at = now(), used_by = ${params.usedBy}
    WHERE token = ${params.token}
      AND layer = ${params.layer}
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING entity_id, role
  `) as Array<{ entity_id: string; role: string | null }>;
  if (claimed[0]) {
    return { ok: true, entityId: claimed[0].entity_id, role: claimed[0].role };
  }
  // Classify the miss for a useful message.
  const peeked = await peekInvite(params.token);
  if (!peeked) return { ok: false, reason: "not_found" };
  if (peeked.layer !== params.layer) return { ok: false, reason: "wrong_layer" };
  if (peeked.usedAt !== null) return { ok: false, reason: "already_used" };
  return { ok: false, reason: "expired" };
}

/** Human-readable message for a failed redeem, for the accept screen. */
export function redeemErrorMessage(
  reason: Exclude<RedeemResult, { ok: true }>["reason"],
): string {
  switch (reason) {
    case "not_found":
      return "This invite link is not valid.";
    case "wrong_layer":
      return "This invite link is for a different kind of account.";
    case "already_used":
      return "This invite link has already been used. Ask the admin for a fresh one.";
    case "expired":
      return "This invite link has expired. Ask the admin for a fresh one.";
  }
}
