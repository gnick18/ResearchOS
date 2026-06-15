"use client";

/**
 * PurchaseHistoryPopup.tsx
 *
 * Purchase items on Loro (docs/proposals/PURCHASE_LORO.md) chunk 4 = the version
 * history surface for a single purchase item. Built on the shared LivingPopup
 * primitive, it hosts the GENERIC EntityVersionHistorySidebar (entityType
 * "purchase_items") driven by the purchase Loro history engine + the purchase
 * adapter, with the reconstructed before/after diff rendered in the popup body
 * via the shared VersionDiffView. Restore writes the selected version back as a
 * forward commit (restorePurchaseVersion).
 *
 * This component is only ever mounted by PurchaseEditor when PURCHASE_LORO_ENABLED
 * is true (the History button is gated on the flag), so it adds zero surface when
 * the flag is off.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import CalmPopupShell from "@/components/ui/CalmPopupShell";
import ScrollArea from "@/components/ui/ScrollArea";
import EntityVersionHistorySidebar, {
  type VersionPreview,
  type VersionHistorySource,
} from "@/components/history/EntityVersionHistorySidebar";
import VersionDiffView from "@/components/history/VersionDiffView";
import type { OpenOrigin } from "@/lib/ui/create-popup-store";
import { makeLoroPurchaseHistoryEngine } from "@/lib/loro/purchase-history-engine";
import { purchaseAdapter } from "@/lib/history/purchase-viewer";
import { restorePurchaseVersion } from "@/lib/loro/purchase-restore";
import { openPurchaseDoc } from "@/lib/loro/purchase-store";

export interface PurchaseHistoryPopupProps {
  /** Controlled open state. */
  open: boolean;
  /** Close the popup. */
  onClose: () => void;
  /** Screen point the open was triggered from, for the LivingPopup zoom. */
  origin?: OpenOrigin | null;
  /** Folder owner the item's sidecar lives under. */
  owner: string;
  /** Numeric purchase_item id in the owner's namespace. */
  itemId: number;
  /** Whether the viewer may restore (write access). Gates the sidebar footer. */
  canRestore: boolean;
  /** Signed-in user (for the open / adopt parity path). */
  currentUser?: string;
  /** Called after a successful restore so the editor can refresh its list. */
  onRestored?: () => void;
  /**
   * Dev/review only: inject a pre-seeded history engine (the `/dev/popup-chrome`
   * gallery passes a fixture engine so the popup renders with a populated version
   * list + real diffs instead of the no-folder empty state). Omitted in the real
   * app, where the Loro engine is built from the on-disk sidecar below.
   */
  engineOverride?: VersionHistorySource;
}

export default function PurchaseHistoryPopup({
  open,
  onClose,
  origin = null,
  owner,
  itemId,
  canRestore,
  currentUser,
  onRestored,
  engineOverride,
}: PurchaseHistoryPopupProps) {
  const [preview, setPreview] = useState<VersionPreview | null>(null);
  const busyRef = useRef(false);

  // One engine instance per (owner, itemId). The sidebar captures it in a stable
  // ref, so a new object on re-render is harmless, but memoizing keeps it clean.
  const engine = useMemo(
    () => engineOverride ?? makeLoroPurchaseHistoryEngine(owner, itemId),
    [engineOverride, owner, itemId],
  );

  const handleClose = useCallback(() => {
    setPreview(null);
    onClose();
  }, [onClose]);

  // Restore: open the live handle and write the target version back as a forward
  // commit (restorePurchaseVersion persists the .loro sidecar + .json mirror),
  // then refresh the editor list and close.
  const handleRestore = useCallback(
    async (targetVersion: number) => {
      if (busyRef.current) return;
      if (!canRestore) return;
      busyRef.current = true;
      try {
        const handle = await openPurchaseDoc(owner, itemId, currentUser);
        await restorePurchaseVersion(handle, owner, itemId, targetVersion);
        onRestored?.();
        handleClose();
      } catch (err) {
        console.error("[PurchaseHistoryPopup] restore failed:", err);
      } finally {
        busyRef.current = false;
      }
    },
    [canRestore, owner, itemId, currentUser, onRestored, handleClose],
  );

  return (
    // Unified Popup Chrome (UNIFIED_POPUP_CHROME_SPEC.md §4): the read-style
    // history surface adopts the shared shell so its frame matches every other
    // popup (transparent header, one meta line, ⤢ + ✕, ambient footer). It is a
    // single-view object, so no tab row. The Restore affordance lives inside the
    // generic EntityVersionHistorySidebar (keyed to its own selection state and
    // shared across every entity type, so it is NOT lifted out here); the footer
    // carries the always-reachable Close exit.
    <CalmPopupShell
      open={open}
      onClose={handleClose}
      origin={origin}
      label="Purchase item history"
      title="Purchase item history"
      titleAccent="violet"
      dockedWidthClassName="max-w-5xl"
      footer={{ doneLabel: "Close", onDone: handleClose }}
      // The history panel's top-edge shadow must cast UP into the header gap, but
      // the scroll body clips overflow above the panel, so it can't live on the
      // panel. Render it here in the always-visible header/body gap instead. This
      // zero-height row mirrors the body layout (flex-1 diff column + w-80 panel)
      // so the glow auto-aligns over the panel's top edge without hardcoding a
      // width. See `.ros-history-topglow` in globals.css.
      beforeBody={
        <div className="flex h-0" aria-hidden>
          <div className="flex-1 min-w-0" />
          <div className="w-80 flex-shrink-0 relative">
            <div className="ros-history-topglow" />
          </div>
        </div>
      }
      // Mirror of beforeBody: the panel's bottom-edge glow, cast down into the
      // footer gap. Same zero-height layout mirror so it aligns over the panel.
      afterBody={
        <div className="flex h-0" aria-hidden>
          <div className="flex-1 min-w-0" />
          <div className="w-80 flex-shrink-0 relative">
            <div className="ros-history-botglow" />
          </div>
        </div>
      }
    >
      <div className="flex h-full min-h-0" data-testid="purchase-history-popup">
        {/* In-place read-only diff column (custom overlay scrollbar). */}
        <ScrollArea className="flex-1 min-w-0 min-h-0">
          {preview ? (
            <div className="p-6" data-testid="purchase-history-diff-column">
              <VersionDiffView
                before={preview.before}
                after={preview.after}
                editor={preview.editor}
                editorLabel={preview.editorLabel}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-foreground-muted text-body p-6">
              <p>Select a version to preview it here.</p>
            </div>
          )}
        </ScrollArea>

        {/* The generic version-history sidebar, driven by the purchase engine +
            adapter. We pass NO headCanonical: the Loro engine reconstructs via
            doc.checkout() and never consults it (genesis is the seed commit, not
            a bare anchor). It owns its own sticky Restore footer (gated by
            canRestore + onRestore), kept here so its selection-keyed restore is
            preserved exactly. */}
        <EntityVersionHistorySidebar
          entityType="purchase_items"
          id={itemId}
          owner={owner}
          adapter={purchaseAdapter}
          engine={engine}
          onClose={handleClose}
          onPreviewChange={setPreview}
          canRestore={canRestore}
          onRestore={handleRestore}
          embedded
        />
      </div>
    </CalmPopupShell>
  );
}
