/**
 * One-time backfill for the LAB_MEMBERSHIP_INDEX KV namespace.
 *
 * Reads a list of labIds, fetches each lab's record via POST /lab/get, and
 * writes every member's Ed25519 pubkey -> labId into the KV index. This covers
 * memberships that existed before the relay-side KV writes were deployed (e.g.
 * Grant's Fungal Interactions Lab).
 *
 * The script is IDEMPOTENT: it is safe to re-run. It reads the existing KV
 * value for each pubkey and merges (deduplicates) before writing.
 *
 * HOW THE SCRIPT ENUMERATES LAB IDS:
 *   There is no relay-side registry of all labIds (each lab lives in its own
 *   LabRecordDO, keyed by labId). The script therefore requires a labId list
 *   supplied by the caller. Pass the labId(s) as command-line arguments:
 *
 *     node scripts/backfill-membership-index.mjs <labId1> [labId2 ...]
 *
 *   To find existing labIds: they are stored in local member folders under the
 *   folder's `.sidecar.json` (field `labId`). On Grant's machine, inspect each
 *   folder's sidecar or run:
 *     grep -r '"labId"' ~/Documents/ResearchOS --include='*.json' -l
 *
 * PREREQUISITES (must run BEFORE this script):
 *   1. Deploy the relay with the LAB_MEMBERSHIP_INDEX KV binding active.
 *      wrangler kv namespace create LAB_MEMBERSHIP_INDEX
 *      (set the returned id in wrangler.toml, then wrangler deploy)
 *
 * USAGE:
 *   RELAY_URL=https://researchos-collab-relay.<acct>.workers.dev \
 *   WRANGLER_ACCOUNT_ID=<acct-id> \
 *   KV_NAMESPACE_ID=<kv-id-from-wrangler-kv-namespace-list> \
 *     node scripts/backfill-membership-index.mjs <labId1> [labId2 ...]
 *
 * The script does NOT use wrangler; it calls the relay HTTP API (/lab/get) to
 * read each lab's record and then the Cloudflare KV REST API to write the index
 * entries. Both WRANGLER_ACCOUNT_ID and KV_NAMESPACE_ID are required for the
 * KV REST writes. The relay URL defaults to the prod relay if RELAY_URL is unset.
 *
 * REQUIRED ENV VARS:
 *   RELAY_URL            - base URL of the deployed relay
 *   WRANGLER_ACCOUNT_ID  - Cloudflare account ID (for KV REST API)
 *   KV_NAMESPACE_ID      - ID of the LAB_MEMBERSHIP_INDEX KV namespace
 *   CF_API_TOKEN         - Cloudflare API token with KV write permission
 *
 * No em-dashes, no emojis.
 */

const RELAY_URL = (process.env.RELAY_URL || "https://researchos-collab-relay.gnick317.workers.dev").replace(/\/+$/, "");
const CF_ACCOUNT_ID = process.env.WRANGLER_ACCOUNT_ID;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;

const labIds = process.argv.slice(2).filter(Boolean);

if (labIds.length === 0) {
  console.error("FAIL: provide at least one labId as a command-line argument");
  console.error("  node scripts/backfill-membership-index.mjs <labId1> [labId2 ...]");
  process.exit(1);
}
if (!CF_ACCOUNT_ID || !KV_NAMESPACE_ID || !CF_API_TOKEN) {
  console.error("FAIL: WRANGLER_ACCOUNT_ID, KV_NAMESPACE_ID, and CF_API_TOKEN must be set");
  process.exit(1);
}

const KV_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}`;

/**
 * Read the current KV value for a pubkey (returns [] if absent or on error).
 */
async function kvGetLabIds(pubkeyHex) {
  const res = await fetch(`${KV_BASE}/values/${encodeURIComponent(pubkeyHex)}`, {
    headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    console.warn(`  [kv-read] ${pubkeyHex.slice(0, 16)}... HTTP ${res.status} - treating as []`);
    return [];
  }
  try {
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Write the merged KV value for a pubkey.
 */
async function kvPutLabIds(pubkeyHex, labIdsArray) {
  const res = await fetch(`${KV_BASE}/values/${encodeURIComponent(pubkeyHex)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(labIdsArray),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`  [kv-write] ${pubkeyHex.slice(0, 16)}... HTTP ${res.status}: ${text}`);
    return false;
  }
  return true;
}

/**
 * Fetch a lab's record from the relay. Returns { head, members } on success or
 * null on error/404.
 */
async function fetchLabRecord(labId) {
  const res = await fetch(`${RELAY_URL}/lab/get?lab=${encodeURIComponent(labId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    console.warn(`  [lab/get] ${labId}: HTTP ${res.status}`);
    return null;
  }
  let data;
  try {
    data = await res.json();
  } catch {
    console.warn(`  [lab/get] ${labId}: JSON parse error`);
    return null;
  }
  const record = data.record;
  if (!record) {
    console.warn(`  [lab/get] ${labId}: no record in response`);
    return null;
  }
  return record;
}

/**
 * Merge labId into a pubkey's KV entry, deduplicating. Returns true on success.
 */
async function indexMember(pubkeyHex, labId, dryRun) {
  const existing = await kvGetLabIds(pubkeyHex);
  if (existing.includes(labId)) {
    console.log(`    [skip] ${pubkeyHex.slice(0, 16)}... already has ${labId}`);
    return true;
  }
  const updated = [...existing, labId];
  if (dryRun) {
    console.log(`    [dry-run] would write ${pubkeyHex.slice(0, 16)}... -> ${JSON.stringify(updated)}`);
    return true;
  }
  const ok = await kvPutLabIds(pubkeyHex, updated);
  if (ok) {
    console.log(`    [write] ${pubkeyHex.slice(0, 16)}... -> ${JSON.stringify(updated)}`);
  }
  return ok;
}

const DRY_RUN = process.env.DRY_RUN === "1";
if (DRY_RUN) {
  console.log("[backfill] DRY_RUN=1: will print changes but not write to KV");
}
console.log(`[backfill] relay: ${RELAY_URL}`);
console.log(`[backfill] labIds to process: ${labIds.join(", ")}`);
console.log("");

let totalMembersIndexed = 0;
let totalErrors = 0;

for (const labId of labIds) {
  console.log(`[lab] ${labId}`);
  const record = await fetchLabRecord(labId);
  if (!record) {
    console.warn(`  SKIP: could not fetch record for ${labId}`);
    totalErrors += 1;
    continue;
  }

  // Collect all pubkeys: the head and every current roster member.
  const pubkeys = new Set();

  if (record.head && typeof record.head.ed25519PublicKey === "string") {
    pubkeys.add(record.head.ed25519PublicKey);
  }

  const members = Array.isArray(record.members) ? record.members : [];
  for (const m of members) {
    if (m && typeof m.ed25519PublicKey === "string") {
      pubkeys.add(m.ed25519PublicKey);
    }
  }

  console.log(`  found ${pubkeys.size} pubkey(s) to index`);

  for (const pubkeyHex of pubkeys) {
    const ok = await indexMember(pubkeyHex, labId, DRY_RUN);
    if (ok) {
      totalMembersIndexed += 1;
    } else {
      totalErrors += 1;
    }
  }

  console.log("");
}

console.log(`[backfill] done. ${totalMembersIndexed} member-lab pairs indexed, ${totalErrors} error(s).`);
if (totalErrors > 0) {
  console.warn("[backfill] some entries had errors; re-run is safe (idempotent).");
  process.exit(1);
}
