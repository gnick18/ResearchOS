import Link from "next/link";

import BetaDonationButton from "@/components/BetaDonationButton";

/**
 * Compact footer pinned to the bottom of the settings rail, the Linear / VS Code
 * pattern: a small support ask and a tight link row at the foot of the sidebar,
 * instead of a marketing footer block inside the content. The full funding
 * acknowledgment lives on the public marketing pages (the welcome and pricing
 * pages), not in the in-app settings chrome.
 *
 * No emojis, no em-dashes, no mid-sentence colons.
 */
const GITHUB_URL = "https://github.com/gnick18/ResearchOS";

export default function SettingsRailFooter() {
  return (
    <div className="space-y-1.5 px-1">
      <BetaDonationButton variant="link" tone="light" />
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-foreground-muted">
        <Link
          href="/pricing"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          Pricing
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/open-source"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          Open source
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/transparency"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          Transparency
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/thanks"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          Sponsors and thanks
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/about"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          About
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/privacy"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          Privacy
        </Link>
        <span aria-hidden="true">·</span>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          GitHub
        </a>
      </div>
      <p className="text-[11px] leading-snug text-foreground-muted">
        ResearchOS LLC, a registered Wisconsin company.
      </p>
    </div>
  );
}
