"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/AppShell";
import { labLinksApi } from "@/lib/api";
import type { LabLink, LabLinkCreate, LabLinkUpdate } from "@/lib/types";

// Predefined colors for link cards
const CARD_COLORS = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "Purple", value: "#a855f7" },
  { name: "Orange", value: "#f97316" },
  { name: "Pink", value: "#ec4899" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Red", value: "#ef4444" },
  { name: "Yellow", value: "#eab308" },
];

// Common categories
const CATEGORIES = [
  "Protocol",
  "Database",
  "Tool",
  "Reference",
  "Supplier",
  "Publication",
  "Software",
  "Other",
];

export default function LabLinksPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [editingLink, setEditingLink] = useState<LabLink | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const queryClient = useQueryClient();

  // Form state
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState(CARD_COLORS[0].value);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["lab-links"],
    queryFn: labLinksApi.list,
  });

  const resetForm = () => {
    setTitle("");
    setUrl("");
    setDescription("");
    setCategory("");
    setColor(CARD_COLORS[0].value);
    setPreviewImageUrl(null);
  };

  const handleFetchPreview = async () => {
    if (!url.trim()) return;
    
    setIsLoadingPreview(true);
    try {
      const preview = await labLinksApi.getPreview(url.trim());
      if (preview.title && !title) {
        setTitle(preview.title);
      }
      if (preview.description && !description) {
        setDescription(preview.description);
      }
      if (preview.image) {
        setPreviewImageUrl(preview.image);
      }
    } catch (error) {
      console.error("Failed to fetch preview:", error);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleCreate = async () => {
    if (!title.trim() || !url.trim()) return;

    try {
      await labLinksApi.create({
        title: title.trim(),
        url: url.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        color,
        preview_image_url: previewImageUrl,
      });
      queryClient.invalidateQueries({ queryKey: ["lab-links"] });
      resetForm();
      setIsCreating(false);
    } catch (error) {
      alert("Failed to create link");
    }
  };

  const handleUpdate = async () => {
    if (!editingLink || !title.trim() || !url.trim()) return;

    try {
      await labLinksApi.update(editingLink.id, {
        title: title.trim(),
        url: url.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        color,
        preview_image_url: previewImageUrl,
      });
      queryClient.invalidateQueries({ queryKey: ["lab-links"] });
      setEditingLink(null);
      resetForm();
    } catch (error) {
      alert("Failed to update link");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await labLinksApi.delete(id);
      queryClient.invalidateQueries({ queryKey: ["lab-links"] });
      setDeleteConfirmId(null);
    } catch (error) {
      alert("Failed to delete link");
    }
  };

  const startEdit = (link: LabLink) => {
    setEditingLink(link);
    setTitle(link.title);
    setUrl(link.url);
    setDescription(link.description || "");
    setCategory(link.category || "");
    setColor(link.color || CARD_COLORS[0].value);
    setPreviewImageUrl(link.preview_image_url);
    setIsCreating(false);
  };

  const cancelEdit = () => {
    setEditingLink(null);
    resetForm();
  };

  const startCreate = () => {
    setIsCreating(true);
    setEditingLink(null);
    resetForm();
  };

  // Group links by category
  const groupedLinks = links.reduce((acc, link) => {
    const cat = link.category || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(link);
    return acc;
  }, {} as Record<string, LabLink[]>);

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Lab Links</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {links.length} link{links.length !== 1 ? "s" : ""} saved
            </p>
          </div>
          <button
            onClick={startCreate}
            className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Add Link
          </button>
        </div>

        {/* Create/Edit Form */}
        {(isCreating || editingLink) && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">
              {editingLink ? "Edit Link" : "New Link"}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  URL *
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={handleFetchPreview}
                    disabled={!url.trim() || isLoadingPreview}
                    className="px-3 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                    title="Fetch preview"
                  >
                    {isLoadingPreview ? (
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Link title"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Category
                </label>
                <input
                  type="text"
                  list="categories"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Select or type category"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <datalist id="categories">
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Color
                </label>
                <div className="flex gap-2 flex-wrap">
                  {CARD_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setColor(c.value)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        color === c.value
                          ? "border-gray-800 scale-110"
                          : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: c.value }}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description (optional)"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              {/* Preview Image URL */}
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Preview Image URL
                </label>
                <div className="flex gap-2 items-start">
                  <input
                    type="url"
                    value={previewImageUrl || ""}
                    onChange={(e) => setPreviewImageUrl(e.target.value || null)}
                    placeholder="Auto-fetched or paste custom image URL"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {previewImageUrl && (
                    <div className="w-20 h-14 rounded-lg overflow-hidden border border-gray-200 flex-shrink-0">
                      <img
                        src={previewImageUrl}
                        alt="Preview"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={editingLink ? cancelEdit : () => setIsCreating(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={editingLink ? handleUpdate : handleCreate}
                disabled={!title.trim() || !url.trim()}
                className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingLink ? "Save Changes" : "Create Link"}
              </button>
            </div>
          </div>
        )}

        {/* Links Grid */}
        {isLoading ? (
          <div className="text-center py-16">
            <p className="text-gray-400">Loading links...</p>
          </div>
        ) : links.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </div>
            <p className="text-lg text-gray-400 mb-2">No links saved yet</p>
            <p className="text-sm text-gray-300">
              Click &ldquo;Add Link&rdquo; to save your first hyperlink
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedLinks).map(([cat, catLinks]) => (
              <div key={cat}>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  {cat}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {catLinks.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-lg hover:border-gray-300 transition-all flex flex-col"
                    >
                      {/* Preview Image or Color Bar */}
                      <div 
                        className="h-32 relative bg-gray-100 flex-shrink-0"
                        style={{ backgroundColor: link.preview_image_url ? undefined : (link.color || CARD_COLORS[0].value) }}
                      >
                        {link.preview_image_url ? (
                          <img
                            src={link.preview_image_url}
                            alt={link.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // Fallback to color bar on image load error
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/50">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                            </svg>
                          </div>
                        )}
                        {/* Category badge */}
                        {link.category && (
                          <div className="absolute top-2 left-2">
                            <span className="px-2 py-0.5 bg-black/50 text-white text-xs rounded-full backdrop-blur-sm">
                              {link.category}
                            </span>
                          </div>
                        )}
                        {/* Action buttons overlay */}
                        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              startEdit(link);
                            }}
                            className="p-1.5 bg-white/90 text-gray-600 hover:text-gray-800 hover:bg-white rounded-lg transition-colors shadow-sm"
                            title="Edit"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                            </svg>
                          </button>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleteConfirmId(link.id);
                            }}
                            className="p-1.5 bg-white/90 text-gray-400 hover:text-red-500 hover:bg-white rounded-lg transition-colors shadow-sm"
                            title="Delete"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18"/>
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                      
                      {/* Content */}
                      <div className="p-4 flex-1 flex flex-col">
                        <h4 className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-2">
                          {link.title}
                        </h4>
                        {link.description && (
                          <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 flex-1">
                            {link.description}
                          </p>
                        )}
                        <p className="text-xs text-gray-400 mt-2 truncate">
                          {new URL(link.url).hostname}
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirmId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteConfirmId(null)}>
            <div className="bg-white rounded-xl p-6 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Delete Link?
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                This action cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirmId)}
                  className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}