// Receipt-ingest endpoint for the LLC business ledger.
//
// POST /api/business/ingest
//   body: { entries: IngestEntry[] }  (a single entry object is also accepted)
//
// This is the automation seam. The daily business-inbox routine (and any other
// trusted script) posts receipts here instead of clicking through the admin UI,
// so expenses land on the books without a human re-typing them. It is NOT the
// human path, the operator still uses /admin/business, which is OAuth gated.
//
// Auth: "Authorization: Bearer ${BUSINESS_INGEST_SECRET}". Fails closed if the
// secret is unset or mismatched (404 so the route is not advertised). A distinct
// secret from CRON_SECRET, so a leaked ingest token cannot fire crons and a
// leaked cron token cannot write to the ledger.
//
// Idempotent on `source`. Give each receipt a stable source tag (for example the
// Gmail message id) and a re-scan of the same inbox will not double-log it.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isSharingEnabled } from "@/lib/sharing/directory/guard";
import { isValidTaxCategory } from "@/lib/business/tax-categories";
import type { LedgerDirection } from "@/lib/business/calc";
import { addLedgerEntryBySource, ensureBusinessSchema } from "@/lib/business/db";

export const runtime = "nodejs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

interface ParsedEntry {
  date: string;
  direction: LedgerDirection;
  category: string;
  amountCents: number;
  note: string;
  taxCategory: string;
  source: string;
}

/** Validates one raw entry. Returns the parsed row or an error string. */
function parseEntry(raw: unknown): ParsedEntry | string {
  if (!raw || typeof raw !== "object") return "entry must be an object";
  const o = raw as Record<string, unknown>;

  const date = asString(o.date);
  if (!ISO_DATE.test(date)) return "invalid date (want YYYY-MM-DD)";

  const direction = asString(o.direction) as LedgerDirection;
  if (direction !== "in" && direction !== "out") {
    return "invalid direction (want 'in' or 'out')";
  }

  const amountCents = Math.round(Number(o.amountCents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return "invalid amountCents (want a positive integer of cents)";
  }

  const taxCategory = asString(o.taxCategory);
  if (taxCategory && !isValidTaxCategory(taxCategory)) {
    return "invalid taxCategory";
  }

  // A source tag is what makes ingest idempotent, so require a non-empty one
  // that is not the catch-all "manual" reserved for hand entry.
  const source = asString(o.source).trim();
  if (!source || source === "manual") {
    return "source is required (a stable id like the email message id)";
  }

  return {
    date,
    direction,
    category: asString(o.category),
    amountCents,
    note: asString(o.note),
    taxCategory,
    source,
  };
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.BUSINESS_INGEST_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response("not found", { status: 404 });
  }

  // The ledger lives in the same Neon database the rest of the business tracker
  // uses, which is only wired up when sharing is enabled.
  if (!isSharingEnabled()) {
    return Response.json({ ok: false, error: "sharing disabled" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // Accept either { entries: [...] } or a single bare entry object.
  const rawEntries = Array.isArray(body.entries)
    ? body.entries
    : body.entries === undefined && (body.date || body.amountCents)
      ? [body]
      : body.entries;
  if (!Array.isArray(rawEntries)) {
    return Response.json(
      { ok: false, error: "expected an 'entries' array" },
      { status: 400 },
    );
  }
  if (rawEntries.length === 0) {
    return Response.json({ ok: true, inserted: 0, skipped: 0, entries: [] });
  }
  if (rawEntries.length > 100) {
    return Response.json(
      { ok: false, error: "too many entries (max 100 per request)" },
      { status: 400 },
    );
  }

  // Validate every entry before writing any, so a bad row in the batch is a
  // clean all-or-nothing rejection rather than a half-applied import.
  const parsed: ParsedEntry[] = [];
  for (let i = 0; i < rawEntries.length; i++) {
    const result = parseEntry(rawEntries[i]);
    if (typeof result === "string") {
      return Response.json(
        { ok: false, error: `entry ${i}: ${result}` },
        { status: 400 },
      );
    }
    parsed.push(result);
  }

  try {
    await ensureBusinessSchema();
    let inserted = 0;
    let skipped = 0;
    const entries = [];
    for (const e of parsed) {
      const res = await addLedgerEntryBySource(e);
      if (res.inserted) inserted += 1;
      else skipped += 1;
      entries.push({ ...res.entry, inserted: res.inserted });
    }
    return Response.json({ ok: true, inserted, skipped, entries });
  } catch (err) {
    console.error("[/api/business/ingest] write failed:", err);
    return Response.json({ ok: false, error: "ingest failed" }, { status: 500 });
  }
}
