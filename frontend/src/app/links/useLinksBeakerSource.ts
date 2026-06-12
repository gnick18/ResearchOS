// sequence editor master (Links source sub-bot). BeakerSearch step 3, the thin
// HOOK that wires the live Links page state + handlers into the pure
// buildLinksSource builder and registers the result with the shared palette.
//
// All the testable logic lives in links-beaker-source.ts (no React, no store).
// LabLinksPage owns its state in local useState (the merged ["lab-links"] list,
// the create / edit form, the selection), so it hands those in rather than the
// hook re-deriving them, mirroring the Calendar source's args-in shape. This
// hook adds the palette-managed activeCategory state the page lacks today (spec
// 7), closes the per-link write helpers over labLinksApi + the single
// ["lab-links"] invalidation (spec 1.4), closes the read-only external-open /
// copy / scroll moves, and calls buildLinksSource inside a useMemo so the
// registration object is stable.
//
// External open (spec 4.2), ALWAYS a new tab via window.open(url, "_blank",
// "noopener,noreferrer") so the opened page cannot reach window.opener. Copy via
// navigator.clipboard.writeText. Both guarded.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { labLinksApi } from "@/lib/local-api";
import { isWholeLabShared } from "@/lib/sharing/unified";
import { useBeakerSearchSource } from "@/components/beaker-search/useBeakerSearchSource";
// beaker-hover.ts deleted (ai centered-redesign bot): hover bias removed.
import type { LabLink } from "@/lib/types";
import {
  buildLinksSource,
  BULK_OPEN_CONFIRM_THRESHOLD,
  type LinksSourceData,
  type LinksSourceHandlers,
} from "./links-beaker-source";

/** The page's live state + handlers, passed straight in so the palette drives
 *  the exact same flows the page's own buttons do. LabLinksPage owns the form
 *  state + the selection + the modal plumbing, so it hands them in. */
export interface UseLinksBeakerSourceArgs {
  links: LabLink[];
  groupedLinks: Record<string, LabLink[]>;
  editingLink: LabLink | null;
  isCreating: boolean;
  isLoadingPreview: boolean;
  // Form state (drives the draft Suggested set).
  title: string;
  url: string;
  wholeLab: boolean;
  color: string;
  // Real page handlers.
  startCreate: () => void;
  startEdit: (link: LabLink) => void;
  cancelEdit: () => void;
  handleCreate: () => void | Promise<void>;
  handleUpdate: () => void | Promise<void>;
  handleFetchPreview: () => void | Promise<void>;
  setDeleteConfirmId: (id: number | null) => void;
  setColor: (hex: string) => void;
  setWholeLab: (b: boolean) => void;
  // Identity.
  currentUser: string;
  profileMap: Record<string, { displayName?: string | null }>;
  // Category filter, LIFTED to the page so selecting a category in the palette
  // actually filters the rendered board (it is no longer palette-local state).
  // Mirrors how Gantt's projectFilterMode / selectedProjectIds page state drives
  // both the board and the source.
  activeCategory: string | null;
  setActiveCategory: (c: string | null) => void;
}

/** Scroll a card into view and pulse it briefly with an inline outline (no new
 *  global CSS class). The page tags each card with data-link-key and each
 *  category heading with data-link-category (the tiny page wire). Degrades to a
 *  no-op when the target is not in the DOM. */
function scrollToSelector(selector: string): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const prev = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = "2px solid var(--accent, #0284c7)";
  el.style.outlineOffset = "3px";
  window.setTimeout(() => {
    el.style.outline = prev;
    el.style.outlineOffset = prevOffset;
  }, 1200);
}

/** Register the Links page's BeakerSearch source while the page is mounted.
 *  Call once from app/links/page.tsx after the existing state reads. */
export function useLinksBeakerSource(args: UseLinksBeakerSourceArgs): void {
  const queryClient = useQueryClient();

  // Hover bias removed (ai centered-redesign bot). hoveredKey is always null.
  const hoveredKey: string | null = null;

  // Category filter, now LIFTED to the page (spec 2.3 lift A). The page owns the
  // state + setter and hands them in, so selecting a category in the palette
  // filters the rendered board, not just the palette nav list / Suggested set.
  const { activeCategory, setActiveCategory } = args;

  // The single invalidation the spec 1.4 table mandates after every write.
  const invalidate = useCallback(
    () => queryClient.refetchQueries({ queryKey: ["lab-links"] }),
    [queryClient],
  );

  const openExternally = useCallback((link: LabLink) => {
    try {
      window.open(link.url, "_blank", "noopener,noreferrer");
    } catch {
      // Malformed url, the row already showed the raw string. No-op.
    }
  }, []);

  const copyUrl = useCallback(async (link: LabLink) => {
    try {
      await navigator.clipboard.writeText(link.url);
    } catch {
      // Clipboard blocked (no permission / insecure context). No-op.
    }
  }, []);

  const toggleVisibility = useCallback(
    async (link: LabLink) => {
      const next = !isWholeLabShared(link.shared_with ?? []);
      await labLinksApi.update(link.id, { whole_lab: next });
      await invalidate();
    },
    [invalidate],
  );

  // Preview is now the site favicon, derived client-side from the url (lift B,
  // Grant's locked decision, no server fetch, no metadata scrape). There is no
  // server preview to refresh, so the card always shows the live favicon for the
  // current url and this is a no-op. We no longer call the getPreview stub.

  const jumpToLink = useCallback(
    (link: LabLink) => scrollToSelector(`[data-link-key="${link.id}"]`),
    [],
  );

  const jumpToCategory = useCallback(
    (category: string) =>
      scrollToSelector(`[data-link-category="${CSS.escape(category)}"]`),
    [],
  );

  // The category-filter "Open all in {category}" confirms once before opening
  // many tabs (spec 3.3 / 4.2 bulk rule). A single external open never confirms
  // (parity with the card); only the bulk path asks.
  const openAll = useCallback(
    (links: LabLink[]) => {
      if (
        links.length > BULK_OPEN_CONFIRM_THRESHOLD &&
        !window.confirm(`Open all ${links.length} links in new tabs?`)
      ) {
        return;
      }
      for (const l of links) openExternally(l);
    },
    [openExternally],
  );

  const handlers = useMemo<LinksSourceHandlers>(
    () => ({
      startCreate: args.startCreate,
      startEdit: args.startEdit,
      cancelEdit: args.cancelEdit,
      handleCreate: args.handleCreate,
      handleUpdate: args.handleUpdate,
      handleFetchPreview: args.handleFetchPreview,
      setDeleteConfirmId: args.setDeleteConfirmId,
      setColor: args.setColor,
      setWholeLab: args.setWholeLab,
      setActiveCategory,
      toggleVisibility,
      openExternally,
      openAll,
      copyUrl,
      jumpToLink,
      jumpToCategory,
    }),
    [
      args.startCreate,
      args.startEdit,
      args.cancelEdit,
      args.handleCreate,
      args.handleUpdate,
      args.handleFetchPreview,
      args.setDeleteConfirmId,
      args.setColor,
      args.setWholeLab,
      setActiveCategory,
      toggleVisibility,
      openExternally,
      openAll,
      copyUrl,
      jumpToLink,
      jumpToCategory,
    ],
  );

  const source = useMemo(() => {
    const data: LinksSourceData = {
      links: args.links,
      groupedLinks: args.groupedLinks,
      editingLink: args.editingLink,
      isCreating: args.isCreating,
      isLoadingPreview: args.isLoadingPreview,
      title: args.title,
      url: args.url,
      wholeLab: args.wholeLab,
      color: args.color,
      activeCategory,
      currentUser: args.currentUser,
      profileMap: args.profileMap,
      // Hovered-as-context (step 4). The full "link:{owner}:{id}" target of the
      // card the pointer was over before the palette opened, or null. SELECTED
      // (editingLink) outranks it in the builder's resolveFocus.
      hoveredKey,
    };
    return buildLinksSource(data, handlers);
  }, [
    args.links,
    args.groupedLinks,
    args.editingLink,
    args.isCreating,
    args.isLoadingPreview,
    args.title,
    args.url,
    args.wholeLab,
    args.color,
    activeCategory,
    args.currentUser,
    args.profileMap,
    handlers,
  ]);

  useBeakerSearchSource(source);
}
