"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { purchasesApi, labApi } from "@/lib/api";
import type { CatalogItem, PurchaseItem } from "@/lib/types";

interface PurchaseEditorProps {
  taskId: number;
  readOnly?: boolean; // When true, all editing is disabled (for lab mode)
  username?: string; // When provided, fetch from this user's data (for lab mode)
}

interface EditingRow {
  item_name: string;
  quantity: string;
  link: string;
  cas: string;
  price_per_unit: string;
  shipping_fees: string;
  notes: string;
}

const EMPTY_ROW: EditingRow = {
  item_name: "",
  quantity: "",
  link: "",
  cas: "",
  price_per_unit: "",
  shipping_fees: "",
  notes: "",
};

function itemToEditingRow(item: PurchaseItem): EditingRow {
  return {
    item_name: item.item_name,
    quantity: item.quantity.toString(),
    link: item.link || "",
    cas: item.cas || "",
    price_per_unit: item.price_per_unit.toString(),
    shipping_fees: item.shipping_fees.toString(),
    notes: item.notes || "",
  };
}

export default function PurchaseEditor({ taskId, readOnly = false, username }: PurchaseEditorProps) {
  const queryClient = useQueryClient();
  const [newRow, setNewRow] = useState<EditingRow>({ ...EMPTY_ROW });
  const [suggestions, setSuggestions] = useState<CatalogItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedCatalogItem, setSelectedCatalogItem] = useState<CatalogItem | null>(null);
  const [overwriteDialog, setOverwriteDialog] = useState<{
    field: string;
    catalogItem: CatalogItem;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const suggestionsRef = useRef<HTMLTableCellElement>(null);
  
  // Editing state for existing items
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingRow, setEditingRow] = useState<EditingRow>({ ...EMPTY_ROW });
  const [editSuggestions, setEditSuggestions] = useState<CatalogItem[]>([]);
  const [showEditSuggestions, setShowEditSuggestions] = useState(false);
  const [editSelectedCatalogItem, setEditSelectedCatalogItem] = useState<CatalogItem | null>(null);
  const editSuggestionsRef = useRef<HTMLTableCellElement>(null);

  const { data: items = [], refetch } = useQuery({
    queryKey: ["purchases", taskId, username],
    queryFn: () => {
      // If username is provided (lab mode), use lab API
      if (username) {
        return labApi.getUserPurchaseItems(username, taskId);
      }
      // Otherwise use regular purchases API
      return purchasesApi.listByTask(taskId);
    },
  });

  // Search catalog as user types item name
  useEffect(() => {
    const q = newRow.item_name.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await purchasesApi.searchCatalog(q);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [newRow.item_name]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
      if (
        editSuggestionsRef.current &&
        !editSuggestionsRef.current.contains(e.target as Node)
      ) {
        setShowEditSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Search catalog as user types in edit row
  useEffect(() => {
    const q = editingRow.item_name.trim();
    if (q.length < 2) {
      setEditSuggestions([]);
      setShowEditSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await purchasesApi.searchCatalog(q);
        setEditSuggestions(results);
        setShowEditSuggestions(results.length > 0);
      } catch {
        setEditSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [editingRow.item_name]);

  const handleSelectSuggestion = useCallback((cat: CatalogItem) => {
    setNewRow((prev) => ({
      ...prev,
      item_name: cat.item_name,
      link: cat.link || "",
      cas: cat.cas || "",
      price_per_unit: cat.price_per_unit.toString(),
    }));
    setSelectedCatalogItem(cat);
    setShowSuggestions(false);
  }, []);

  const handleSelectEditSuggestion = useCallback((cat: CatalogItem) => {
    setEditingRow((prev) => ({
      ...prev,
      item_name: cat.item_name,
      link: cat.link || "",
      cas: cat.cas || "",
      price_per_unit: cat.price_per_unit.toString(),
    }));
    setEditSelectedCatalogItem(cat);
    setShowEditSuggestions(false);
  }, []);

  const handleStartEdit = useCallback((item: PurchaseItem) => {
    setEditingItemId(item.id);
    setEditingRow(itemToEditingRow(item));
    setEditSelectedCatalogItem(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingItemId(null);
    setEditingRow({ ...EMPTY_ROW });
    setEditSelectedCatalogItem(null);
  }, []);

  const handleEditFieldChange = useCallback(
    (field: keyof EditingRow, value: string) => {
      setEditingRow((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editingItemId || !editingRow.item_name.trim()) return;
    setSaving(true);
    try {
      await purchasesApi.update(editingItemId, {
        item_name: editingRow.item_name.trim(),
        quantity: parseInt(editingRow.quantity) || 1,
        link: editingRow.link.trim() || null,
        cas: editingRow.cas.trim() || null,
        price_per_unit: parseFloat(editingRow.price_per_unit) || 0,
        shipping_fees: parseFloat(editingRow.shipping_fees) || 0,
        notes: editingRow.notes.trim() || null,
      });
      setEditingItemId(null);
      setEditingRow({ ...EMPTY_ROW });
      setEditSelectedCatalogItem(null);
      refetch();
      await queryClient.refetchQueries({ queryKey: ["purchases-all"] });
    } catch {
      alert("Failed to update item");
    } finally {
      setSaving(false);
    }
  }, [editingItemId, editingRow, refetch, queryClient]);

  const handleFieldChange = useCallback(
    (field: keyof EditingRow, value: string) => {
      setNewRow((prev) => ({ ...prev, [field]: value }));

      // Check if user changed link, cas, or price_per_unit after selecting from catalog
      if (
        selectedCatalogItem &&
        (field === "link" || field === "cas" || field === "price_per_unit")
      ) {
        const originalValue =
          field === "link"
            ? selectedCatalogItem.link || ""
            : field === "cas"
            ? selectedCatalogItem.cas || ""
            : selectedCatalogItem.price_per_unit.toString();

        if (value !== originalValue && value.trim() !== "") {
          // Will show dialog on save
        }
      }
    },
    [selectedCatalogItem]
  );

  const computeTotal = useCallback((row: EditingRow): string => {
    const qty = parseInt(row.quantity) || 0;
    const ppu = parseFloat(row.price_per_unit) || 0;
    const ship = parseFloat(row.shipping_fees) || 0;
    return (qty * ppu + ship).toFixed(2);
  }, []);

  const doAddRow = useCallback(async (rowData: EditingRow) => {
    try {
      await purchasesApi.create({
        task_id: taskId,
        item_name: rowData.item_name.trim(),
        quantity: parseInt(rowData.quantity) || 1,
        link: rowData.link.trim() || null,
        cas: rowData.cas.trim() || null,
        price_per_unit: parseFloat(rowData.price_per_unit) || 0,
        shipping_fees: parseFloat(rowData.shipping_fees) || 0,
        notes: rowData.notes.trim() || null,
      });
      setNewRow({ ...EMPTY_ROW });
      setSelectedCatalogItem(null);
      refetch();
      await queryClient.refetchQueries({ queryKey: ["purchases-all"] });
    } catch {
      alert("Failed to add item");
    } finally {
      setSaving(false);
    }
  }, [taskId, refetch, queryClient]);

  const handleAddRow = useCallback(async () => {
    if (!newRow.item_name.trim() || !newRow.quantity) return;
    setSaving(true);

    // Check if catalog item was modified
    if (selectedCatalogItem) {
      const linkChanged =
        newRow.link !== (selectedCatalogItem.link || "") && newRow.link.trim() !== "";
      const casChanged =
        newRow.cas !== (selectedCatalogItem.cas || "") && newRow.cas.trim() !== "";
      const priceChanged =
        newRow.price_per_unit !== selectedCatalogItem.price_per_unit.toString() &&
        newRow.price_per_unit.trim() !== "";

      if (linkChanged || casChanged || priceChanged) {
        setOverwriteDialog({
          field: [
            linkChanged ? "Link" : "",
            casChanged ? "CAS" : "",
            priceChanged ? "Price" : "",
          ]
            .filter(Boolean)
            .join(", "),
          catalogItem: selectedCatalogItem,
        });
        setSaving(false);
        return;
      }
    }

    await doAddRow(newRow);
  }, [newRow, selectedCatalogItem, doAddRow]);

  const handleOverwriteChoice = useCallback(
    async (choice: "overwrite" | "new") => {
      if (!overwriteDialog) return;
      setSaving(true);

      if (choice === "overwrite") {
        try {
          await purchasesApi.updateCatalogItem(overwriteDialog.catalogItem.id, {
            item_name: newRow.item_name.trim(),
            link: newRow.link.trim() || null,
            cas: newRow.cas.trim() || null,
            price_per_unit: parseFloat(newRow.price_per_unit) || 0,
          });
        } catch {
          alert("Failed to update catalog");
        }
      } else {
        try {
          await purchasesApi.createCatalogItem({
            item_name: newRow.item_name.trim(),
            link: newRow.link.trim() || null,
            cas: newRow.cas.trim() || null,
            price_per_unit: parseFloat(newRow.price_per_unit) || 0,
          });
        } catch {
          alert("Failed to create catalog item");
        }
      }

      setOverwriteDialog(null);
      await doAddRow(newRow);
    },
    [overwriteDialog, newRow, doAddRow]
  );

  const handleDeleteItem = useCallback(
    async (id: number) => {
      try {
        await purchasesApi.delete(id);
        refetch();
        await queryClient.refetchQueries({ queryKey: ["purchases-all"] });
      } catch {
        alert("Failed to delete item");
      }
    },
    [refetch, queryClient]
  );

  const taskTotal = items.reduce((sum, i) => sum + i.total_price, 0);

  return (
    <div className="p-4">
      {/* Overwrite dialog */}
      {overwriteDialog && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-medium text-amber-800 mb-2">
            You changed {overwriteDialog.field} from the catalog entry &ldquo;
            {overwriteDialog.catalogItem.item_name}&rdquo;.
          </p>
          <p className="text-xs text-amber-600 mb-3">
            Would you like to update the existing catalog entry or save as a new
            item?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleOverwriteChoice("overwrite")}
              className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700"
            >
              Overwrite existing
            </button>
            <button
              onClick={() => handleOverwriteChoice("new")}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Save as new item
            </button>
            <button
              onClick={() => {
                setOverwriteDialog(null);
                setSaving(false);
              }}
              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 w-48">
                Item Name
              </th>
              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 w-16">
                Qty
              </th>
              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 w-40">
                Link
              </th>
              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 w-32">
                CAS / Accession
              </th>
              <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 w-24">
                Price/Unit
              </th>
              <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 w-24">
                Shipping
              </th>
              <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 w-24">
                Total
              </th>
              <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 w-32">
                Notes
              </th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {/* Existing items */}
            {items.map((item) => (
              editingItemId === item.id ? (
                // Edit mode row
                <tr
                  key={item.id}
                  className="border-b border-gray-50 bg-amber-50/50"
                >
                  <td className="py-2 px-2 relative" ref={editSuggestionsRef}>
                    <input
                      type="text"
                      value={editingRow.item_name}
                      onChange={(e) => handleEditFieldChange("item_name", e.target.value)}
                      placeholder="Item name..."
                      className="w-full px-2 py-1 border border-amber-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                    {/* Edit suggestions dropdown */}
                    {showEditSuggestions && editSuggestions.length > 0 && (
                      <div className="absolute top-full left-2 right-2 z-10 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                        {editSuggestions.map((cat) => (
                          <button
                            key={cat.id}
                            onClick={() => handleSelectEditSuggestion(cat)}
                            className="w-full text-left px-3 py-2 hover:bg-amber-50 border-b border-gray-50 last:border-b-0"
                          >
                            <p className="text-sm font-medium text-gray-900">
                              {cat.item_name}
                            </p>
                            <p className="text-xs text-gray-400">
                              ${cat.price_per_unit.toFixed(2)}
                              {cat.cas ? ` · ${cat.cas}` : ""}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={editingRow.quantity}
                      onChange={(e) =>
                        handleEditFieldChange("quantity", e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="0"
                      className="w-full px-2 py-1 border border-amber-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={editingRow.link}
                      onChange={(e) => handleEditFieldChange("link", e.target.value)}
                      placeholder="URL..."
                      className="w-full px-2 py-1 border border-amber-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={editingRow.cas}
                      onChange={(e) => handleEditFieldChange("cas", e.target.value)}
                      placeholder="CAS#..."
                      className="w-full px-2 py-1 border border-amber-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={editingRow.price_per_unit}
                      onChange={(e) =>
                        handleEditFieldChange("price_per_unit", e.target.value)
                      }
                      placeholder="0.00"
                      className="w-full px-2 py-1 border border-amber-300 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={editingRow.shipping_fees}
                      onChange={(e) =>
                        handleEditFieldChange("shipping_fees", e.target.value)
                      }
                      placeholder="0.00"
                      className="w-full px-2 py-1 border border-amber-300 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-2 text-right font-medium text-gray-700">
                    ${computeTotal(editingRow)}
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={editingRow.notes}
                      onChange={(e) => handleEditFieldChange("notes", e.target.value)}
                      placeholder="Notes..."
                      className="w-full px-2 py-1 border border-amber-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-1 flex items-center gap-1">
                    <button
                      onClick={handleSaveEdit}
                      disabled={saving || !editingRow.item_name.trim()}
                      className="text-green-500 hover:text-green-700 text-sm font-bold disabled:opacity-30"
                      title="Save changes"
                    >
                      ✓
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="text-gray-400 hover:text-gray-600 text-sm"
                      title="Cancel editing"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ) : (
                // View mode row
                <tr
                  key={item.id}
                  className={`border-b border-gray-50 ${!readOnly ? "hover:bg-gray-50 cursor-pointer" : ""}`}
                  onClick={!readOnly ? () => handleStartEdit(item) : undefined}
                >
                  <td className="py-2 px-2 text-gray-700">{item.item_name}</td>
                  <td className="py-2 px-2 text-gray-700">{item.quantity}</td>
                  <td className="py-2 px-2">
                    {item.link ? (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline truncate block max-w-[150px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.link}
                      </a>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-gray-500 text-xs">
                    {item.cas || "—"}
                  </td>
                  <td className="py-2 px-2 text-right text-gray-700">
                    ${item.price_per_unit.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right text-gray-500">
                    ${item.shipping_fees.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right font-medium text-gray-900">
                    ${item.total_price.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-gray-400 text-xs">
                    {item.notes || "—"}
                  </td>
                  <td className="py-2 px-1">
                    {!readOnly && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteItem(item.id);
                        }}
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              )
            ))}

            {/* New row input - hidden in readOnly mode */}
            {!readOnly && (
              <tr className="bg-blue-50/30">
                <td className="py-2 px-2 relative" ref={suggestionsRef}>
                  <input
                    type="text"
                    value={newRow.item_name}
                    onChange={(e) =>
                      handleFieldChange("item_name", e.target.value)
                    }
                    placeholder="Item name..."
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  {/* Suggestions dropdown */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute top-full left-2 right-2 z-10 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {suggestions.map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => handleSelectSuggestion(cat)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-b-0"
                        >
                          <p className="text-sm font-medium text-gray-900">
                            {cat.item_name}
                          </p>
                          <p className="text-xs text-gray-400">
                            ${cat.price_per_unit.toFixed(2)}
                            {cat.cas ? ` · ${cat.cas}` : ""}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-2 px-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={newRow.quantity}
                    onChange={(e) =>
                      handleFieldChange("quantity", e.target.value.replace(/\D/g, ""))
                    }
                    placeholder="0"
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newRow.link}
                    onChange={(e) => handleFieldChange("link", e.target.value)}
                    placeholder="URL..."
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newRow.cas}
                    onChange={(e) => handleFieldChange("cas", e.target.value)}
                    placeholder="CAS#..."
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={newRow.price_per_unit}
                    onChange={(e) =>
                      handleFieldChange("price_per_unit", e.target.value)
                    }
                    placeholder="0.00"
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={newRow.shipping_fees}
                    onChange={(e) =>
                      handleFieldChange("shipping_fees", e.target.value)
                    }
                    placeholder="0.00"
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2 text-right font-medium text-gray-700">
                  ${computeTotal(newRow)}
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newRow.notes}
                    onChange={(e) => handleFieldChange("notes", e.target.value)}
                    placeholder="Notes..."
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-1">
                  <button
                    onClick={handleAddRow}
                    disabled={saving || !newRow.item_name.trim() || !newRow.quantity}
                    className="text-blue-500 hover:text-blue-700 text-sm font-bold disabled:opacity-30"
                  >
                    +
                  </button>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200">
              <td colSpan={6} className="py-2 px-2 text-right text-xs font-semibold text-gray-500">
                Order Total:
              </td>
              <td className="py-2 px-2 text-right font-bold text-gray-900">
                ${taskTotal.toFixed(2)}
              </td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
