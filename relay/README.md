# ResearchOS Collab Relay

A Cloudflare Worker + Durable Object that acts as a blind WebSocket fan-out hub for ResearchOS notes collaboration. One Durable Object instance per collab session (room), addressed by a random `sessionId`.

## What it does

Every binary message that arrives on one socket is forwarded verbatim to every OTHER socket in the same room. The relay **never parses or stores the payload**. Clients encrypt and sign every Loro update before sending; the relay fans ciphertext and is blind to note content. Signature verification and envelope authentication at the relay are a planned hardening step (see Phase 3 design doc section 6).

The relay uses the WebSocket Hibernation API so the Durable Object can be evicted between messages while sockets remain open, keeping memory usage near zero at rest.

## Endpoint

```
ws://localhost:8787/ws?session=<sessionId>
```

- `sessionId` is a random opaque string chosen by the session initiator. Each unique value maps to its own isolated Durable Object room.
- Missing or empty `session` returns HTTP 400.
- A non-WebSocket request to `/ws` returns HTTP 426.

## Running locally

```
cd relay
npm install
npm run dev
```

No Cloudflare account is needed for local development. `wrangler dev` starts a local `workerd` instance at `http://localhost:8787`.

## Deploying

```
npm run deploy
```

Requires a Cloudflare account and `wrangler login`. Grant provisions this when the local collab loop is verified.

## Manual two-client fan-out test

With `npm run dev` running in a separate terminal:

```
node relay/test/fanout.mjs
```

The script opens two WebSocket connections to the `test-room` session, has client A send a binary payload, and asserts:
1. Client B receives the payload verbatim.
2. Client A does NOT receive an echo of its own message.

It prints `PASS` or `FAIL` and exits. It is **not** part of CI (CI cannot run a live relay server).

## Project layout

```
relay/
  src/worker.ts       the Worker fetch handler + CollabRoom Durable Object
  test/fanout.mjs     manual two-client fan-out harness (run against wrangler dev)
  wrangler.toml       local dev + deploy config
  tsconfig.json       Workers type target (no emit)
  package.json        wrangler + @cloudflare/workers-types + ws devDeps
```
