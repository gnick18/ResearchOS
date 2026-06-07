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
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/curves/utils.js";

// Synchronous wasm init at module load, before any LoroDoc is constructed.
initSync({ module: wasm });

/** Frame type tags (first byte of every binary message). */
const MSG_DOC_UPDATE = 0x01;
const MSG_EPHEMERAL = 0x02;

/** How often the DO backs its snapshot up to R2 (disaster-recovery net). */
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;

export interface Env {
  COLLAB_ROOM: DurableObjectNamespace;
  /** R2 bucket for periodic per-doc snapshot backups (disaster recovery). */
  COLLAB_BACKUPS: R2Bucket;
}

/** Permissive CORS for the cross-origin /snapshot fetch from the app. The
 *  session id is the capability; the response carries only that doc's bytes. */
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
    if (url.pathname === "/grant" || url.pathname === "/revoke") {
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

  /** Imports an incoming update into the canonical doc and re-persists. */
  private persistUpdate(update: Uint8Array): void {
    const d = this.ensureDoc();
    try {
      d.import(update);
    } catch {
      // Malformed update: skip persistence. Live fan-out still happens so a
      // transient bad frame never blocks the session.
      return;
    }
    const snapshot = d.export({ mode: "snapshot" });
    this.sql().exec(
      "INSERT INTO doc (k, snapshot) VALUES ('doc', ?) ON CONFLICT(k) DO UPDATE SET snapshot = excluded.snapshot",
      snapshot,
    );
    this.hasStored = true;
    this.markDirtyAndArm();
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

    const type = bytes[0];
    if (type === MSG_DOC_UPDATE) {
      this.persistUpdate(bytes.subarray(1));
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

/** Prepends the one-byte type tag to a payload. */
function frame(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.byteLength + 1);
  out[0] = type;
  out.set(payload, 1);
  return out;
}
