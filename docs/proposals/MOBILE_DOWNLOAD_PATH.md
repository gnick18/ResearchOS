# Mobile download path (design)

Status: design, 2026-06-07. The laptop-to-phone direction of the companion, end-to-end encrypted. Unlocks today-glance and barcode reorder (the phone needs lab data pulled down). Companion to MOBILE_CAPTURE_RELAY.md (the upload direction).

## Goal

Get a small snapshot of lab data (today's tasks now, inventory later) from the laptop down to the phone, with the relay never able to read it. The laptop owns the data folder; it builds the snapshot, seals it to the phone, and publishes the ciphertext. The phone pulls and decrypts.

## Privacy model, end-to-end encrypted (Grant 2026-06-07)

The relay only ever holds ciphertext. The laptop seals each snapshot to the phone device's public key; only that device's private key can open it. Reuses the existing sharing crypto verbatim.

- `sealToRecipient(plaintext, deviceX25519Pub)` and `openSealed(sealed, deviceX25519Priv)` in frontend/src/lib/sharing/encryption.ts. Pure X25519 ECDH + HKDF-SHA256 + XChaCha20-Poly1305 (@noble), no account/directory dependency. A phone holding only an X25519 keypair can unseal.

## Keys

The phone gains a SECOND device keypair during pairing.

- Device signing key, Ed25519 (already exists). Identifies the device, signs requests.
- Device sealing key, X25519 (NEW). The laptop seals snapshots to its public half; the phone unseals with its private half. Generated alongside the Ed25519 key, stored in expo-secure-store.
- The X25519 public key is registered with the relay at pairing time (added to /capture/register and stored on the device binding).

## Relay additions (in the existing CaptureInbox DO)

- `devices` table gains `x25519_pubkey TEXT`. `POST /capture/register` accepts `devX25519` and stores it. `GET /capture/devices` returns it (the laptop needs each device's X25519 key to seal).
- `POST /capture/snapshot/publish`, USER-key signed. Body `{ u, name, device, ts, sig }` plus the sealed blob (multipart, same as upload). `name` is a slot like "today". `device` is the target device's Ed25519 pubkey (the binding id). Verifies the device is bound to `u`, then stores the blob at R2 key `<u>/snap/<device>/<name>` (overwrite-latest, not a queue). Sig covers `researchos-snapshot-publish\nu=..\nname=..\ndevice=..\nts=..\nsha256=<of sealed>`.
- `GET /capture/snapshot/get?u=&name=&device=&ts=&sig=`, DEVICE-key signed (the phone holds its Ed25519 device key, not the user key). Returns the latest sealed blob for that device+name, or 404. Sig covers `researchos-snapshot-get\nu=..\nname=..\ndevice=..\nts=..`, verified against the device's bound Ed25519 key. 120s ts freshness on both.

Note the asymmetry from the upload direction: capture reads are USER-key signed (the laptop reads); snapshot reads are DEVICE-key signed (the phone reads). Snapshot publish is USER-key signed (the laptop writes).

## Laptop publisher

A poller-sibling that, when the folder is connected and the identity is unlocked, periodically (and on focus, throttled) builds the "today" snapshot and publishes it to each bound device.

- Build, `fetchAllTasks()` filtered to incomplete tasks spanning today (start_date <= today <= end_date) plus a short overdue/upcoming count. Shape per task `{ id, name, start_date, end_date, task_type }`. JSON, kept small.
- For each bound device, `sealToRecipient(json, decode(device.x25519PublicKey))`, then publish to `<name=today, device=device.ed>`.
- Throttle (publish at most every ~60s and on focus) to keep relay writes modest. Overwrite-latest means the phone always pulls the freshest.

## Phone

- Device X25519 keypair (device-identity.ts extension): generate + store, expose the public hex (for register) and a `unsealSnapshot(sealed)` using `openSealed` reimplemented on RN with @noble (copy encryption.ts openSealed verbatim; it is pure @noble).
- Pairing register sends `devX25519`.
- A fetch+unseal helper: GET /capture/snapshot/get signed by the device Ed25519 key, then openSealed with the device X25519 private key, parse JSON.
- Today-glance screen (a tab or the Home body): pull "today", show the task list (active today, plus overdue/upcoming counts), pull-to-refresh. Read-only. Empty/last-synced states.

## Storage + lifecycle

- Snapshots are overwrite-latest in R2 (`<u>/snap/<device>/<name>`), so they do not pile up. They are NOT acked/deleted by the phone (unlike captures); the laptop refreshes them. A device revoke should also drop its snapshots.
- Sealed, so even at rest in R2 the relay cannot read them.

## Build sequence

- A. Relay, register `devX25519` + devices returns it + `snapshot/publish` + `snapshot/get` + the device-key-signed verification. Extend relay/scripts/smoke-capture.mjs to prove the FULL E2E download loop in node (generate a device X25519 key, seal a payload to it, publish, fetch with the device Ed key, openSealed, assert plaintext matches). Grant deploys + smoke-tests. (this first, verifiable without a phone)
- B. Phone, X25519 device key + register change + fetch/unseal + today-glance screen.
- C. Laptop, the today-snapshot publisher (sibling to the capture poller).

Later, an "inventory" snapshot (same machinery, different builder) powers barcode reorder.

## Notes

House style, no em-dashes, no emojis, no mid-sentence colons. The same canonical-string discipline as the upload direction; relay/scripts/smoke-capture.mjs stays the source of truth for the wire format.
