"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/AppShell";
import Tooltip from "@/components/Tooltip";
import UserAvatar from "@/components/UserAvatar";
import { labLinksApi } from "@/lib/local-api";
import type { LabLink } from "@/lib/types";
import { isWholeLabShared } from "@/lib/sharing/unified";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useFeaturePicks } from "@/hooks/useFeaturePicks";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import AttributionChip from "@/components/AttributionChip";
import { useLinksBeakerSource } from "./useLinksBeakerSource";
import { faviconUrl, hostnameOf, linkKey } from "./links-beaker-source";

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
  // Category filter, LIFTED here from the BeakerSearch hook (spec 2.3 lift A) so
  // picking a category in the palette filters the rendered board, not just the
  // palette nav list. Mirrors Gantt's projectFilter page state driving both the
  // board and the source. null = show every category group.
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Escape closes the delete-confirm modal (app-wide convention), matching the
  // backdrop click. Only bound while the confirm is open. The create / edit
  // panel below is an inline card, not an overlay, so it is left alone.
  useEscapeToClose(() => setDeleteConfirmId(null), deleteConfirmId !== null);

  // Copy-alignment manager 2026-05-26: page header now reads "Links"
  // for every account type (formerly "Lab Links" for lab accounts).
  // Visibility gate (picks.links === "yes") still lives upstream in
  // deriveVisibleTabs. featurePicks read is retained in case future
  // copy needs account-type carve-outs, but the surface label is now
  // a constant.
  const { currentUser } = useFileSystem();
  const featurePicks = useFeaturePicks(currentUser);
  void featurePicks;
  const surfaceLabel = "Links";

  // Lab-share restore (links lab-share restore bot, 2026-05-29): per-user
  // display-name map so shared-in (non-owned) cards can badge their owner.
  const profileMap = useLabUserProfileMap();

  // Form state
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState(CARD_COLORS[0].value);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  // Visibility toggle: false = "Just me" (private), true = "Whole lab".
  // New links default to "Just me".
  const [wholeLab, setWholeLab] = useState(false);

  // A link is owned by the viewer when its owner is unset (legacy, lives in
  // the viewer's own folder) or equals the current user. Only the owner may
  // edit / delete; shared-in cards are view-only.
  const isOwnLink = (link: LabLink): boolean =>
    !link.owner || link.owner === currentUser;

  // Draft persistence + navigation guard for the create form.
  // Edit form drafts are intentionally skipped: the server copy is
  // always fresh and a stale edit draft would overwrite the user's
  // most recent saved data on return.
  const LINK_DRAFT_KEY = "researchos:draft:new-lab-link";
  const hasLinkContent = isCreating && (title.trim().length > 0 || url.trim().length > 0);
  const { clearDraft: clearLinkDraft } = useDraftPersistence(
    LINK_DRAFT_KEY,
    { title, url, description, category, color },
    hasLinkContent,
    {
      onRestore: (saved) => {
        if (!saved.title?.trim() && !saved.url?.trim()) return;
        setTitle(saved.title ?? "");
        setUrl(saved.url ?? "");
        setDescription(saved.description ?? "");
        setCategory(saved.category ?? "");
        if (saved.color) setColor(saved.color);
      },
    },
  );
  useUnsavedChangesGuard(hasLinkContent);

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
    setWholeLab(false);
  };

  // Client-side preview (lift B, Grant's locked decision, no server fetch, no
  // metadata scrape). We derive the hostname + the favicon from the url right in
  // the browser. When the title is still empty we seed it with the hostname so
  // the draft is not blank; the favicon shows live on the card from the url, so
  // there is no thumbnail to store. We no longer call the getPreview stub.
  const handleFetchPreview = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    const host = hostnameOf(trimmed);
    if (!title && host && host !== trimmed) setTitle(host);
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
        whole_lab: wholeLab,
      });
      queryClient.invalidateQueries({ queryKey: ["lab-links"] });
      clearLinkDraft();
      resetForm();
      setIsCreating(false);
    } catch {
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
        whole_lab: wholeLab,
      });
      queryClient.invalidateQueries({ queryKey: ["lab-links"] });
      setEditingLink(null);
      resetForm();
    } catch {
      alert("Failed to update link");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await labLinksApi.delete(id);
      queryClient.invalidateQueries({ queryKey: ["lab-links"] });
      setDeleteConfirmId(null);
    } catch {
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
    // Initialize the Visibility toggle from whether the link carries the
    // "*" whole-lab sentinel in shared_with.
    setWholeLab(isWholeLabShared(link.shared_with ?? []));
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

  // Register the Links BeakerSearch source (step 3) while the page is mounted.
  // The pure builder + the thin wiring live in the co-located
  // links-beaker-source.ts / useLinksBeakerSource.ts; this hands it the page's
  // live state + real handlers so the palette drives the same flows the cards do.
  useLinksBeakerSource({
    links,
    groupedLinks,
    editingLink,
    isCreating,
    isLoadingPreview,
    title,
    url,
    wholeLab,
    color,
    startCreate,
    startEdit,
    cancelEdit,
    handleCreate,
    handleUpdate,
    handleFetchPreview,
    setDeleteConfirmId,
    setColor,
    setWholeLab,
    currentUser: currentUser ?? "",
    profileMap,
    activeCategory,
    setActiveCategory,
  });

  return (
    <AppShell>
      <div className="flex-1 overflow-auto px-6 pt-3 pb-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-title font-semibold text-foreground">{surfaceLabel}</h2>
            <span className="text-meta text-foreground-muted">
              {links.length} link{links.length !== 1 ? "s" : ""} saved
            </span>
          </div>
          <button
            onClick={startCreate}
            className="px-4 py-2 bg-brand-action text-white text-body font-medium rounded-lg hover:bg-brand-action/90 transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Add Link
          </button>
        </div>

        {/* Create/Edit Form */}
        {(isCreating || editingLink) && (
          <div className="bg-surface-raised border border-border rounded-xl p-5 mb-6">
            <h3 className="text-body font-semibold text-foreground mb-4">
              {editingLink ? "Edit Link" : "New Link"}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  URL *
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <Tooltip label="Fetch preview" placement="bottom">
                    <button
                      type="button"
                      onClick={handleFetchPreview}
                      disabled={!url.trim() || isLoadingPreview}
                      className="px-3 py-2 bg-surface-sunken text-foreground-muted text-body font-medium rounded-lg hover:bg-foreground-muted/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
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
                  </Tooltip>
                </div>
              </div>
              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Link title"
                  className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Category
                </label>
                <input
                  type="text"
                  list="categories"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Select or type category"
                  className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <datalist id="categories">
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
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
                          ? "border-gray-800 dark:border-foreground scale-110"
                          : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: c.value }}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>
              {/* Visibility toggle (links lab-share restore bot,
                  2026-05-29): "Just me" keeps the link private to the
                  owner; "Whole lab" stamps the edit-level "*" sentinel so
                  every lab member can see (and collaboratively maintain)
                  the bookmark. New links default to "Just me". */}
              <div className="md:col-span-2">
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Visibility
                </label>
                <div
                  role="radiogroup"
                  aria-label="Link visibility"
                  className="inline-flex rounded-lg border border-border p-0.5 bg-surface-sunken ros-seg-track"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!wholeLab}
                    onClick={() => setWholeLab(false)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-body font-medium rounded-md transition-colors ${
                      !wholeLab
                        ? "bg-surface-raised text-foreground ros-seg-active"
                        : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    Just me
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={wholeLab}
                    onClick={() => setWholeLab(true)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-body font-medium rounded-md transition-colors ${
                      wholeLab
                        ? "bg-surface-raised text-blue-600 dark:text-blue-300 ros-seg-active"
                        : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    Whole lab
                  </button>
                </div>
                <p className="text-meta text-foreground-muted mt-1">
                  {wholeLab
                    ? "Everyone in your lab can see and edit this link."
                    : "Only you can see this link."}
                </p>
              </div>
              <div className="md:col-span-2">
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description (optional)"
                  className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              {/* Preview Image URL */}
              <div className="md:col-span-2">
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Preview Image URL
                </label>
                <div className="flex gap-2 items-start">
                  <input
                    type="url"
                    value={previewImageUrl || ""}
                    onChange={(e) => setPreviewImageUrl(e.target.value || null)}
                    placeholder="Auto-fetched or paste custom image URL"
                    className="flex-1 px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {previewImageUrl && (
                    <div className="w-20 h-14 rounded-lg overflow-hidden border border-border flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element -- src is an arbitrary user-pasted HTTP URL (link preview thumbnail); next/image would require an allowlist of every domain users might paste */}
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
                className="px-4 py-2 text-body text-foreground-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={editingLink ? handleUpdate : handleCreate}
                disabled={!title.trim() || !url.trim()}
                className="px-4 py-2 bg-brand-action text-white text-body font-medium rounded-lg hover:bg-brand-action/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingLink ? "Save Changes" : "Create Link"}
              </button>
            </div>
          </div>
        )}

        {/* Links Grid */}
        {isLoading ? (
          <div className="text-center py-16">
            <p className="text-foreground-muted">Loading links...</p>
          </div>
        ) : links.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 bg-surface-sunken rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-muted">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </div>
            <p className="text-title text-foreground-muted mb-2">No links saved yet</p>
            <p className="text-body text-foreground-muted">
              Add a link to save it here
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Active category filter banner (spec 2.3 lift A). When a category
                is picked in the palette the board renders only that group; this
                row shows what is filtered and offers a one-click clear. */}
            {activeCategory && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-sunken px-3 py-2">
                <p className="text-meta text-foreground-muted">
                  Showing{" "}
                  <span className="font-medium text-foreground">{activeCategory}</span>
                  {" "}
                  ({groupedLinks[activeCategory]?.length ?? 0} link
                  {(groupedLinks[activeCategory]?.length ?? 0) === 1 ? "" : "s"})
                </p>
                <button
                  type="button"
                  onClick={() => setActiveCategory(null)}
                  className="text-meta font-medium text-blue-600 dark:text-blue-300 hover:underline"
                >
                  Clear the {activeCategory} filter
                </button>
              </div>
            )}
            {Object.entries(groupedLinks)
              .filter(([cat]) => !activeCategory || cat === activeCategory)
              .map(([cat, catLinks]) => (
              <div key={cat} data-link-category={cat}>
                <h3 className="text-meta font-semibold text-foreground-muted uppercase tracking-wider mb-3">
                  {cat}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {catLinks.map((link) => (
                    <a
                      key={link.id}
                      data-link-key={link.id}
                      data-beaker-target={`link:${linkKey(link, currentUser ?? "")}`}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group bg-surface-raised border border-border rounded-xl overflow-hidden hover:shadow-lg hover:border-border transition-all flex flex-col"
                    >
                      {/* Preview Image or Color Bar */}
                      <div 
                        className="h-32 relative bg-surface-sunken flex-shrink-0"
                        style={{ backgroundColor: link.preview_image_url ? undefined : (link.color || CARD_COLORS[0].value) }}
                      >
                        {link.preview_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- src is an arbitrary user-pasted HTTP URL (link preview thumbnail); next/image would require an allowlist of every domain users might paste
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
                          // Client-side preview (lift B, Grant's locked
                          // decision, no server fetch, no metadata scrape): the
                          // site favicon + hostname derived from the url in the
                          // browser. faviconUrl guards a malformed url and
                          // returns null, in which case the color bar shows on
                          // its own. The favicon img self-hides on a load error.
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                            {faviconUrl(link.url) && (
                              // eslint-disable-next-line @next/next/no-img-element -- favicon from the public favicon service for an arbitrary hostname; next/image would require an allowlist of every domain users might paste
                              <img
                                src={faviconUrl(link.url) ?? undefined}
                                alt=""
                                width={32}
                                height={32}
                                className="w-8 h-8 rounded-md bg-white/90 p-1 shadow-sm"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            )}
                            <span className="px-2 text-meta font-medium text-white/90 truncate max-w-full">
                              {hostnameOf(link.url)}
                            </span>
                          </div>
                        )}
                        {/* Category badge */}
                        {link.category && (
                          <div className="absolute top-2 left-2">
                            <span className="px-2 py-0.5 bg-black/50 text-white text-meta rounded-full backdrop-blur-sm">
                              {link.category}
                            </span>
                          </div>
                        )}
                        {/* Action buttons overlay. Only the link's OWNER
                            may edit / delete; shared-in cards (owned by
                            another lab member) are view-only, so the
                            affordances are hidden entirely for them. */}
                        {isOwnLink(link) && (
                          <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Tooltip label="Edit" placement="bottom">
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  startEdit(link);
                                }}
                                className="p-1.5 bg-surface-raised/90 text-foreground-muted hover:text-foreground hover:bg-surface-raised rounded-lg transition-colors shadow-sm"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                </svg>
                              </button>
                            </Tooltip>
                            <Tooltip label="Delete" placement="bottom">
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setDeleteConfirmId(link.id);
                                }}
                                className="p-1.5 bg-surface-raised/90 text-foreground-muted hover:text-red-500 hover:bg-surface-raised rounded-lg transition-colors shadow-sm"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                                  <path d="M10 11v6M14 11v6" />
                                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                                </svg>
                              </button>
                            </Tooltip>
                          </div>
                        )}
                      </div>
                      
                      {/* Content */}
                      <div className="p-4 flex-1 flex flex-col">
                        <h4 className="text-body font-semibold text-foreground group-hover:text-blue-600 dark:hover:text-blue-300 transition-colors line-clamp-2">
                          {link.title}
                        </h4>
                        {link.description && (
                          <p className="text-meta text-foreground-muted mt-1.5 line-clamp-2 flex-1">
                            {link.description}
                          </p>
                        )}
                        <p className="text-meta text-foreground-muted mt-2 truncate">
                          {new URL(link.url).hostname}
                        </p>
                        {/* Owner badge (links lab-share restore bot,
                            2026-05-29): shared-in cards (owned by another
                            lab member) carry the owner's avatar + name so
                            it is clear which cards are yours vs shared with
                            you. Own cards omit the badge. */}
                        {!isOwnLink(link) && link.owner && (
                          <div className="flex items-center gap-1.5 mt-2 min-w-0">
                            <UserAvatar username={link.owner} size="xs" />
                            <span className="text-meta text-foreground-muted truncate">
                              Shared by{" "}
                              {profileMap[link.owner]?.displayName?.trim() ||
                                link.owner}
                            </span>
                          </div>
                        )}
                        {/* VCP R3 attribution stamps (VCP R3 attribution
                            stamps, 2026-05-26): inline last-edited chip in
                            the lab link card footer. Self-hides on pre-R3
                            links that lack the fields. */}
                        <div className="mt-1">
                          <AttributionChip
                            username={link.last_edited_by}
                            editedAt={link.last_edited_at}
                            small
                          />
                        </div>
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
            <div className="bg-surface-overlay border border-border shadow-lg rounded-xl p-6 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-heading font-semibold text-foreground mb-2">
                Delete Link?
              </h3>
              <p className="text-body text-foreground-muted mb-4">
                This action cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="px-4 py-2 text-body text-foreground-muted hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirmId)}
                  className="px-4 py-2 bg-red-500 text-white text-body font-medium rounded-lg hover:bg-red-600 transition-colors"
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