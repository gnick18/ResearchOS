// BeakerBot edit (update) coworker tools (ai edit-tools bot, 2026-06-14).
//
// The remaining UPDATE tools that close BeakerBot's "can create but not edit" gap
// for the last object types. BeakerBot could already create sequences, molecules,
// notes, and purchases, but not change one after the fact. These add the edits a
// user most often wants:
//
//   - update_sequence: rename a library sequence (display name).
//   - update_molecule: rename a molecule.
//   - update_note: rename a note (its title).
//   - update_purchase: change an order's item name, quantity, vendor, or unit price,
//     or move its status (needs ordering -> ordered -> received). Status uses
//     purchaseItemsApi.setOrderStatus so the ordering bell still fires.
//
// All ACTION tools (action: true, isDestructive false). None deletes, so none forces
// the destructive hard-stop; the user sees a one-line confirm before anything writes.
//
// THE LANE RULE. The local-api owns every write. Each tool resolves the object by the
// user's words (a name or id) and patches it through the real api, never invents a
// field. v1 is OWN objects only where the type carries the is_shared_with_me overlay.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  sequencesApi,
  notesApi,
  purchasesApi,
} from "@/lib/local-api";
import { moleculesApi, type MoleculeMeta } from "@/lib/chemistry/api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { objectDeepLink } from "@/lib/references";
import type {
  SequenceRecord,
  Note,
  PurchaseItem,
  PurchaseItemUpdate,
  PurchaseOrderStatus,
} from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam
// ---------------------------------------------------------------------------

export type EditToolsDeps = {
  listSequences: () => Promise<SequenceRecord[]>;
  renameSequence: (id: number, displayName: string) => Promise<SequenceRecord | null>;
  listMolecules: () => Promise<MoleculeMeta[]>;
  renameMolecule: (id: string, name: string) => Promise<MoleculeMeta | null>;
  listNotes: () => Promise<Note[]>;
  renameNote: (id: number, title: string) => Promise<Note | null>;
  /** Fetch a note WITH its entries (the list projection may be lean). */
  getNote: (id: number) => Promise<Note | null>;
  /** Replace one entry's content (the running-log edit path). */
  setNoteEntryContent: (
    noteId: number,
    entryId: string,
    content: string,
  ) => Promise<Note | null>;
  /** Replace the note's top-level description (for an entry-less note). */
  setNoteDescription: (id: number, description: string) => Promise<Note | null>;
  listPurchases: () => Promise<PurchaseItem[]>;
  updatePurchase: (id: number, data: PurchaseItemUpdate) => Promise<PurchaseItem | null>;
  setPurchaseStatus: (
    id: number,
    status: PurchaseOrderStatus,
  ) => Promise<{ item: PurchaseItem | null; notified: boolean }>;
  navigate: (path: string) => void;
};

export const editToolsDeps: EditToolsDeps = {
  listSequences: () => sequencesApi.list(),
  renameSequence: (id, displayName) =>
    sequencesApi.update(id, { display_name: displayName }),
  listMolecules: () => moleculesApi.list(),
  renameMolecule: (id, name) => moleculesApi.update(id, { name }),
  listNotes: () => notesApi.list(),
  renameNote: (id, title) => notesApi.update(id, { title }),
  getNote: (id) => notesApi.get(id),
  setNoteEntryContent: (noteId, entryId, content) =>
    notesApi.updateEntry(noteId, entryId, { content }),
  setNoteDescription: (id, description) => notesApi.update(id, { description }),
  listPurchases: () => purchasesApi.listAll(),
  updatePurchase: (id, data) => purchasesApi.update(id, data),
  setPurchaseStatus: (id, status) => purchasesApi.setOrderStatus(id, status),
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Resolution helpers (pure, exported for tests)
// ---------------------------------------------------------------------------

/** Generic own-only resolver by numeric id or case-insensitive name. The id type
 *  is the record's own (number for sequences/notes/purchases, string for
 *  molecules). `nameOf` reads the display field; `idOf` reads the id; `isShared`
 *  excludes a shared-with-me record. Pure. */
function resolveBy<T, ID>(
  items: T[],
  ref: string | number | undefined,
  idOf: (t: T) => ID,
  nameOf: (t: T) => string,
  isShared: (t: T) => boolean,
): T | null {
  if (ref === undefined || ref === null || ref === "") return null;
  const own = items.filter((t) => !isShared(t));
  const refStr = String(ref).trim();
  // Id match: compare as strings so a numeric or string id both work.
  const byId = own.find((t) => String(idOf(t)) === refStr);
  if (byId) return byId;
  const name = refStr.toLowerCase();
  return own.find((t) => (nameOf(t) ?? "").trim().toLowerCase() === name) ?? null;
}

export function resolveSequence(
  seqs: SequenceRecord[],
  ref: string | number | undefined,
): SequenceRecord | null {
  // sequencesApi.list returns own sequences only, so none are excluded here.
  return resolveBy(seqs, ref, (s) => s.id, (s) => s.display_name, () => false);
}

export function resolveMolecule(
  mols: MoleculeMeta[],
  ref: string | number | undefined,
): MoleculeMeta | null {
  // Molecules have no shared-with-me overlay on the meta, so none are excluded.
  return resolveBy(mols, ref, (m) => m.id, (m) => m.name, () => false);
}

export function resolveNote(
  notes: Note[],
  ref: string | number | undefined,
): Note | null {
  // notesApi.list returns own notes only, so none are excluded here.
  return resolveBy(notes, ref, (n) => n.id, (n) => n.title, () => false);
}

export function resolvePurchase(
  items: PurchaseItem[],
  ref: string | number | undefined,
): PurchaseItem | null {
  return resolveBy(items, ref, (p) => p.id, (p) => p.item_name, () => false);
}

/** Resolve which note entry to edit: by its title (case-insensitive) when given,
 *  otherwise the most recent entry (latest date, falling back to the last in the
 *  array). Returns null when there are no entries or the named one is not found. */
export function resolveNoteEntry<T extends { id: string; title: string; date: string }>(
  entries: T[],
  ref: string | undefined,
): T | null {
  if (!entries.length) return null;
  if (ref && ref.trim()) {
    const name = ref.trim().toLowerCase();
    return entries.find((e) => (e.title ?? "").trim().toLowerCase() === name) ?? null;
  }
  // Latest: max by date string (ISO sorts lexically), fall back to last element.
  return entries.reduce((best, e) => (e.date > best.date ? e : best), entries[entries.length - 1]);
}

/** Map a free-form status word the user might say to the canonical order status,
 *  or null when it is not a status word. Pure. */
export function parseOrderStatus(raw: unknown): PurchaseOrderStatus | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/(receiv|arriv|deliver|got it|in hand)/.test(s)) return "received";
  // Check needs-ordering BEFORE ordered, so "need to order" / "not ordered" is not
  // swallowed by the bare "order" match for the ordered state.
  if (/(need|to-?do|to order|not ordered|unorder|not yet)/.test(s)) return "needs_ordering";
  if (/(order|placed|bought|purchas)/.test(s)) return "ordered";
  return null;
}

// ---------------------------------------------------------------------------
// update_sequence
// ---------------------------------------------------------------------------

export const updateSequenceTool: AiTool = {
  name: "update_sequence",
  description:
    "Rename one of the user's library sequences. Use this when the user asks to rename a sequence or plasmid. Call search_my_work (or list_sequences) first to find it, then call this with the sequence (a name or numeric id) and the new name. The app shows a one-line preview before anything writes. After it writes, confirm in one short sentence. Own sequences only.",
  parameters: {
    type: "object",
    properties: {
      sequence: {
        type: "string",
        description: "The sequence to rename, by its current name (case-insensitive) or numeric id.",
      },
      name: { type: "string", description: "The new name for the sequence." },
    },
    required: ["sequence", "name"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const ref = String(args.sequence ?? "?");
    const name = String(args.name ?? "").trim();
    return { summary: `rename sequence "${ref}" to "${name}"` };
  },
  execute: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return { ok: false as const, error: "A new sequence name is required." };
    const seqs = await editToolsDeps.listSequences();
    const seq = resolveSequence(seqs, args.sequence as string | number | undefined);
    if (!seq) {
      const names = seqs.map((s) => s.display_name);
      return {
        ok: false as const,
        error: `I could not find one of your sequences called "${args.sequence}". Your sequences are: ${names.length ? names.map((n) => `"${n}"`).join(", ") : "(none yet)"}.`,
      };
    }
    let updated: SequenceRecord | null;
    try {
      updated = await editToolsDeps.renameSequence(seq.id, name);
    } catch (err) {
      return { ok: false as const, error: `Could not rename the sequence. ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!updated) return { ok: false as const, error: `Sequence ${seq.id} disappeared during the update.` };
    editToolsDeps.navigate(objectDeepLink("sequence", updated.id));
    return { ok: true as const, id: updated.id, name: updated.display_name };
  },
};

// ---------------------------------------------------------------------------
// update_molecule
// ---------------------------------------------------------------------------

export const updateMoleculeTool: AiTool = {
  name: "update_molecule",
  description:
    "Rename one of the user's molecules. Use this when the user asks to rename a molecule or compound. Call search_my_work first to find it, then call this with the molecule (a name or id) and the new name. The app shows a one-line preview before anything writes. After it writes, confirm in one short sentence.",
  parameters: {
    type: "object",
    properties: {
      molecule: {
        type: "string",
        description: "The molecule to rename, by its current name (case-insensitive) or id.",
      },
      name: { type: "string", description: "The new name for the molecule." },
    },
    required: ["molecule", "name"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const ref = String(args.molecule ?? "?");
    const name = String(args.name ?? "").trim();
    return { summary: `rename molecule "${ref}" to "${name}"` };
  },
  execute: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return { ok: false as const, error: "A new molecule name is required." };
    const mols = await editToolsDeps.listMolecules();
    const mol = resolveMolecule(mols, args.molecule as string | number | undefined);
    if (!mol) {
      const names = mols.map((m) => m.name);
      return {
        ok: false as const,
        error: `I could not find one of your molecules called "${args.molecule}". Your molecules are: ${names.length ? names.map((n) => `"${n}"`).join(", ") : "(none yet)"}.`,
      };
    }
    let updated: MoleculeMeta | null;
    try {
      updated = await editToolsDeps.renameMolecule(mol.id, name);
    } catch (err) {
      return { ok: false as const, error: `Could not rename the molecule. ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!updated) return { ok: false as const, error: `Molecule ${mol.id} disappeared during the update.` };
    editToolsDeps.navigate(objectDeepLink("molecule", updated.id));
    return { ok: true as const, id: updated.id, name: updated.name };
  },
};

// ---------------------------------------------------------------------------
// update_note
// ---------------------------------------------------------------------------

export const updateNoteTool: AiTool = {
  name: "update_note",
  description:
    "Rename one of the user's notes (its title). Use this when the user asks to rename or retitle a note. To ADD content to a note use write_note (append); to edit the body, that happens in the editor. Call list_notes (or search_my_work) first to find it, then call this with the note (a title or numeric id) and the new title. The app shows a one-line preview before anything writes. After it writes, confirm in one short sentence. Own notes only.",
  parameters: {
    type: "object",
    properties: {
      note: {
        type: "string",
        description: "The note to rename, by its current title (case-insensitive) or numeric id.",
      },
      title: { type: "string", description: "The new title for the note." },
    },
    required: ["note", "title"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const ref = String(args.note ?? "?");
    const title = String(args.title ?? "").trim();
    return { summary: `rename note "${ref}" to "${title}"` };
  },
  execute: async (args) => {
    const title = String(args.title ?? "").trim();
    if (!title) return { ok: false as const, error: "A new note title is required." };
    const notes = await editToolsDeps.listNotes();
    const note = resolveNote(notes, args.note as string | number | undefined);
    if (!note) {
      const names = notes.map((n) => n.title);
      return {
        ok: false as const,
        error: `I could not find one of your notes called "${args.note}". Your notes are: ${names.length ? names.map((n) => `"${n}"`).join(", ") : "(none yet)"}.`,
      };
    }
    let updated: Note | null;
    try {
      updated = await editToolsDeps.renameNote(note.id, title);
    } catch (err) {
      return { ok: false as const, error: `Could not rename the note. ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!updated) return { ok: false as const, error: `Note ${note.id} disappeared during the update.` };
    editToolsDeps.navigate(objectDeepLink("note", updated.id));
    return { ok: true as const, id: updated.id, title: updated.title };
  },
};

// ---------------------------------------------------------------------------
// edit_note (edit the CONTENT of a note)
// ---------------------------------------------------------------------------

export const editNoteTool: AiTool = {
  name: "edit_note",
  description:
    "Edit the CONTENT of an existing note (not just its title). Use this when the user asks to fix, rewrite, or change text already in a note. To ADD a brand-new dated section use write_note instead. By default this REPLACES the content of the note's most recent entry; pass an entry title to target a specific one, or mode \"append\" to add to that entry. Call list_notes (or read_note) first. The app shows a one-line preview before anything writes. NO INTERPRETATION: write the user's OWN words, never invent findings or conclusions. Own notes only.",
  parameters: {
    type: "object",
    properties: {
      note: {
        type: "string",
        description: "The note to edit, by its title (case-insensitive) or numeric id.",
      },
      entry: {
        type: "string",
        description:
          "The title of the specific entry to edit. Optional; omit to edit the note's most recent entry.",
      },
      content: { type: "string", description: "The new content (the user's own words)." },
      mode: {
        type: "string",
        enum: ["replace", "append"],
        description:
          "\"replace\" overwrites the entry content (default). \"append\" adds to the end of that entry.",
      },
    },
    required: ["note", "content"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const ref = String(args.note ?? "?");
    const mode = args.mode === "append" ? "add to" : "rewrite";
    const target =
      typeof args.entry === "string" && args.entry.trim()
        ? ` entry "${args.entry.trim()}"`
        : " the latest entry";
    return { summary: `${mode}${target} in note "${ref}"` };
  },
  execute: async (args) => {
    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (!content) return { ok: false as const, error: "The new content is required." };
    const mode = args.mode === "append" ? "append" : "replace";

    const notes = await editToolsDeps.listNotes();
    const found = resolveNote(notes, args.note as string | number | undefined);
    if (!found) {
      const names = notes.map((n) => n.title);
      return {
        ok: false as const,
        error: `I could not find one of your notes called "${args.note}". Your notes are: ${names.length ? names.map((n) => `"${n}"`).join(", ") : "(none yet)"}.`,
      };
    }
    // Fetch the full note so we have its entries (the list projection may be lean).
    const note = (await editToolsDeps.getNote(found.id)) ?? found;
    const entryRef = typeof args.entry === "string" ? args.entry : undefined;

    let updated: Note | null;
    try {
      if (note.entries && note.entries.length > 0) {
        const entry = resolveNoteEntry(note.entries, entryRef);
        if (!entry) {
          const titles = note.entries.map((e) => `"${e.title}"`).join(", ");
          return {
            ok: false as const,
            error: `That note has no entry called "${entryRef}". Its entries are: ${titles}.`,
          };
        }
        const next = mode === "append" ? `${entry.content.trimEnd()}\n\n${content}` : content;
        updated = await editToolsDeps.setNoteEntryContent(note.id, entry.id, next);
      } else {
        // Entry-less note: edit the top-level description body.
        const next = mode === "append" ? `${(note.description ?? "").trimEnd()}\n\n${content}` : content;
        updated = await editToolsDeps.setNoteDescription(note.id, next);
      }
    } catch (err) {
      return { ok: false as const, error: `Could not edit the note. ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!updated) return { ok: false as const, error: `Note ${note.id} disappeared during the update.` };

    editToolsDeps.navigate(objectDeepLink("note", note.id));
    return { ok: true as const, id: note.id, title: updated.title, mode };
  },
};

// ---------------------------------------------------------------------------
// update_purchase
// ---------------------------------------------------------------------------

export const updatePurchaseTool: AiTool = {
  name: "update_purchase",
  description:
    "Update one of the user's purchase orders: change its item name, quantity, vendor, or unit price, or move its status (needs ordering -> ordered -> received). Use this when the user says an order arrived, changes the quantity, or fixes the vendor. Call summarize_purchases (or search_my_work) first to find the order, then call this with the purchase (an item name or numeric id) and the fields to change. The app shows a one-line preview before anything writes. After it writes, confirm in one short sentence. MONEY RULE: never re-type or re-sum a money total; if the user gives a new unit price use exactly the number they said.",
  parameters: {
    type: "object",
    properties: {
      purchase: {
        type: "string",
        description: "The order to update, by its item name (case-insensitive) or numeric id.",
      },
      itemName: { type: "string", description: "A new item name. Optional." },
      quantity: { type: "number", description: "A new quantity. Optional." },
      vendor: { type: "string", description: "A new vendor. Optional." },
      pricePerUnit: { type: "number", description: "A new unit price. Optional. Use exactly the number the user said." },
      status: {
        type: "string",
        description:
          "Move the order's status. Use \"received\" when it arrived, \"ordered\" when it was placed, or \"needs ordering\" to mark it not yet ordered. Optional.",
      },
    },
    required: ["purchase"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const ref = String(args.purchase ?? "?");
    const changes: string[] = [];
    if (typeof args.itemName === "string" && args.itemName.trim()) changes.push(`rename to "${args.itemName.trim()}"`);
    if (typeof args.quantity === "number") changes.push(`quantity ${args.quantity}`);
    if (typeof args.vendor === "string" && args.vendor.trim()) changes.push(`vendor "${args.vendor.trim()}"`);
    if (typeof args.pricePerUnit === "number") changes.push(`unit price ${args.pricePerUnit}`);
    const status = parseOrderStatus(args.status);
    if (status) changes.push(`mark ${status.replace("_", " ")}`);
    return { summary: `update order "${ref}": ${changes.length ? changes.join(", ") : "no change"}` };
  },
  execute: async (args) => {
    const items = await editToolsDeps.listPurchases();
    const item = resolvePurchase(items, args.purchase as string | number | undefined);
    if (!item) {
      const names = items.map((p) => p.item_name);
      return {
        ok: false as const,
        error: `I could not find an order called "${args.purchase}". Your orders are: ${names.length ? names.map((n) => `"${n}"`).join(", ") : "(none yet)"}.`,
      };
    }

    // Field edits (name / quantity / vendor / price) go through update; the status
    // transition goes through setOrderStatus so the ordering bell still fires.
    const data: PurchaseItemUpdate = {};
    if (typeof args.itemName === "string" && args.itemName.trim()) data.item_name = args.itemName.trim();
    if (typeof args.quantity === "number") data.quantity = Math.max(0, Math.round(args.quantity));
    if (typeof args.vendor === "string") data.vendor = args.vendor.trim() || null;
    if (typeof args.pricePerUnit === "number") data.price_per_unit = args.pricePerUnit;
    const status = parseOrderStatus(args.status);

    if (Object.keys(data).length === 0 && !status) {
      return {
        ok: false as const,
        error: "Nothing to update. Pass an item name, quantity, vendor, unit price, or a status.",
      };
    }

    let current: PurchaseItem | null = item;
    try {
      if (Object.keys(data).length > 0) {
        current = await editToolsDeps.updatePurchase(item.id, data);
      }
      if (status) {
        const res = await editToolsDeps.setPurchaseStatus(item.id, status);
        current = res.item ?? current;
      }
    } catch (err) {
      return { ok: false as const, error: `Could not update the order. ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!current) return { ok: false as const, error: `Order ${item.id} disappeared during the update.` };

    editToolsDeps.navigate("/purchases");
    return {
      ok: true as const,
      id: current.id,
      itemName: current.item_name,
      quantity: current.quantity,
      vendor: current.vendor ?? null,
      orderStatus: current.order_status ?? null,
    };
  },
};
