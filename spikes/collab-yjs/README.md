# Collab Yjs spike (THROWAWAY)

A throwaway proof-of-concept for Collaborate Mode (see
`docs/proposals/CROSS_BOUNDARY_SHARING_COLLABORATE.md`). It proves the one hard
mechanic before we commit to a real build, two browser tabs live-editing ONE
note in real time, with visible remote cursors, through a minimal Cloudflare
Durable Object WebSocket hub running LOCALLY via `wrangler dev`. No Cloudflare
account, no login, no deploy.

This is scratch. It does NOT touch `frontend/` and adds no dependency to the
main app. It may or may not be kept.

## What it proves

- Yjs CRDT + `y-codemirror.next` `yCollab` bound to a CodeMirror 6 editor.
- A Durable Object that fans Yjs update messages between connected sockets,
  using the WebSocket Hibernation API.
- Live cursors / selection via the Yjs awareness protocol.

## Important simplification (read this)

The hub here is a PLAINTEXT blind byte relay. It forwards each binary message
from one socket to all other sockets and never parses the payload. In the real
build (section 4a of the proposal) each message is already
XChaCha20-Poly1305 ciphertext + Ed25519 signed by the client before it reaches
the hub, and the hub verifies the signed envelope and fans the ciphertext. The
fan-out + live-edit + cursor mechanic this spike proves is IDENTICAL under that
wrapper, the hub never needs to read the payload to route it. The spike's job
is the live-editing + cursor mechanic, which is the same under 4a and 4b. The
encrypt/sign layer is a known quantity that lives in
`frontend/src/lib/sharing/encryption.ts` and is not re-proven here.

Other simplifications, single hard-coded room, two-person, no auth, no invites,
no retire-to-local, no persistence beyond what the still-connected peer can
re-broadcast.

## Run it yourself

Requires Node 18+ (built and verified on Node 24). All commands run from this
`spikes/collab-yjs/` directory.

1. Install dependencies (local to this folder, nothing global).

   ```
   npm install
   ```

2. Build the browser client bundle.

   ```
   npm run build:client
   ```

3. Start the local worker (this runs the Durable Object via workerd, no
   Cloudflare login needed).

   ```
   npm run dev
   ```

   It prints `Ready on http://127.0.0.1:8787`.

4. Open `http://127.0.0.1:8787/` in TWO browser tabs (Chrome or Edge).

What you should see, type in one tab and the text appears in the other tab in
real time, character by character, with no refresh. Each tab shows the other
tab's cursor as a colored caret, and selecting text shows the other person's
selection highlight. The status line at the top reads "connected + synced".

## Objective proof without a browser

`npm run verify` (with the worker running) opens TWO WebSocket clients to the
local worker as two Yjs peers, edits one, and asserts the edit relays to the
other and both Y.Docs converge to identical text, including a concurrent-edit
merge and an awareness (cursor) relay check.

```
npm run dev        # terminal 1
npm run verify     # terminal 2
```

Expected tail, `ALL ASSERTIONS PASSED`. Override the target with
`WS_URL=ws://host:port/ws npm run verify`.

## Files

- `src/worker.ts` - the Durable Object. A blind WebSocket fan-out relay using
  the Hibernation API. ~90 lines.
- `src/relay-provider.ts` - a tiny client-side Yjs network provider that does
  the peer-to-peer sync + awareness handshake over the blind relay. Wire
  framing matches `y-websocket` / `y-protocols`.
- `src/client.ts` - the browser entry. CM6 editor + `yCollab` binding + the
  relay provider.
- `public/index.html` - the two-tab demo page.
- `test/convergence.mjs` - the no-browser convergence + awareness proof.
- `wrangler.toml` - local worker config (DO binding, SQLite migration for the
  Hibernation API, static asset serving).
