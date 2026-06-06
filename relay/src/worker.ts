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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("This endpoint requires a WebSocket upgrade", {
        status: 426,
        headers: { Upgrade: "websocket" },
      });
    }

    const sessionId = url.searchParams.get("session");
    if (!sessionId || sessionId.trim() === "") {
      return new Response("Missing required query parameter: session", {
        status: 400,
      });
    }

    // Each sessionId maps to its own DO instance (isolated room). idFromName is
    // deterministic, so any client that knows the sessionId joins the same room.
    const id = env.COLLAB_ROOM.idFromName(sessionId);
    const stub = env.COLLAB_ROOM.get(id);
    return stub.fetch(request);
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
    this.sql().exec(
      "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)",
    );
  }

  private sql(): SqlStorage {
    return this.state.storage.sql;
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
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // Record the sessionId (from the connect URL) so the R2 backup key is
    // stable and meaningful. The DO is addressed by idFromName(sessionId) but
    // does not otherwise know its own session string.
    const sid = new URL(request.url).searchParams.get("session");
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
