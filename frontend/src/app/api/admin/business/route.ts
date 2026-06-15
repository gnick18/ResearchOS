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

import { requireOperator } from "@/lib/sharing/operator-access";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import { getCapacityMetrics } from "@/lib/sharing/capacity";
import { estimateMonthlyInfraCostCents } from "@/lib/sharing/capacity-shared";
import {
  computeReimbursement,
  computeSummary,
  upcomingDeadlines,
  OWNER_CONTRIBUTION_CATEGORY,
  OWNER_DRAW_CATEGORY,
  type EntityConfig,
  type LedgerDirection,
  type PaymentMethodKind,
  type SubscriptionCadence,
} from "@/lib/business/calc";
import {
  addLedgerEntry,
  addPaymentMethod,
  addSubscription,
  addTask,
  deleteLedgerEntry,
  deletePaymentMethod,
  deleteSubscription,
  deleteTask,
  ensureBusinessSchema,
  getEntity,
  listBusinessEmails,
  listLedger,
  listPaymentMethods,
  listSubscriptions,
  listTasks,
  setLedgerPaidWith,
  setLedgerTaxCategory,
  setTaskDone,
  updatePaymentMethod,
  updateSubscription,
  upsertEntity,
} from "@/lib/business/db";
import { isValidTaxCategory } from "@/lib/business/tax-categories";

export const runtime = "nodejs";

/** Shared gate. Returns a Response to short-circuit, or null to proceed.
 *  Operator = an ADMIN_EMAILS OAuth session OR a valid operator access-code cookie. */
async function gate(): Promise<Response | null> {
  if (!isSharingEnabled()) return json(404, { error: "not found" });
  return requireOperator();
}

export async function GET(): Promise<Response> {
  const blocked = await gate();
  if (blocked) return blocked;

  await ensureBusinessSchema();
  try {
    const [entity, ledger, tasks, emails, paymentMethods, subscriptions, capacity] =
      await Promise.all([
        getEntity(),
        listLedger(),
        listTasks(),
        listBusinessEmails(),
        listPaymentMethods(),
        listSubscriptions(),
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
      paymentMethods,
      subscriptions,
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

interface ParsedPaymentMethod {
  label: string;
  last4: string;
  kind: PaymentMethodKind;
  status: string;
}

/** Validates an incoming payment method. Strips everything but the last four
 *  digits, so a full card number can never be persisted even if one is sent. */
function parsePaymentMethod(raw: unknown): ParsedPaymentMethod | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = asString(o.label).trim();
  if (!label) return null;
  const last4 = asString(o.last4).replace(/\D/g, "").slice(-4);
  const kind: PaymentMethodKind =
    asString(o.kind) === "personal" ? "personal" : "llc";
  const status = asString(o.status).trim();
  return { label, last4, kind, status };
}

interface ParsedSubscription {
  label: string;
  amountCents: number;
  cadence: SubscriptionCadence;
  paidWith: number | null;
  nextRenewal: string | null;
}

function parseSubscription(raw: unknown): ParsedSubscription | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = asString(o.label).trim();
  if (!label) return null;
  const amountCents = Math.round(Number(o.amountCents));
  if (!Number.isFinite(amountCents) || amountCents < 0) return null;
  const cadence: SubscriptionCadence =
    asString(o.cadence) === "yearly" ? "yearly" : "monthly";
  const pwRaw = o.paidWith;
  const paidWith =
    pwRaw == null || pwRaw === "" ? null : Math.round(Number(pwRaw));
  if (paidWith !== null && (!Number.isFinite(paidWith) || paidWith <= 0)) {
    return null;
  }
  const nextRenewal =
    typeof o.nextRenewal === "string" && ISO_DATE.test(o.nextRenewal)
      ? o.nextRenewal
      : null;
  return { label, amountCents, cadence, paidWith, nextRenewal };
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
    duns: o.duns == null ? null : asString(o.duns),
    businessPhone: o.businessPhone == null ? null : asString(o.businessPhone),
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
    fundingGrantNo: o.fundingGrantNo == null ? null : asString(o.fundingGrantNo),
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
      const paidWithRaw = e.paidWith;
      const paidWith =
        paidWithRaw == null || paidWithRaw === ""
          ? null
          : Math.round(Number(paidWithRaw));
      if (paidWith !== null && (!Number.isFinite(paidWith) || paidWith <= 0)) {
        return json(400, { error: "invalid paidWith" });
      }
      const entry = await addLedgerEntry({
        date,
        direction,
        category: asString(e.category),
        amountCents,
        note: asString(e.note),
        taxCategory,
        paidWith,
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

    if (action === "addPaymentMethod") {
      const m = parsePaymentMethod(body.method);
      if (!m) return json(400, { error: "invalid payment method" });
      const method = await addPaymentMethod(m);
      return json(200, { method });
    }

    if (action === "updatePaymentMethod") {
      const id = Math.round(Number(body.id));
      if (!Number.isFinite(id) || id <= 0) return json(400, { error: "invalid id" });
      const m = parsePaymentMethod(body.method);
      if (!m) return json(400, { error: "invalid payment method" });
      const method = await updatePaymentMethod(id, m);
      if (!method) return json(404, { error: "method not found" });
      return json(200, { method });
    }

    if (action === "deletePaymentMethod") {
      const id = Math.round(Number(body.id));
      if (!Number.isFinite(id) || id <= 0) return json(400, { error: "invalid id" });
      await deletePaymentMethod(id);
      return json(200, { ok: true });
    }

    if (action === "setEntryPaidWith") {
      const id = Math.round(Number(body.id));
      if (!Number.isFinite(id) || id <= 0) return json(400, { error: "invalid id" });
      const raw = body.paidWith;
      const paidWith =
        raw == null || raw === "" ? null : Math.round(Number(raw));
      if (paidWith !== null && (!Number.isFinite(paidWith) || paidWith <= 0)) {
        return json(400, { error: "invalid paidWith" });
      }
      const entry = await setLedgerPaidWith(id, paidWith);
      if (!entry) return json(404, { error: "entry not found" });
      return json(200, { entry });
    }

    if (action === "recordReimbursement") {
      const mode = asString(body.mode);
      if (mode !== "capital" && mode !== "draw") {
        return json(400, { error: "invalid mode" });
      }
      // The amount is computed server-side from the current ledger and methods,
      // never trusted from the client, and only the still-outstanding delta is
      // recorded so a repeat click cannot double-settle.
      const [ledger, methods] = await Promise.all([
        listLedger(),
        listPaymentMethods(),
      ]);
      const { outstandingCents } = computeReimbursement(ledger, methods);
      if (outstandingCents <= 0) {
        return json(400, { error: "nothing outstanding" });
      }
      const today = new Date().toISOString().slice(0, 10);
      const entry =
        mode === "capital"
          ? await addLedgerEntry({
              date: today,
              direction: "in",
              category: OWNER_CONTRIBUTION_CATEGORY,
              amountCents: outstandingCents,
              note: "Owner-fronted purchases recorded as a capital contribution (no money moves, the expenses still deduct)",
              taxCategory: "",
              source: "manual",
            })
          : await addLedgerEntry({
              date: today,
              direction: "out",
              category: OWNER_DRAW_CATEGORY,
              amountCents: outstandingCents,
              note: "Mercury to personal reimbursement of owner-fronted purchases (an owner draw, not a deductible expense)",
              taxCategory: "",
              source: "manual",
            });
      return json(200, { entry });
    }

    if (action === "addSubscription") {
      const s = parseSubscription(body.subscription);
      if (!s) return json(400, { error: "invalid subscription" });
      const subscription = await addSubscription(s);
      return json(200, { subscription });
    }

    if (action === "updateSubscription") {
      const id = Math.round(Number(body.id));
      if (!Number.isFinite(id) || id <= 0) return json(400, { error: "invalid id" });
      const s = parseSubscription(body.subscription);
      if (!s) return json(400, { error: "invalid subscription" });
      const subscription = await updateSubscription(id, s);
      if (!subscription) return json(404, { error: "subscription not found" });
      return json(200, { subscription });
    }

    if (action === "deleteSubscription") {
      const id = Math.round(Number(body.id));
      if (!Number.isFinite(id) || id <= 0) return json(400, { error: "invalid id" });
      await deleteSubscription(id);
      return json(200, { ok: true });
    }

    return json(400, { error: "unknown action" });
  } catch {
    return json(500, { error: "business write failed" });
  }
}
