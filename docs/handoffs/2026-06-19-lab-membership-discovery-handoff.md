# Lab membership discovery handoff (2026-06-19)

Memory `[[project_joined_lab_loop]]`. Findings doc `docs/proposals/2026-06-19-lab-membership-discovery-findings.md`. Resolves the chipped gap `task_0754f33b`.

## The gap (live test, 2026-06-19)

A user's lab MEMBERSHIPS only surface on the client via a LOCAL member folder, and that folder is created ONLY at join/enter time (`provisionMemberFolder` is called solely from `checkAndEnterLab` + `enterLabViaToken` in `frontend/src/lib/lab/lab-member-activation.ts`). There was NO client path that asks the relay "what labs does this account belong to". So a membership that exists server-side (head approved the member, the head-signed DO roster + the billing pool include them) is INVISIBLE on the member's device whenever no local member folder exists: joined before `NEXT_PUBLIC_LAB_AS_FOLDER` was on, a new device, or a reset folder set.

Repro: Grant joined Emile's "Fungal Interactions Lab" (Emile approved, Emile sees Grant as a member), but Grant's switcher showed no such lab and no way to enter it.

## Data-path finding

No reverse `account -> labs` index existed anywhere. The relay `LabRecordDO` is keyed BY labId (one DO per lab), `/lab/get?lab=<id>` returns one lab's roster but cannot enumerate in reverse, and there was no `listMyLabs`. The fix REQUIRES a relay/worker addition (a separate manual `wrangler deploy`).

## What was built (branch `feat/lab-membership-discovery`, MERGED to local main `e2947236a`, NOT pushed)

Flag-gated behind `NEXT_PUBLIC_LAB_AS_FOLDER` (off = byte-identical). Two commits.

Client (`40392d646`):
- `frontend/src/lib/lab/lab-membership-discovery.ts` — `discoverMyLabMemberships` signs the canonical message `lab-discover-memberships\n<pubkeyHex>\n<issuedAt>` with the member's Ed25519 key and POSTs to `/lab/discover-memberships?pubkey=<hex>` with body `{ issuedAt, signature }`, expecting `{ labIds: string[] }`. Returns `[]` on 404/error/flag-off, never throws.
- `frontend/src/components/file-system/FolderSwitcher.tsx` — when the flag is on, runs discovery on open, filters out labs already in the remembered set, and shows an "Available to join" section with an Enter button per discovered lab. Enter calls `checkAndEnterLab` (the crypto proof that the sealed key copy opens), which provisions the OPFS member folder via `recordMemberActivation`. The P2 pull (`useLabViewPull`) fires automatically from `LabSignInGate` after the folder activates.
- `frontend/src/lib/lab/__tests__/lab-membership-discovery.test.ts` — 9 tests (flag-off inertness, 404 degradation, network errors, parse, malformed-response filtering, signature correctness).

Relay (`da7ea61ec`):
- `relay/wrangler.toml` — `[[kv_namespaces]]` binding `LAB_MEMBERSHIP_INDEX`, id `4a853f473b4d4aa491db61f267f14606` (set by Grant; was a placeholder).
- `relay/src/worker.ts` — `Env.LAB_MEMBERSHIP_INDEX`, the `POST /lab/discover-memberships` handler (signature-verified, 5-minute freshness window, returns `{ labIds }`, `[]` on unknown-but-valid pubkey), and best-effort NON-fatal KV writes (`kvIndexAddMembership` / `kvIndexRemoveMembership`) at `/lab/create` (head + genesis roster) and `/lab/append` (add / remove member entries).
- `relay/scripts/backfill-membership-index.mjs` — idempotent one-time backfill. Takes a labId list as args (the relay keeps NO labId registry), calls `/lab/get?lab=<labId>` per lab, and writes head + every member pubkey to KV via the Cloudflare KV REST API. `DRY_RUN=1` previews.
- `relay/test/lab.mjs` — section (q), 6 tests for the endpoint (valid sig, stale ts, bad sig, missing param, malformed body, wrong method).

Canonical message is byte-identical on both sides, so no client change was needed.

## Validation done

- tsc clean (client). Relay tsc shows only its 7 pre-existing errors (loro wasm + 2 `instanceof` pairs), zero new.
- Client vitest 9/9, relay smoke section added (the relay has no vitest, it uses manual `relay/test/*.mjs` vs `wrangler dev`).
- `wrangler deploy --dry-run` from `relay/` PASSES: worker compiles, `LAB_MEMBERSHIP_INDEX` resolves to namespace `4a853f473b4d4aa491db61f267f14606`. Nothing deployed.
- Branch base was `origin/main@7dda8391670`, which has since advanced to `c40fe7be4`; verified ZERO overlap between the 8 feature files and the intervening main work, so the merge was clean and touched none of Grant's uncommitted edits.

## REMAINING (Grant, manual; nothing deployed)

1. `cd relay && wrangler deploy` — ship the endpoint + KV writes (the KV namespace already exists and is bound).
2. Backfill the PRE-EXISTING memberships (the KV only captures NEW create/join writes, so Grant's Fungal Interactions membership needs this). Get the labId first (it is NOT on Grant's disk, which is the bug itself):
   - paste the signed-invite link (the labId rides in its `#` hash), or
   - Emile reads it from his lab (settings/URL or `grep -rh '"labId"' <his lab folder> --include='*.json'`), or
   - Emile runs the backfill from his side once (it seeds head + ALL members, so it covers Grant too and needs no labId from Grant).
   Then: `DRY_RUN=1 RELAY_URL=https://researchos-collab-relay.gnick317.workers.dev WRANGLER_ACCOUNT_ID=<acct> KV_NAMESPACE_ID=4a853f473b4d4aa491db61f267f14606 CF_API_TOKEN=<token-with-kv-write> node scripts/backfill-membership-index.mjs <labId>` (drop `DRY_RUN` for the real run).
3. Push local main to `origin/main` when ready (the merge is local-only right now).
4. `NEXT_PUBLIC_LAB_AS_FOLDER` is already ON in prod, so once the relay is deployed and backfilled the "Available to join" section lights up.

## Follow-up / risk

A real member DEPARTURE is a "rotate" entry (to re-seal the lab key without them), not a bare "remove", so a departed member's labId lingers in the KV index until a rotate-prune or re-backfill. This is SAFE: discovery is only additive, the server-side `checkAndEnterLab` crypto proof is the real access gate (a stale discovery entry just fails the key proof on Enter). Follow-up: prune the index on rotate as well.
