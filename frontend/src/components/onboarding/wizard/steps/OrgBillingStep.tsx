// Wizard step: billing. Skippable per the resolved Q4 default ("configure
// later" is allowed, the org account is usable without billing wired).
//
// Billing has a full calculator (storage / labs / spending ceiling) that lives
// in the admin portal. Rather than duplicate it inside the wizard, this step
// frames the choice and lands the admin in the portal's billing section to
// finish, or lets them skip and configure later. This keeps a single source of
// truth for the billing UI.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { OrgKind } from "./OrgNameStep";

export interface OrgBillingStepProps {
  kind: OrgKind;
  /** Finish the wizard and land in the portal (where billing can be configured). */
  onFinish: () => void;
}

export default function OrgBillingStep({ kind, onFinish }: OrgBillingStepProps) {
  const portalNoun = kind === "department" ? "department" : "institution";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        Billing
      </h1>
      <p className="mb-6 mt-2 text-sm text-foreground-muted">
        Your {portalNoun} account is ready to use. You can set a spending ceiling
        and add a payment method now in the admin portal, or configure billing
        later, nothing is blocked until you do.
      </p>

      <div className="w-full space-y-3">
        <button
          type="button"
          onClick={onFinish}
          className="w-full rounded-xl bg-[#1283c9] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f6fa8]"
        >
          Go to the admin portal
        </button>
        <p className="text-xs text-foreground-muted">
          Billing lives under the Billing tab in your {portalNoun} admin portal.
        </p>
      </div>
    </div>
  );
}
