// LLC business tracker endpoint (powers the /admin/business tab).
//
// GET  /api/admin/business  - entity facts + ledger + derived summary + deadlines
// POST /api/admin/business  - action-based mutations (upsertEntity, addEntry, deleteEntry)
//
// Operator-only. Gated exactly like /api/admin/metrics, the signed-in OAuth
// email must be in ADMIN_EMAILS, otherwise a 404 (so the endpoint's existence
// is not advertised), and the whole thing is dark unless SHARING_ENABLED is on.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { isAdminEmail } from "@/lib/sharing/admin";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import { getCapacityMetrics } from "@/lib/sharing/capacity";
import { estimateMonthlyInfraCostCents } from "@/lib/sharing/capacity-shared";
import {
  computeSummary,
  upcomingDeadlines,
  type EntityConfig,
  type LedgerDirection,
} from "@/lib/business/calc";
import {
  addLedgerEntry,
  addTask,
  deleteLedgerEntry,
  deleteTask,
  ensureBusinessSchema,
  getEntity,
  listBusinessEmails,
  listLedger,
  listTasks,
  setLedgerTaxCategory,
  setTaskDone,
  upsertEntity,
} from "@/lib/business/db";
import { isValidTaxCategory } from "@/lib/business/tax-categories";

export const runtime = "nodejs";

/** Shared gate. Returns a Response to short-circuit, or null to proceed. */
async function gate(): Promise<Response | null> {
  if (!isSharingEnabled()) return json(404, { error: "not found" });
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) return json(404, { error: "not found" });
  return null;
}

export async function GET(): Promise<Response> {
  const blocked = await gate();
  if (blocked) return blocked;

  await ensureBusinessSchema();
  try {
    const [entity, ledger, tasks, emails, capacity] = await Promise.all([
      getEntity(),
      listLedger(),
      listTasks(),
      listBusinessEmails(),
      // Resilient (per-service null fallback) and wrapped, so a measurement
      // hiccup never sinks the page; the estimate just reads zero.
      getCapacityMetrics().catch(() => null),
    ]);
    const summary = computeSummary(ledger, entity.reservePct);
    const deadlines = upcomingDeadlines(entity, new Date());
    const infraEstimate = estimateMonthlyInfraCostCents(
      // The metered durable content is the collab doc store (migrating to
      // Cloudflare Durable Objects), not the whole legacy Neon database.
      capacity?.neon.collabBytes ?? null,
      capacity?.r2.usedBytes ?? null,
    );
    return json(200, {
      entity,
      ledger,
      tasks,
      emails,
      summary,
      deadlines,
      infraEstimate,
    });
  } catch (err) {
    // Log the real cause so a failing query is diagnosable from the server
    // console; the response stays generic so the endpoint leaks nothing.
    console.error("[/api/admin/business] read failed:", err);
    return json(500, { error: "business read failed" });
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseEntity(raw: unknown): EntityConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const formationDate =
    typeof o.formationDate === "string" && ISO_DATE.test(o.formationDate)
      ? o.formationDate
      : null;
  const appleEnrollmentDate =
    typeof o.appleEnrollmentDate === "string" && ISO_DATE.test(o.appleEnrollmentDate)
      ? o.appleEnrollmentDate
      : null;
  const googleEnrollmentDate =
    typeof o.googleEnrollmentDate === "string" && ISO_DATE.test(o.googleEnrollmentDate)
      ? o.googleEnrollmentDate
      : null;
  const reservePctRaw = Number(o.reservePct);
  const reservePct = Number.isFinite(reservePctRaw)
    ? Math.min(Math.max(reservePctRaw, 0), 100)
    : 25;
  const stRaw = asString(o.salesTaxStatus);
  const salesTaxStatus =
    stRaw === "taxable" || stRaw === "exempt" ? stRaw : "pending";
  return {
    legalName: asString(o.legalName),
    state: asString(o.state) || "Wisconsin",
    entityId: o.entityId == null ? null : asString(o.entityId),
    formationDate,
    ein: o.ein == null ? null : asString(o.ein),
    registeredAgent: o.registeredAgent == null ? null : asString(o.registeredAgent),
    appleEnrollmentId:
      o.appleEnrollmentId == null ? null : asString(o.appleEnrollmentId),
    appleEnrollmentDate,
    googlePlayAccount:
      o.googlePlayAccount == null ? null : asString(o.googlePlayAccount),
    googleEnrollmentDate,
    bankLabel: o.bankLabel == null ? null : asString(o.bankLabel),
    docsFolder: o.docsFolder == null ? null : asString(o.docsFolder),
    salesTaxStatus,
    salesTaxNote: o.salesTaxNote == null ? null : asString(o.salesTaxNote),
    reservePct,
  };
}

export async function POST(request: Request): Promise<Response> {
  const blocked = await gate();
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid json" });
  }

  await ensureBusinessSchema();

  try {
    const action = asString(body.action);
    if (action === "upsertEntity") {
      const entity = parseEntity(body.entity);
      if (!entity) return json(400, { error: "invalid entity" });
      const saved = await upsertEntity(entity);
      return json(200, { entity: saved });
    }

    if (action === "addEntry") {
      const e = (body.entry ?? {}) as Record<string, unknown>;
      const date = asString(e.date);
      const direction = asString(e.direction) as LedgerDirection;
      const amountCents = Math.round(Number(e.amountCents));
      if (!ISO_DATE.test(date)) return json(400, { error: "invalid date" });
      if (direction !== "in" && direction !== "out") {
        return json(400, { error: "invalid direction" });
      }
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        return json(400, { error: "invalid amount" });
      }
      const taxCategory = asString(e.taxCategory);
      if (taxCategory && !isValidTaxCategory(taxCategory)) {
        return json(400, { error: "invalid tax category" });
      }
      const entry = await addLedgerEntry({
        date,
        direction,
        category: asString(e.category),
        amountCents,
        note: asString(e.note),
        taxCategory,
        source: asString(e.source) || "manual",
      });
      return json(200, { entry });
    }

    if (action === "updateEntryTax") {
      const id = Math.round(Number(body.id));
      if (!Number.isFinite(id) || id <= 0) return json(400, { error: "invalid id" });
      const taxCategory = asString(body.taxCategory);
      if (taxCategory && !isValidTaxCategory(taxCategory)) {
        return json(400, { error: "invalid tax category" });
      }
      const entry = await setLedgerTaxCategory(id, taxCategory);
      if (!entry) return json(404, { error: "entry not found" });
      return json(200, { entry });
    }

    if (action === "deleteEntry") {
      const id = Math.round(Number(body.id));
      if (!Number.isFinite(id) || id <= 0) return json(400, { error: "invalid id" });
      await deleteLedgerEntry(id);
      return json(200, { ok: true });
    }

    if (action === "addTask") {
      const label = asString(body.label).trim();
      if (!label) return json(400, { error: "empty task" });
      const task = await addTask(label);
      return json(200, { task });
    }

    if (action === "toggleTask") {
      const id = Math.round(Number(body.id));
      if (!Number.isFinite(id) || id <= 0) return json(400, { error: "invalid id" });
      await setTaskDone(id, Boolean(body.done));
      return json(200, { ok: true });
    }

    if (action === "deleteTask") {
      const id = Math.round(Number(body.id));
      if (!Number.isFinite(id) || id <= 0) return json(400, { error: "invalid id" });
      await deleteTask(id);
      return json(200, { ok: true });
    }

    return json(400, { error: "unknown action" });
  } catch {
    return json(500, { error: "business write failed" });
  }
}
