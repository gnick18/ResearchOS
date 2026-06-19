import type { Metadata } from "next";
import PrivacyPolicy from "@/components/privacy/PrivacyPolicy";

/**
 * Standalone `/privacy` route: the ResearchOS privacy policy.
 *
 * A plain-English privacy policy. The core app is local-first and stores
 * nothing about the user on our servers; the page is honest about the one
 * place that changes (optional cross-boundary sharing) and about the
 * third-party logins used to verify an email. It exists in part because the
 * OAuth providers (Google, Microsoft, LinkedIn) ask for a privacy policy URL
 * before approving sign-in.
 *
 * Like /open-source it is an informational / legal page, not a documented app
 * feature, so it renders without the AppShell or a connected data folder and is
 * intentionally excluded from the wiki-coverage map.
 */
export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "ResearchOS keeps your research data on your own computer. This plain-English privacy policy explains what that means, the one place it changes (optional sharing), and how we handle the little we store.",
};

export default function PrivacyPage() {
  return <PrivacyPolicy />;
}
