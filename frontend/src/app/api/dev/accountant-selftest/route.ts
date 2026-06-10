// DEV-ONLY. One-click "is the Accountant booking path actually working" check.
//
// POST /api/dev/accountant-selftest
//
// Powers the dev panel button on /admin/business. It exercises the REAL path the
// inbox bot uses (an HTTP POST to /api/business/ingest with the Bearer secret),
// not a shortcut, so a green result means the bot will really book receipts:
//   1. clean any leftover probe rows
//   2. POST a tiny throwaway entry -> expect it inserts
//   3. POST the same entry again -> expect it is skipped (idempotency works)
//   4. delete the probe rows so the ledger is left exactly as it was
//
// Hard-gated to development (404 in production); the route does not exist for a
// real deploy. House style: no em-dashes, no emojis, no mid-sentence colons.

import { isSharingEnabled } from "@/lib/sharing/directory/guard";
import { deleteLedgerEntriesBySource, ensureBusinessSchema } from "@/lib/business/db";

export const runtime = "nodejs";

const PROBE_SOURCE = "dev-selftest";

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

export async function POST(request: Request): Promise<Response> {
  if (!isDev()) return new Response("not found", { status: 404 });

  const steps: { label: string; ok: boolean; detail?: string }[] = [];
  const push = (label: string, ok: boolean, detail?: string) =>
    steps.push({ label, ok, detail });

  // 1. Secret present?
  const secret = process.env.BUSINESS_INGEST_SECRET;
  if (!secret) {
    push("Ingest secret set", false, "BUSINESS_INGEST_SECRET is missing");
    return Response.json({
      ok: false,
      steps,
      hint: "Add BUSINESS_INGEST_SECRET to frontend/.env.local and restart the dev server.",
    });
  }
  push("Ingest secret set", true);

  // 2. Sharing on? (the ingest endpoint is dark otherwise)
  if (!isSharingEnabled()) {
    push("Sharing enabled", false, "SHARING_ENABLED is off, ingest returns 503");
    return Response.json({
      ok: false,
      steps,
      hint: "Set SHARING_ENABLED=true in frontend/.env.local and restart the dev server.",
    });
  }
  push("Sharing enabled", true);

  const origin = new URL(request.url).origin;
  const today = new Date().toISOString().slice(0, 10);
  const probe = {
    date: today,
    direction: "out",
    amountCents: 1,
    category: "DEV SELF TEST (auto-deleted)",
    note: "accountant booking-path self-test",
    taxCategory: "",
    source: PROBE_SOURCE,
  };

  try {
    await ensureBusinessSchema();
    // Clean any leftover probe row from an interrupted prior run.
    await deleteLedgerEntriesBySource(PROBE_SOURCE);

    const callIngest = async () =>
      fetch(`${origin}/api/business/ingest`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ entries: [probe] }),
      });

    // 3. First POST should insert.
    const r1 = await callIngest();
    if (r1.status !== 200) {
      const body = await r1.text();
      push("Ingest endpoint reachable + secret accepted", false, `HTTP ${r1.status} ${body.slice(0, 120)}`);
      await deleteLedgerEntriesBySource(PROBE_SOURCE);
      return Response.json({
        ok: false,
        steps,
        hint:
          r1.status === 404
            ? "404 means the Bearer secret did not match. Restart the dev server so it loads the .env.local value."
            : "The ingest endpoint rejected the probe. See the detail.",
      });
    }
    const d1 = (await r1.json()) as { inserted: number };
    push("Books a receipt (insert)", d1.inserted === 1, `inserted ${d1.inserted}`);

    // 4. Second POST should be skipped (idempotent on source).
    const r2 = await callIngest();
    const d2 = (await r2.json()) as { skipped: number };
    push("Skips a duplicate (idempotency)", d2.skipped === 1, `skipped ${d2.skipped}`);

    // 5. Clean up, leave the ledger untouched.
    const removed = await deleteLedgerEntriesBySource(PROBE_SOURCE);
    push("Cleans up the probe row", removed >= 1, `removed ${removed}`);

    const ok = steps.every((s) => s.ok);
    return Response.json({
      ok,
      steps,
      message: ok
        ? "Booking path is healthy. The Accountant will book receipts."
        : "Something in the path is off, see the failing step.",
    });
  } catch (err) {
    // Best-effort cleanup so a thrown test never leaves a probe row behind.
    try {
      await deleteLedgerEntriesBySource(PROBE_SOURCE);
    } catch {
      // ignore
    }
    push("Self-test ran", false, err instanceof Error ? err.message : "unknown error");
    return Response.json({ ok: false, steps }, { status: 500 });
  }
}
