"use client";

// PI capability revamp Phase 2 pass 2 (sharing + collaboration manager,
// 2026-06-07): the "Lab head actions" affordance in a record detail popup
// header. A lab head viewing a MEMBER's record sees a small vertical-dots
// (kebab) button; clicking it opens the SAME shared PI context menu the record
// list rows use (usePiRecordMenu). The record is already open here, so the menu
// drops "Edit as lab head" (includeEditAsPi=false) and shows only the role
// actions (flag toggle, plus assign for tasks / approve-decline for purchases).
//
// Rendered ONLY when isPiViewingMemberRecord is true; a non-PI, or a lab head on
// their OWN record, gets no button at all. The owning popup renders piMenu.modals
// once so the task Assign modal has a home.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons. The "more actions"
// glyph is the verified `more` icon from the icon registry (the single sanctioned
// icon source; the icon-guard blocks new inline SVGs). The button is wrapped in
// the Tooltip component (not title=).

import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons/Icon";
import { usePiRecordMenu } from "@/hooks/usePiRecordMenu";
import { isPiViewingMemberRecord } from "@/lib/lab/pi-record-menu";
import type {
  PiMenuRecord,
  PiMenuRecordType,
} from "@/lib/lab/pi-record-menu";
import type { AccountType } from "@/lib/settings/user-settings";

export default function PiActionsHeaderButton({
  recordType,
  record,
  viewerUsername,
  accountType,
  onEditAsPi,
  className,
}: {
  recordType: PiMenuRecordType;
  record: PiMenuRecord;
  /** The active user. */
  viewerUsername: string | null | undefined;
  /** The active user's account type. */
  accountType: AccountType | null | undefined;
  /** Open / focus the record for editing. Kept for parity with the list-row
   *  callers even though the popup menu omits the "Edit as lab head" row, so the
   *  hook's callback contract stays satisfied. */
  onEditAsPi: () => void;
  className?: string;
}) {
  const piMenu = usePiRecordMenu();

  // Non-PI, or a lab head on their OWN record: render nothing. Byte-identical
  // for everyone who is not a PI on a member's record.
  if (!isPiViewingMemberRecord(accountType, viewerUsername, record.owner)) {
    return null;
  }

  return (
    <>
      <Tooltip label="Lab head actions" placement="bottom">
        <button
          type="button"
          aria-label="Lab head actions"
          aria-haspopup="menu"
          data-testid="pi-actions-header-button"
          onClick={(e) =>
            piMenu.handleContextMenu(e, {
              recordType,
              record,
              onEditAsPi,
              // The record is already open here, so omit "Edit as lab head".
              includeEditAsPi: false,
            })
          }
          className={`p-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-sunken transition-colors ${
            className ?? ""
          }`}
        >
          <Icon name="more" className="w-4 h-4" />
        </button>
      </Tooltip>
      {piMenu.modals}
    </>
  );
}
