# Mobile capture relay (design)

Status: design, 2026-06-07. Backbone for the mobile companion's real pairing + bench-capture sync. Replaces the Telegram bench-photo bridge with a proper, identity-signed, transient relay.

## Goal

Get a bench photo from the phone into the user's data folder inbox, without the phone ever touching the folder directly. The laptop owns the folder (File System Access API); the phone cannot reach it. The relay is the bridge.

## Model, accountless and pubkey-keyed

There is no user database and no login on the relay. The relay is keyed by the user's identity public key (the existing Ed25519 key the sharing/collab features already use). The trust rules are simple.

- To WRITE to bucket U, you must hold a device key that was bound to U by a grant signed with U's private key.
- To READ or DELETE from bucket U, you must sign a challenge with U's private key.
- An attacker can only ever create their own bucket under their own pubkey. They cannot touch U's.

The relay holds captures in R2 only until the laptop pulls them, then they are deleted. It never permanently stores user data, mirroring the existing cross-boundary relay ethos.

## Identity and keys

- User identity key, the existing per-user Ed25519 keypair (`UnlockedKeys.ed25519PrivateKey` / `ed25519PublicKey` hex). This represents the user and lives on the laptop. We never send the private key anywhere.
- Device key, a fresh Ed25519 keypair the phone generates during pairing. The private half stays in the iOS secure enclave (expo-secure-store). The public half is registered with the relay, bound to the user pubkey.
- One crypto stack everywhere, `@noble/curves/ed25519`. Already in `frontend/src/lib/sharing/directory/signature.ts` and in `relay/src/worker.ts`; usable in React Native too.

## Pairing and device registration

The phone gets authorized via a grant, not a long-lived token (the locked "device registration" decision).

1. The laptop creates a grant, `{ u: userPubkeyHex, pid: pairingId, exp: <iso, ~2 min>, url: relayUrl }`, signs the canonical bytes with the user private key, and renders grant+signature as a QR (Settings to Devices).
2. The phone scans, verifies the signature against `u`, checks `exp`, generates its device keypair, and calls `POST /capture/register` with `{ grant, sig, devicePubkey, label }`.
3. The relay verifies the grant signature against `u` and that it is unexpired, then stores the binding `u -> devicePubkey` (with label + boundAt). The device is now trusted for U.
4. The phone stores `{ u, relayUrl, devicePubkey, devicePrivkey }` in secure-store and shows Paired.

Tradeoff, the grant is a short-lived bearer capability for its ~2 minute window (whoever scans the on-screen QR in that window can bind a device to U). Mitigated by the short expiry and the QR only being shown briefly on the user's own screen. A future hardening can add a laptop-side confirm of the pending device before it goes live; v0 does not need it.

Revocation, the laptop lists bound devices and can delete a binding (`POST /capture/devices/revoke`, signed by the user key). A revoked device's uploads stop being accepted.

## Endpoints (new CaptureInbox Durable Object, one per user pubkey)

All request bodies are JSON unless noted. All signatures are Ed25519 over a canonical, action-bound, versioned byte string (mirroring the existing worker's signed-payload convention). Timestamps guard replay.

- `POST /capture/register`, body `{ grant, sig, devicePubkey, label }`. Binds the device. Verifies grant sig against `grant.u`.
- `POST /capture/upload`, multipart, the image blob plus a header/field `meta` `{ u, devicePubkey, captureId, caption?, createdAt, contentType, sig }`. `sig` covers `u + captureId + createdAt + sha256(blob)` by the device key. Relay checks the device is bound to `u`, stores the blob at `u/<captureId>` in R2 and the metadata in the DO index.
- `GET /capture/inbox?u=...&ts=...&sig=...`, returns the list of pending captures `[{ captureId, caption?, createdAt, contentType }]`. `sig` covers `u + ts` by the USER key. Short `ts` freshness window.
- `GET /capture/object?u=...&id=...&ts=...&sig=...`, returns one blob. User-key signed.
- `POST /capture/ack`, body `{ u, ids, ts, sig }` user-key signed, deletes the acked captures from R2 + index.
- `GET /capture/devices` and `POST /capture/devices/revoke`, user-key signed, list and revoke device bindings.

## Storage

- A `CaptureInbox` Durable Object keyed by `userPubkey` (mirrors `RecipientInbox`). Its SQLite holds device bindings and the capture index (small metadata rows). 
- Image blobs in a new R2 bucket `researchos-captures` (separate lifecycle from the collab backups; captures are transient).
- Lives in the existing `relay/` Worker. New DO class + new R2 binding in `relay/wrangler.toml`, new routes in `relay/src/worker.ts`.

## Laptop pull, into the folder inbox

A poller in the web app (when the folder is connected) signs an inbox request with the user key, fetches pending captures, and for each one writes into `users/{username}/inbox` using the existing path.

- `attachImageToTask({ ownerUsername, taskId: 0, basePath: "users/{username}/inbox", blob, suggestedFilename, altText })`.
- `writeSidecar(base, finalFilename, { source: "relay", caption?, receivedAt })`. Add `"relay"` to the `ImageSidecar.source` union.
- Then `POST /capture/ack` so the relay deletes them. The capture now lives only in the folder, end to end.

## Cloudflare provisioning (Grant)

The relay Worker already exists and deploys. Adding capture needs.

1. Create the R2 bucket, `wrangler r2 bucket create researchos-captures` (from `relay/`).
2. The new DO + R2 binding land in `relay/wrangler.toml` (this design's build adds them).
3. `wrangler deploy` from `relay/`. The phone needs a publicly reachable URL, so for on-device testing we deploy to the workers.dev URL rather than relying on a localhost `wrangler dev` (the phone cannot reach the laptop's localhost). `wrangler dev --remote` is an option for iteration.

## Build sequence

- A. The Worker, `CaptureInbox` DO + routes + R2 + Ed25519 verification, plus a smoke-test script. Grant provisions R2 + deploys + smoke-tests. (this first)
- B. Desktop pairing, Settings to Devices, sign the grant, render the QR (add a QR lib), poll for the bound device, list/revoke devices.
- C. Phone crypto, on scan verify the grant + generate the device key + register; the outbox Send uploads each capture signed by the device key.
- D. Laptop pull, the inbox poller that writes captures into the folder and acks.

Each piece is build-then-Grant-tests; the full loop cannot be orchestrator-verified (needs the phone, the laptop folder, and the deployed Worker).

## Notes

- House terms, "encrypted transfer" / "your device key" in any user copy. No em-dashes, no emojis, no mid-sentence colons.
- This supersedes the Telegram bench-photo bridge over time; Telegram and the relay coexist during the transition.
