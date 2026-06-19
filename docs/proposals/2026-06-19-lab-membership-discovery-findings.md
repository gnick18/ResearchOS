# Lab Membership Discovery: Findings and Plan

Date: 2026-06-19

## Problem

When a member joins a lab on one device or before the `LAB_AS_FOLDER_ENABLED` flag
was on, no local member folder is created on the current device. The remembered-folders
registry in IndexedDB carries `labId` on `RememberedFolderMeta` rows, but those rows
only exist after `provisionMemberFolder` runs (on join) or `rememberManagedFolder` is
called. On a new device, after a folder reset, or when joining predates the flag, the
labId is absent from the local registry and there is no path to discover it.

## Reverse Index: Does Not Exist

The relay (`relay/src/worker.ts`) uses one Durable Object per lab, keyed by `labId`
(`LabRecordDO`). There is no endpoint that answers "what labs does account X belong to?"

Confirmed absent from:

- `relay/src/worker.ts` (no `/lab/my-memberships`, no reverse scan)
- `frontend/src/lib/lab/lab-do-client.ts` (no `listMyLabs`, no `getMyLabs`)
- `frontend/src/lib/lab/` (no membership-discovery module)

The per-lab GET endpoint (`/lab/get?lab=<labId>`) returns the full roster for ONE lab.
To answer "all labs for pubkey X" the relay must enumerate DOs, which it cannot do
without a pre-built index.

## Proposed Relay Addition (separate wrangler deploy required)

### New KV binding: `LAB_MEMBERSHIP_INDEX`

Key: `hex(ed25519_pubkey)` (the member's signing public key)
Value: JSON-serialized `string[]` of `labId` values

### KV write sites in `relay/src/worker.ts`

- `/lab/create`: after persisting the head's lab record, write:
  `KV.put(headPubkey, JSON.stringify([labId, ...existing]))`
- `/lab/append` for add-member entries: after verifying the entry, write:
  `KV.put(newMemberEd25519Pubkey, JSON.stringify([labId, ...existing]))`

### New endpoint: `POST /lab/discover-memberships?pubkey=<hex_ed25519_pubkey>`

Request body:
```json
{ "issuedAt": 1234567890000, "signature": "<hex>" }
```

The signature covers the canonical message (UTF-8 bytes of):
```
lab-discover-memberships\n<pubkey_hex>\n<issuedAt>
```

Signed with the member's Ed25519 private key. The relay verifies by:
1. Checking `issuedAt` is within a 5-minute window (replay protection).
2. Verifying `signature` against the canonical message using the `pubkey` in the query param.
3. Reading `KV.get(pubkey)` and returning the stored `labIds` array.

Response `200`: `{ "labIds": ["lab123", "lab456"] }`
Response `404`: endpoint not yet deployed (client treats as `[]`)
Response `400` / `500`: client treats as `[]`

### Security properties

- The relay never returns the lab key or any plaintext. It only discloses which
  `labId` values are associated with the pubkey.
- The member still must pass the `checkAndEnterLab` crypto proof (open their sealed
  key copy) before any local folder is provisioned. Discovery is list-only.
- A replay attacker who captures the signature cannot reuse it after 5 minutes.
- The relay sees only the public key, never the private key.

## Client Build (this PR)

The client is built against the proposed endpoint shape and degrades gracefully:

- `discoverMyLabMemberships` in `frontend/src/lib/lab/lab-membership-discovery.ts`
  signs the canonical message and POSTs to `/lab/discover-memberships`.
- On `404` (endpoint not yet deployed) or any network error, returns `[]`.
- Gated by `LAB_AS_FOLDER_ENABLED`. Returns `[]` immediately when the flag is off.
- `FolderSwitcher.tsx` shows a "Discovered labs" section for labs returned by the
  discovery call that do not already have a local member folder. Selecting one runs
  `checkAndEnterLab` (the crypto proof) and then `runLabViewPullForSession`.

## Deploy Order

1. Ship this PR (client only, relay endpoint returns `404`, section is empty but safe).
2. Add `LAB_MEMBERSHIP_INDEX` KV binding and the three relay changes in a separate
   wrangler deploy.
3. On the next lab create/append the index builds. Existing labs are not retroactively
   indexed (a one-time backfill is a follow-up, out of scope here).
4. Flip `NEXT_PUBLIC_LAB_AS_FOLDER=1` in Vercel after the relay deploy is live.
