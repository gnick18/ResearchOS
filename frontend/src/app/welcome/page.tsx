import type { Metadata } from "next";
import LandingPage from "@/components/landing/LandingPage";

/**
 * Standalone `/welcome` route. Renders the first-time-visitor landing page
 * for everyone, regardless of connection state. This is the surface the
 * Settings "View the welcome page" link points at (so a connected user can
 * revisit the marketing page that is otherwise gated to truly-new visitors),
 * and the URL the wiki-screenshot capture shoots `landing.png` from.
 *
 * No `onGetStarted` prop here, so LandingPage's primary CTA navigates to
 * /?connect=1 instead of dismissing an inline gate.
 */
export const metadata: Metadata = {
  title: "Welcome to ResearchOS",
  description:
    "A free, local-first electronic lab notebook. Your data lives as a plain folder on your own machine: private, version-controlled, and yours to keep.",
};

export default function WelcomePage() {
  return <LandingPage />;
}
