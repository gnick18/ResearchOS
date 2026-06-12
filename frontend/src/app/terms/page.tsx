import type { Metadata } from "next";
import TermsOfService from "@/components/terms/TermsOfService";

/**
 * Standalone `/terms` route: the ResearchOS terms of service.
 *
 * A plain-English terms of service for the hosted app at research-os.app and
 * the optional paid services. The load-bearing facts are that the software
 * itself is free and open source under the AGPLv3 (so the license governs the
 * code, and these terms govern the hosted service), that the everyday app is
 * local-first so your data stays in your own folder, and that the only paid
 * parts are optional cloud storage and the metered AI assistant, both free
 * during the beta.
 *
 * Like /privacy and /open-source it is an informational / legal page, not a
 * documented app feature, so it renders without the AppShell or a connected
 * data folder and is intentionally excluded from the wiki-coverage map.
 */
export const metadata: Metadata = {
  title: "Terms of service | ResearchOS",
  description:
    "The terms for using the hosted ResearchOS app and its optional paid services. The software is free and open source under the AGPLv3, your everyday work stays on your own machine, and cloud storage and the AI assistant are free during the beta.",
};

export default function TermsPage() {
  return <TermsOfService />;
}
