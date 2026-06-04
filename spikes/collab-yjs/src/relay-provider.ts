/**
 * RelayProvider, a tiny Yjs network provider for the blind byte-relay hub.
 *
 * The stock y-websocket provider assumes a server that participates in the
 * sync handshake. Our hub is a dumb blind relay (it just forwards bytes to
 * peers), so this provider implements the peer-to-peer Yjs handshake directly
 * over that relay. It is deliberately small and transparent so the spike has
 * no hidden behavior, and it is the same shape the production client would
 * take, the only production addition is wrapping `send` with encrypt+sign and
 * `onmessage` with verify+decrypt (section 4a).
 *
 * Wire framing matches y-websocket / y-protocols exactly (lib0 varint + the
 * sync and awareness protocols), so it is interoperable with the broader Yjs
 * ecosystem if we later swap in a stock provider.
 */

import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// Minimal WebSocket type so this file builds for both browser and node (ws).
interface SocketLike {
  binaryType: string;
  send(data: Uint8Array): void;
  close(): void;
  addEventListener(type: string, cb: (ev: any) => void): void;
  readyState: number;
}

export interface RelayProviderOptions {
  WebSocketImpl?: any; // node passes the `ws` constructor; browser uses global
}

export class RelayProvider {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  ws: SocketLike;
  synced = false;
  private _onSynced?: () => void;

  constructor(url: string, doc: Y.Doc, opts: RelayProviderOptions = {}) {
    this.doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);

    const WS = opts.WebSocketImpl ?? (globalThis as any).WebSocket;
    const ws: SocketLike = new WS(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.addEventListener("open", () => {
      // Sync step 1: broadcast our state vector so peers send what we lack.
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(enc, this.doc);
      this.send(encoding.toUint8Array(enc));

      // Announce our awareness state (cursor/presence) to peers.
      const aenc = encoding.createEncoder();
      encoding.writeVarUint(aenc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        aenc,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
          this.doc.clientID,
        ]),
      );
      this.send(encoding.toUint8Array(aenc));
    });

    ws.addEventListener("message", (ev: any) => {
      const data = new Uint8Array(ev.data as ArrayBuffer);
      this.onMessage(data);
    });

    // Local doc changes -> sync step 2 (update) to peers.
    this.doc.on("update", (update: Uint8Array, origin: any) => {
      if (origin === this) return; // came from the network; don't echo
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.send(encoding.toUint8Array(enc));
    });

    // Local awareness changes -> relay to peers.
    this.awareness.on(
      "update",
      ({ added, updated, removed }: any, origin: any) => {
        if (origin === "remote") return;
        const changed = added.concat(updated).concat(removed);
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          enc,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        this.send(encoding.toUint8Array(enc));
      },
    );
  }

  onSynced(cb: () => void) {
    if (this.synced) cb();
    else this._onSynced = cb;
  }

  private send(data: Uint8Array) {
    if (this.ws.readyState === 1) this.ws.send(data);
  }

  private onMessage(data: Uint8Array) {
    const dec = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(dec);
    if (messageType === MESSAGE_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      const syncMessageType = syncProtocol.readSyncMessage(
        dec,
        enc,
        this.doc,
        this, // origin marker so our update listener does not echo
      );
      // If readSyncMessage produced a reply (e.g. answer to a step1), send it.
      if (encoding.length(enc) > 1) {
        this.send(encoding.toUint8Array(enc));
      }
      // syncMessageType 1 (step2) or 2 (update) means we received doc state.
      if (
        (syncMessageType === syncProtocol.messageYjsSyncStep2 ||
          syncMessageType === syncProtocol.messageYjsUpdate) &&
        !this.synced
      ) {
        this.synced = true;
        this._onSynced?.();
      }
    } else if (messageType === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(dec),
        "remote",
      );
    }
  }
}
