import type { Metadata } from "next";
import ThanksPage from "@/components/thanks/ThanksPage";

/**
 * Public `/thanks` route: sponsors plus the open-source thank-you.
 *
 * One branded page that does two community-gratitude jobs at once, thanking the
 * people who fund ResearchOS through GitHub Sponsors and crediting the
 * open-source projects it is built on. GitHub stays the checkout; this page
 * tells the story and links out. Design doc: docs/proposals/THANKS_PAGE.md.
 *
 * Public, no auth, no connected data folder. Rendered without the AppShell so
 * anyone can read it. It is a marketing/brand page, not a documented app
 * feature, so it is excluded from the wiki-coverage map (alongside /welcome and
 * /open-source). We DO want it indexed, so no robots noindex.
 *
 * `/sponsors` redirects here (src/app/sponsors/page.tsx).
 */
export const metadata: Metadata = {
  title: "Thanks",
  description:
    "ResearchOS is free and open because of the people who fund it and the open-source projects it is built on. Sponsor it on GitHub, and see what it stands on.",
};

export default function ThanksRoutePage() {
  return <ThanksPage />;
}
