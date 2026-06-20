/**
 * ResearchOS notes collaboration relay.
 *
 * One Durable Object instance per collab session (addressed by sessionId), so
 * each room is fully isolated. The DO uses the WebSocket Hibernation API, so it
 * can be evicted between messages while the sockets stay open (Cloudflare
 * rehydrates it on the next event).
 *
 * STORAGE MIGRATION phase 1 (collab -> Durable Object, see
 * docs/proposals/COLLAB_STORAGE_D1_DO_MIGRATION.md): the DO is no longer a blind
 * byte pipe. It is now the canonical store. It persists the Loro document in its
 * own SQLite and serves a catch-up snapshot to every new peer, so a doc
 * converges even when no other peer is online (durable + offline reconcile).
 * This replaces the Neon collab tables + the /api/collab/* Vercel routes (those
 * are removed at the chunk-5 cutover).
 *
 * WIRE PROTOCOL (binary frames; first byte is the type tag):
 *   0x01 MSG_DOC_UPDATE  loro update bytes  -> import + persist, then fan out
 *   0x02 MSG_EPHEMERAL   cursor/awareness   -> fan out only (never persisted)
 * Under the Option B decision, collab updates travel as PLAINTEXT over TLS (no
 * E2E seal), which is what lets the DO read and compact canonical bytes.
 *
 * loro-crdt runs in workerd via the explicit-wasm-module + initSync recipe (the
 * plain `import { LoroDoc } from "loro-crdt"` resolves to the Node build and
 * fails with "Invalid URL string"). Spike confirmed 2026-06-06.
 */

import wasm from "loro-crdt/web/loro_wasm_bg.wasm";
import { initSync, LoroDoc } from "loro-crdt/web/index.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/curves/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

// Synchronous wasm init at module load, before any LoroDoc is constructed.
initSync({ module: wasm });

/** Frame type tags (first byte of every binary message). */
const MSG_DOC_UPDATE = 0x01;
const MSG_EPHEMERAL = 0x02;
/** DO -> client: durable persistence is paused (cost breaker tripped, write
 *  throttle hit, or the doc is at its size cap). Payload is a short ASCII reason
 *  ("paused" | "throttled" | "full"). Live fan-out continues, so collaborators
 *  keep seeing edits; only the durable write is deferred. The client surfaces a
 *  quiet "sync paused" and the edit stays safe in the local Loro doc. */
const MSG_SYNC_BLOCKED = 0x03;

/** How often the DO backs its snapshot up to R2 (disaster-recovery net). */
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;

// ---- Cost-enforcement carry-over (lab-tier launch gate) ---------------------
// The old Vercel /api/collab/push route enforced a cost breaker + write limits
// before persisting; the DO is the canonical store now, so it must enforce them
// itself or lab collab can leak Cloudflare cost (no hard spend cap there). These
// are GLOBAL + per-DOC guards; precise per-owner metering lands with billing.

/** Per-doc durable snapshot ceiling. A single note/experiment doc is KB-MB; a
 *  snapshot past this is not persisted (live fan-out still happens), so one doc
 *  cannot grow DO storage without bound. Tunable. */
const MAX_DOC_BYTES = 8 * 1024 * 1024;
/** Per-doc write throttle (token bucket): sustained persists/sec and the burst
 *  ceiling. Normal editing is a few/sec; this bounds a runaway single doc. The
 *  global breaker is the aggregate backstop. */
const WRITE_RATE_PER_SEC = 10;
const WRITE_BURST = 40;
/** How long the DO caches the breaker pause state between reads (fail-open). */
const BREAKER_TTL_MS = 60 * 1000;
/** How long the DO caches the per-owner over-cap state. Usage only changes on
 *  the ~5 min backup tally, and the endpoint is dormant until BILLING_ENABLED,
 *  so a minute of staleness is harmless and fail-open. */
const OWNER_CAP_TTL_MS = 60 * 1000;
/** Debounce on the MSG_SYNC_BLOCKED signal so a paused doc does not spam the
 *  client on every keystroke. */
const BLOCK_SIGNAL_DEBOUNCE_MS = 5 * 1000;

/**
 * Hard cap on a single inbound WebSocket frame (2 MB). A real collab update or
 * an ephemeral cursor frame is kilobytes; a multi-MB frame is malformed or
 * hostile. A peer on an open pre-grant doc is unauthenticated, so without this
 * a single huge frame would be imported + snapshotted and could pressure the DO
 * isolate. Oversize frames close the socket with 1009 (message too big).
 */
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/**
 * Server-side caps on recipient-inbox / capture metadata strings. The client
 * calls /inbox/push and /capture/upload directly, bypassing any caller-side
 * limit (e.g. the notify-invite route's 300-char title cap), so the relay
 * enforces these itself before persisting.
 */
const MAX_TITLE_LEN = 300;
const MAX_EMAIL_LEN = 254;
const MAX_NAME_LEN = 100;
const MAX_CAPTION_LEN = 300;

/** Truncate to a max length, returning null for any non-string value. */
function capStr(v: unknown, max: number): string | null {
  return typeof v === "string" ? v.slice(0, max) : null;
}

/** Max length of a stored cosmetic lab-branding string (name / title / display
 *  name). Generous enough for a real lab name, bounded so a hand-crafted request
 *  cannot stuff the DO meta table. */
const LAB_BRAND_MAX_LEN = 200;

/** Max lab-logo size in bytes (512 KB). A logo is a small mark, not an asset
 *  library, so this is plenty while keeping the R2 object cheap to stream on
 *  every member screen. */
const LAB_LOGO_MAX_BYTES = 512 * 1024;

/** The image content-types a lab logo may use. */
const LAB_LOGO_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export interface Env {
  COLLAB_ROOM: DurableObjectNamespace;
  /** R2 bucket for periodic per-doc snapshot backups (disaster recovery). */
  COLLAB_BACKUPS: R2Bucket;
  /** Per-recipient inbox (external-collab chunk 3), addressed by emailHash. */
  RECIPIENT_INBOX: DurableObjectNamespace;
  /** Per-user capture inbox (mobile capture relay, piece A), addressed by the
   *  user's identity pubkey hex. Holds device bindings + the pending capture
   *  index in SQLite. */
  CAPTURE_INBOX: DurableObjectNamespace;
  /** R2 bucket for transient bench-capture blobs. Deleted on ack (the laptop
   *  pulls them into the data folder, then the relay drops them). */
  CAPTURES: R2Bucket;
  /** Per-lab record store (lab tier Phase 2), addressed by labId. Holds the
   *  head pubkey (set on create), the head-signed hash-chained membership log,
   *  and the per-generation sealed lab-key envelopes. It NEVER receives the lab
   *  key in plaintext, only sealed copies + signed public metadata. Dormant
   *  behind LAB_TIER_ENABLED on the client; the DO + binding ship inert. */
  LAB_RECORD: DurableObjectNamespace;
  /** R2 bucket for server-blind lab data (lab tier Phase 3). Stores opaque
   *  lab-key ciphertext; the relay never decrypts or holds the lab key. Keyed
   *  `${labId}/${owner}/${recordType}/${recordId}`. Dormant until the client
   *  calls the /lab/data/* routes. */
  LAB_DATA: R2Bucket;
  /** Base URL of the Vercel app (e.g. https://research-os-xi.vercel.app). The
   *  collab DO fetches `${APP_BASE_URL}/api/billing/breaker-state` to learn if
   *  the cost breaker has paused cloud writes. Unset (local dev) = fail open
   *  (never paused), so collab works with no config. */
  APP_BASE_URL?: string;
  /** Optional shared secret sent as a Bearer token when reading the breaker
   *  state, matching RELAY_BREAKER_SECRET on the Vercel side. Unset = the
   *  endpoint is read without auth (dev). */
  RELAY_BREAKER_SECRET?: string;
  /** Reverse membership index for lab-membership discovery. Key = hex Ed25519
   *  pubkey of a member; value = JSON string[] of labIds. Written best-effort
   *  on /lab/create (head pubkey) and /lab/append "add" entries (new member
   *  pubkey). Read by POST /lab/discover-memberships. Optional so local dev
   *  without a KV binding degrades gracefully (discovery returns []). */
  LAB_MEMBERSHIP_INDEX?: KVNamespace;
  /** Test-only overrides (ms) for the phone-push timing gates, so the smoke
   *  harness need not wait the real 30s cooldown / 3-min dead-man's-switch.
   *  Unset in prod (the constants apply). Set via
   *  `wrangler dev --var NOTIFY_COOLDOWN_MS:0 --var REMINDER_STALE_MS:0`. */
  NOTIFY_COOLDOWN_MS?: string;
  REMINDER_STALE_MS?: string;
}

/**
 * Permissive CORS (`*`) on every route. This is a deliberate, accepted posture,
 * not an oversight:
 *   - Write routes (/inbox/*, /capture/*, /lab/*, /access/*) authenticate with
 *     Ed25519 signatures over a canonical message plus a replay window. Origin
 *     is not part of that trust model, so allowing any origin grants no write
 *     capability a forged Origin header would not already grant.
 *   - The open-doc /snapshot read is capability-gated by the unguessable session
 *     id and returns only that one doc's bytes. It is therefore probe-able from
 *     any origin by anyone who already holds the session id, which is the same
 *     party allowed to read it.
 * If we ever want to additionally lock reads to the known frontend origin(s),
 * thread an ALLOWED_ORIGIN wrangler var through here; until then `*` is correct
 * for a relay whose security rests on signatures and capabilities, not origins.
 */
const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session");

    // Live transport: WebSocket fan-out + persistence.
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("This endpoint requires a WebSocket upgrade", {
          status: 426,
          headers: { Upgrade: "websocket" },
        });
      }
      if (!sessionId || sessionId.trim() === "") {
        return new Response("Missing required query parameter: session", {
          status: 400,
        });
      }
      const stub = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(sessionId));
      return stub.fetch(request);
    }

    // Canonical snapshot read (storage-migration phase 1 chunk 5). The client
    // adopts this as its base for a collab doc instead of reading Neon, which
    // is the fork-fix source of truth (Option B server-canonical), now served
    // by the DO. GET only; the session id is the capability.
    if (url.pathname === "/snapshot") {
      if (!sessionId || sessionId.trim() === "") {
        return new Response("Missing required query parameter: session", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const stub = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(sessionId));
      return stub.fetch(request);
    }

    // Access control (storage-migration chunk 3). Owner-signed membership
    // mutations. A doc stays OPEN until its first /grant, which flips it to
    // ENFORCED (see CollabRoom). POST only; the owner signature is the
    // capability. Forwarded to the per-session DO that owns the member table.
    // /members (external-collab chunk 5) is an owner-signed READ of the current
    // member list, so the owner's revoke UI can list who has access. It is a POST
    // (it carries the owner signature in the body, like /grant and /revoke), but
    // it never mutates. Routed to the same per-session DO.
    if (
      url.pathname === "/grant" ||
      url.pathname === "/revoke" ||
      url.pathname === "/members"
    ) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: CORS_HEADERS,
        });
      }
      if (!sessionId || sessionId.trim() === "") {
        return new Response("Missing required query parameter: session", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const stub = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(sessionId));
      return stub.fetch(request);
    }

    // Per-recipient inbox (external-collab chunk 3). Discovery channel for a
    // live-collab grant. Addressed by the recipient's emailHash, so it is
    // independent of any one collab session. /inbox/push is the sender writing
    // an invite (anyone may send, like email); /inbox/list and /inbox/dismiss
    // are recipient-signed reads/deletes. POST only; the inbox DO does its own
    // signature + TOFU checks. NOTHING here materializes a local copy; this only
    // surfaces pending invites (accept + materialize is chunk 4).
    if (
      url.pathname === "/inbox/push" ||
      url.pathname === "/inbox/list" ||
      url.pathname === "/inbox/dismiss"
    ) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: CORS_HEADERS,
        });
      }
      // /inbox/push is addressed by ?to=<emailHash>, the recipient routes by
      // ?owner=<emailHash>. Both name the same per-recipient DO.
      const inboxKey =
        url.pathname === "/inbox/push"
          ? url.searchParams.get("to")
          : url.searchParams.get("owner");
      if (!inboxKey || inboxKey.trim() === "") {
        return new Response("Missing required query parameter", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const stub = env.RECIPIENT_INBOX.get(
        env.RECIPIENT_INBOX.idFromName(inboxKey),
      );
      return stub.fetch(request);
    }

    // Server-blind lab data store (lab tier Phase 3). Stores and returns opaque
    // lab-key ciphertext; the relay never decrypts or holds the lab key. Writes
    // and lists are Ed25519-signed and re-verified against the lab roster fetched
    // from the LabRecordDO via the real /lab/get route. GET /lab/data/get is
    // open at the transport (the blob is useless without the lab key). ADDITIVE
    // and dormant (client gate is LAB_TIER_ENABLED). Dispatched BEFORE the
    // /lab/create|append|get block so it matches first.
    // CORS preflight for ALL cross-origin /lab/* requests (the JSON Content-Type
    // on the lab-record POSTs + the lab-data GETs make these non-simple). MUST
    // run BEFORE the method-specific /lab blocks below, which 405 a non-POST and
    // would otherwise turn the preflight into a 405 that the browser rejects.
    if (request.method === "OPTIONS" && url.pathname.startsWith("/lab/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (url.pathname.startsWith("/lab/data/")) {
      return handleLabData(url, request, env);
    }

    // Lab membership discovery. POST /lab/discover-memberships?pubkey=<hex>.
    // The client (lab-membership-discovery.ts) signs a canonical message and
    // sends { issuedAt, signature } in the body. On valid signature, returns
    // { labIds: string[] } from the KV reverse index. If the KV binding is not
    // deployed yet (local dev), returns { labIds: [] } so the client degrades
    // gracefully (the client also handles 404 as []).
    if (url.pathname === "/lab/discover-memberships") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: CORS_HEADERS,
        });
      }
      return handleLabDiscoverMemberships(url, request, env);
    }

    // Lab identity + branding (cosmetic). The lab logo route accepts BOTH a
    // head-signed POST (upload) and an OPEN GET (stream the bytes), so it is
    // routed to the LabRecordDO here, ahead of the POST-only /lab/* block below.
    // The branding is cosmetic (it never gates access), the GET is public by
    // design (it is shown to a not-yet-member on the invite page), and the POST
    // is head-signed inside the DO. Mirrors how /lab/create resolves the DO by
    // ?lab=<labId>.
    if (url.pathname === "/lab/logo") {
      if (request.method !== "GET" && request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: CORS_HEADERS,
        });
      }
      const labId = url.searchParams.get("lab");
      if (!labId || labId.trim() === "") {
        return new Response("Missing required query parameter: lab", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const stub = env.LAB_RECORD.get(env.LAB_RECORD.idFromName(labId));
      return stub.fetch(request);
    }

    // Per-lab record store (lab tier Phase 2). The authoritative server-side home
    // of a lab: the head pubkey, the head-signed hash-chained membership log, and
    // the per-generation sealed lab-key envelopes. Addressed by ?lab=<labId>, so
    // each lab has its own LabRecordDO independent of any collab session. The DO
    // verifies the head's Ed25519 signature ON THE LOG ENTRIES (not a separate
    // request signature) and re-runs the chain checks before appending. It is
    // BLIND to the lab key, it only ever stores sealed copies + signed public
    // metadata. POST only; the DO does its own verification. This is ADDITIVE and
    // dormant (the client gate is LAB_TIER_ENABLED); nothing in the live app calls
    // it yet. Mirrors how /inbox/* resolves RECIPIENT_INBOX by emailHash.
    if (
      url.pathname === "/lab/create" ||
      url.pathname === "/lab/append" ||
      url.pathname === "/lab/get" ||
      url.pathname === "/lab/resync" ||
      url.pathname === "/lab/accept" ||
      url.pathname === "/lab/accept/list" ||
      url.pathname === "/lab/accept/dismiss" ||
      url.pathname === "/lab/profile" ||
      url.pathname === "/lab/profile/get"
    ) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: CORS_HEADERS,
        });
      }
      const labId = url.searchParams.get("lab");
      if (!labId || labId.trim() === "") {
        return new Response("Missing required query parameter: lab", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const stub = env.LAB_RECORD.get(env.LAB_RECORD.idFromName(labId));
      return stub.fetch(request);
    }

    // CORS preflight for the cross-origin capture POSTs/GETs from the app (the
    // JSON body / custom handling makes these non-simple requests). Handled
    // before the dispatch below so an OPTIONS never tries to parse a body.
    if (request.method === "OPTIONS" && url.pathname.startsWith("/capture/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Mobile capture relay (piece A). Accountless, pubkey-keyed transient relay.
    // Every /capture/* route is addressed by the user identity pubkey hex (the
    // ?u query param, or meta.u on the multipart upload), so each user has their
    // own CaptureInbox DO. The DO does its own Ed25519 signature + replay checks;
    // an attacker can only ever touch a bucket under their own pubkey. Blobs live
    // in the CAPTURES R2 bucket until the laptop acks them.
    if (url.pathname.startsWith("/capture/")) {
      // The upload is multipart/form-data with u inside the `meta` JSON field, so
      // it cannot be read from the query string. Every other capture route
      // carries u in the query (?u=). The DO is named by u in both cases; the
      // upload handler re-reads u from the parsed meta and the worker forwards by
      // a header so the DO is addressed consistently.
      let userPubkey = url.searchParams.get("u");
      if (
        url.pathname === "/capture/upload" ||
        url.pathname === "/capture/snapshot/publish"
      ) {
        // Clone so the DO can still read the multipart body. We only need the u
        // routing key here; pull it from a lightweight form parse. Both the
        // capture upload and the snapshot publish are multipart with u in meta.
        try {
          const form = await request.clone().formData();
          const metaRaw = form.get("meta");
          if (typeof metaRaw === "string") {
            const meta = JSON.parse(metaRaw) as { u?: unknown };
            if (typeof meta.u === "string") userPubkey = meta.u;
          }
        } catch {
          // Fall through to the missing-u guard below.
        }
      }
      if (!userPubkey || userPubkey.trim() === "") {
        return new Response("Missing required parameter: u", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const stub = env.CAPTURE_INBOX.get(
        env.CAPTURE_INBOX.idFromName(userPubkey),
      );
      return stub.fetch(request);
    }

    // CORS preflight for the cross-origin inbox + access-control POSTs from the
    // app (the JSON Content-Type header makes these non-simple requests, so the
    // browser sends an OPTIONS preflight first).
    if (
      request.method === "OPTIONS" &&
      (url.pathname.startsWith("/inbox/") ||
        url.pathname === "/grant" ||
        url.pathname === "/revoke" ||
        url.pathname === "/members")
    ) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

export class CollabRoom {
  readonly state: DurableObjectState;
  readonly env: Env;
  /** In-memory canonical doc, lazily loaded from SQLite (survives across
   *  messages until the DO is evicted, then reloaded on the next use). */
  private doc: LoroDoc | null = null;
  /** Whether a snapshot has ever been stored for this room (so a brand-new
   *  empty room does not send a pointless catch-up frame). */
  private hasStored = false;

  // ---- cost-enforcement state (launch gate) ----
  /** Cached cost-breaker pause state, refreshed async + fail-open. */
  private breakerCache: { paused: boolean; exp: number } | null = null;
  private breakerRefreshing = false;
  /** Cached per-owner over-cap state for this doc's owner, refreshed async +
   *  fail-open. reason says whether storage ("quota") or activity ("activity")
   *  is over. Dormant unless BILLING_ENABLED (the endpoint returns over:false). */
  private ownerCapCache: {
    over: boolean;
    reason: "quota" | "activity" | null;
    exp: number;
  } | null = null;
  private ownerCapRefreshing = false;
  /** Durable writes applied since the last activity report to Vercel. Reported +
   *  decremented on the backup alarm (per-owner ACTIVITY tally). In-memory per DO
   *  instance; an eviction loses at most the unreported tail, acceptable for a
   *  metering counter that fails toward under-counting (customer-friendly). */
  private writesSinceReport = 0;
  /** Per-doc write throttle (token bucket). In-memory per DO instance; resets on
   *  eviction, which is lenient and acceptable for a rate guard. */
  private writeTokens = WRITE_BURST;
  private lastRefill = Date.now();
  /** Last time we signalled the client that persistence is blocked (debounce). */
  private lastBlockSignal = 0;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // One row holds the compacted snapshot. BLOB (SQLite) avoids the 128 KiB
    // per-value cap of the DO key-value storage API.
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS doc (k TEXT PRIMARY KEY, snapshot BLOB)",
    );
    // Tracks whether there are un-backed-up changes since the last R2 backup.
    // The meta table also holds the access-control flags (chunk 3): 'enforced'
    // ('0'/'1', absent = open) and 'owner_pubkey' (hex, set on the first grant
    // = trust-on-first-use).
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)",
    );
    // Access control (chunk 3): authorized members of an ENFORCED doc. email is
    // the lowercased canonical directory email, pubkey is the hex Ed25519
    // signing key the member's connect token is verified against.
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS members (email TEXT PRIMARY KEY, pubkey TEXT NOT NULL, role TEXT, added_at INTEGER, added_by TEXT)",
    );
  }

  private sql(): SqlStorage {
    return this.state.storage.sql;
  }

  // ---- Access control (chunk 3) ----------------------------------------

  /** Reads a single meta value, or null when the key is absent. */
  private metaGet(key: string): string | null {
    const rows = this.sql()
      .exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", key)
      .toArray();
    return rows.length > 0 ? rows[0].v : null;
  }

  private metaSet(key: string, value: string): void {
    this.sql().exec(
      "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      key,
      value,
    );
  }

  /** True once this doc has received its first grant (in-lab path stays OPEN
   *  until then, the critical safety property). */
  private isEnforced(): boolean {
    return this.metaGet("enforced") === "1";
  }

  /** Looks up a member's stored hex Ed25519 pubkey, or null if not a member. */
  private memberPubkey(email: string): string | null {
    const rows = this.sql()
      .exec<{ pubkey: string }>(
        "SELECT pubkey FROM members WHERE email = ?",
        email.toLowerCase(),
      )
      .toArray();
    return rows.length > 0 ? rows[0].pubkey : null;
  }

  /** Verifies a hex Ed25519 signature over a UTF-8 message under a hex pubkey.
   *  Pure JS (@noble/curves), so it runs in workerd. Any malformed input is a
   *  verification failure, never a throw. */
  private verifySig(sigHex: string, message: string, pubkeyHex: string): boolean {
    try {
      const sig = hexToBytes(sigHex);
      const pub = hexToBytes(pubkeyHex);
      const msg = new TextEncoder().encode(message);
      return ed25519.verify(sig, msg, pub);
    } catch {
      return false;
    }
  }

  /** A timestamp is fresh when it is within +/- 5 minutes of now (replay
   *  guard). Non-finite input is stale. */
  private isFresh(ts: number): boolean {
    if (typeof ts !== "number" || !Number.isFinite(ts)) return false;
    return Math.abs(Date.now() - ts) <= 5 * 60 * 1000;
  }

  private json(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  /** POST /grant. Owner-signed; the first grant flips the doc to ENFORCED and
   *  records the owner plus the backfilled members (trust-on-first-use). */
  private async handleGrant(sessionId: string, request: Request): Promise<Response> {
    let body: {
      owner?: { email?: string; pubkey?: string };
      members?: Array<{ email?: string; pubkey?: string; role?: string }>;
      issuedAt?: number;
      signature?: string;
    };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const owner = body.owner;
    const members = body.members;
    const issuedAt = body.issuedAt;
    const signature = body.signature;
    if (
      !owner ||
      typeof owner.email !== "string" ||
      typeof owner.pubkey !== "string" ||
      !Array.isArray(members) ||
      typeof issuedAt !== "number" ||
      typeof signature !== "string"
    ) {
      return this.json({ error: "malformed grant" }, 400);
    }

    if (!this.isFresh(issuedAt)) {
      return this.json({ error: "stale issuedAt" }, 401);
    }

    // Canonical message MUST be built from the request's members verbatim so it
    // matches what the owner signed.
    const message = `grant\n${sessionId}\n${owner.email}\n${issuedAt}\n${JSON.stringify(members)}`;
    if (!this.verifySig(signature, message, owner.pubkey)) {
      return this.json({ error: "bad signature" }, 401);
    }

    // Validate every member entry BEFORE any write, so a malformed payload can
    // never leave the doc half-enforced (owner recorded + flag flipped but
    // members rejected). A bad request mutates nothing.
    for (const m of members) {
      if (typeof m.email !== "string" || typeof m.pubkey !== "string") {
        return this.json({ error: "malformed member entry" }, 400);
      }
    }

    // TOFU owner check. First grant establishes the owner; later grants must
    // come from the established owner key.
    const storedOwner = this.metaGet("owner_pubkey");
    if (storedOwner === null) {
      this.metaSet("owner_pubkey", owner.pubkey);
      this.metaSet("enforced", "1");
      const now = Date.now();
      this.sql().exec(
        "INSERT INTO members (email, pubkey, role, added_at, added_by) VALUES (?, ?, 'owner', ?, ?) ON CONFLICT(email) DO UPDATE SET pubkey = excluded.pubkey, role = 'owner', added_at = excluded.added_at, added_by = excluded.added_by",
        owner.email.toLowerCase(),
        owner.pubkey,
        now,
        owner.email,
      );
    } else if (storedOwner !== owner.pubkey) {
      return this.json({ error: "not the established owner" }, 403);
    }

    const now = Date.now();
    for (const m of members) {
      if (typeof m.email !== "string" || typeof m.pubkey !== "string") {
        return this.json({ error: "malformed member entry" }, 400);
      }
      this.sql().exec(
        "INSERT INTO members (email, pubkey, role, added_at, added_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET pubkey = excluded.pubkey, role = excluded.role, added_at = excluded.added_at, added_by = excluded.added_by",
        m.email.toLowerCase(),
        m.pubkey,
        m.role ?? null,
        now,
        owner.email,
      );
    }

    return this.json({ ok: true }, 200);
  }

  /** POST /revoke. Owner-signed; deletes a member. The doc stays ENFORCED. */
  private async handleRevoke(sessionId: string, request: Request): Promise<Response> {
    let body: {
      owner?: { email?: string; pubkey?: string };
      email?: string;
      issuedAt?: number;
      signature?: string;
    };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const owner = body.owner;
    const email = body.email;
    const issuedAt = body.issuedAt;
    const signature = body.signature;
    if (
      !owner ||
      typeof owner.email !== "string" ||
      typeof owner.pubkey !== "string" ||
      typeof email !== "string" ||
      typeof issuedAt !== "number" ||
      typeof signature !== "string"
    ) {
      return this.json({ error: "malformed revoke" }, 400);
    }

    if (!this.isFresh(issuedAt)) {
      return this.json({ error: "stale issuedAt" }, 401);
    }

    // Revoke requires an established owner; an open (never-granted) doc has no
    // owner to authorize a revoke.
    const storedOwner = this.metaGet("owner_pubkey");
    if (storedOwner === null || storedOwner !== owner.pubkey) {
      return this.json({ error: "not the established owner" }, 403);
    }

    const message = `revoke\n${sessionId}\n${owner.email}\n${issuedAt}\n${email}`;
    if (!this.verifySig(signature, message, owner.pubkey)) {
      return this.json({ error: "bad signature" }, 401);
    }

    this.sql().exec("DELETE FROM members WHERE email = ?", email.toLowerCase());
    return this.json({ ok: true }, 200);
  }

  /** POST /members (external-collab chunk 5). Owner-signed READ of the current
   *  member list, so the owner's revoke UI can list who has access. Never
   *  mutates. The owner signs revoke\nmembers\n${sessionId}\n${ownerEmail}\n${issuedAt}
   *  (a distinct verb so a /members signature can never be replayed against
   *  /grant or /revoke). Only the established owner may read the list. */
  private async handleMembers(sessionId: string, request: Request): Promise<Response> {
    let body: {
      owner?: { email?: string; pubkey?: string };
      issuedAt?: number;
      signature?: string;
    };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const owner = body.owner;
    const issuedAt = body.issuedAt;
    const signature = body.signature;
    if (
      !owner ||
      typeof owner.email !== "string" ||
      typeof owner.pubkey !== "string" ||
      typeof issuedAt !== "number" ||
      typeof signature !== "string"
    ) {
      return this.json({ error: "malformed members request" }, 400);
    }

    if (!this.isFresh(issuedAt)) {
      return this.json({ error: "stale issuedAt" }, 401);
    }

    // Listing members requires an established owner; an open (never-granted) doc
    // has no member table to read and no owner to authorize the read.
    const storedOwner = this.metaGet("owner_pubkey");
    if (storedOwner === null || storedOwner !== owner.pubkey) {
      return this.json({ error: "not the established owner" }, 403);
    }

    const message = `members\n${sessionId}\n${owner.email}\n${issuedAt}`;
    if (!this.verifySig(signature, message, owner.pubkey)) {
      return this.json({ error: "bad signature" }, 401);
    }

    const rows = this.sql()
      .exec<{
        email: string;
        pubkey: string;
        role: string | null;
        added_at: number | null;
        added_by: string | null;
      }>(
        "SELECT email, pubkey, role, added_at, added_by FROM members ORDER BY added_at ASC",
      )
      .toArray();

    const members = rows.map((r) => ({
      email: r.email,
      pubkey: r.pubkey,
      role: r.role,
      addedAt: r.added_at,
      addedBy: r.added_by,
    }));

    return this.json({ members }, 200);
  }

  /** Connect-time gate for /ws and /snapshot. Returns null when the connection
   *  is allowed (open doc, or a valid member token on an enforced doc), or a
   *  401 Response to reject. */
  private connectGate(sessionId: string, url: URL): Response | null {
    if (!this.isEnforced()) return null; // open doc: in-lab path unchanged.

    const authEmail = url.searchParams.get("authEmail");
    const authTs = url.searchParams.get("authTs");
    const authSig = url.searchParams.get("authSig");
    if (!authEmail || !authTs || !authSig) {
      return this.json({ error: "auth required" }, 401);
    }
    const ts = Number(authTs);
    if (!this.isFresh(ts)) {
      return this.json({ error: "stale authTs" }, 401);
    }
    const pubkey = this.memberPubkey(authEmail);
    if (pubkey === null) {
      return this.json({ error: "not a member" }, 401);
    }
    const message = `connect\n${sessionId}\n${authEmail}\n${authTs}`;
    if (!this.verifySig(authSig, message, pubkey)) {
      return this.json({ error: "bad auth signature" }, 401);
    }
    return null;
  }

  /** Loads (once) the canonical doc from SQLite into memory. */
  private ensureDoc(): LoroDoc {
    if (this.doc) return this.doc;
    const d = new LoroDoc();
    const rows = this.sql()
      .exec<{ snapshot: ArrayBuffer | null }>("SELECT snapshot FROM doc WHERE k = 'doc'")
      .toArray();
    const stored = rows.length > 0 ? rows[0].snapshot : null;
    if (stored) {
      const bytes = new Uint8Array(stored);
      if (bytes.byteLength > 0) {
        try {
          d.import(bytes);
          this.hasStored = true;
        } catch {
          // Corrupt snapshot: start clean rather than wedge the room. The next
          // update re-seeds storage.
        }
      }
    }
    this.doc = d;
    return d;
  }

  // ---- cost enforcement (launch gate) ----------------------------------

  /**
   * Whether the cost breaker has paused cloud writes. Reads a per-instance cache
   * synchronously (so the hot path never awaits) and kicks an async refresh when
   * the cache is stale. Fails OPEN: with no cache yet, or no APP_BASE_URL, or a
   * fetch error, this returns false (not paused) so collab is never wedged by a
   * billing-side hiccup. The breaker is a backstop, not a correctness gate.
   */
  private isCloudPausedCached(): boolean {
    const now = Date.now();
    if (!this.breakerCache || this.breakerCache.exp <= now) {
      void this.refreshBreaker();
      if (!this.breakerCache) return false; // first read, fail open
    }
    return this.breakerCache.paused;
  }

  private async refreshBreaker(): Promise<void> {
    if (this.breakerRefreshing) return;
    this.breakerRefreshing = true;
    let paused = false;
    const base = this.env.APP_BASE_URL;
    if (base) {
      try {
        const headers: Record<string, string> = {};
        if (this.env.RELAY_BREAKER_SECRET) {
          headers.authorization = `Bearer ${this.env.RELAY_BREAKER_SECRET}`;
        }
        const res = await fetch(`${base}/api/billing/breaker-state`, {
          headers,
        });
        if (res.ok) {
          const j = (await res.json()) as { paused?: boolean };
          paused = !!j.paused;
        }
      } catch {
        paused = false; // fail open
      }
    }
    this.breakerCache = { paused, exp: Date.now() + BREAKER_TTL_MS };
    this.breakerRefreshing = false;
  }

  /**
   * Whether this doc's owner is over their STORAGE cap or monthly ACTIVITY
   * allowance, and which. Per-instance cache read synchronously (hot path never
   * awaits) with an async refresh when stale. Fails OPEN: no owner_pubkey yet (an
   * open in-lab doc with no grant has no billable owner), no cache, no
   * APP_BASE_URL, or a fetch error all read as not-over. The endpoint is itself
   * dormant unless BILLING_ENABLED, so this whole layer is inert until launch.
   */
  private ownerBlockReason(): "quota" | "activity" | null {
    // No grant yet means no billable owner; never enforce a cap.
    if (!this.metaGet("owner_pubkey")) return null;
    const now = Date.now();
    if (!this.ownerCapCache || this.ownerCapCache.exp <= now) {
      void this.refreshOwnerCap();
      if (!this.ownerCapCache) return null; // first read, fail open
    }
    return this.ownerCapCache.over ? this.ownerCapCache.reason : null;
  }

  private async refreshOwnerCap(): Promise<void> {
    if (this.ownerCapRefreshing) return;
    this.ownerCapRefreshing = true;
    let over = false;
    let reason: "quota" | "activity" | null = null;
    const base = this.env.APP_BASE_URL;
    const ownerPubkey = this.metaGet("owner_pubkey");
    if (base && ownerPubkey) {
      try {
        const headers: Record<string, string> = {};
        if (this.env.RELAY_BREAKER_SECRET) {
          headers.authorization = `Bearer ${this.env.RELAY_BREAKER_SECRET}`;
        }
        const res = await fetch(
          `${base}/api/billing/owner-state?ownerPubkey=${encodeURIComponent(ownerPubkey)}`,
          { headers },
        );
        if (res.ok) {
          const j = (await res.json()) as {
            over?: boolean;
            reason?: "quota" | "activity" | null;
          };
          over = !!j.over;
          reason = over ? (j.reason ?? "quota") : null;
        }
      } catch {
        over = false; // fail open
      }
    }
    this.ownerCapCache = { over, reason, exp: Date.now() + OWNER_CAP_TTL_MS };
    this.ownerCapRefreshing = false;
  }

  /** Per-doc write-rate token bucket. Returns false when over the rate. */
  private allowWriteRate(): boolean {
    const now = Date.now();
    const refill = ((now - this.lastRefill) / 1000) * WRITE_RATE_PER_SEC;
    this.writeTokens = Math.min(WRITE_BURST, this.writeTokens + refill);
    this.lastRefill = now;
    if (this.writeTokens >= 1) {
      this.writeTokens -= 1;
      return true;
    }
    return false;
  }

  /** Reason this write must not be durably persisted, or null when it may. */
  private writeBlockReason(): "paused" | "quota" | "activity" | "throttled" | null {
    if (this.isCloudPausedCached()) return "paused";
    const owner = this.ownerBlockReason();
    if (owner) return owner; // "quota" (storage) or "activity" (monthly writes)
    if (!this.allowWriteRate()) return "throttled";
    return null;
  }

  /** Tell the sender that durable persistence is paused (debounced). */
  private signalBlocked(ws: WebSocket, reason: string): void {
    const now = Date.now();
    if (now - this.lastBlockSignal < BLOCK_SIGNAL_DEBOUNCE_MS) return;
    this.lastBlockSignal = now;
    try {
      const body = new TextEncoder().encode(reason);
      const f = new Uint8Array(1 + body.byteLength);
      f[0] = MSG_SYNC_BLOCKED;
      f.set(body, 1);
      ws.send(f);
    } catch {
      // Socket gone; nothing to do.
    }
  }

  /**
   * Imports an incoming update into the canonical doc and re-persists. Returns
   * false WITHOUT persisting when the resulting snapshot would exceed the per-doc
   * cap (the import still applied to the in-memory doc for live fan-out, but the
   * durable store stays at the last under-cap snapshot, so storage cannot grow
   * without bound). Returns true on a successful persist or a malformed update.
   */
  private persistUpdate(update: Uint8Array): boolean {
    const d = this.ensureDoc();
    try {
      d.import(update);
    } catch {
      // Malformed update: skip persistence. Live fan-out still happens so a
      // transient bad frame never blocks the session.
      return true;
    }
    const snapshot = d.export({ mode: "snapshot" });
    if (snapshot.byteLength > MAX_DOC_BYTES) {
      // Doc is at its ceiling. Do not persist the over-cap snapshot.
      return false;
    }
    this.sql().exec(
      "INSERT INTO doc (k, snapshot) VALUES ('doc', ?) ON CONFLICT(k) DO UPDATE SET snapshot = excluded.snapshot",
      snapshot,
    );
    this.hasStored = true;
    // Count this durable write toward the per-owner monthly activity tally,
    // reported to Vercel on the backup alarm. Activity (compute) is the real
    // cost driver, so this is what the activity throttle meters against.
    this.writesSinceReport += 1;
    this.markDirtyAndArm();
    return true;
  }

  /**
   * Flag the room as having un-backed-up changes and ensure a backup alarm is
   * scheduled. The SQLite snapshot is the primary durable store; R2 is a
   * disaster-recovery copy taken on a throttled cadence.
   */
  private markDirtyAndArm(): void {
    this.sql().exec(
      "INSERT INTO meta (k, v) VALUES ('dirty', '1') ON CONFLICT(k) DO UPDATE SET v = '1'",
    );
    void this.armBackupAlarm();
  }

  private async armBackupAlarm(): Promise<void> {
    try {
      if ((await this.state.storage.getAlarm()) === null) {
        await this.state.storage.setAlarm(Date.now() + BACKUP_INTERVAL_MS);
      }
    } catch {
      // Alarm scheduling is best-effort; a failure just delays a backup.
    }
  }

  private backupKey(): string {
    const rows = this.sql()
      .exec<{ v: string }>("SELECT v FROM meta WHERE k = 'session_id'")
      .toArray();
    const sid = rows.length > 0 ? rows[0].v : this.state.id.toString();
    return `snapshots/${sid}.loro`;
  }

  /**
   * Periodic disaster-recovery backup. Writes the current snapshot to R2 when
   * the room is dirty, clears the flag, and schedules one more tick to batch
   * imminent writes; if still clean on the next tick it returns early and the
   * alarm goes idle (a new write re-arms it).
   *
   * Also reports the current snapshot byteLength to Vercel so the per-owner
   * billing tally (collab_doc_sizes) stays current. Best-effort, fail-silent:
   * a metering failure never blocks the backup path.
   */
  async alarm(): Promise<void> {
    const dirtyRows = this.sql()
      .exec<{ v: string }>("SELECT v FROM meta WHERE k = 'dirty'")
      .toArray();
    const dirty = dirtyRows.length > 0 && dirtyRows[0].v === "1";
    if (!dirty) return; // no activity since last backup -> let the alarm go idle

    const rows = this.sql()
      .exec<{ snapshot: ArrayBuffer | null }>("SELECT snapshot FROM doc WHERE k = 'doc'")
      .toArray();
    const stored = rows.length > 0 ? rows[0].snapshot : null;
    if (stored && stored.byteLength > 0) {
      try {
        await this.env.COLLAB_BACKUPS.put(this.backupKey(), stored);
      } catch {
        // R2 write failed; leave dirty set and retry on the next tick.
        await this.state.storage.setAlarm(Date.now() + BACKUP_INTERVAL_MS);
        return;
      }
    }
    this.sql().exec("UPDATE meta SET v = '0' WHERE k = 'dirty'");
    await this.state.storage.setAlarm(Date.now() + BACKUP_INTERVAL_MS);

    // Report snapshot size to the Vercel billing tally. Only when owner_pubkey
    // is set (an enforced doc; open docs have no billable owner yet). Runs after
    // the R2 write so a metering hiccup never delays the backup.
    void this.reportDocSize(stored ? stored.byteLength : 0);
    // Report the write-activity delta accumulated since the last tick.
    void this.reportActivity();
  }

  /**
   * Best-effort POST of the write-activity delta (durable writes since the last
   * report) to the Vercel monthly tally. Fail-silent. Decrements the counter by
   * exactly what was reported on success, so writes that land during the await
   * are preserved for the next tick; on failure the counter is untouched and the
   * delta retries. Only when owner_pubkey is set (an enforced doc has a billable
   * owner). Under-counts at worst (eviction loses the unreported tail), the
   * customer-friendly direction.
   */
  private async reportActivity(): Promise<void> {
    const base = this.env.APP_BASE_URL;
    if (!base) return; // local dev with no APP_BASE_URL; no-op
    const ownerPubkey = this.metaGet("owner_pubkey");
    if (!ownerPubkey) return; // open doc with no grant yet; nothing to bill
    const delta = this.writesSinceReport;
    if (delta <= 0) return;
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (this.env.RELAY_BREAKER_SECRET) {
        headers.authorization = `Bearer ${this.env.RELAY_BREAKER_SECRET}`;
      }
      const res = await fetch(`${base}/api/collab/activity`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ownerPubkey, writes: delta }),
      });
      if (res.ok) this.writesSinceReport -= delta;
    } catch {
      // Fail silent; the delta stays and retries on the next alarm tick.
    }
  }

  /**
   * Best-effort POST of the current doc size to the Vercel metering endpoint.
   * Fail-silent: any error is swallowed so the backup alarm is never affected.
   */
  private async reportDocSize(byteLength: number): Promise<void> {
    const base = this.env.APP_BASE_URL;
    if (!base) return; // local dev with no APP_BASE_URL; no-op
    const ownerPubkey = this.metaGet("owner_pubkey");
    if (!ownerPubkey) return; // open doc with no grant yet; nothing to bill
    const sessionIdRows = this.sql()
      .exec<{ v: string }>("SELECT v FROM meta WHERE k = 'session_id'")
      .toArray();
    const docId =
      sessionIdRows.length > 0 ? sessionIdRows[0].v : this.state.id.toString();
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (this.env.RELAY_BREAKER_SECRET) {
        headers.authorization = `Bearer ${this.env.RELAY_BREAKER_SECRET}`;
      }
      await fetch(`${base}/api/collab/doc-size`, {
        method: "POST",
        headers,
        body: JSON.stringify({ docId, ownerPubkey, bytes: byteLength }),
      });
    } catch {
      // Fail silent; metering is best-effort.
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session") ?? "";

    // Access-control mutations (chunk 3). Owner-signed; route before the
    // snapshot/ws handling.
    if (url.pathname === "/grant") {
      return this.handleGrant(sessionId, request);
    }
    if (url.pathname === "/revoke") {
      return this.handleRevoke(sessionId, request);
    }
    if (url.pathname === "/members") {
      return this.handleMembers(sessionId, request);
    }

    // Canonical snapshot read (HTTP GET, no WebSocket). The client adopts this
    // as its base for a collab doc. 200 with the snapshot bytes when stored,
    // 204 when the room is empty (the client keeps its local copy).
    if (url.pathname === "/snapshot") {
      // Gate before serving any bytes. Open docs pass through unchanged.
      const denied = this.connectGate(sessionId, url);
      if (denied) return denied;
      const headers: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      };
      const d = this.ensureDoc();
      if (!this.hasStored) {
        return new Response(null, { status: 204, headers });
      }
      const snapshot = d.export({ mode: "snapshot" });
      return new Response(snapshot, {
        status: 200,
        headers: { ...headers, "Content-Type": "application/octet-stream" },
      });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // Gate the upgrade. Open docs accept anyone (in-lab path unchanged); an
    // enforced doc requires a valid member connect token, else 401 before the
    // socket is ever accepted.
    const denied = this.connectGate(sessionId, url);
    if (denied) return denied;

    // Record the sessionId (from the connect URL) so the R2 backup key is
    // stable and meaningful. The DO is addressed by idFromName(sessionId) but
    // does not otherwise know its own session string.
    const sid = url.searchParams.get("session");
    if (sid) {
      this.sql().exec(
        "INSERT INTO meta (k, v) VALUES ('session_id', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        sid,
      );
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);

    // Catch-up from storage: hand the new peer the canonical snapshot so it
    // converges immediately, even with no other peer online.
    const d = this.ensureDoc();
    if (this.hasStored) {
      try {
        server.send(frame(MSG_DOC_UPDATE, d.export({ mode: "snapshot" })));
      } catch {
        // New socket already gone; nothing to do.
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): void {
    // Protocol is binary only. Ignore stray text frames.
    if (typeof data === "string") return;
    const bytes = new Uint8Array(data);
    if (bytes.byteLength === 0) return;
    // Reject oversize frames before any import/snapshot work. On an open
    // pre-grant doc the sender is unauthenticated, so this is the only guard
    // against a single multi-MB frame pressuring the isolate.
    if (bytes.byteLength > MAX_FRAME_BYTES) {
      try {
        ws.close(1009, "message too large");
      } catch {
        // Socket already gone; nothing to do.
      }
      return;
    }

    const type = bytes[0];
    if (type === MSG_DOC_UPDATE) {
      // Cost-enforcement gate: when the breaker is paused or the per-doc write
      // throttle is hit, skip the DURABLE persist (the cost driver) but still
      // fan out live below, so collaborators keep seeing edits and the local
      // Loro doc keeps every edit safe. Signal the sender so it can surface a
      // quiet "sync paused". When allowed, persistUpdate returns false if the
      // doc is at its size cap, which is the same deal (signal "full").
      const blocked = this.writeBlockReason();
      if (blocked) {
        this.signalBlocked(ws, blocked);
      } else if (!this.persistUpdate(bytes.subarray(1))) {
        this.signalBlocked(ws, "full");
      }
    }
    // MSG_EPHEMERAL and any unknown type are fanned out but never persisted.

    // Fan out the frame verbatim (type byte included) to every other peer.
    for (const peer of this.state.getWebSockets()) {
      if (peer === ws) continue;
      try {
        peer.send(data);
      } catch {
        // Peer disconnected between enumeration and send; skip it.
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      // Already closed or closing.
    }
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      // Ignore close errors on an errored socket.
    }
  }
}

/**
 * Per-recipient inbox (external-collab chunk 3). One DO instance per recipient
 * emailHash (idFromName(emailHash)). It holds the pending live-collab invites
 * addressed to that recipient and nothing else. The relay stays blind to the
 * collab content; an invite row carries only routing metadata (the collab doc
 * id + session id + a human title + who sent it).
 *
 * SECURITY MODEL.
 *   - /inbox/push: anyone may send an invite (like email). The sender SIGNS the
 *     push with their own directory Ed25519 key so the recorded from-identity is
 *     authentic and cannot be forged. The first push to a fresh inbox also
 *     records the recipient's pubkey (trust-on-first-use). A later push that
 *     presents a DIFFERENT recipientPubkey is rejected, so a sender cannot
 *     rebind someone else's inbox to a key they control.
 *   - /inbox/list and /inbox/dismiss: recipient-signed, and the signing pubkey
 *     MUST equal the established recipient_pubkey. Only the established recipient
 *     can read or clear their own inbox.
 *
 * No invite ever materializes a local copy here. Surfacing pending invites is
 * all this chunk does; accept + materialize-to-folder is chunk 4.
 */
export class RecipientInbox {
  readonly state: DurableObjectState;
  readonly env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // One row per pending invite, keyed by the collab doc id (re-pushing the
    // same doc upserts rather than duplicating).
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS invites (doc_id TEXT PRIMARY KEY, session_id TEXT, title TEXT, kind TEXT, from_email TEXT, from_name TEXT, from_pubkey TEXT, created_at INTEGER)",
    );
    // from_pubkey was added in external-collab chunk 4 so the recipient can
    // verify the sender's (email, pubkey) directory binding at accept time. An
    // inbox table created before chunk 4 lacks the column, so add it idempotently
    // (SQLite ADD COLUMN is a no-op-on-exists only if guarded, so swallow the
    // duplicate-column error). A row pushed before this column existed reads it
    // back as null, and the recipient treats a null from_pubkey as unverifiable.
    try {
      this.sql().exec("ALTER TABLE invites ADD COLUMN from_pubkey TEXT");
    } catch {
      // Column already present (fresh table above, or a prior migration).
    }
    // meta holds 'recipient_pubkey' (hex, TOFU on the first push).
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)",
    );
  }

  private sql(): SqlStorage {
    return this.state.storage.sql;
  }

  private metaGet(key: string): string | null {
    const rows = this.sql()
      .exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", key)
      .toArray();
    return rows.length > 0 ? rows[0].v : null;
  }

  private metaSet(key: string, value: string): void {
    this.sql().exec(
      "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      key,
      value,
    );
  }

  /** Verifies a hex Ed25519 signature over a UTF-8 message under a hex pubkey.
   *  Any malformed input is a verification failure, never a throw. */
  private verifySig(sigHex: string, message: string, pubkeyHex: string): boolean {
    try {
      const sig = hexToBytes(sigHex);
      const pub = hexToBytes(pubkeyHex);
      const msg = new TextEncoder().encode(message);
      return ed25519.verify(sig, msg, pub);
    } catch {
      return false;
    }
  }

  /** Within +/- 5 minutes of now (replay guard). Non-finite is stale. */
  private isFresh(ts: number): boolean {
    if (typeof ts !== "number" || !Number.isFinite(ts)) return false;
    return Math.abs(Date.now() - ts) <= 5 * 60 * 1000;
  }

  private json(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  /** POST /inbox/push?to=<emailHash>. Sender-signed; upserts one invite. */
  private async handlePush(request: Request): Promise<Response> {
    let body: {
      from?: { email?: string; name?: string; pubkey?: string };
      recipientEmailHash?: string;
      recipientPubkey?: string;
      invite?: {
        collabDocId?: string;
        sessionId?: string;
        title?: string;
        kind?: string;
      };
      issuedAt?: number;
      signature?: string;
    };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const from = body.from;
    const recipientEmailHash = body.recipientEmailHash;
    const recipientPubkey = body.recipientPubkey;
    const invite = body.invite;
    const issuedAt = body.issuedAt;
    const signature = body.signature;
    if (
      !from ||
      typeof from.email !== "string" ||
      typeof from.pubkey !== "string" ||
      typeof recipientEmailHash !== "string" ||
      typeof recipientPubkey !== "string" ||
      !invite ||
      typeof invite.collabDocId !== "string" ||
      typeof invite.sessionId !== "string" ||
      typeof issuedAt !== "number" ||
      typeof signature !== "string"
    ) {
      return this.json({ error: "malformed push" }, 400);
    }

    if (!this.isFresh(issuedAt)) {
      return this.json({ error: "stale issuedAt" }, 401);
    }

    // from.email, title and kind are part of the signed message so the sender
    // identity and the displayed invite cannot be spoofed by a holder of any
    // valid keypair (the signature authenticates WHO sent it, not just that a
    // valid signer did). The recipient client should still confirm the
    // from.email <-> from.pubkey directory binding at accept time (chunk 4).
    const message = `inbox-push\n${recipientEmailHash}\n${recipientPubkey}\n${from.email}\n${invite.collabDocId}\n${invite.sessionId}\n${invite.title ?? ""}\n${invite.kind ?? ""}\n${issuedAt}`;
    if (!this.verifySig(signature, message, from.pubkey)) {
      return this.json({ error: "bad signature" }, 401);
    }

    // TOFU on the recipient pubkey. The first push establishes it; a later push
    // must present the same key, so a sender cannot rebind the inbox owner.
    const stored = this.metaGet("recipient_pubkey");
    if (stored === null) {
      this.metaSet("recipient_pubkey", recipientPubkey);
    } else if (stored !== recipientPubkey) {
      return this.json({ error: "recipient pubkey mismatch" }, 403);
    }

    this.sql().exec(
      "INSERT INTO invites (doc_id, session_id, title, kind, from_email, from_name, from_pubkey, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(doc_id) DO UPDATE SET session_id = excluded.session_id, title = excluded.title, kind = excluded.kind, from_email = excluded.from_email, from_name = excluded.from_name, from_pubkey = excluded.from_pubkey, created_at = excluded.created_at",
      invite.collabDocId,
      invite.sessionId,
      // The client posts straight to /inbox/push, so cap these here rather than
      // trusting any caller-side limit.
      capStr(invite.title, MAX_TITLE_LEN),
      typeof invite.kind === "string" ? invite.kind : null,
      capStr(from.email, MAX_EMAIL_LEN),
      capStr(from.name, MAX_NAME_LEN),
      // from.pubkey is already validated above and is the SAME key that signed
      // this push (verifySig used from.pubkey), so persisting it records the key
      // that the recipient will later confirm against the directory binding.
      from.pubkey,
      Date.now(),
    );

    return this.json({ ok: true }, 200);
  }

  /** Recipient-signed gate shared by /inbox/list and /inbox/dismiss. Returns
   *  the canonical message that was verified on success, or a Response to
   *  reject. The caller passes the already-parsed email + pubkey + issuedAt +
   *  signature plus the canonical message the recipient should have signed. */
  private recipientGate(
    pubkey: string,
    issuedAt: number,
    signature: string,
    message: string,
  ): Response | null {
    if (!this.isFresh(issuedAt)) {
      return this.json({ error: "stale issuedAt" }, 401);
    }
    const stored = this.metaGet("recipient_pubkey");
    if (stored === null) {
      // No established recipient yet (empty inbox). Treated as empty, not an
      // auth error, so a brand-new recipient sees an empty list cleanly.
      return this.json({ error: "empty" }, 200);
    }
    if (stored !== pubkey) {
      return this.json({ error: "not the recipient" }, 403);
    }
    if (!this.verifySig(signature, message, pubkey)) {
      return this.json({ error: "bad signature" }, 401);
    }
    return null;
  }

  /** POST /inbox/list?owner=<emailHash>. Recipient-signed read. */
  private async handleList(request: Request): Promise<Response> {
    let body: {
      email?: string;
      pubkey?: string;
      issuedAt?: number;
      signature?: string;
    };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const email = body.email;
    const pubkey = body.pubkey;
    const issuedAt = body.issuedAt;
    const signature = body.signature;
    if (
      typeof email !== "string" ||
      typeof pubkey !== "string" ||
      typeof issuedAt !== "number" ||
      typeof signature !== "string"
    ) {
      return this.json({ error: "malformed list" }, 400);
    }

    // Enumeration hardening (external-collab chunk 5). The inbox address derives
    // from a PUBLIC salt, so an outsider could probe it. To remove the
    // established-vs-empty oracle, ANY recipient-auth failure on /inbox/list
    // (unestablished inbox, wrong pubkey, bad signature, stale timestamp) returns
    // the SAME empty 200 an unestablished inbox returns. An outsider cannot
    // distinguish "established with a key I do not hold" from "never established",
    // so probing leaks nothing. /inbox/dismiss stays strict-rejecting (it is a
    // mutation, and a 403 there does not leak existence the list already hides).
    const stored = this.metaGet("recipient_pubkey");
    if (
      stored === null ||
      stored !== pubkey ||
      !this.isFresh(issuedAt) ||
      !this.verifySig(
        signature,
        `inbox-list\n${this.ownerHashFrom(request)}\n${issuedAt}`,
        pubkey,
      )
    ) {
      return this.json({ invites: [] }, 200);
    }

    const rows = this.sql()
      .exec<{
        doc_id: string;
        session_id: string;
        title: string | null;
        kind: string | null;
        from_email: string | null;
        from_name: string | null;
        from_pubkey: string | null;
        created_at: number;
      }>(
        "SELECT doc_id, session_id, title, kind, from_email, from_name, from_pubkey, created_at FROM invites ORDER BY created_at DESC",
      )
      .toArray();

    const invites = rows.map((r) => ({
      collabDocId: r.doc_id,
      sessionId: r.session_id,
      title: r.title,
      kind: r.kind,
      fromEmail: r.from_email,
      fromName: r.from_name,
      // The sender's signing pubkey (external-collab chunk 4). The recipient
      // confirms this equals the directory binding for fromEmail before any
      // materialize, so a spoofed from_email cannot pass accept.
      fromPubkey: r.from_pubkey,
      createdAt: r.created_at,
    }));

    return this.json({ invites }, 200);
  }

  /** POST /inbox/dismiss?owner=<emailHash>. Recipient-signed delete of one. */
  private async handleDismiss(request: Request): Promise<Response> {
    let body: {
      email?: string;
      pubkey?: string;
      collabDocId?: string;
      issuedAt?: number;
      signature?: string;
    };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const email = body.email;
    const pubkey = body.pubkey;
    const collabDocId = body.collabDocId;
    const issuedAt = body.issuedAt;
    const signature = body.signature;
    if (
      typeof email !== "string" ||
      typeof pubkey !== "string" ||
      typeof collabDocId !== "string" ||
      typeof issuedAt !== "number" ||
      typeof signature !== "string"
    ) {
      return this.json({ error: "malformed dismiss" }, 400);
    }

    const message = `inbox-dismiss\n${this.ownerHashFrom(request)}\n${collabDocId}\n${issuedAt}`;
    const denied = this.recipientGate(pubkey, issuedAt, signature, message);
    if (denied) return denied;

    this.sql().exec("DELETE FROM invites WHERE doc_id = ?", collabDocId);
    return this.json({ ok: true }, 200);
  }

  /** The recipient emailHash this DO is addressed by, read from ?owner. The DO
   *  is named idFromName(emailHash) but does not otherwise know its own name,
   *  and the recipient signs the canonical message over that same hash. */
  private ownerHashFrom(request: Request): string {
    return new URL(request.url).searchParams.get("owner") ?? "";
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/inbox/push") return this.handlePush(request);
    if (url.pathname === "/inbox/list") return this.handleList(request);
    if (url.pathname === "/inbox/dismiss") return this.handleDismiss(request);
    return this.json({ error: "not found" }, 404);
  }
}

/**
 * Per-user capture inbox (mobile capture relay, piece A). One DO instance per
 * user identity pubkey hex (idFromName(userPubkeyHex)). It holds that user's
 * bound devices and the index of pending bench captures, and nothing else. The
 * blobs themselves live in the CAPTURES R2 bucket at key `<u>/<captureId>` and
 * are deleted on ack.
 *
 * TRUST MODEL (accountless, pubkey-keyed; mirrors the cross-boundary relay).
 *   - To WRITE to bucket U you must hold a device key that was bound to U by a
 *     grant signed with U's identity private key (POST /capture/register), and
 *     each upload is signed by that device key.
 *   - To READ or DELETE from bucket U you must sign the challenge with U's
 *     identity private key (inbox, object, ack, devices, devices/revoke).
 *   - An attacker can only ever create + touch a bucket under their own pubkey;
 *     they can never reach U's, because the DO is addressed by U and every write
 *     is gated on a device binding U authorized.
 *
 * CANONICAL SIGNED-BYTE STRINGS (the contract; the phone + desktop sign these
 * exact UTF-8 strings, then ed25519 verify). See capturePairGrantMessage,
 * captureUploadMessage and captureReadMessage below.
 *
 * REPLAY GUARD. User-key-signed reads carry an ISO `ts`; it must be within 120s
 * of server time. Pairing grants carry an ISO `exp`; a grant past `exp` is
 * rejected.
 */
export class CaptureInbox {
  readonly state: DurableObjectState;
  readonly env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // Devices bound to this user. device_pubkey is the hex Ed25519 key the
    // phone generated at pairing; uploads are verified against it.
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS devices (device_pubkey TEXT PRIMARY KEY, label TEXT, bound_at TEXT)",
    );
    // x25519_pubkey (mobile download path, piece A) is the device's hex X25519
    // SEALING key. The laptop seals each snapshot to it so only that device can
    // open the ciphertext. Added idempotently so a devices table created before
    // this column exists keeps its rows (they read back x25519_pubkey as null,
    // and an older phone that paired without a sealing key simply cannot receive
    // snapshots until it re-registers). SQLite ADD COLUMN throws if the column is
    // already present, so swallow that (mirrors RecipientInbox.from_pubkey).
    try {
      this.sql().exec("ALTER TABLE devices ADD COLUMN x25519_pubkey TEXT");
    } catch {
      // Column already present (fresh table above, or a prior migration).
    }
    // push_token (phone push, P1) is the device's Expo push token. It is a
    // routing identifier the laptop reads back from /capture/devices to send a
    // generic, content-free wake-and-fetch push via the Expo Push Service. Added
    // idempotently for the same reason as x25519_pubkey above; a device that
    // paired before push existed (or denied the OS notification grant) reads back
    // null and simply never gets a buzz until it registers a token. The token is
    // never lab content, so storing it plainly is consistent with the rest of the
    // device record.
    try {
      this.sql().exec("ALTER TABLE devices ADD COLUMN push_token TEXT");
    } catch {
      // Column already present (fresh table above, or a prior migration).
    }
    // The index of pending captures. blob_key is the R2 key (`<u>/<captureId>`);
    // the blob is deleted from R2 on ack alongside the row.
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS captures (capture_id TEXT PRIMARY KEY, caption TEXT, created_at TEXT, content_type TEXT, blob_key TEXT, uploaded_at TEXT)",
    );
    // Focus context channel (notebook integrations Phase 0). One row per bound
    // device; the laptop seals the current focus context to each device's X25519
    // key and writes it here. The phone polls for its own row.
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS context (device_pubkey TEXT PRIMARY KEY, sealed TEXT, updated_at TEXT)",
    );
    // Command channel (notebook integrations Phase 0). The phone posts sealed
    // commands (append-line, switch-tab, route-capture, timer events); the laptop
    // polls + acks them. Deleted on ack.
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS commands (command_id TEXT PRIMARY KEY, sealed TEXT, created_at TEXT)",
    );
    // Notify config (phone push P2). A single-row mirror of this user's
    // notification ROUTING config (the per-category channel matrix + quiet
    // hours), published by the user's own laptop. It carries NO research
    // content, only channel toggles and a time window, so the relay can run the
    // recipient's phone gate server-side when a sender asks it to push the
    // recipient (who may be offline). last_notify_at is a coarse per-DO cooldown
    // so a burst of sender calls cannot machine-gun the recipient's phone.
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS notify_config (id INTEGER PRIMARY KEY CHECK (id = 1), config TEXT, updated_at TEXT, last_notify_at INTEGER)",
    );
    // Scheduled reminders (phone push P3b). The user's laptop pre-registers its
    // upcoming due reminder times here (content-free: an opaque id + a fire_at
    // epoch-ms, no event name); a Durable Object alarm fires the ones that come
    // due while the laptop is closed. reminder_meta holds the last registration
    // time (for the dead-man's-switch that stands the alarm down while the laptop
    // is online) and this user's pubkey (the DO does not otherwise know its own
    // name, which the alarm needs for the R2 snapshot key).
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, fire_at INTEGER)",
    );
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS reminder_meta (id INTEGER PRIMARY KEY CHECK (id = 1), registered_at INTEGER, user_pubkey TEXT)",
    );
  }

  private sql(): SqlStorage {
    return this.state.storage.sql;
  }

  /** Verifies a hex Ed25519 signature over a UTF-8 message under a hex pubkey.
   *  Pure JS (@noble/curves), so it runs in workerd. Any malformed input is a
   *  verification failure, never a throw. (Mirrors CollabRoom.verifySig.) */
  private verifySig(sigHex: string, message: string, pubkeyHex: string): boolean {
    try {
      const sig = hexToBytes(sigHex);
      const pub = hexToBytes(pubkeyHex);
      const msg = new TextEncoder().encode(message);
      return ed25519.verify(sig, msg, pub);
    } catch {
      return false;
    }
  }

  /** Effective phone-push cooldown (ms). Env override for the smoke harness,
   *  else the constant. Allows 0 in tests. */
  private cooldownMs(): number {
    const v = this.env.NOTIFY_COOLDOWN_MS;
    const n = Number(v);
    return v != null && v !== "" && Number.isFinite(n) ? n : NOTIFY_COOLDOWN_MS;
  }

  /** Effective reminder dead-man's-switch window (ms). Env override for tests. */
  private staleMs(): number {
    const v = this.env.REMINDER_STALE_MS;
    const n = Number(v);
    return v != null && v !== "" && Number.isFinite(n) ? n : REMINDER_STALE_MS;
  }

  /** An ISO timestamp is fresh when it is within +/- 120s of now (the brief's
   *  replay window for user-key-signed reads). Unparseable input is stale. */
  private isFreshIso(iso: string): boolean {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return false;
    return Math.abs(Date.now() - t) <= 120 * 1000;
  }

  /** True when the ISO `exp` is in the future (grant still valid). */
  private notExpired(expIso: string): boolean {
    const t = Date.parse(expIso);
    if (!Number.isFinite(t)) return false;
    return t > Date.now();
  }

  private json(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  /** True when device_pubkey is currently bound to this user. */
  private isBoundDevice(devicePubkey: string): boolean {
    const rows = this.sql()
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM devices WHERE device_pubkey = ?",
        devicePubkey,
      )
      .toArray();
    return rows.length > 0 && rows[0].n > 0;
  }

  // ---- Read auth (user-key signed challenge) ---------------------------

  /** Shared gate for the user-key-signed read/mutate routes (inbox, object,
   *  ack, devices, devices/revoke). Verifies the ts freshness and the user's
   *  signature over the action-bound canonical message. Returns null on success
   *  or a Response to reject. The caller passes the exact canonical message the
   *  user should have signed. */
  private userGate(
    u: string,
    ts: string,
    sig: string,
    message: string,
  ): Response | null {
    if (!this.isFreshIso(ts)) {
      return this.json({ error: "stale ts" }, 401);
    }
    if (!this.verifySig(sig, message, u)) {
      return this.json({ error: "bad signature" }, 401);
    }
    return null;
  }

  /** Shared gate for device-key-signed routes. Verifies the ts freshness, that
   *  the device is bound to this user, and the device's signature over the
   *  canonical message. Returns null on success or a Response to reject. */
  private deviceGate(
    devicePubkey: string,
    ts: string,
    sig: string,
    message: string,
  ): Response | null {
    if (!this.isFreshIso(ts)) {
      return this.json({ error: "stale ts" }, 401);
    }
    if (!this.isBoundDevice(devicePubkey)) {
      return this.json({ error: "device not bound" }, 403);
    }
    if (!this.verifySig(sig, message, devicePubkey)) {
      return this.json({ error: "bad signature" }, 401);
    }
    return null;
  }

  // ---- Routes -----------------------------------------------------------

  /** POST /capture/register. Binds a device. The user-signed grant is the
   *  capability; we verify it against grant.u and check it is unexpired, then
   *  upsert the device binding. */
  private async handleRegister(request: Request): Promise<Response> {
    let body: {
      grant?: { u?: unknown; pid?: unknown; exp?: unknown; url?: unknown };
      sig?: unknown;
      devicePubkey?: unknown;
      label?: unknown;
      devX25519?: unknown;
      userX25519PubHex?: unknown;
      pushToken?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const grant = body.grant;
    const sig = body.sig;
    const devicePubkey = body.devicePubkey;
    const label = body.label;
    if (
      !grant ||
      typeof grant.u !== "string" ||
      typeof grant.pid !== "string" ||
      typeof grant.exp !== "string" ||
      typeof grant.url !== "string" ||
      typeof sig !== "string" ||
      typeof devicePubkey !== "string"
    ) {
      return this.json({ error: "malformed register" }, 400);
    }

    if (!this.notExpired(grant.exp)) {
      return this.json({ error: "expired grant" }, 401);
    }

    const message = capturePairGrantMessage(
      grant.u,
      grant.pid,
      grant.exp,
      grant.url,
    );
    if (!this.verifySig(sig, message, grant.u)) {
      return this.json({ error: "bad grant signature" }, 401);
    }

    // devX25519 (mobile download path) is OPTIONAL so older phones that paired
    // before the sealing key existed keep working. When present it is stored on
    // the binding; the laptop reads it back from /capture/devices to seal
    // snapshots to this device.
    const devX25519 = body.devX25519;
    // pushToken (phone push P1) is OPTIONAL the same way devX25519 is: a phone
    // that has not been granted the OS notification permission registers without
    // one and simply never buzzes. We do NOT overwrite an existing token with
    // null on a re-register that omits it, so a device-signed token refresh
    // (POST /capture/devices/push-token) made between pairings survives a later
    // bare re-pair. COALESCE keeps the stored token when the incoming value is
    // null.
    const pushToken = body.pushToken;
    this.sql().exec(
      "INSERT INTO devices (device_pubkey, label, bound_at, x25519_pubkey, push_token) VALUES (?, ?, ?, ?, ?) ON CONFLICT(device_pubkey) DO UPDATE SET label = excluded.label, bound_at = excluded.bound_at, x25519_pubkey = excluded.x25519_pubkey, push_token = COALESCE(excluded.push_token, devices.push_token)",
      devicePubkey,
      typeof label === "string" ? label : null,
      new Date().toISOString(),
      typeof devX25519 === "string" ? devX25519 : null,
      typeof pushToken === "string" && pushToken.trim() !== "" ? pushToken : null,
    );

    // Echo back the user's X25519 sealing public key (Phase 1 route-capture).
    // The phone stores this on its pairing record and seals route-capture
    // commands to it so only the laptop holding the matching private key can
    // open them. It rides in on the register body (carried by the signed grant
    // payload, sealing key is public so it needs no separate signature) and is
    // OPTIONAL: an older app that does not send it just gets it back absent and
    // falls back to inbox routing.
    const userX25519PubHex = body.userX25519PubHex;
    return this.json(
      {
        ok: true,
        userX25519PubHex:
          typeof userX25519PubHex === "string" ? userX25519PubHex : undefined,
      },
      200,
    );
  }

  /** POST /capture/upload. multipart/form-data: a `blob` file field + a text
   *  `meta` JSON field. The bound device key signs over u + captureId +
   *  createdAt + sha256(blob). We verify the device is bound, recompute the
   *  blob's sha256 and verify the upload signature, store the blob in R2, then
   *  index it. */
  private async handleUpload(request: Request): Promise<Response> {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return this.json({ error: "invalid multipart body" }, 400);
    }

    const blob = form.get("blob");
    const metaRaw = form.get("meta");
    if (!(blob instanceof File) && !(blob instanceof Blob)) {
      return this.json({ error: "missing blob field" }, 400);
    }
    if (typeof metaRaw !== "string") {
      return this.json({ error: "missing meta field" }, 400);
    }

    let meta: {
      u?: unknown;
      devicePubkey?: unknown;
      captureId?: unknown;
      caption?: unknown;
      createdAt?: unknown;
      contentType?: unknown;
      sig?: unknown;
    };
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      return this.json({ error: "invalid meta JSON" }, 400);
    }

    const u = meta.u;
    const devicePubkey = meta.devicePubkey;
    const captureId = meta.captureId;
    const createdAt = meta.createdAt;
    const contentType = meta.contentType;
    const sig = meta.sig;
    if (
      typeof u !== "string" ||
      typeof devicePubkey !== "string" ||
      typeof captureId !== "string" ||
      typeof createdAt !== "string" ||
      typeof contentType !== "string" ||
      typeof sig !== "string"
    ) {
      return this.json({ error: "malformed meta" }, 400);
    }

    if (!this.isBoundDevice(devicePubkey)) {
      return this.json({ error: "device not bound" }, 403);
    }

    // Recompute the blob's sha256 so the signature binds the exact bytes we
    // store (a tampered blob or mismatched meta fails verification).
    const blobBytes = new Uint8Array(await blob.arrayBuffer());
    const sha256 = await sha256Hex(blobBytes);
    const message = captureUploadMessage(u, captureId, createdAt, sha256);
    if (!this.verifySig(sig, message, devicePubkey)) {
      return this.json({ error: "bad upload signature" }, 401);
    }

    const blobKey = `${u}/${captureId}`;
    try {
      await this.env.CAPTURES.put(blobKey, blobBytes, {
        httpMetadata: { contentType },
      });
    } catch {
      return this.json({ error: "storage write failed" }, 500);
    }

    this.sql().exec(
      "INSERT INTO captures (capture_id, caption, created_at, content_type, blob_key, uploaded_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(capture_id) DO UPDATE SET caption = excluded.caption, created_at = excluded.created_at, content_type = excluded.content_type, blob_key = excluded.blob_key, uploaded_at = excluded.uploaded_at",
      captureId,
      capStr(meta.caption, MAX_CAPTION_LEN),
      createdAt,
      contentType,
      blobKey,
      new Date().toISOString(),
    );

    return this.json({ ok: true, captureId }, 200);
  }

  /** GET /capture/inbox?u=&ts=&sig=. User-key signed. Lists pending captures,
   *  newest-first. */
  private handleInbox(u: string, url: URL): Response {
    const ts = url.searchParams.get("ts") ?? "";
    const sig = url.searchParams.get("sig") ?? "";
    const denied = this.userGate(u, ts, sig, captureReadMessage("inbox", u, ts));
    if (denied) return denied;

    const rows = this.sql()
      .exec<{
        capture_id: string;
        caption: string | null;
        created_at: string;
        content_type: string;
      }>(
        "SELECT capture_id, caption, created_at, content_type FROM captures ORDER BY created_at DESC",
      )
      .toArray();

    const captures = rows.map((r) => ({
      captureId: r.capture_id,
      caption: r.caption,
      createdAt: r.created_at,
      contentType: r.content_type,
    }));

    return this.json({ captures }, 200);
  }

  /** GET /capture/object?u=&id=&ts=&sig=. User-key signed. Streams one blob. */
  private async handleObject(u: string, url: URL): Promise<Response> {
    const id = url.searchParams.get("id") ?? "";
    const ts = url.searchParams.get("ts") ?? "";
    const sig = url.searchParams.get("sig") ?? "";
    if (id.trim() === "") {
      return this.json({ error: "missing id" }, 400);
    }
    const denied = this.userGate(
      u,
      ts,
      sig,
      captureReadMessage("object", u, ts, `id=${id}`),
    );
    if (denied) return denied;

    const rows = this.sql()
      .exec<{ blob_key: string; content_type: string }>(
        "SELECT blob_key, content_type FROM captures WHERE capture_id = ?",
        id,
      )
      .toArray();
    if (rows.length === 0) {
      return this.json({ error: "not found" }, 404);
    }

    const obj = await this.env.CAPTURES.get(rows[0].blob_key);
    if (!obj) {
      return this.json({ error: "not found" }, 404);
    }

    return new Response(obj.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type":
          obj.httpMetadata?.contentType ?? rows[0].content_type ?? "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  }

  /** POST /capture/ack. User-key signed. Deletes the acked blobs + index rows.
   *  The signed `ids` are the sorted, comma-joined capture ids. */
  private async handleAck(u: string, request: Request): Promise<Response> {
    let body: { u?: unknown; ids?: unknown; ts?: unknown; sig?: unknown };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const ids = body.ids;
    const ts = body.ts;
    const sig = body.sig;
    if (
      typeof body.u !== "string" ||
      !Array.isArray(ids) ||
      typeof ts !== "string" ||
      typeof sig !== "string"
    ) {
      return this.json({ error: "malformed ack" }, 400);
    }
    for (const id of ids) {
      if (typeof id !== "string") {
        return this.json({ error: "malformed ack ids" }, 400);
      }
    }

    // The signed ids list is canonicalized to sorted + comma-joined so the
    // client and worker agree regardless of request order.
    const sortedIds = [...(ids as string[])].sort();
    const denied = this.userGate(
      u,
      ts,
      sig,
      captureReadMessage("ack", u, ts, `ids=${sortedIds.join(",")}`),
    );
    if (denied) return denied;

    let deleted = 0;
    for (const id of sortedIds) {
      const rows = this.sql()
        .exec<{ blob_key: string }>(
          "SELECT blob_key FROM captures WHERE capture_id = ?",
          id,
        )
        .toArray();
      if (rows.length === 0) continue;
      try {
        await this.env.CAPTURES.delete(rows[0].blob_key);
      } catch {
        // Best-effort blob delete; still drop the index row so the capture
        // stops being listed (a stray R2 object is harmless + lifecycle-cleaned).
      }
      this.sql().exec("DELETE FROM captures WHERE capture_id = ?", id);
      deleted += 1;
    }

    return this.json({ ok: true, deleted }, 200);
  }

  /** GET /capture/devices?u=&ts=&sig=. User-key signed. Lists bound devices. */
  private handleDevices(u: string, url: URL): Response {
    const ts = url.searchParams.get("ts") ?? "";
    const sig = url.searchParams.get("sig") ?? "";
    const denied = this.userGate(
      u,
      ts,
      sig,
      captureReadMessage("devices", u, ts),
    );
    if (denied) return denied;

    const rows = this.sql()
      .exec<{
        device_pubkey: string;
        label: string | null;
        bound_at: string | null;
        x25519_pubkey: string | null;
        push_token: string | null;
      }>(
        "SELECT device_pubkey, label, bound_at, x25519_pubkey, push_token FROM devices ORDER BY bound_at ASC",
      )
      .toArray();

    const devices = rows.map((r) => ({
      devicePubkey: r.device_pubkey,
      label: r.label,
      boundAt: r.bound_at,
      // The device's hex X25519 sealing key (mobile download path). null for an
      // older device that paired before the sealing key existed; the laptop
      // skips those when publishing snapshots.
      x25519Pubkey: r.x25519_pubkey,
      // The device's Expo push token (phone push P1). null when the phone never
      // registered one (denied the OS grant, or paired before push existed); the
      // laptop sends a generic wake-and-fetch buzz only to devices that have one.
      pushToken: r.push_token,
    }));

    return this.json({ devices }, 200);
  }

  /** POST /capture/devices/revoke. User-key signed. Deletes one binding. */
  private async handleRevoke(u: string, request: Request): Promise<Response> {
    let body: { u?: unknown; device?: unknown; ts?: unknown; sig?: unknown };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const device = body.device;
    const ts = body.ts;
    const sig = body.sig;
    if (
      typeof body.u !== "string" ||
      typeof device !== "string" ||
      typeof ts !== "string" ||
      typeof sig !== "string"
    ) {
      return this.json({ error: "malformed revoke" }, 400);
    }

    const denied = this.userGate(
      u,
      ts,
      sig,
      captureReadMessage("revoke", u, ts, `device=${device}`),
    );
    if (denied) return denied;

    this.sql().exec("DELETE FROM devices WHERE device_pubkey = ?", device);

    // Mobile download path: a revoked device must not keep readable snapshots in
    // R2. Drop every snapshot under this device's prefix. Best-effort; a stray
    // object is sealed (unreadable) and lifecycle-cleaned, so a failure here is
    // not a security gap, only minor litter.
    try {
      const prefix = `${u}/snap/${device}/`;
      const listed = await this.env.CAPTURES.list({ prefix });
      for (const obj of listed.objects) {
        try {
          await this.env.CAPTURES.delete(obj.key);
        } catch {
          // Skip one failed delete; the rest still get cleaned.
        }
      }
    } catch {
      // Listing failed; leave the (sealed, unreadable) snapshots for lifecycle
      // cleanup. The binding is already gone, which is the security-relevant act.
    }

    return this.json({ ok: true }, 200);
  }

  /** POST /capture/devices/push-token. DEVICE-key signed. Sets or refreshes the
   *  bound device's Expo push token (phone push P1). Device-signed (not
   *  user-signed) so the phone can refresh its own token on launch or rotation
   *  without a fresh pairing grant. The OS notification grant can be given after
   *  pairing, and Expo tokens rotate, so this is the durable path; the register
   *  body carries the token only as the first-pair convenience. Storing null is
   *  allowed (the phone clears it when the grant is revoked). */
  private async handleSetPushToken(u: string, request: Request): Promise<Response> {
    let body: {
      u?: unknown;
      device?: unknown;
      pushToken?: unknown;
      ts?: unknown;
      sig?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const device = body.device;
    const ts = body.ts;
    const sig = body.sig;
    // The token may be an empty string to clear it; only its presence as a string
    // is required. The signed message binds the exact token bytes so the relay
    // cannot be made to store a different token than the device authorized.
    const pushToken = typeof body.pushToken === "string" ? body.pushToken : "";
    if (
      typeof body.u !== "string" ||
      typeof device !== "string" ||
      typeof ts !== "string" ||
      typeof sig !== "string"
    ) {
      return this.json({ error: "malformed push-token" }, 400);
    }

    const denied = this.deviceGate(
      device,
      ts,
      sig,
      devicePushTokenMessage(u, device, pushToken, ts),
    );
    if (denied) return denied;

    this.sql().exec(
      "UPDATE devices SET push_token = ? WHERE device_pubkey = ?",
      pushToken.trim() === "" ? null : pushToken,
      device,
    );

    return this.json({ ok: true }, 200);
  }

  /** POST /capture/notify-config (phone push P2). USER-key signed. This user's
   *  own laptop mirrors its notification routing config (the per-category channel
   *  matrix + quiet hours + tz offset, NO research content) so the relay can run
   *  the phone gate server-side when a sender asks it to buzz this (possibly
   *  offline) user. Capped + single-row. */
  private async handleNotifyConfig(u: string, request: Request): Promise<Response> {
    let body: { u?: unknown; config?: unknown; ts?: unknown; sig?: unknown };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }
    const config = body.config;
    const ts = body.ts;
    const sig = body.sig;
    if (
      typeof body.u !== "string" ||
      typeof config !== "string" ||
      typeof ts !== "string" ||
      typeof sig !== "string"
    ) {
      return this.json({ error: "malformed notify-config" }, 400);
    }
    if (config.length > 8192) {
      return this.json({ error: "config too large" }, 413);
    }
    const sha = await sha256Hex(new TextEncoder().encode(config));
    const denied = this.userGate(u, ts, sig, notifyConfigMessage(u, ts, sha));
    if (denied) return denied;

    this.sql().exec(
      "INSERT INTO notify_config (id, config, updated_at, last_notify_at) VALUES (1, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at",
      config,
      new Date().toISOString(),
    );
    return this.json({ ok: true }, 200);
  }

  /** POST /capture/notify-recipient (phone push P2). SENDER-key signed. A sender
   *  that just did a cross-user action (a share, a lab assignment/flag, an
   *  announcement) asks the relay to buzz the RECIPIENT (this DO's user), who may
   *  be offline. `sender` is a real ResearchOS identity (signature-verified);
   *  cross-user authorization is implicit (the share itself established the
   *  relationship, which the relay never sees) and the blast radius is bounded:
   *  a GENERIC, content-free push, gated by the recipient's OWN synced
   *  per-category phone toggle + quiet hours, coarsely rate-limited per DO. The
   *  sealed pending snapshot the phone fetches carries only a generic per-category
   *  line, never sender-supplied text (decision C1). */
  private async handleNotifyRecipient(u: string, request: Request): Promise<Response> {
    let body: {
      u?: unknown;
      sender?: unknown;
      category?: unknown;
      ts?: unknown;
      sig?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }
    const sender = body.sender;
    const category = body.category;
    const ts = body.ts;
    const sig = body.sig;
    if (
      typeof body.u !== "string" ||
      typeof sender !== "string" ||
      typeof category !== "string" ||
      typeof ts !== "string" ||
      typeof sig !== "string"
    ) {
      return this.json({ error: "malformed notify-recipient" }, 400);
    }
    if (!this.isFreshIso(ts)) {
      return this.json({ error: "stale ts" }, 401);
    }
    if (!this.verifySig(sig, notifyRecipientMessage(u, sender, category, ts), sender)) {
      return this.json({ error: "bad signature" }, 401);
    }
    if (!(PHONE_PUSH_CATEGORIES as readonly string[]).includes(category)) {
      return this.json({ ok: true, pushed: 0, reason: "unknown category" }, 200);
    }

    const rows = this.sql()
      .exec<{ config: string | null; last_notify_at: number | null }>(
        "SELECT config, last_notify_at FROM notify_config WHERE id = 1",
      )
      .toArray();
    // No synced config means we cannot honor the recipient's gate, so fail safe
    // (no buzz). The recipient still gets the notification on their own laptop.
    if (rows.length === 0 || !rows[0].config) {
      return this.json({ ok: true, pushed: 0, reason: "no config" }, 200);
    }
    const nowMs = Date.now();
    const lastAt = rows[0].last_notify_at ?? 0;
    if (nowMs - lastAt < this.cooldownMs()) {
      return this.json({ ok: true, pushed: 0, reason: "cooldown" }, 200);
    }
    let config: NotifyConfig;
    try {
      config = JSON.parse(rows[0].config) as NotifyConfig;
    } catch {
      return this.json({ ok: true, pushed: 0, reason: "bad config" }, 200);
    }
    // Evaluate BOTH offline channels the recipient may have routed this category
    // to: phone push (P2) and sender-triggered email (phase 2.5). Both honor the
    // recipient's own per-category toggle + quiet hours. If neither fires, do not
    // consume the cooldown (a muted category should never starve a later allowed
    // one).
    const phoneOn = shouldBuzzPhone(config, category, nowMs);
    const emailOn = shouldEmail(config, category, nowMs);
    if (!phoneOn && !emailOn) {
      return this.json({ ok: true, pushed: 0, emailed: 0, reason: "gated" }, 200);
    }
    // Stamp the cooldown up front so concurrent sender calls dedupe.
    this.sql().exec("UPDATE notify_config SET last_notify_at = ? WHERE id = 1", nowMs);

    const r = await this.deliverToRecipient(u, category, ts, config, phoneOn, emailOn);
    return this.json({ ok: true, ...r }, 200);
  }

  /** Shared offline-delivery for a recipient (this DO's user). Seals a generic
   *  content-free pending snapshot to each device with a seal key + sends a
   *  generic Expo push (when phoneOn), and sends a generic email to the
   *  recipient's own address (when emailOn). The caller has already run the gate
   *  + cooldown. Reused by notify-recipient (P2/2.5, sender-triggered) and the
   *  reminder alarm (P3b, scheduled). `u` is the recipient pubkey (the R2 key). */
  private async deliverToRecipient(
    u: string,
    category: string,
    tsIso: string,
    config: NotifyConfig,
    phoneOn: boolean,
    emailOn: boolean,
  ): Promise<{ pushed: number; sealed: number; emailed: number }> {
    let pushed = 0;
    let sealedCount = 0;
    if (phoneOn) {
      const devices = this.sql()
        .exec<{
          device_pubkey: string;
          x25519_pubkey: string | null;
          push_token: string | null;
        }>("SELECT device_pubkey, x25519_pubkey, push_token FROM devices")
        .toArray();
      const snap = buildPendingSnapshot(category, tsIso);
      const plaintext = new TextEncoder().encode(JSON.stringify(snap));
      const tokens: string[] = [];
      for (const d of devices) {
        if (!d.x25519_pubkey) continue;
        try {
          const sealed = sealToRecipient(plaintext, hexToBytes(d.x25519_pubkey));
          await this.env.CAPTURES.put(
            `${u}/snap/${d.device_pubkey}/notifications-pending`,
            sealed,
            { httpMetadata: { contentType: "application/octet-stream" } },
          );
          if (d.push_token) tokens.push(d.push_token);
        } catch {
          // Skip one device; the rest still get sealed + pushed.
        }
      }
      sealedCount = tokens.length;
      pushed = await sendExpoPush(tokens, category);
    }

    let emailed = 0;
    if (emailOn && config.email) {
      // The recipient mails their OWN registered address (the only place email
      // ever goes), via the existing Vercel mailer (Resend + SHARING_ENABLED gate
      // + IP rate limit). Generic content-free body, same as the push.
      emailed = await sendNotifyEmail(this.env.APP_BASE_URL, config.email, category);
    }
    return { pushed, sealed: sealedCount, emailed };
  }

  /** POST /capture/register-reminders (phone push P3b). USER-key signed. The
   *  user's own laptop mirrors its upcoming due reminder times here (content-free:
   *  an opaque id + a fire_at epoch-ms), REPLACING the prior set. A DO alarm fires
   *  the ones that come due while the laptop is closed. Stamps the registration
   *  time (the dead-man's-switch) + this user's pubkey (for the alarm's R2 key). */
  private async handleRegisterReminders(u: string, request: Request): Promise<Response> {
    let body: { u?: unknown; reminders?: unknown; ts?: unknown; sig?: unknown };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }
    const ts = body.ts;
    const sig = body.sig;
    const rawList = Array.isArray(body.reminders) ? body.reminders : null;
    if (
      typeof body.u !== "string" ||
      !rawList ||
      typeof ts !== "string" ||
      typeof sig !== "string"
    ) {
      return this.json({ error: "malformed register-reminders" }, 400);
    }
    // Validate + cap. Each entry is { id: string, fireAt: number(ms) }.
    const list = rawList
      .filter(
        (r): r is { id: string; fireAt: number } =>
          !!r &&
          typeof (r as { id?: unknown }).id === "string" &&
          typeof (r as { fireAt?: unknown }).fireAt === "number" &&
          Number.isFinite((r as { fireAt: number }).fireAt),
      )
      .slice(0, 200);
    // The signed message binds the exact list bytes so the relay stores only what
    // the user authorized.
    const json = JSON.stringify(body.reminders);
    const sha = await sha256Hex(new TextEncoder().encode(json));
    const denied = this.userGate(u, ts, sig, registerRemindersMessage(u, ts, sha));
    if (denied) return denied;

    // REPLACE the schedule wholesale (the laptop sends the full upcoming set).
    this.sql().exec("DELETE FROM reminders");
    for (const r of list) {
      this.sql().exec(
        "INSERT INTO reminders (id, fire_at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET fire_at = excluded.fire_at",
        r.id,
        Math.floor(r.fireAt),
      );
    }
    this.sql().exec(
      "INSERT INTO reminder_meta (id, registered_at, user_pubkey) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET registered_at = excluded.registered_at, user_pubkey = excluded.user_pubkey",
      Date.now(),
      u,
    );
    await this.armReminderAlarm();
    return this.json({ ok: true, scheduled: list.length }, 200);
  }

  /** Arm the DO alarm to the nearest future reminder fire time (or clear it when
   *  none remain). One alarm per DO; the alarm() handler reschedules forward. */
  private async armReminderAlarm(): Promise<void> {
    const rows = this.sql()
      .exec<{ next: number | null }>(
        "SELECT MIN(fire_at) AS next FROM reminders WHERE fire_at > ?",
        Date.now(),
      )
      .toArray();
    const next = rows[0]?.next ?? null;
    // Also consider already-due entries (fire_at <= now) so a just-registered
    // past-due reminder fires promptly rather than waiting for a future one.
    const due = this.sql()
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM reminders WHERE fire_at <= ?",
        Date.now(),
      )
      .toArray();
    if ((due[0]?.n ?? 0) > 0) {
      await this.state.storage.setAlarm(Date.now() + 1000);
      return;
    }
    if (next !== null) {
      await this.state.storage.setAlarm(next);
    }
  }

  /** DO alarm (phone push P3b). Fires due reminders for an OFFLINE recipient.
   *  Dead-man's-switch: if the laptop re-registered recently it is online and the
   *  laptop + the P1 watcher already handle reminders, so the alarm stands down
   *  (reschedules, does not deliver or delete). When the laptop has gone silent it
   *  delivers ONE batched generic buzz for all due reminders, then deletes them. */
  async alarm(): Promise<void> {
    const nowMs = Date.now();
    const meta = this.sql()
      .exec<{ registered_at: number | null; user_pubkey: string | null }>(
        "SELECT registered_at, user_pubkey FROM reminder_meta WHERE id = 1",
      )
      .toArray();
    if (meta.length === 0 || !meta[0].user_pubkey) return;
    const u = meta[0].user_pubkey;
    const registeredAt = meta[0].registered_at ?? 0;

    const due = this.sql()
      .exec<{ id: string }>("SELECT id FROM reminders WHERE fire_at <= ?", nowMs)
      .toArray();

    const laptopOnline = nowMs - registeredAt < this.staleMs();
    if (due.length > 0 && !laptopOnline) {
      // Gate on the recipient's own reminders routing + quiet hours + cooldown.
      const cfgRows = this.sql()
        .exec<{ config: string | null; last_notify_at: number | null }>(
          "SELECT config, last_notify_at FROM notify_config WHERE id = 1",
        )
        .toArray();
      const cooled =
        cfgRows.length > 0 &&
        nowMs - (cfgRows[0].last_notify_at ?? 0) >= this.cooldownMs();
      if (cfgRows.length > 0 && cfgRows[0].config && cooled) {
        try {
          const config = JSON.parse(cfgRows[0].config) as NotifyConfig;
          const phoneOn = shouldBuzzPhone(config, "reminders", nowMs);
          const emailOn = shouldEmail(config, "reminders", nowMs);
          if (phoneOn || emailOn) {
            this.sql().exec(
              "UPDATE notify_config SET last_notify_at = ? WHERE id = 1",
              nowMs,
            );
            await this.deliverToRecipient(
              u,
              "reminders",
              new Date(nowMs).toISOString(),
              config,
              phoneOn,
              emailOn,
            );
          }
        } catch {
          // A bad config or delivery failure must not strand the alarm; the due
          // entries are still deleted below so we never busy-loop on them.
        }
      }
      // Delete the due entries whether or not they buzzed (gated-off reminders
      // are still in the laptop's synced list); this prevents re-firing.
      for (const d of due) {
        this.sql().exec("DELETE FROM reminders WHERE id = ?", d.id);
      }
    }

    // Reschedule to the next future reminder (if any). When the laptop is online
    // we leave the due entries in place for the laptop to replace on re-register.
    const nextRows = this.sql()
      .exec<{ next: number | null }>(
        "SELECT MIN(fire_at) AS next FROM reminders WHERE fire_at > ?",
        nowMs,
      )
      .toArray();
    const next = nextRows[0]?.next ?? null;
    if (next !== null) {
      await this.state.storage.setAlarm(next);
    }
  }

  /** POST /capture/snapshot/publish (mobile download path). multipart/form-data:
   *  a `blob` file field (the SEALED ciphertext) + a text `meta` JSON field
   *  `{ u, name, device, ts, sig }`. The USER identity key signs over

  /** POST /capture/snapshot/publish (mobile download path). multipart/form-data:
   *  a `blob` file field (the SEALED ciphertext) + a text `meta` JSON field
   *  `{ u, name, device, ts, sig }`. The USER identity key signs over
   *  u + name + device + ts + sha256(sealed blob). We verify the device is bound
   *  to u, recompute the blob sha256, verify the user signature, then store the
   *  sealed blob overwrite-latest at `<u>/snap/<device>/<name>`. */
  private async handleSnapshotPublish(request: Request): Promise<Response> {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return this.json({ error: "invalid multipart body" }, 400);
    }

    const blob = form.get("blob");
    const metaRaw = form.get("meta");
    if (!(blob instanceof File) && !(blob instanceof Blob)) {
      return this.json({ error: "missing blob field" }, 400);
    }
    if (typeof metaRaw !== "string") {
      return this.json({ error: "missing meta field" }, 400);
    }

    let meta: {
      u?: unknown;
      name?: unknown;
      device?: unknown;
      ts?: unknown;
      sig?: unknown;
    };
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      return this.json({ error: "invalid meta JSON" }, 400);
    }

    const u = meta.u;
    const name = meta.name;
    const device = meta.device;
    const ts = meta.ts;
    const sig = meta.sig;
    if (
      typeof u !== "string" ||
      typeof name !== "string" ||
      typeof device !== "string" ||
      typeof ts !== "string" ||
      typeof sig !== "string"
    ) {
      return this.json({ error: "malformed meta" }, 400);
    }

    // The target device must be bound to this user (the laptop publishes to its
    // own paired devices only).
    if (!this.isBoundDevice(device)) {
      return this.json({ error: "device not bound" }, 403);
    }

    if (!this.isFreshIso(ts)) {
      return this.json({ error: "stale ts" }, 401);
    }

    // Recompute the sealed blob's sha256 so the user signature binds the exact
    // ciphertext we store.
    const blobBytes = new Uint8Array(await blob.arrayBuffer());
    const sha256 = await sha256Hex(blobBytes);
    const message = snapshotPublishMessage(u, name, device, ts, sha256);
    if (!this.verifySig(sig, message, u)) {
      return this.json({ error: "bad signature" }, 401);
    }

    const blobKey = `${u}/snap/${device}/${name}`;
    try {
      await this.env.CAPTURES.put(blobKey, blobBytes, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
    } catch {
      return this.json({ error: "storage write failed" }, 500);
    }

    return this.json({ ok: true }, 200);
  }

  /** GET /capture/snapshot/get?u=&name=&device=&ts=&sig= (mobile download path).
   *  DEVICE-key signed (the phone holds its Ed25519 device key, not the user
   *  key). The `device` param is the binding id AND the verifying pubkey. We
   *  verify the device is bound to u, then verify the signature against the
   *  device's bound Ed25519 key over u + name + device + ts, then return the
   *  latest sealed blob for `<u>/snap/<device>/<name>` (or 404). */
  private async handleSnapshotGet(u: string, url: URL): Promise<Response> {
    const name = url.searchParams.get("name") ?? "";
    const device = url.searchParams.get("device") ?? "";
    const ts = url.searchParams.get("ts") ?? "";
    const sig = url.searchParams.get("sig") ?? "";
    if (name.trim() === "" || device.trim() === "") {
      return this.json({ error: "missing name or device" }, 400);
    }

    if (!this.isBoundDevice(device)) {
      return this.json({ error: "device not bound" }, 403);
    }

    if (!this.isFreshIso(ts)) {
      return this.json({ error: "stale ts" }, 401);
    }
    // Signed by the DEVICE's bound Ed25519 key (the `device` param), NOT the
    // user key. This is the asymmetry the design calls out: the phone reads.
    const message = snapshotGetMessage(u, name, device, ts);
    if (!this.verifySig(sig, message, device)) {
      return this.json({ error: "bad signature" }, 401);
    }

    const blobKey = `${u}/snap/${device}/${name}`;
    const obj = await this.env.CAPTURES.get(blobKey);
    if (!obj) {
      return this.json({ error: "not found" }, 404);
    }

    return new Response(obj.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  }

  /** PUT /capture/context/publish. USER-signed. Stores the sealed focus context
   *  for one bound device. The laptop seals the same plaintext context to each
   *  device's X25519 key and calls this once per device. */
  private async handleContextPublish(u: string, request: Request): Promise<Response> {
    let body: { u?: unknown; device?: unknown; ts?: unknown; sig?: unknown; sealed?: unknown };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const device = body.device;
    const ts = body.ts;
    const sig = body.sig;
    const sealed = body.sealed;
    if (
      typeof device !== "string" ||
      typeof ts !== "string" ||
      typeof sig !== "string" ||
      typeof sealed !== "string"
    ) {
      return this.json({ error: "malformed context publish" }, 400);
    }
    if (!this.isBoundDevice(device)) {
      return this.json({ error: "device not bound" }, 403);
    }

    const enc = new TextEncoder();
    const sealedBytes = enc.encode(sealed);
    const sha = await sha256Hex(sealedBytes);
    const denied = this.userGate(u, ts, sig, contextPublishMessage(u, device, ts, sha));
    if (denied) return denied;

    this.sql().exec(
      "INSERT INTO context (device_pubkey, sealed, updated_at) VALUES (?, ?, ?) ON CONFLICT(device_pubkey) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at",
      device,
      sealed,
      new Date().toISOString(),
    );
    return this.json({ ok: true }, 200);
  }

  /** GET /capture/context?u=&device=&ts=&sig=. DEVICE-signed. Returns the
   *  sealed focus context for the requesting device, or null if none published. */
  private handleContextGet(url: URL): Response {
    const u = url.searchParams.get("u") ?? "";
    const device = url.searchParams.get("device") ?? "";
    const ts = url.searchParams.get("ts") ?? "";
    const sig = url.searchParams.get("sig") ?? "";

    const denied = this.deviceGate(device, ts, sig, contextGetMessage(u, device, ts));
    if (denied) return denied;

    const rows = this.sql()
      .exec<{ sealed: string; updated_at: string }>(
        "SELECT sealed, updated_at FROM context WHERE device_pubkey = ?",
        device,
      )
      .toArray();

    if (rows.length === 0) {
      return this.json({ sealed: null }, 200);
    }
    return this.json({ sealed: rows[0].sealed, updatedAt: rows[0].updated_at }, 200);
  }

  /** POST /capture/command. DEVICE-signed. The phone posts one sealed command;
   *  the laptop polls and acks it. */
  private async handleCommandPost(request: Request): Promise<Response> {
    let body: {
      u?: unknown;
      device?: unknown;
      commandId?: unknown;
      ts?: unknown;
      sig?: unknown;
      sealed?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const u = body.u;
    const device = body.device;
    const commandId = body.commandId;
    const ts = body.ts;
    const sig = body.sig;
    const sealed = body.sealed;
    if (
      typeof u !== "string" ||
      typeof device !== "string" ||
      typeof commandId !== "string" ||
      typeof ts !== "string" ||
      typeof sig !== "string" ||
      typeof sealed !== "string"
    ) {
      return this.json({ error: "malformed command post" }, 400);
    }

    const enc = new TextEncoder();
    const sealedBytes = enc.encode(sealed);
    const sha = await sha256Hex(sealedBytes);
    const denied = this.deviceGate(device, ts, sig, commandPostMessage(u, device, commandId, ts, sha));
    if (denied) return denied;

    this.sql().exec(
      "INSERT INTO commands (command_id, sealed, created_at) VALUES (?, ?, ?) ON CONFLICT(command_id) DO NOTHING",
      commandId,
      sealed,
      new Date().toISOString(),
    );
    return this.json({ ok: true, commandId }, 200);
  }

  /** GET /capture/commands/poll?u=&ts=&sig=. USER-signed. Returns all pending
   *  commands, oldest-first (FIFO). */
  private handleCommandsPoll(u: string, url: URL): Response {
    const ts = url.searchParams.get("ts") ?? "";
    const sig = url.searchParams.get("sig") ?? "";
    const denied = this.userGate(u, ts, sig, commandsPollMessage(u, ts));
    if (denied) return denied;

    const rows = this.sql()
      .exec<{ command_id: string; sealed: string; created_at: string }>(
        "SELECT command_id, sealed, created_at FROM commands ORDER BY created_at ASC",
      )
      .toArray();

    const commands = rows.map((r) => ({
      commandId: r.command_id,
      sealed: r.sealed,
      createdAt: r.created_at,
    }));
    return this.json({ commands }, 200);
  }

  /** POST /capture/commands/ack. USER-signed. Deletes the acked command rows.
   *  The signed ids are sorted + comma-joined so client and worker agree on bytes. */
  private async handleCommandsAck(u: string, request: Request): Promise<Response> {
    let body: { u?: unknown; ids?: unknown; ts?: unknown; sig?: unknown };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }
    const ids = body.ids;
    const ts = body.ts;
    const sig = body.sig;
    if (!Array.isArray(ids) || typeof ts !== "string" || typeof sig !== "string") {
      return this.json({ error: "malformed ack" }, 400);
    }
    const stringIds = ids.filter((id): id is string => typeof id === "string");
    if (stringIds.length === 0) {
      return this.json({ deleted: 0 }, 200);
    }
    const denied = this.userGate(u, ts, sig, commandsAckMessage(u, stringIds, ts));
    if (denied) return denied;

    for (const id of stringIds) {
      this.sql().exec("DELETE FROM commands WHERE command_id = ?", id);
    }
    return this.json({ deleted: stringIds.length }, 200);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST routes carry u in the body (register) or are addressed by the worker
    // via the meta.u routing (upload); ack + devices/revoke carry u in the body.
    if (url.pathname === "/capture/register") {
      if (request.method !== "POST") return this.json({ error: "method not allowed" }, 405);
      return this.handleRegister(request);
    }
    if (url.pathname === "/capture/upload") {
      if (request.method !== "POST") return this.json({ error: "method not allowed" }, 405);
      return this.handleUpload(request);
    }
    // Snapshot publish is multipart (u lives in meta, like upload), so it does
    // not go through the JSON peekBodyU path below.
    if (url.pathname === "/capture/snapshot/publish") {
      if (request.method !== "POST") return this.json({ error: "method not allowed" }, 405);
      return this.handleSnapshotPublish(request);
    }
    if (url.pathname === "/capture/snapshot/get") {
      if (request.method !== "GET") return this.json({ error: "method not allowed" }, 405);
      return this.handleSnapshotGet(url.searchParams.get("u") ?? "", url);
    }
    // Context publish is a PUT with u in the query string (not in the body), so
    // it is handled before the peekBodyU block below.
    if (url.pathname === "/capture/context/publish") {
      if (request.method !== "PUT") return this.json({ error: "method not allowed" }, 405);
      return this.handleContextPublish(url.searchParams.get("u") ?? "", request);
    }
    if (url.pathname === "/capture/context") {
      if (request.method !== "GET") return this.json({ error: "method not allowed" }, 405);
      return this.handleContextGet(url);
    }
    if (url.pathname === "/capture/commands/poll") {
      if (request.method !== "GET") return this.json({ error: "method not allowed" }, 405);
      return this.handleCommandsPoll(url.searchParams.get("u") ?? "", url);
    }

    // The remaining routes are user-key-signed and carry u in ?u (GET) or the
    // body (POST). The worker already routed to this DO by that same u.
    const uBody =
      request.method === "POST"
        ? await this.peekBodyU(request)
        : { u: url.searchParams.get("u") ?? "", request };

    if (url.pathname === "/capture/ack") {
      if (request.method !== "POST") return this.json({ error: "method not allowed" }, 405);
      return this.handleAck(uBody.u, uBody.request);
    }
    if (url.pathname === "/capture/devices/revoke") {
      if (request.method !== "POST") return this.json({ error: "method not allowed" }, 405);
      return this.handleRevoke(uBody.u, uBody.request);
    }
    if (url.pathname === "/capture/devices/push-token") {
      if (request.method !== "POST") return this.json({ error: "method not allowed" }, 405);
      return this.handleSetPushToken(uBody.u, uBody.request);
    }
    if (url.pathname === "/capture/notify-config") {
      if (request.method !== "POST") return this.json({ error: "method not allowed" }, 405);
      return this.handleNotifyConfig(uBody.u, uBody.request);
    }
    if (url.pathname === "/capture/notify-recipient") {
      if (request.method !== "POST") return this.json({ error: "method not allowed" }, 405);
      return this.handleNotifyRecipient(uBody.u, uBody.request);
    }
    if (url.pathname === "/capture/register-reminders") {
      if (request.method !== "POST") return this.json({ error: "method not allowed" }, 405);
      return this.handleRegisterReminders(uBody.u, uBody.request);
    }
    if (url.pathname === "/capture/inbox") {
      if (request.method !== "GET") return this.json({ error: "method not allowed" }, 405);
      return this.handleInbox(url.searchParams.get("u") ?? "", url);
    }
    if (url.pathname === "/capture/object") {
      if (request.method !== "GET") return this.json({ error: "method not allowed" }, 405);
      return this.handleObject(url.searchParams.get("u") ?? "", url);
    }
    if (url.pathname === "/capture/devices") {
      if (request.method !== "GET") return this.json({ error: "method not allowed" }, 405);
      return this.handleDevices(url.searchParams.get("u") ?? "", url);
    }
    if (url.pathname === "/capture/command") {
      if (request.method !== "POST") return this.json({ error: "method not allowed" }, 405);
      return this.handleCommandPost(uBody.request);
    }
    if (url.pathname === "/capture/commands/ack") {
      if (request.method !== "POST") return this.json({ error: "method not allowed" }, 405);
      return this.handleCommandsAck(uBody.u, uBody.request);
    }

    return this.json({ error: "not found" }, 404);
  }

  /** Reads u from a JSON POST body without consuming the original stream, and
   *  hands back a fresh Request the handler can re-parse. The body is only ever
   *  read once per handler, so the clone is cheap. */
  private async peekBodyU(
    request: Request,
  ): Promise<{ u: string; request: Request }> {
    const cloned = request.clone();
    let u = "";
    try {
      const body = (await cloned.json()) as { u?: unknown };
      if (typeof body.u === "string") u = body.u;
    } catch {
      // Leave u empty; the handler re-parses and returns the malformed error.
    }
    return { u, request };
  }
}

// ===========================================================================
// Lab tier Phase 3 chunk 1: the server-blind lab data store (/lab/data/*).
//
// The worker stores and returns opaque lab-key ciphertext in the LAB_DATA R2
// bucket. It NEVER holds the lab key and NEVER decrypts. The R2 object key is
// `${labId}/${owner}/${recordType}/${recordId}` (plaintext routing metadata so
// the PI can enumerate a member's records by prefix). Signed writes and lists
// are verified against the lab roster fetched from the REAL LabRecordDO via the
// POST /lab/get route (NOT a /lab/roster route; that does not exist). Reads are
// open at the transport (useless without the lab key).
// ===========================================================================

/** Verifies a hex Ed25519 signature over a UTF-8 message under a hex pubkey.
 *  Pure JS (@noble/curves), so it runs in workerd. Any malformed input is a
 *  verification failure, never a throw. (Mirrors CollabRoom.verifySig.) */
function verifyLabSig(
  sigHex: string,
  message: string,
  pubkeyHex: string,
): boolean {
  try {
    const sig = hexToBytes(sigHex);
    const pub = hexToBytes(pubkeyHex);
    const msg = new TextEncoder().encode(message);
    return ed25519.verify(sig, msg, pub);
  } catch {
    return false;
  }
}

/** A millisecond-epoch issuedAt is fresh within +/- 5 minutes of now. */
function labTsFresh(issuedAt: number): boolean {
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return false;
  return Math.abs(Date.now() - issuedAt) <= 5 * 60 * 1000;
}

function labJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** The roster shape the data routes check against. Built by fetchRoster from the
 *  real LabRecordDO /lab/get response. */
interface LabRosterPayload {
  labId: string;
  /** Hex Ed25519 signing pubkey of the lab head. */
  headPubkey: string;
  members: Array<{ pubkey: string; role: string }>;
}

/** True when pubkeyHex is the head or a listed member of the roster. */
function rosterAllows(roster: LabRosterPayload, pubkeyHex: string): boolean {
  const target = pubkeyHex.toLowerCase();
  if (roster.headPubkey.toLowerCase() === target) return true;
  return roster.members.some((m) => m.pubkey.toLowerCase() === target);
}

/**
 * Fetches a lab's roster from its REAL LabRecordDO via POST /lab/get, or null
 * when the lab does not exist (fail-closed). The DO returns the full record
 * including `record.head` (a LabMemberWire with ed25519PublicKey) and
 * `record.members` (LabMemberWire[]). We map head.ed25519PublicKey to
 * headPubkey, and members[].ed25519PublicKey to members[].pubkey.
 *
 * This is the ONLY place the data routes talk to the LabRecordDO. There is NO
 * /lab/roster endpoint on the DO; that route does not exist.
 */
async function fetchRoster(
  env: Env,
  labId: string,
): Promise<LabRosterPayload | null> {
  const stub = env.LAB_RECORD.get(env.LAB_RECORD.idFromName(labId));
  // POST /lab/get?lab=<labId> is the real DO's open-read endpoint. Returns
  // { record: { labId, head, members, keyGeneration, log }, envelopes } on 200
  // or { error } on 404 when the lab does not exist.
  const res = await stub.fetch(
    `https://lab-record/lab/get?lab=${encodeURIComponent(labId)}`,
    { method: "POST" },
  );
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as {
      record?: {
        labId?: string;
        head?: { ed25519PublicKey?: string; [k: string]: unknown } | null;
        members?: Array<{ ed25519PublicKey?: string; role?: string; [k: string]: unknown }>;
        [k: string]: unknown;
      };
    };
    const record = data.record;
    if (!record) return null;
    const headPubkey = record.head?.ed25519PublicKey;
    if (typeof headPubkey !== "string" || headPubkey.trim() === "") return null;
    const members = Array.isArray(record.members)
      ? record.members
          .filter(
            (m): m is { ed25519PublicKey: string; role: string } =>
              !!m && typeof m.ed25519PublicKey === "string",
          )
          .map((m) => ({ pubkey: m.ed25519PublicKey, role: m.role ?? "member" }))
      : [];
    return { labId, headPubkey, members };
  } catch {
    return null;
  }
}

/** Decodes a base64 string to bytes. Uses atob (available in workerd). */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ---- Lab data store canonical signed-byte strings --------------------------
// THE CONTRACT. The client (frontend/src/lib/lab/lab-data-protocol.ts) keeps
// byte-identical copies of labDataPutMessage / labDataListMessage; if you
// change one, change both, or signatures stop verifying.

/** The R2 object key for one lab record. Mirrors labDataObjectKey in the client
 *  protocol module. */
function labDataObjectKeyServer(
  labId: string,
  owner: string,
  recordType: string,
  recordId: string,
): string {
  return `${labId}/${owner}/${recordType}/${recordId}`;
}

/** Canonical PUT message (mirrors labDataPutMessage in the client). */
function labDataPutCanonical(
  labId: string,
  owner: string,
  recordType: string,
  recordId: string,
  ciphertextSha256: string,
  issuedAt: number,
): string {
  return [
    "lab-data-put",
    `labId=${labId}`,
    `owner=${owner}`,
    `recordType=${recordType}`,
    `recordId=${recordId}`,
    `sha256=${ciphertextSha256}`,
    `issuedAt=${issuedAt}`,
  ].join("\n");
}

/** Canonical LIST message (mirrors labDataListMessage in the client). */
function labDataListCanonical(
  labId: string,
  prefix: string,
  issuedAt: number,
): string {
  return [
    "lab-data-list",
    `labId=${labId}`,
    `prefix=${prefix}`,
    `issuedAt=${issuedAt}`,
  ].join("\n");
}

// ===========================================================================
// Lab membership discovery (reverse KV index).
// ===========================================================================
//
// LAB_MEMBERSHIP_INDEX KV: key = hex Ed25519 pubkey, value = JSON string[].
// Written best-effort at /lab/create (head) and /lab/append "add" entries.
// Read by POST /lab/discover-memberships (signed by the member being looked up).
//
// KV writes are ALWAYS best-effort and non-fatal. A KV failure must never break
// /lab/create or /lab/append.

/**
 * Appends labId to the KV membership list for pubkeyHex, deduplicating.
 * Silently swallows all errors (best-effort, non-fatal).
 */
async function kvIndexAddMembership(
  kv: KVNamespace | undefined,
  pubkeyHex: string,
  labId: string,
): Promise<void> {
  if (!kv) return; // KV binding not configured (local dev or not deployed yet)
  try {
    const existing = await kv.get(pubkeyHex);
    const labs: string[] = existing ? (JSON.parse(existing) as string[]) : [];
    if (!labs.includes(labId)) {
      labs.push(labId);
    }
    await kv.put(pubkeyHex, JSON.stringify(labs));
  } catch {
    // Best-effort: a KV write failure must never bubble up to the caller.
  }
}

/**
 * Removes labId from the KV membership list for pubkeyHex. Silently swallows
 * all errors (best-effort, non-fatal). Called on /lab/append "remove" entries.
 */
async function kvIndexRemoveMembership(
  kv: KVNamespace | undefined,
  pubkeyHex: string,
  labId: string,
): Promise<void> {
  if (!kv) return;
  try {
    const existing = await kv.get(pubkeyHex);
    if (!existing) return;
    const labs: string[] = JSON.parse(existing) as string[];
    const updated = labs.filter((id) => id !== labId);
    if (updated.length === labs.length) return; // nothing changed
    await kv.put(pubkeyHex, JSON.stringify(updated));
  } catch {
    // Best-effort: a KV write failure must never bubble up to the caller.
  }
}

/**
 * POST /lab/discover-memberships?pubkey=<hex>.
 *
 * The client sends { issuedAt: number, signature: hex } in the JSON body.
 * The signature covers the UTF-8 bytes of the canonical message:
 *   "lab-discover-memberships\n<pubkey_hex>\n<issuedAt>"
 * which byte-matches discoverMembershipsCanonicalMessage in
 * frontend/src/lib/lab/lab-membership-discovery.ts.
 *
 * On valid signature and fresh issuedAt, returns { labIds: string[] }.
 * On unknown pubkey (valid sig but not in the index), returns { labIds: [] }.
 * On bad/stale sig, returns 401. On malformed request, returns 400.
 *
 * If the KV binding is absent (local dev), returns { labIds: [] } so the
 * client's 404/error-degrade path also handles this gracefully.
 */
async function handleLabDiscoverMemberships(
  url: URL,
  request: Request,
  env: Env,
): Promise<Response> {
  const pubkeyHex = url.searchParams.get("pubkey");
  if (!pubkeyHex || pubkeyHex.trim() === "") {
    return new Response(JSON.stringify({ error: "missing pubkey query param" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let body: { issuedAt?: unknown; signature?: unknown };
  try {
    body = (await request.json()) as { issuedAt?: unknown; signature?: unknown };
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const issuedAt = body.issuedAt;
  const signature = body.signature;
  if (typeof issuedAt !== "number" || typeof signature !== "string") {
    return new Response(
      JSON.stringify({ error: "malformed body: issuedAt (number) and signature (string) required" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  // Freshness window: +/- 5 minutes (matches CollabRoom.isFresh and the client comment).
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 5 * 60 * 1000) {
    return new Response(JSON.stringify({ error: "stale issuedAt" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Canonical message: byte-identical to discoverMembershipsCanonicalMessage in
  // frontend/src/lib/lab/lab-membership-discovery.ts.
  //   "lab-discover-memberships\n<pubkey_hex>\n<issuedAt>"
  const canonicalMessage = `lab-discover-memberships\n${pubkeyHex}\n${issuedAt}`;

  let sigValid = false;
  try {
    const sig = hexToBytes(signature);
    const pub = hexToBytes(pubkeyHex);
    const msg = new TextEncoder().encode(canonicalMessage);
    sigValid = ed25519.verify(sig, msg, pub);
  } catch {
    sigValid = false;
  }
  if (!sigValid) {
    return new Response(JSON.stringify({ error: "bad signature" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // KV lookup. Missing binding (local dev without KV) and unknown pubkey both
  // return { labIds: [] } rather than a 404, so the client's graceful-degrade
  // path (which only triggers on 404 or network error) keeps working.
  if (!env.LAB_MEMBERSHIP_INDEX) {
    return new Response(JSON.stringify({ labIds: [] }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let labIds: string[] = [];
  try {
    const raw = await env.LAB_MEMBERSHIP_INDEX.get(pubkeyHex);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        labIds = parsed.filter((v): v is string => typeof v === "string");
      }
    }
  } catch {
    // KV read failure: degrade to []. The client handles this gracefully.
    labIds = [];
  }

  return new Response(JSON.stringify({ labIds }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Worker-level dispatch for the SERVER-BLIND lab data store. */
async function handleLabData(
  url: URL,
  request: Request,
  env: Env,
): Promise<Response> {
  if (url.pathname === "/lab/data/put") {
    if (request.method !== "POST") {
      return labJson({ error: "method not allowed" }, 405);
    }
    return handleLabDataPut(request, env);
  }
  if (url.pathname === "/lab/data/get") {
    if (request.method !== "GET") {
      return labJson({ error: "method not allowed" }, 405);
    }
    return handleLabDataGet(url, env);
  }
  if (url.pathname === "/lab/data/list") {
    if (request.method !== "POST") {
      return labJson({ error: "method not allowed" }, 405);
    }
    return handleLabDataList(request, env);
  }
  return labJson({ error: "not found" }, 404);
}

/** POST /lab/data/put. Member/head-signed write of one lab-key ciphertext blob.
 *  The signature binds the ciphertext sha256, so the stored bytes cannot be
 *  swapped under a valid signature. The worker NEVER decrypts the ciphertext. */
async function handleLabDataPut(request: Request, env: Env): Promise<Response> {
  let body: {
    labId?: unknown;
    owner?: unknown;
    recordType?: unknown;
    recordId?: unknown;
    ciphertext?: unknown;
    signerPubkey?: unknown;
    issuedAt?: unknown;
    signature?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return labJson({ error: "invalid JSON body" }, 400);
  }

  const { labId, owner, recordType, recordId, ciphertext, signerPubkey, issuedAt, signature } =
    body;
  if (
    typeof labId !== "string" ||
    typeof owner !== "string" ||
    typeof recordType !== "string" ||
    typeof recordId !== "string" ||
    typeof ciphertext !== "string" ||
    typeof signerPubkey !== "string" ||
    typeof issuedAt !== "number" ||
    typeof signature !== "string"
  ) {
    return labJson({ error: "malformed put" }, 400);
  }
  if (!labTsFresh(issuedAt)) {
    return labJson({ error: "stale issuedAt" }, 401);
  }

  // Decode the ciphertext (base64) to opaque bytes. The worker treats these as
  // an opaque blob; it never interprets or decrypts them.
  let ciphertextBytes: Uint8Array;
  try {
    ciphertextBytes = base64ToBytes(ciphertext);
  } catch {
    return labJson({ error: "bad ciphertext encoding" }, 400);
  }

  const ciphertextSha256 = await sha256Hex(ciphertextBytes);
  const message = labDataPutCanonical(
    labId,
    owner,
    recordType,
    recordId,
    ciphertextSha256,
    issuedAt,
  );
  if (!verifyLabSig(signature, message, signerPubkey)) {
    return labJson({ error: "bad signature" }, 401);
  }

  const roster = await fetchRoster(env, labId);
  if (!roster || !rosterAllows(roster, signerPubkey)) {
    return labJson({ error: "not a lab member" }, 401);
  }

  const key = labDataObjectKeyServer(labId, owner, recordType, recordId);
  try {
    await env.LAB_DATA.put(key, ciphertextBytes);
  } catch {
    return labJson({ error: "storage write failed" }, 500);
  }
  return labJson({ ok: true, key }, 200);
}

/** GET /lab/data/get?key=<labId/owner/recordType/recordId>. Returns the raw
 *  ciphertext bytes; the caller decrypts with the lab key client-side. Open at
 *  the transport because the blob is useless without the lab key (which the
 *  relay never holds). The worker NEVER decrypts. */
async function handleLabDataGet(url: URL, env: Env): Promise<Response> {
  const key = url.searchParams.get("key");
  if (!key || key.trim() === "") {
    return labJson({ error: "missing key" }, 400);
  }
  const obj = await env.LAB_DATA.get(key);
  if (!obj) {
    return labJson({ error: "not found" }, 404);
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}

/** POST /lab/data/list. Member/head-signed enumeration of the R2 object keys
 *  under `${labId}/${prefix}` (prefix = an owner or `owner/recordType`). This is
 *  what lets the PI enumerate every member's lab records. */
async function handleLabDataList(request: Request, env: Env): Promise<Response> {
  let body: {
    labId?: unknown;
    prefix?: unknown;
    signerPubkey?: unknown;
    issuedAt?: unknown;
    signature?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return labJson({ error: "invalid JSON body" }, 400);
  }

  const { labId, prefix, signerPubkey, issuedAt, signature } = body;
  if (
    typeof labId !== "string" ||
    typeof prefix !== "string" ||
    typeof signerPubkey !== "string" ||
    typeof issuedAt !== "number" ||
    typeof signature !== "string"
  ) {
    return labJson({ error: "malformed list" }, 400);
  }
  if (!labTsFresh(issuedAt)) {
    return labJson({ error: "stale issuedAt" }, 401);
  }

  const message = labDataListCanonical(labId, prefix, issuedAt);
  if (!verifyLabSig(signature, message, signerPubkey)) {
    return labJson({ error: "bad signature" }, 401);
  }

  const roster = await fetchRoster(env, labId);
  if (!roster || !rosterAllows(roster, signerPubkey)) {
    return labJson({ error: "not a lab member" }, 401);
  }

  // R2 list under the full `${labId}/${prefix}` namespace, paging through the
  // truncated cursor so a large lab enumerates fully.
  const fullPrefix = prefix === "" ? `${labId}/` : `${labId}/${prefix}`;
  const keys: string[] = [];
  let cursor: string | undefined = undefined;
  try {
    do {
      const listed: R2Objects = await env.LAB_DATA.list({
        prefix: fullPrefix,
        cursor,
      });
      for (const o of listed.objects) keys.push(o.key);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  } catch {
    return labJson({ error: "storage list failed" }, 500);
  }
  return labJson({ keys }, 200);
}

// ===========================================================================
// Lab tier Phase 2: the per-lab record store.
// ===========================================================================
//
// LAB-LOG CANONICAL MESSAGE. THE CONTRACT. This MUST byte-match
// canonicalEntryMessage in frontend/src/lib/lab/lab-membership.ts exactly, since
// the head signs that string and the DO verifies the same bytes. If you change
// one, change both. The client builder labLogCanonicalMessage in
// frontend/src/lib/lab/lab-do-client.ts is a third copy that must agree too;
// the client tests round-trip a real lab-key entry through this DO to prove it.

interface LabMemberWire {
  username: string;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  role: "head" | "member";
}

interface LabLogEntryWire {
  seq: number;
  // "role" (Lab Manager Phase 1) is a head-signed roster change that flips a
  // member's admin flag WITHOUT a key effect, so it behaves like "remove" on this
  // relay (no envelope, no copy, generation stays put). See the append handler.
  type: "create" | "add" | "remove" | "rotate" | "role";
  keyGeneration: number;
  roster: LabMemberWire[];
  subject?: LabMemberWire;
  issuedAt: number;
  prevHash: string;
  signature: string;
}

interface LabKeyCopyWire {
  username: string;
  sealed: string;
}

interface LabEnvelopeWire {
  generation: number;
  copies: LabKeyCopyWire[];
  seedLink?: string;
}

/**
 * The exact canonical message the head signs for a log entry (everything but the
 * signature, in a fixed order, with the "lab-log" verb prefix). Byte-identical to
 * canonicalEntryMessage in lab-membership.ts. JSON.stringify of roster/subject is
 * deterministic because both sides construct those objects with the same key
 * order, so sign and verify produce identical bytes.
 */
function labLogCanonicalMessage(entry: Omit<LabLogEntryWire, "signature">): string {
  return [
    "lab-log",
    String(entry.seq),
    entry.type,
    String(entry.keyGeneration),
    JSON.stringify(entry.roster),
    JSON.stringify(entry.subject ?? null),
    String(entry.issuedAt),
    entry.prevHash,
  ].join("\n");
}

/**
 * Per-lab record store (lab tier Phase 2). One DO instance per labId
 * (idFromName(labId)). It is the authoritative server-side home of a lab:
 *
 *   - head_pubkey: the head's Ed25519 signing key, set on /lab/create like
 *     RecipientInbox sets recipient_pubkey on first push. Every later write is
 *     verified against it, so only the head can extend the log.
 *   - the head-signed, hash-chained membership log (one row per entry).
 *   - one sealed lab-key ENVELOPE per generation (copies sealed to each member's
 *     X25519 key + an optional seed link).
 *
 * SECURITY MODEL. The server stays BLIND to the lab key. It only ever receives
 * sealed copies (openable solely with a member's X25519 private key) and signed
 * public metadata. It never sees the 32-byte lab key in plaintext.
 *
 * Authentication is the LOG ENTRY's own head signature, not a separate request
 * token: each entry carries an Ed25519 signature by the head over
 * labLogCanonicalMessage(entry). On /lab/create the DO records head_pubkey from
 * the genesis entry's verified roster head and stores the entry + envelope. On
 * /lab/append the DO verifies the new entry's signature against the STORED
 * head_pubkey AND that it chains correctly onto the stored tail (seq monotonic,
 * prevHash = sha256(tail signature), generation rule), mirroring
 * verifyMembershipLog, before it accepts the row. A non-head signature, a forged
 * generation jump, a replayed/reordered seq, or a broken prevHash is rejected.
 *
 * /lab/get is an open read of the record + envelopes. The sealed copies are
 * crypto-gated (only the right member can open theirs), so an open read leaks no
 * lab key. An optional requester signature can gate it for symmetry, but is not
 * required.
 */
export class LabRecordDO {
  readonly state: DurableObjectState;
  readonly env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // One row per log entry, in seq order. entry is the full LabLogEntryWire JSON.
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS log (seq INTEGER PRIMARY KEY, type TEXT, key_generation INTEGER, signature TEXT, entry TEXT)",
    );
    // One row per generation, holding that generation's sealed envelope JSON.
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS envelopes (generation INTEGER PRIMARY KEY, envelope TEXT)",
    );
    // meta holds 'head_pubkey' (hex, set on create) and 'lab_id'.
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)",
    );
    // Pending join ACCEPTS (lab tier Phase 8c), one row per joining MEMBER. A
    // member who opened a head-minted invite link posts a signed accept here
    // (the member email is SEALED to the head, so this row leaks no email). The
    // head reads them (head-signed /lab/accept/list), verifies + finalizes
    // (addMember), then dismisses. Keyed by the member's Ed25519 pubkey so ONE
    // reusable invite link admits MANY members (each joiner gets their own
    // pending row), and a member re-posting replaces only their own row.
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS lab_accepts (member_pubkey TEXT PRIMARY KEY, nonce TEXT, accept TEXT, created_at INTEGER)",
    );
    // One-time, idempotent, best-effort migration from the legacy nonce-keyed
    // `accepts` table to the member-keyed `lab_accepts` table. A no-op once the
    // legacy table is gone (the outer try/catch swallows the missing-table case).
    try {
      const legacy = this.sql()
        .exec<{ accept: string; created_at: number }>(
          "SELECT accept, created_at FROM accepts",
        )
        .toArray();
      for (const r of legacy) {
        try {
          const a = JSON.parse(r.accept);
          if (a && typeof a.memberEd25519Pub === "string") {
            this.sql().exec(
              "INSERT INTO lab_accepts (member_pubkey, nonce, accept, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(member_pubkey) DO NOTHING",
              a.memberEd25519Pub,
              a.nonce ?? "",
              r.accept,
              r.created_at,
            );
          }
        } catch {
          /* skip a bad legacy row */
        }
      }
      this.sql().exec("DROP TABLE accepts");
    } catch {
      /* no legacy table, nothing to migrate */
    }
  }

  private sql(): SqlStorage {
    return this.state.storage.sql;
  }

  private metaGet(key: string): string | null {
    const rows = this.sql()
      .exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", key)
      .toArray();
    return rows.length > 0 ? rows[0].v : null;
  }

  private metaSet(key: string, value: string): void {
    this.sql().exec(
      "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      key,
      value,
    );
  }

  /** Verifies a hex Ed25519 signature over a UTF-8 message under a hex pubkey.
   *  Any malformed input is a verification failure, never a throw. */
  private verifySig(sigHex: string, message: string, pubkeyHex: string): boolean {
    try {
      const sig = hexToBytes(sigHex);
      const pub = hexToBytes(pubkeyHex);
      const msg = new TextEncoder().encode(message);
      return ed25519.verify(sig, msg, pub);
    } catch {
      return false;
    }
  }

  private json(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  /** sha256 hex of an entry's signature bytes, the next entry's prevHash. Matches
   *  hashEntrySignature in lab-membership.ts (sha256 of the hex-decoded
   *  signature). */
  private async hashEntrySignature(signatureHex: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      hexToBytes(signatureHex),
    );
    const view = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < view.length; i++) {
      hex += view[i].toString(16).padStart(2, "0");
    }
    return hex;
  }

  /** Basic structural validation of a log entry from the wire. Returns null on a
   *  shape problem (so the caller returns 400). Does NOT verify the signature or
   *  the chain (those are separate steps). */
  private badEntryShape(entry: unknown): entry is LabLogEntryWire {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    if (typeof e.seq !== "number" || !Number.isInteger(e.seq) || e.seq < 0) {
      return false;
    }
    if (
      e.type !== "create" &&
      e.type !== "add" &&
      e.type !== "remove" &&
      e.type !== "rotate" &&
      e.type !== "role"
    ) {
      return false;
    }
    if (typeof e.keyGeneration !== "number" || !Number.isInteger(e.keyGeneration)) {
      return false;
    }
    if (!Array.isArray(e.roster)) return false;
    if (typeof e.issuedAt !== "number") return false;
    if (typeof e.prevHash !== "string") return false;
    if (typeof e.signature !== "string") return false;
    return true;
  }

  /** The stored log tail, or null when the log is empty. */
  private tail(): LabLogEntryWire | null {
    const rows = this.sql()
      .exec<{ entry: string }>(
        "SELECT entry FROM log ORDER BY seq DESC LIMIT 1",
      )
      .toArray();
    return rows.length > 0 ? (JSON.parse(rows[0].entry) as LabLogEntryWire) : null;
  }

  /** POST /lab/create?lab=<labId>. The genesis: a head-signed seq-0 create entry
   *  plus the gen-0 envelope. The DO verifies the head signature on the entry,
   *  records head_pubkey, and stores the entry + envelope. Rejects if the lab
   *  already exists (head_pubkey already set) with 409. */
  /**
   * Best-effort report of this lab's current member roster to the Vercel billing
   * reconcile endpoint, so members who joined by an invite link (membership lives
   * here in the DO with no Neon touchpoint) are enrolled in the lab's shared
   * billing pool, and members who left are removed. Mirrors CollabRoom's
   * reportDocSize: fail-silent, only when APP_BASE_URL is set, secret-gated. Sends
   * Ed25519 PUBKEYS only (Vercel resolves them to email hashes), so no email
   * leaves the DO. See docs/proposals/LAB_SHARED_BILLING_POOL.md.
   */
  private async reportLabRoster(roster: LabMemberWire[]): Promise<boolean> {
    const base = this.env.APP_BASE_URL;
    if (!base) {
      // No APP_BASE_URL means the relay cannot reach the Vercel billing layer, so
      // a lab's roster never reconciles into the shared billing pool. This is a
      // valid local-dev state, but in a real deploy it silently strands billing,
      // so warn loudly enough to catch a misconfigured deploy in the relay logs.
      console.warn(
        "[lab] reportLabRoster skipped: APP_BASE_URL is unset; billing pool will not reconcile",
      );
      return false;
    }
    const piPubkey = this.metaGet("head_pubkey");
    if (!piPubkey) return false; // lab not created yet
    const members = roster
      .filter(
        (m) => m && m.role !== "head" && typeof m.ed25519PublicKey === "string",
      )
      .map((m) => ({ pubkey: m.ed25519PublicKey, username: m.username }));
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.env.RELAY_BREAKER_SECRET) {
      headers.authorization = `Bearer ${this.env.RELAY_BREAKER_SECRET}`;
    }
    const body = JSON.stringify({ piPubkey, members });
    // Bounded retry so a transient Vercel hiccup does not silently drop the sync.
    // The reconcile route is idempotent (it reconciles to the full roster each
    // time), so a retry is always safe to re-send.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const res = await fetch(`${base}/api/billing/lab/reconcile`, {
          method: "POST",
          headers,
          body,
        });
        if (res.ok) return true;
        // A 4xx is not worth retrying (bad request / auth); only retry 5xx.
        if (res.status < 500) return false;
      } catch {
        // network error: fall through to retry
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 150 * attempt));
      }
    }
    // Exhausted retries; enrollment self-heals on the next membership change or
    // an explicit /lab/resync.
    return false;
  }

  private async handleCreate(request: Request, labId: string): Promise<Response> {
    let body: { entry?: unknown; envelope?: unknown };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const entry = body.entry;
    const envelope = body.envelope as LabEnvelopeWire | undefined;
    if (!this.badEntryShape(entry)) {
      return this.json({ error: "malformed entry" }, 400);
    }
    if (
      !envelope ||
      typeof envelope !== "object" ||
      typeof (envelope as LabEnvelopeWire).generation !== "number" ||
      !Array.isArray((envelope as LabEnvelopeWire).copies)
    ) {
      return this.json({ error: "malformed envelope" }, 400);
    }

    // Reject a duplicate create. head_pubkey is set exactly once, here.
    if (this.metaGet("head_pubkey") !== null) {
      return this.json({ error: "lab already exists" }, 409);
    }

    // Genesis shape: seq 0, type create, empty prevHash, generation 0.
    if (entry.seq !== 0 || entry.type !== "create" || entry.prevHash !== "") {
      return this.json({ error: "invalid genesis entry" }, 400);
    }
    if (entry.keyGeneration !== 0 || envelope.generation !== 0) {
      return this.json({ error: "genesis generation must be 0" }, 400);
    }

    // The head is the role:"head" member in the roster head OR, since the create
    // roster lists the non-head members (lab-key.ts builds it that way), the head
    // pubkey is supplied alongside. We take it from the request so the DO knows
    // who to bind, then REQUIRE the genesis signature to verify under it. A forged
    // head_pubkey that did not actually sign the entry fails this check.
    const head = (body as { head?: LabMemberWire }).head;
    if (
      !head ||
      typeof head.ed25519PublicKey !== "string" ||
      head.role !== "head"
    ) {
      return this.json({ error: "missing head" }, 400);
    }

    const message = labLogCanonicalMessage({
      seq: entry.seq,
      type: entry.type,
      keyGeneration: entry.keyGeneration,
      roster: entry.roster,
      subject: entry.subject,
      issuedAt: entry.issuedAt,
      prevHash: entry.prevHash,
    });
    if (!this.verifySig(entry.signature, message, head.ed25519PublicKey)) {
      return this.json({ error: "bad genesis signature" }, 401);
    }

    // Bind the head and store the genesis entry + envelope atomically enough for a
    // single-threaded DO (one request at a time per instance).
    this.metaSet("head_pubkey", head.ed25519PublicKey);
    this.metaSet("lab_id", labId);
    this.metaSet("head", JSON.stringify(head));

    // Optional cosmetic lab branding carried alongside the genesis. These are
    // NOT part of the signed log (they never gate access), so we just stash the
    // strings in meta. All optional, so an older client that omits them is fine.
    const brandBody = body as {
      labName?: unknown;
      piTitle?: unknown;
      piDisplay?: unknown;
    };
    if (typeof brandBody.labName === "string") {
      this.metaSet("lab_name", brandBody.labName.slice(0, LAB_BRAND_MAX_LEN));
    }
    if (typeof brandBody.piTitle === "string") {
      this.metaSet("pi_title", brandBody.piTitle.slice(0, LAB_BRAND_MAX_LEN));
    }
    if (typeof brandBody.piDisplay === "string") {
      this.metaSet("pi_display", brandBody.piDisplay.slice(0, LAB_BRAND_MAX_LEN));
    }
    this.sql().exec(
      "INSERT INTO log (seq, type, key_generation, signature, entry) VALUES (?, ?, ?, ?, ?)",
      entry.seq,
      entry.type,
      entry.keyGeneration,
      entry.signature,
      JSON.stringify(entry),
    );
    this.sql().exec(
      "INSERT INTO envelopes (generation, envelope) VALUES (?, ?) ON CONFLICT(generation) DO UPDATE SET envelope = excluded.envelope",
      envelope.generation,
      JSON.stringify(envelope),
    );

    // Enroll the genesis roster (any backfilled members) into the billing pool.
    void this.reportLabRoster(entry.roster);

    // Index the head pubkey in the reverse membership KV (best-effort, non-fatal).
    // The head is always a member of their own lab. Any backfilled genesis roster
    // members are also indexed here so the discover endpoint works immediately
    // after create.
    void kvIndexAddMembership(this.env.LAB_MEMBERSHIP_INDEX, head.ed25519PublicKey, labId);
    for (const m of entry.roster) {
      if (typeof m.ed25519PublicKey === "string" && m.ed25519PublicKey !== head.ed25519PublicKey) {
        void kvIndexAddMembership(this.env.LAB_MEMBERSHIP_INDEX, m.ed25519PublicKey, labId);
      }
    }

    return this.json({ ok: true }, 200);
  }

  /** POST /lab/append?lab=<labId>. A new head-signed log entry (add/remove/
   *  rotate). For rotate, a new envelope for the bumped generation; for add, the
   *  newcomer's sealed copy to splice into the current envelope. The DO verifies
   *  the head signature against the STORED head_pubkey AND that the entry chains
   *  onto the stored tail before appending. */
  private async handleAppend(request: Request): Promise<Response> {
    let body: {
      entry?: unknown;
      envelope?: unknown;
      copy?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }

    const entry = body.entry;
    if (!this.badEntryShape(entry)) {
      return this.json({ error: "malformed entry" }, 400);
    }

    const headPubkey = this.metaGet("head_pubkey");
    if (headPubkey === null) {
      // No lab here yet. Append before create is meaningless.
      return this.json({ error: "lab does not exist" }, 404);
    }

    const tail = this.tail();
    if (tail === null) {
      return this.json({ error: "lab has no genesis" }, 409);
    }

    // Chain checks, mirroring verifyMembershipLog for a single append.
    // 1. seq is exactly tail.seq + 1 (monotonic, no gap, no reorder, no replay).
    if (entry.seq !== tail.seq + 1) {
      return this.json({ error: "seq is not monotonic" }, 400);
    }
    // 2. A second create is never valid.
    if (entry.type === "create") {
      return this.json({ error: "unexpected create on append" }, 400);
    }
    // 3. prevHash equals sha256(tail signature).
    const wantPrev = await this.hashEntrySignature(tail.signature);
    if (entry.prevHash !== wantPrev) {
      return this.json({ error: "broken hash chain" }, 400);
    }
    // 4. Generation rule: bump by exactly one on rotate, stay put on add/remove.
    const wantGeneration =
      entry.type === "rotate"
        ? tail.keyGeneration + 1
        : tail.keyGeneration;
    if (entry.keyGeneration !== wantGeneration) {
      return this.json(
        {
          error: `unexpected keyGeneration ${entry.keyGeneration}, wanted ${wantGeneration}`,
        },
        400,
      );
    }

    // 5. The signature verifies under the STORED head pubkey over the canonical
    // message. This is the catch-all: any flipped byte above also changes this
    // message, and a non-head signer fails outright.
    const message = labLogCanonicalMessage({
      seq: entry.seq,
      type: entry.type,
      keyGeneration: entry.keyGeneration,
      roster: entry.roster,
      subject: entry.subject,
      issuedAt: entry.issuedAt,
      prevHash: entry.prevHash,
    });
    if (!this.verifySig(entry.signature, message, headPubkey)) {
      return this.json({ error: "bad signature" }, 401);
    }

    // Envelope handling. A rotate carries a fresh envelope for the new
    // generation; an add carries the newcomer's sealed copy that we splice into
    // the CURRENT generation's stored envelope. Neither ever carries a lab key.
    if (entry.type === "rotate") {
      const envelope = body.envelope as LabEnvelopeWire | undefined;
      if (
        !envelope ||
        typeof envelope !== "object" ||
        envelope.generation !== entry.keyGeneration ||
        !Array.isArray(envelope.copies)
      ) {
        return this.json({ error: "rotate requires a matching envelope" }, 400);
      }
      this.sql().exec(
        "INSERT INTO envelopes (generation, envelope) VALUES (?, ?) ON CONFLICT(generation) DO UPDATE SET envelope = excluded.envelope",
        envelope.generation,
        JSON.stringify(envelope),
      );
    } else if (entry.type === "add") {
      const copy = body.copy as LabKeyCopyWire | undefined;
      if (
        !copy ||
        typeof copy.username !== "string" ||
        typeof copy.sealed !== "string"
      ) {
        return this.json({ error: "add requires the newcomer sealed copy" }, 400);
      }
      const rows = this.sql()
        .exec<{ envelope: string }>(
          "SELECT envelope FROM envelopes WHERE generation = ?",
          entry.keyGeneration,
        )
        .toArray();
      if (rows.length === 0) {
        return this.json({ error: "no envelope for the current generation" }, 409);
      }
      const env = JSON.parse(rows[0].envelope) as LabEnvelopeWire;
      // Upsert the newcomer's copy (idempotent on re-send).
      const others = env.copies.filter((c) => c.username !== copy.username);
      env.copies = [...others, copy];
      this.sql().exec(
        "UPDATE envelopes SET envelope = ? WHERE generation = ?",
        JSON.stringify(env),
        entry.keyGeneration,
      );
    }
    // remove carries neither (it is a roster change with no key effect; a real
    // departure rotates, which is the rotate branch above).

    // Append the entry only after all checks + the envelope write succeed.
    this.sql().exec(
      "INSERT INTO log (seq, type, key_generation, signature, entry) VALUES (?, ?, ?, ?, ?)",
      entry.seq,
      entry.type,
      entry.keyGeneration,
      entry.signature,
      JSON.stringify(entry),
    );

    // The entry carries the full post-change roster, so reconcile the lab's
    // billing pool to it (enroll joiners, remove departures) on any add/remove/
    // rotate. Best-effort and idempotent.
    void this.reportLabRoster(entry.roster);

    // Update the reverse membership KV index (best-effort, non-fatal).
    // "add" entries: index the new member's Ed25519 pubkey -> labId.
    // "remove" entries: prune the departed member's labId from the index.
    // "rotate" entries need no index change (roster membership is unchanged).
    const storedLabId = this.metaGet("lab_id") ?? "";
    if (storedLabId && entry.subject && typeof entry.subject.ed25519PublicKey === "string") {
      if (entry.type === "add") {
        void kvIndexAddMembership(
          this.env.LAB_MEMBERSHIP_INDEX,
          entry.subject.ed25519PublicKey,
          storedLabId,
        );
      } else if (entry.type === "remove") {
        void kvIndexRemoveMembership(
          this.env.LAB_MEMBERSHIP_INDEX,
          entry.subject.ed25519PublicKey,
          storedLabId,
        );
      }
    }

    return this.json({ ok: true }, 200);
  }

  /** POST /lab/get?lab=<labId>. Open read of the record + envelopes. The sealed
   *  copies are crypto-gated, so this leaks no lab key. Returns 404 when the lab
   *  does not exist. */
  private async handleGet(): Promise<Response> {
    const headPubkey = this.metaGet("head_pubkey");
    if (headPubkey === null) {
      return this.json({ error: "lab does not exist" }, 404);
    }

    const logRows = this.sql()
      .exec<{ entry: string }>("SELECT entry FROM log ORDER BY seq ASC")
      .toArray();
    const log = logRows.map((r) => JSON.parse(r.entry) as LabLogEntryWire);

    const envRows = this.sql()
      .exec<{ envelope: string }>(
        "SELECT envelope FROM envelopes ORDER BY generation ASC",
      )
      .toArray();
    const envelopes = envRows.map(
      (r) => JSON.parse(r.envelope) as LabEnvelopeWire,
    );

    const headRaw = this.metaGet("head");
    const head = headRaw ? (JSON.parse(headRaw) as LabMemberWire) : null;
    const labId = this.metaGet("lab_id") ?? "";
    const finalEntry = log.length > 0 ? log[log.length - 1] : null;

    // The record mirrors LabRecord (lab-membership.ts): head + the final roster
    // as members + the keyGeneration of the final entry + the full log. The
    // client re-runs verifyMembershipLog over this before trusting it.
    const record = {
      labId,
      head,
      members: finalEntry ? finalEntry.roster : [],
      keyGeneration: finalEntry ? finalEntry.keyGeneration : 0,
      log,
    };

    return this.json({ record, envelopes }, 200);
  }

  /**
   * POST /lab/resync?lab=<labId>. Re-reports the lab's current roster to the
   * Vercel billing reconcile endpoint, without any membership change.
   *
   * This closes a timing race: a member is added to the log (which fires a
   * reconcile) at the moment the head finalizes their accept, which can be
   * BEFORE that member has logged in and auto-bound their directory profile. The
   * first reconcile then finds no pubkey binding and skips them, and reconcile
   * only re-fires on the next membership-log change, which may never come. The
   * member's client calls this after a successful auto-bind so the roster
   * reconciles again now that their binding exists, enrolling them in the pool.
   *
   * Open write (any party can ask the relay to re-report; the relay holds the
   * reconcile secret, so no secret leaves the server, and the reconcile body
   * carries pubkeys only). Idempotent and harmless to call repeatedly.
   */
  private async handleResync(): Promise<Response> {
    if (this.metaGet("head_pubkey") === null) {
      return this.json({ error: "lab does not exist" }, 404);
    }
    const tail = this.tail();
    const roster = tail ? tail.roster : [];
    const reported = await this.reportLabRoster(roster);
    return this.json({ ok: true, reported }, 200);
  }

  /** POST /lab/accept?lab=<labId>. A member posts a signed join accept. Open
   *  write (the member may not be in any roster yet); the head is the real
   *  verifier at finalize. We do light shape validation, require the lab to
   *  exist, and store ONE row per joining MEMBER keyed by memberEd25519Pub (a
   *  re-post by the same member replaces only their own pending accept, so a
   *  single reusable invite link can admit many members). The member email
   *  inside is sealed to the head, so this row leaks no email. */
  private async handleAcceptPush(request: Request, labId: string): Promise<Response> {
    if (this.metaGet("head_pubkey") === null) {
      return this.json({ error: "lab does not exist" }, 404);
    }
    let body: { accept?: unknown };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }
    const a = body.accept as Record<string, unknown> | undefined;
    if (
      !a ||
      typeof a !== "object" ||
      a.labId !== labId ||
      typeof a.nonce !== "string" ||
      typeof a.memberX25519Pub !== "string" ||
      typeof a.memberEd25519Pub !== "string" ||
      typeof a.sealedEmail !== "string" ||
      typeof a.memberSig !== "string" ||
      typeof a.invite !== "object"
    ) {
      return this.json({ error: "malformed accept" }, 400);
    }
    this.sql().exec(
      "INSERT INTO lab_accepts (member_pubkey, nonce, accept, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(member_pubkey) DO UPDATE SET nonce = excluded.nonce, accept = excluded.accept, created_at = excluded.created_at",
      a.memberEd25519Pub,
      a.nonce,
      JSON.stringify(a),
      Date.now(),
    );
    return this.json({ ok: true }, 200);
  }

  /** The replay window for head-signed lab CONTROL requests (profile update,
   *  accept list/dismiss). These are cosmetic or idempotent, so the window is the
   *  device-clock-skew tolerance, not a tight replay bound: a brand-new lab head
   *  whose machine clock is more than a few minutes off was getting every save
   *  rejected with 401 while create + invite-accept (which bypass freshness)
   *  worked, which read as "the lab name will not save". An hour absorbs ordinary
   *  unsynced-clock drift while still bounding replay of a captured request.
   *  Security-sensitive routes (grants, revokes) keep the tight isFresh window. */
  private static readonly HEAD_CONTROL_SKEW_MS = 60 * 60 * 1000;

  /** Verifies a head-signed control request (profile/list/dismiss) against the
   *  stored head_pubkey over the given canonical message, within a clock-skew
   *  tolerant window so a captured request cannot be replayed indefinitely.
   *  Returns null on success or a Response to reject. */
  private requireHeadSig(
    message: string,
    sigHex: string,
    issuedAt: number,
  ): Response | null {
    const headPubkey = this.metaGet("head_pubkey");
    if (headPubkey === null) return this.json({ error: "lab does not exist" }, 404);
    if (
      typeof issuedAt !== "number" ||
      !Number.isFinite(issuedAt) ||
      Math.abs(Date.now() - issuedAt) > LabRecordDO.HEAD_CONTROL_SKEW_MS
    ) {
      return this.json({ error: "stale or missing issuedAt" }, 401);
    }
    if (!this.verifySig(sigHex, message, headPubkey)) {
      return this.json({ error: "bad head signature" }, 401);
    }
    return null;
  }

  /** POST /lab/accept/list?lab=<labId>. Head-signed read of pending accepts.
   *  Body: { issuedAt, signature } over "lab-accept-list\n<labId>\n<issuedAt>". */
  private async handleAcceptList(request: Request, labId: string): Promise<Response> {
    let body: { issuedAt?: number; signature?: string };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }
    const message = `lab-accept-list\n${labId}\n${body.issuedAt}`;
    const rej = this.requireHeadSig(message, body.signature ?? "", body.issuedAt ?? 0);
    if (rej) return rej;
    const rows = this.sql()
      .exec<{ accept: string; created_at: number }>(
        "SELECT accept, created_at FROM lab_accepts ORDER BY created_at ASC",
      )
      .toArray();
    const accepts = rows.map((r) => ({
      ...JSON.parse(r.accept),
      createdAt: r.created_at,
    }));
    return this.json({ accepts }, 200);
  }

  /** POST /lab/accept/dismiss?lab=<labId>. Head-signed removal of one member's
   *  pending accept, keyed by the member's Ed25519 pubkey.
   *  Body: { memberPubkey, issuedAt, signature } over
   *  "lab-accept-dismiss\n<labId>\n<memberPubkey>\n<issuedAt>". */
  private async handleAcceptDismiss(request: Request, labId: string): Promise<Response> {
    let body: { memberPubkey?: string; issuedAt?: number; signature?: string };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }
    if (typeof body.memberPubkey !== "string") {
      return this.json({ error: "missing memberPubkey" }, 400);
    }
    const message = `lab-accept-dismiss\n${labId}\n${body.memberPubkey}\n${body.issuedAt}`;
    const rej = this.requireHeadSig(message, body.signature ?? "", body.issuedAt ?? 0);
    if (rej) return rej;
    this.sql().exec("DELETE FROM lab_accepts WHERE member_pubkey = ?", body.memberPubkey);
    return this.json({ ok: true }, 200);
  }

  /** POST /lab/profile?lab=<labId>. Head-signed update of the cosmetic lab
   *  branding (lab name, PI title, PI display name). These are NOT in the signed
   *  membership log; they never gate access, so a head signature over a fresh
   *  message is the whole authorization. Body:
   *  { labName, piTitle, piDisplay, issuedAt, signature } signed over
   *  "lab-profile\n<labId>\n<labName>\n<piTitle>\n<piDisplay>\n<issuedAt>". */
  private async handleProfileUpdate(request: Request, labId: string): Promise<Response> {
    let body: {
      labName?: unknown;
      piTitle?: unknown;
      piDisplay?: unknown;
      issuedAt?: number;
      signature?: string;
    };
    try {
      body = await request.json();
    } catch {
      return this.json({ error: "invalid JSON body" }, 400);
    }
    const labName = typeof body.labName === "string" ? body.labName : "";
    const piTitle = typeof body.piTitle === "string" ? body.piTitle : "";
    const piDisplay = typeof body.piDisplay === "string" ? body.piDisplay : "";
    const message = `lab-profile\n${labId}\n${labName}\n${piTitle}\n${piDisplay}\n${body.issuedAt}`;
    const rej = this.requireHeadSig(message, body.signature ?? "", body.issuedAt ?? 0);
    if (rej) return rej;
    this.metaSet("lab_name", labName.slice(0, LAB_BRAND_MAX_LEN));
    this.metaSet("pi_title", piTitle.slice(0, LAB_BRAND_MAX_LEN));
    this.metaSet("pi_display", piDisplay.slice(0, LAB_BRAND_MAX_LEN));
    return this.json({ ok: true }, 200);
  }

  /** POST /lab/profile/get?lab=<labId>. OPEN read of the cosmetic branding (the
   *  invite page shows it to a not-yet-member). Returns empty strings + hasLogo
   *  false for a lab that exists but has not been branded; 404 for no such lab. */
  private handleProfileGet(): Response {
    if (this.metaGet("head_pubkey") === null) {
      return this.json({ error: "lab does not exist" }, 404);
    }
    return this.json(
      {
        labName: this.metaGet("lab_name") ?? "",
        piTitle: this.metaGet("pi_title") ?? "",
        piDisplay: this.metaGet("pi_display") ?? "",
        hasLogo: this.metaGet("has_logo") === "1",
      },
      200,
    );
  }

  /** POST /lab/logo?lab=<labId>. Head-signed logo upload. The raw image bytes are
   *  the request body; the content-type is the request Content-Type header. Caps
   *  the size + restricts the type, verifies the head signature over
   *  "lab-logo\n<labId>\n<sha256hex>\n<issuedAt>" (sha256 of the bytes), then puts
   *  to LAB_DATA under logos/<labId> with the content-type in R2 httpMetadata and
   *  sets has_logo=1 + logo_ct. The issuedAt + signature ride in query params so
   *  the body stays the raw image. */
  private async handleLogoUpload(request: Request, labId: string): Promise<Response> {
    const url = new URL(request.url);
    const contentType = request.headers.get("content-type") ?? "";
    if (!LAB_LOGO_CONTENT_TYPES.has(contentType)) {
      return this.json({ error: "unsupported image type" }, 415);
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) {
      return this.json({ error: "empty logo body" }, 400);
    }
    if (bytes.byteLength > LAB_LOGO_MAX_BYTES) {
      return this.json({ error: "logo too large" }, 413);
    }
    const sha = await sha256Hex(bytes);
    const issuedAt = Number(url.searchParams.get("issuedAt") ?? "0");
    const signature = url.searchParams.get("sig") ?? "";
    const message = `lab-logo\n${labId}\n${sha}\n${issuedAt}`;
    const rej = this.requireHeadSig(message, signature, issuedAt);
    if (rej) return rej;
    try {
      await this.env.LAB_DATA.put(`logos/${labId}`, bytes, {
        httpMetadata: { contentType },
      });
    } catch {
      return this.json({ error: "storage write failed" }, 500);
    }
    this.metaSet("has_logo", "1");
    this.metaSet("logo_ct", contentType);
    return this.json({ ok: true }, 200);
  }

  /** GET /lab/logo?lab=<labId>. OPEN read of the lab logo bytes, streamed with the
   *  stored content-type. 404 when the lab has no logo. */
  private async handleLogoGet(): Promise<Response> {
    if (this.metaGet("has_logo") !== "1") {
      return this.json({ error: "no logo" }, 404);
    }
    const labId = this.metaGet("lab_id") ?? "";
    const obj = await this.env.LAB_DATA.get(`logos/${labId}`);
    if (!obj) {
      return this.json({ error: "no logo" }, 404);
    }
    const ct =
      obj.httpMetadata?.contentType ??
      this.metaGet("logo_ct") ??
      "application/octet-stream";
    return new Response(obj.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": ct,
        // A short cache so the ambient header logo is not re-fetched on every
        // navigation, but a logo change shows up promptly (the client also
        // cache-busts the URL on a fresh upload).
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const labId = url.searchParams.get("lab") ?? "";
    if (url.pathname === "/lab/create") return this.handleCreate(request, labId);
    if (url.pathname === "/lab/append") return this.handleAppend(request);
    if (url.pathname === "/lab/get") return this.handleGet();
    if (url.pathname === "/lab/resync") return this.handleResync();
    if (url.pathname === "/lab/accept") return this.handleAcceptPush(request, labId);
    if (url.pathname === "/lab/accept/list") return this.handleAcceptList(request, labId);
    if (url.pathname === "/lab/accept/dismiss") return this.handleAcceptDismiss(request, labId);
    if (url.pathname === "/lab/profile") return this.handleProfileUpdate(request, labId);
    if (url.pathname === "/lab/profile/get") return this.handleProfileGet();
    if (url.pathname === "/lab/logo") {
      if (request.method === "GET") return this.handleLogoGet();
      return this.handleLogoUpload(request, labId);
    }
    return this.json({ error: "not found" }, 404);
  }
}

/** Prepends the one-byte type tag to a payload. */
function frame(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.byteLength + 1);
  out[0] = type;
  out.set(payload, 1);
  return out;
}

// ---- Mobile capture relay canonical signed-byte strings -----------------
// THE CONTRACT. The phone + desktop sign the UTF-8 of these exact strings, then
// ed25519 verify. The smoke-test scripts (relay/scripts/smoke-capture.mjs and
// relay/scripts/smoke-snapshot.mjs) keep byte-identical copies; if you change
// one, change all of them.

/** Pairing grant, signed by the USER identity key. */
export function capturePairGrantMessage(
  userPubkeyHex: string,
  pairingId: string,
  expIso: string,
  relayUrl: string,
): string {
  return `researchos-pair-grant\nu=${userPubkeyHex}\npid=${pairingId}\nexp=${expIso}\nurl=${relayUrl}`;
}

/** Capture upload, signed by the bound DEVICE key. sha256Hex is the lowercase
 *  hex sha256 of the blob bytes. */
export function captureUploadMessage(
  userPubkeyHex: string,
  captureId: string,
  createdAtIso: string,
  sha256Hex: string,
): string {
  return `researchos-capture-upload\nu=${userPubkeyHex}\ncid=${captureId}\ncreatedAt=${createdAtIso}\nsha256=${sha256Hex}`;
}

/** Read/list/object/ack/devices/revoke challenge, signed by the USER identity
 *  key. action is one of inbox|object|ack|devices|revoke. extra lines (already
 *  formatted as `key=value`) are appended verbatim, e.g. `id=<captureId>` for
 *  object, `ids=<comma-joined-sorted-ids>` for ack, `device=<pubkey>` for
 *  revoke. */
export function captureReadMessage(
  action: "inbox" | "object" | "ack" | "devices" | "revoke",
  userPubkeyHex: string,
  tsIso: string,
  extra?: string,
): string {
  const base = `researchos-capture-${action}\nu=${userPubkeyHex}\nts=${tsIso}`;
  return extra ? `${base}\n${extra}` : base;
}

/** POST /capture/devices/push-token (phone push P1), signed by the bound DEVICE
 *  Ed25519 key. The exact token bytes are bound into the signed message so the
 *  relay stores only the token the device authorized. An empty token clears it.
 *  MUST stay byte-identical to the mobile caller in mobile/lib/push-token.ts. */
export function devicePushTokenMessage(
  userPubkeyHex: string,
  devicePubkeyHex: string,
  pushToken: string,
  tsIso: string,
): string {
  return `researchos-device-push-token\nu=${userPubkeyHex}\ndevice=${devicePubkeyHex}\ntoken=${pushToken}\nts=${tsIso}`;
}

/** POST /capture/notify-config (phone push P2), signed by the USER identity key.
 *  sha256Hex is the lowercase hex sha256 of the config JSON string. */
export function notifyConfigMessage(
  userPubkeyHex: string,
  tsIso: string,
  sha256HexValue: string,
): string {
  return `researchos-notify-config\nu=${userPubkeyHex}\nts=${tsIso}\nsha256=${sha256HexValue}`;
}

/** POST /capture/register-reminders (phone push P3b), signed by the USER identity
 *  key. sha256HexValue is over the reminders JSON array. */
export function registerRemindersMessage(
  userPubkeyHex: string,
  tsIso: string,
  sha256HexValue: string,
): string {
  return `researchos-register-reminders\nu=${userPubkeyHex}\nts=${tsIso}\nsha256=${sha256HexValue}`;
}

/** POST /capture/notify-recipient (phone push P2), signed by the SENDER identity
 *  key. `u` is the RECIPIENT pubkey (the DO this addresses); `sender` is the
 *  signer. Binds the recipient + sender + coarse category + ts so the signature
 *  cannot be replayed against a different recipient or category. */
export function notifyRecipientMessage(
  recipientPubkeyHex: string,
  senderPubkeyHex: string,
  category: string,
  tsIso: string,
): string {
  return `researchos-notify-recipient\nu=${recipientPubkeyHex}\nsender=${senderPubkeyHex}\ncategory=${category}\nts=${tsIso}`;
}

// ---- Phone push P2 helpers (server-side seal + gate + Expo send) -----------
// The relay buzzes a recipient whose laptop is closed, on a sender's request.
// The push payload is GENERIC + content-free; the sealed pending snapshot it
// wakes the phone to fetch carries only a generic per-category line.

/** The five user-facing phone categories. A sender may only buzz one of these;
 *  an unknown value is dropped. Matches NotificationCategory in
 *  frontend/src/lib/notifications/preferences.ts. */
const PHONE_PUSH_CATEGORIES = [
  "shared",
  "comments",
  "lab",
  "purchases",
  "reminders",
] as const;

/** Coarse per-DO cooldown so a sender burst cannot machine-gun the phone. */
const NOTIFY_COOLDOWN_MS = 30_000;

/** Phone push P3b dead-man's-switch. The reminder alarm delivers only when the
 *  laptop has NOT re-registered within this window (i.e. it has gone offline). A
 *  laptop online inside this window is fired locally + buzzed by the P1 watcher,
 *  so the alarm stands down to avoid a double-buzz. The laptop republishes its
 *  schedule on the ~60s snapshot cadence, so 3 minutes is several missed ticks. */
const REMINDER_STALE_MS = 3 * 60_000;

/** Generic, content-FREE bodies keyed by category (same copy as the web
 *  /api/send-push route). Never an item name or any notification text. */
const GENERIC_PUSH_BODY: Record<string, string> = {
  shared: "Something new was shared with you",
  comments: "You have a new comment or mention",
  lab: "New lab activity",
  purchases: "An order update is waiting",
  reminders: "You have a reminder",
};
const DEFAULT_PUSH_BODY = "New activity in your lab";

/** A real Expo push token. Matches the web route's validation. */
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

/** The recipient routing config the laptop mirrors to the relay (no research
 *  content). channels is the per-category channel matrix; tzOffsetMinutes is the
 *  recipient's Date.getTimezoneOffset() so the relay can resolve their LOCAL
 *  time for quiet hours. */
interface NotifyConfig {
  channels?: Record<string, { phone?: boolean; email?: boolean } | undefined>;
  quietHours?: {
    enabled?: boolean;
    start?: string;
    end?: string;
    weekendsQuiet?: boolean;
  };
  tzOffsetMinutes?: number;
  /** The recipient's own verified notification email (phase 2.5). Present only
   *  when the recipient has set it; email ever only goes to this address. */
  email?: string;
}

/** HKDF info string, byte-identical to frontend sealToRecipient (encryption.ts).
 *  If you change the seal construction, change both. */
const SEAL_INFO = utf8ToBytes("researchos.sharing.seal.v1");

/** Seal a plaintext to a recipient X25519 public key. A byte-for-byte port of
 *  frontend/src/lib/sharing/encryption.ts sealToRecipient (same @noble libs):
 *  epk(32) || nonce(24) || XChaCha20-Poly1305(HKDF-SHA256(ECDH, salt=epk||rpk,
 *  info=SEAL_INFO), nonce). The phone's openSealed/unsealSnapshot reads it. */
function sealToRecipient(
  plaintext: Uint8Array,
  recipientX25519PublicKey: Uint8Array,
): Uint8Array {
  if (recipientX25519PublicKey.length !== 32) {
    throw new Error("sealToRecipient: recipient public key must be 32 bytes");
  }
  const ephemeral = x25519.keygen();
  const shared = x25519.getSharedSecret(
    ephemeral.secretKey,
    recipientX25519PublicKey,
  );
  const salt = concatBytes(ephemeral.publicKey, recipientX25519PublicKey);
  const key = hkdf(sha256, shared, salt, SEAL_INFO, 32);
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return concatBytes(ephemeral.publicKey, nonce, ciphertext);
}

/** True when the recipient's LOCAL time (UTC shifted by their tz offset) is
 *  inside the quiet-hours window. Mirrors isQuietNow in preferences.ts. */
function isQuietNow(
  q: NotifyConfig["quietHours"],
  nowMs: number,
  tzOffsetMinutes: number,
): boolean {
  if (!q || !q.enabled) return false;
  // getTimezoneOffset returns minutes where local = UTC - offset, so the
  // recipient-local wall clock is UTC shifted back by the offset.
  const local = new Date(nowMs - tzOffsetMinutes * 60_000);
  const day = local.getUTCDay(); // 0 = Sun, 6 = Sat
  if (q.weekendsQuiet && (day === 0 || day === 6)) return true;
  const toMin = (hhmm: string | undefined): number => {
    const [h, m] = String(hhmm ?? "").split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const cur = local.getUTCHours() * 60 + local.getUTCMinutes();
  const start = toMin(q.start);
  const end = toMin(q.end);
  if (start === end) return false;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

/** The recipient's own phone gate: the category is routed to the phone AND it is
 *  not quiet hours. Account-tier is implicit (only paired account devices have a
 *  seal key + push token to reach). */
function shouldBuzzPhone(
  config: NotifyConfig,
  category: string,
  nowMs: number,
): boolean {
  const ch = config.channels?.[category];
  if (!ch || !ch.phone) return false;
  return !isQuietNow(config.quietHours, nowMs, config.tzOffsetMinutes ?? 0);
}

/** The recipient's own email gate (phase 2.5): the category is routed to email
 *  AND it is not quiet hours. The caller also requires config.email to be set. */
function shouldEmail(
  config: NotifyConfig,
  category: string,
  nowMs: number,
): boolean {
  const ch = config.channels?.[category];
  if (!ch || !ch.email) return false;
  return !isQuietNow(config.quietHours, nowMs, config.tzOffsetMinutes ?? 0);
}

/** Send a generic, content-free notification email to the recipient's OWN
 *  address (phase 2.5) via the existing Vercel mailer route (Resend +
 *  SHARING_ENABLED gate + IP rate limit live there). Returns 1 on a 200, else 0;
 *  a failed email is never an error (the recipient still gets the in-app + any
 *  phone delivery). */
async function sendNotifyEmail(
  appOrigin: string | undefined,
  toEmail: string,
  category: string,
): Promise<number> {
  const origin = (appOrigin && appOrigin.trim() !== "" ? appOrigin : "https://research-os.app").replace(/\/+$/, "");
  const body = GENERIC_PUSH_BODY[category] ?? DEFAULT_PUSH_BODY;
  try {
    const res = await fetch(`${origin}/api/notify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: toEmail, title: "ResearchOS", body }),
    });
    return res.ok ? 1 : 0;
  } catch {
    return 0;
  }
}

/** Build the generic, content-free pending snapshot (one synthesized row). Shape
 *  matches SnapshotNotification so the phone merges it with the laptop list. */
function buildPendingSnapshot(category: string, tsIso: string) {
  return {
    kind: "notifications" as const,
    version: 1 as const,
    notifications: [
      {
        id: `relay-${category}-${tsIso}`,
        category,
        title: "ResearchOS",
        body: GENERIC_PUSH_BODY[category] ?? DEFAULT_PUSH_BODY,
        createdAt: tsIso,
        read: false,
      },
    ],
  };
}

/** Send a generic, content-free push to the Expo Push Service. Returns how many
 *  tokens were sent to (0 on any failure; a missed buzz is never an error). */
async function sendExpoPush(tokens: string[], category: string): Promise<number> {
  const valid = Array.from(
    new Set(tokens.filter((t) => EXPO_TOKEN_RE.test(t))),
  ).slice(0, 20);
  if (valid.length === 0) return 0;
  const body = GENERIC_PUSH_BODY[category] ?? DEFAULT_PUSH_BODY;
  const messages = valid.map((to) => ({
    to,
    title: "ResearchOS",
    body,
    sound: "default",
    priority: "high",
    data: { kind: "notifications", category },
  }));
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
    return res.ok ? valid.length : 0;
  } catch {
    return 0;
  }
}

/** Snapshot publish (mobile download path), signed by the USER identity key.
 *  sha256Hex is the lowercase hex sha256 of the SEALED blob bytes. */
export function snapshotPublishMessage(
  userPubkeyHex: string,
  name: string,
  devicePubkeyHex: string,
  tsIso: string,
  sha256Hex: string,
): string {
  return `researchos-snapshot-publish\nu=${userPubkeyHex}\nname=${name}\ndevice=${devicePubkeyHex}\nts=${tsIso}\nsha256=${sha256Hex}`;
}

/** Snapshot get (mobile download path), signed by the bound DEVICE Ed25519 key
 *  (the phone reads). */
export function snapshotGetMessage(
  userPubkeyHex: string,
  name: string,
  devicePubkeyHex: string,
  tsIso: string,
): string {
  return `researchos-snapshot-get\nu=${userPubkeyHex}\nname=${name}\ndevice=${devicePubkeyHex}\nts=${tsIso}`;
}

/** PUT /capture/context/publish. USER-signed. sha256Hex is over the sealed bytes. */
export function contextPublishMessage(
  userPubkeyHex: string,
  devicePubkeyHex: string,
  tsIso: string,
  sha256Hex: string,
): string {
  return `researchos-context-publish\nu=${userPubkeyHex}\ndevice=${devicePubkeyHex}\nts=${tsIso}\nsha256=${sha256Hex}`;
}

/** GET /capture/context. DEVICE-signed. */
export function contextGetMessage(
  userPubkeyHex: string,
  devicePubkeyHex: string,
  tsIso: string,
): string {
  return `researchos-context-get\nu=${userPubkeyHex}\ndevice=${devicePubkeyHex}\nts=${tsIso}`;
}

/** POST /capture/command. DEVICE-signed. sha256Hex is over the sealed bytes. */
export function commandPostMessage(
  userPubkeyHex: string,
  devicePubkeyHex: string,
  commandId: string,
  tsIso: string,
  sha256Hex: string,
): string {
  return `researchos-command-post\nu=${userPubkeyHex}\ndevice=${devicePubkeyHex}\ncommandId=${commandId}\nts=${tsIso}\nsha256=${sha256Hex}`;
}

/** GET /capture/commands/poll. USER-signed. */
export function commandsPollMessage(
  userPubkeyHex: string,
  tsIso: string,
): string {
  return `researchos-command-poll\nu=${userPubkeyHex}\nts=${tsIso}`;
}

/** POST /capture/commands/ack. USER-signed. ids are sorted + comma-joined. */
export function commandsAckMessage(
  userPubkeyHex: string,
  ids: string[],
  tsIso: string,
): string {
  return `researchos-command-ack\nu=${userPubkeyHex}\nids=${[...ids].sort().join(",")}\nts=${tsIso}`;
}

/** Lowercase hex sha256 of the given bytes, via WebCrypto (available in
 *  workerd). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}
