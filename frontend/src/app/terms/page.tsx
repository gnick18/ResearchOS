import type { Metadata } from "next";
import TermsOfService from "@/components/terms/TermsOfService";
import {
  isBillingEnabled,
  isAiBillingEnabled,
} from "@/lib/billing/config";

/**
 * Standalone `/terms` route: the ResearchOS terms of service.
 *
 * A plain-English terms of service for the hosted app at research-os.app and
 * the optional paid services. The load-bearing facts are that the software
 * itself is free and open source under the AGPLv3 (so the license governs the
 * code, and these terms govern the hosted service), that the everyday app is
 * local-first so your data stays in your own folder, and that the only paid
 * parts are optional cloud storage and the metered AI assistant.
 *
 * The billing flags (BILLING_ENABLED, AI_BILLING_ENABLED) are read here and
 * passed as plain props so the component can render the correct copy. When both
 * flags are off the terms state that paid services are free during the beta.
 * When a flag is on the terms reflect that the service is live and billed.
 *
 * Like /privacy and /open-source it is an informational / legal page, not a
 * documented app feature, so it renders without the AppShell or a connected
 * data folder and is intentionally excluded from the wiki-coverage map.
 */
export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The terms for using the hosted ResearchOS app and its optional paid services. The software is free and open source under the AGPLv3, your everyday work stays on your own machine, and the optional cloud storage and AI assistant are available as paid services.",
};

export default function TermsPage() {
  const storageBillingOn = isBillingEnabled();
  const aiBillingOn = isAiBillingEnabled();
  return (
    <TermsOfService storageBillingOn={storageBillingOn} aiBillingOn={aiBillingOn} />
  );
}
