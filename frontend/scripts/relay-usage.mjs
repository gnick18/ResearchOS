// Operator-facing relay usage tracker (Grant only). Cross-boundary sharing.
//
// Reports AGGREGATE relay consumption from the relay_inbox table on Neon, so the
// generous 5 GB / 100-pending budget can be watched against real usage over time
// and adjusted later. This is DISTINCT from the per-user "Inbox and storage"
// display in Settings, that shows one mailbox to its owner, this shows the whole
// relay to the operator.
//
// READ-ONLY. It only SELECTs, it never writes, deletes, or sweeps. NO PII, the
// relay is blind, the table holds only peppered email hashes (never a plaintext
// address), so "distinct recipients" is a count of distinct hashes, never a list
// of people. Nothing here can be reversed into an identity.
//
// WHAT IT REPORTS
//   - total rows, split by status (pending vs ready) and by live vs expired
//   - total stored bytes (sum of size_bytes) over live rows, ready and pending
//   - distinct recipient mailboxes (distinct recipient_email_hash, live rows)
//   - distinct senders (distinct sender_email_hash, live rows)
//   - the oldest live pending item (created_at + age in days)
//   - the single largest mailbox, count and bytes (a budget-pressure check)
//   - how the live total compares to the 5 GB / 100-per-mailbox budget
//
// HOW GRANT RUNS IT, from frontend/ with DATABASE_URL set (the relay's Neon
// connection string, the same one the routes read). Pull it from Vercel or paste
// it inline for a one-off:
//
//   DATABASE_URL="postgres://...neon..." node scripts/relay-usage.mjs
//
//   # JSON instead of the text report (for piping into a chart or a log):
//   DATABASE_URL="postgres://..." node scripts/relay-usage.mjs --json
//
// It re-runs safely any time, it touches nothing. If DATABASE_URL is unset it
// exits 1 with a clear message rather than a driver error.

import { neon } from "@neondatabase/serverless";

// Keep these in sync with src/lib/sharing/relay/limits.ts. Duplicated (not
// imported) because this is a plain .mjs Node script outside the TS build, and
// the values change rarely. If you change limits.ts, change these too.
const FREE_STORAGE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB per mailbox
const PENDING_SHARE_CAP = 100; // pending shares per mailbox

const asJson = process.argv.includes("--json");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Set the relay's Neon connection string, e.g.\n" +
      '  DATABASE_URL="postgres://...neon..." node scripts/relay-usage.mjs',
  );
  process.exit(1);
}

const sql = neon(url);

function humanBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function num(v) {
  return v == null ? 0 : Number(v);
}

async function main() {
  // The table may not exist yet on a brand-new relay, the routes create it lazily
  // on first use. Detect that and report cleanly rather than throwing.
  const exists = await sql`
    SELECT to_regclass('public.relay_inbox') IS NOT NULL AS present
  `;
  if (!exists[0]?.present) {
    if (asJson) {
      console.log(JSON.stringify({ tablePresent: false }, null, 2));
    } else {
      console.log("relay_inbox does not exist yet, the relay has had no traffic.");
    }
    return;
  }

  // One pass for the headline aggregates over LIVE (non-expired) rows, plus an
  // all-rows split so expired-but-not-yet-swept rows are visible too.
  const totals = await sql`
    SELECT
      count(*)                                                      AS rows_all,
      count(*) FILTER (WHERE expires_at > now())                    AS rows_live,
      count(*) FILTER (WHERE expires_at <= now())                   AS rows_expired,
      count(*) FILTER (WHERE status = 'ready'   AND expires_at > now()) AS live_ready,
      count(*) FILTER (WHERE status = 'pending' AND expires_at > now()) AS live_pending,
      coalesce(sum(size_bytes) FILTER (WHERE expires_at > now()), 0) AS live_bytes,
      count(DISTINCT recipient_email_hash) FILTER (WHERE expires_at > now()) AS recipients,
      count(DISTINCT sender_email_hash)    FILTER (WHERE expires_at > now()) AS senders
    FROM relay_inbox
  `;
  const t = totals[0] ?? {};

  // Oldest live pending item, the one closest to its TTL sweep.
  const oldest = await sql`
    SELECT created_at,
           extract(epoch FROM (now() - created_at)) / 86400.0 AS age_days
    FROM relay_inbox
    WHERE status = 'pending' AND expires_at > now()
    ORDER BY created_at ASC
    LIMIT 1
  `;

  // The single fullest mailbox, by count and by bytes, over live rows. A budget
  // pressure check, which mailbox is closest to either ceiling.
  const fullest = await sql`
    SELECT recipient_email_hash,
           count(*)                       AS pending,
           coalesce(sum(size_bytes), 0)   AS bytes
    FROM relay_inbox
    WHERE expires_at > now()
    GROUP BY recipient_email_hash
    ORDER BY bytes DESC
    LIMIT 1
  `;

  const report = {
    tablePresent: true,
    capturedAt: new Date().toISOString(),
    rows: {
      all: num(t.rows_all),
      live: num(t.rows_live),
      expiredNotSwept: num(t.rows_expired),
      liveReady: num(t.live_ready),
      livePending: num(t.live_pending),
    },
    liveBytes: num(t.live_bytes),
    distinctRecipients: num(t.recipients),
    distinctSenders: num(t.senders),
    oldestPending: oldest[0]
      ? {
          createdAt: oldest[0].created_at,
          ageDays: Number(Number(oldest[0].age_days).toFixed(1)),
        }
      : null,
    fullestMailbox: fullest[0]
      ? {
          // The hash, not an email, the relay never stores a plaintext address.
          recipientEmailHash: fullest[0].recipient_email_hash,
          pending: num(fullest[0].pending),
          bytes: num(fullest[0].bytes),
        }
      : null,
    budget: {
      freeStorageBytesPerMailbox: FREE_STORAGE_BYTES,
      pendingShareCapPerMailbox: PENDING_SHARE_CAP,
    },
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("Relay usage (aggregate, operator view)");
  console.log("=======================================");
  console.log(`Captured            : ${report.capturedAt}`);
  console.log("");
  console.log(`Rows, all           : ${report.rows.all}`);
  console.log(`Rows, live          : ${report.rows.live}  (ready ${report.rows.liveReady}, pending ${report.rows.livePending})`);
  console.log(`Rows, expired        : ${report.rows.expiredNotSwept}  (past TTL, awaiting sweep)`);
  console.log("");
  console.log(`Stored bytes, live  : ${humanBytes(report.liveBytes)}  (${report.liveBytes} bytes)`);
  console.log(`Distinct recipients : ${report.distinctRecipients}`);
  console.log(`Distinct senders    : ${report.distinctSenders}`);
  console.log("");
  if (report.oldestPending) {
    console.log(`Oldest pending      : ${report.oldestPending.createdAt}  (${report.oldestPending.ageDays} days old)`);
  } else {
    console.log("Oldest pending      : none");
  }
  if (report.fullestMailbox) {
    const m = report.fullestMailbox;
    const bytePct = ((m.bytes / FREE_STORAGE_BYTES) * 100).toFixed(2);
    const countPct = ((m.pending / PENDING_SHARE_CAP) * 100).toFixed(0);
    console.log(`Fullest mailbox     : ${m.pending} pending, ${humanBytes(m.bytes)}`);
    console.log(`                      ${bytePct}% of the 5 GB byte budget, ${countPct}% of the 100-share cap`);
    console.log(`                      (hash ${m.recipientEmailHash})`);
  } else {
    console.log("Fullest mailbox     : none");
  }
  console.log("");
  console.log(`Budget per mailbox  : ${humanBytes(FREE_STORAGE_BYTES)} / ${PENDING_SHARE_CAP} pending shares`);
}

main().catch((err) => {
  console.error("relay-usage failed:", err.message ?? err);
  process.exit(1);
});
