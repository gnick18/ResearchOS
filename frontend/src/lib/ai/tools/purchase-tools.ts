// BeakerBot create_purchase tool (BeakerAI lane, 2026-06-13).
//
// A gated WRITE tool that lets BeakerBot log a new purchase/order entry on
// behalf of the user ("order 2 boxes of P1000 tips from Fisher for the cyp51A
// project"). The write is two-step in the domain model:
//
//   1. Create a parent Task with task_type "purchase" (the order group/container
//      that appears on the Gantt and the Purchases page).
//   2. Create the PurchaseItem line item linked to that task via task_id.
//
// Both steps are wrapped inside a single describeAction preview so the user
// confirms once and sees vendor, item, quantity, price, and project before
// anything writes.
//
// VERBATIM MONEY RULE: every price the tool echoes is a pre-formatted
// *Display string the model MUST copy character-for-character. The model
// never re-types, re-sums, rounds, or reformats a dollar figure.
//
// Project resolution: the tool accepts a project by name (case-insensitive)
// or numeric id, looks it up via the deps seam, and fails with a clear error
// when no match is found. It never invents a project id.
//
// Injectable seam so every export is unit-testable without a real folder.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { tasksApi, purchasesApi, projectsApi } from "@/lib/local-api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { resolveProject } from "./task-tools";
import type { Project, Task, PurchaseItem } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam
// ---------------------------------------------------------------------------

export type PurchaseToolsDeps = {
  /** Fetch the user's own projects (for project-name resolution). */
  listProjects: () => Promise<Project[]>;
  /** Create the parent purchase-type task. Returns the saved Task. */
  createTask: (data: {
    name: string;
    start_date: string;
    duration_days: number;
    task_type: "purchase";
    project_id?: number | null;
  }) => Promise<Task>;
  /** Create the purchase line item linked to the parent task. */
  createPurchaseItem: (data: {
    task_id: number;
    item_name: string;
    quantity: number;
    price_per_unit?: number;
    shipping_fees?: number;
    vendor?: string | null;
    catalog_number?: string | null;
    category?: string | null;
    notes?: string | null;
    link?: string | null;
  }) => Promise<PurchaseItem>;
  /** Navigate to an internal path after a successful write. */
  navigate: (path: string) => void;
};

/** Shared US dollar formatter. Produces strings like "$1,234.56". Used for
 *  every *Display field so the model never has to reformat a number. */
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** Format today as YYYY-MM-DD in local time. The purchase task anchors to
 *  today the same way the UI's NewPurchaseModal does via todayLocal(). */
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const purchaseToolsDeps: PurchaseToolsDeps = {
  listProjects: () => projectsApi.list(),
  createTask: (data) => tasksApi.create(data),
  createPurchaseItem: (data) => purchasesApi.create(data),
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Compute the total price from price_per_unit, quantity, and shipping_fees.
 *  Matches the formula purchasesApi.create uses internally. */
export function computeTotal(
  pricePerUnit: number,
  quantity: number,
  shippingFees: number,
): number {
  return Math.round((pricePerUnit * quantity + shippingFees) * 100) / 100;
}

/** Format a number as a US dollar string. The caller must echo this string
 *  verbatim, never re-type the underlying number. */
export function formatUsd(amount: number): string {
  return USD_FORMATTER.format(amount);
}

// ---------------------------------------------------------------------------
// create_purchase
// ---------------------------------------------------------------------------

export const createPurchaseTool: AiTool = {
  name: "create_purchase",
  description:
    "Create a purchase or order entry in ResearchOS. Use this when the user asks to order, buy, or log a purchase, for example \"order 2 boxes of P1000 tips from Fisher for the cyp51A project\" or \"add a purchase for 1 bottle of ethanol\". " +
    "Before writing anything the app shows the user a preview with the vendor, item, quantity, price, and project, this IS the consent, do not also call propose_plan. After the write, confirm in one short sentence what was ordered. " +
    "Resolve the project by name (case-insensitive) or numeric id. Call get_my_projects first to find a real project name or id; never invent one. " +
    "VERBATIM MONEY RULE: every *Display field returned in the result is a pre-formatted dollar string. Echo it character-for-character, never re-type, re-sum, round, or reformat. " +
    "Requires item name, quantity, and vendor at minimum. Price, shipping, notes, catalog number, and project are optional.",
  parameters: {
    type: "object",
    properties: {
      itemName: {
        type: "string",
        description:
          "The item or reagent to order, for example \"P1000 pipette tips\" or \"ethanol, 500 mL\".",
      },
      quantity: {
        type: "number",
        description: "How many units to order. Must be a positive integer.",
      },
      vendor: {
        type: "string",
        description:
          "The vendor or supplier, for example \"Fisher\" or \"Sigma-Aldrich\". Optional but strongly recommended.",
      },
      pricePerUnit: {
        type: "number",
        description:
          "The price per unit in US dollars. Optional, defaults to 0 when unknown.",
      },
      shippingFees: {
        type: "number",
        description:
          "Shipping fees in US dollars. Optional, defaults to 0.",
      },
      project: {
        type: "string",
        description:
          "The project to attach the order to, by name (case-insensitive) or numeric id. Call get_my_projects first to get the real project name or id. Omit to leave the order unattached to any project.",
      },
      catalogNumber: {
        type: "string",
        description:
          "The vendor catalog or item number, for example \"F-13961\" or \"E7023\". Optional.",
      },
      notes: {
        type: "string",
        description:
          "Any extra notes on the order, for example \"need expedited shipping\" or \"for the mass spec runs\". Optional.",
      },
      link: {
        type: "string",
        description:
          "A URL to the product page. Optional.",
      },
    },
    required: ["itemName", "quantity"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const itemName = String(args.itemName ?? "item");
    const quantity = typeof args.quantity === "number" ? Math.max(1, Math.round(args.quantity)) : 1;
    const vendor = typeof args.vendor === "string" && args.vendor.trim()
      ? args.vendor.trim()
      : null;
    const pricePerUnit = typeof args.pricePerUnit === "number" ? args.pricePerUnit : 0;
    const shippingFees = typeof args.shippingFees === "number" ? args.shippingFees : 0;
    const total = computeTotal(pricePerUnit, quantity, shippingFees);
    const totalDisplay = formatUsd(total);
    const priceDisplay = formatUsd(pricePerUnit);
    const projectRef = typeof args.project === "string" || typeof args.project === "number"
      ? String(args.project).trim()
      : null;

    const vendorLine = vendor ? `Vendor: ${vendor}` : "Vendor: (not specified)";
    const priceLine = pricePerUnit > 0
      ? `Price per unit: ${priceDisplay}, qty ${quantity}, total: ${totalDisplay}`
      : `Qty: ${quantity} (price not specified)`;
    const projectLine = projectRef ? `Project: ${projectRef}` : "Project: (unassigned)";

    return {
      summary: [
        `order "${itemName}"`,
        vendorLine,
        priceLine,
        projectLine,
      ].join(" | "),
    };
  },
  execute: async (args) => {
    const itemName = String(args.itemName ?? "").trim();
    if (!itemName) {
      return { ok: false as const, error: "itemName is required." };
    }
    const quantity = typeof args.quantity === "number"
      ? Math.max(1, Math.round(args.quantity))
      : 1;
    if (!Number.isFinite(quantity) || quantity < 1) {
      return { ok: false as const, error: "quantity must be a positive integer." };
    }
    const vendor = typeof args.vendor === "string" && args.vendor.trim()
      ? args.vendor.trim()
      : null;
    const pricePerUnit = typeof args.pricePerUnit === "number" && args.pricePerUnit >= 0
      ? args.pricePerUnit
      : 0;
    const shippingFees = typeof args.shippingFees === "number" && args.shippingFees >= 0
      ? args.shippingFees
      : 0;
    const catalogNumber = typeof args.catalogNumber === "string" && args.catalogNumber.trim()
      ? args.catalogNumber.trim()
      : null;
    const notes = typeof args.notes === "string" && args.notes.trim()
      ? args.notes.trim()
      : null;
    const link = typeof args.link === "string" && args.link.trim()
      ? args.link.trim()
      : null;

    // Resolve the project from a name or numeric id. Never invent an id.
    let projectId: number | null = null;
    const projectRef =
      typeof args.project === "string" || typeof args.project === "number"
        ? (args.project as string | number)
        : undefined;
    if (projectRef !== undefined && String(projectRef).trim() !== "") {
      const projects = await purchaseToolsDeps.listProjects();
      const project = resolveProject(projects, projectRef);
      if (!project) {
        return {
          ok: false as const,
          error: `No project called "${projectRef}" was found. Call get_my_projects and use a real project name or id.`,
        };
      }
      projectId = project.id;
    }

    // Step 1: create the parent purchase task.
    let task: Task;
    try {
      task = await purchaseToolsDeps.createTask({
        name: itemName,
        start_date: todayIso(),
        duration_days: 1,
        task_type: "purchase",
        project_id: projectId,
      });
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not create the purchase order. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Step 2: create the line item linked to the parent task.
    let item: PurchaseItem;
    try {
      item = await purchaseToolsDeps.createPurchaseItem({
        task_id: task.id,
        item_name: itemName,
        quantity,
        price_per_unit: pricePerUnit,
        shipping_fees: shippingFees,
        vendor,
        catalog_number: catalogNumber,
        notes,
        link,
      });
    } catch (err) {
      // The parent task was created. Leave it; the purchases page shows it
      // and the user can add the line item manually. Surface a clear message.
      return {
        ok: false as const,
        error: `The purchase order was created (task ${task.id}) but the line item could not be saved. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Navigate to the purchases page so the user sees the new order.
    purchaseToolsDeps.navigate("/purchases");

    const total = computeTotal(pricePerUnit, quantity, shippingFees);
    const totalDisplay = formatUsd(total);

    return {
      ok: true as const,
      taskId: task.id,
      itemId: item.id,
      itemName: item.item_name,
      vendor: item.vendor ?? null,
      quantity: item.quantity,
      pricePerUnit: item.price_per_unit,
      shippingFees: item.shipping_fees,
      totalPrice: item.total_price,
      /** Pre-formatted total price string. Echo this verbatim, never re-type. */
      totalPriceDisplay: totalDisplay,
      projectId,
      orderStatus: item.order_status ?? "needs_ordering",
    };
  },
};
