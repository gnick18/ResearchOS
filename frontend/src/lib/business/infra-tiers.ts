// Infrastructure service tiers, free vs paid, for the /admin/business page.
//
// A scaling reference so the operator can see each service's free ceiling and
// the next paid step at a glance, and plan upgrades as usage grows. Prices and
// limits change, so the page labels this "verify current pricing" and carries
// the date these were checked. Update here in one place.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export const INFRA_TIERS_CHECKED = "2026-06-05";

export interface InfraTier {
  service: string;
  role: string;
  /** Free-tier ceiling. */
  free: string;
  /** The next paid step and its cost. */
  paid: string;
  /** When the free tier runs out / what triggers the upgrade. */
  upgradeWhen: string;
  /** Set when action is needed now (renders highlighted). */
  actionNow?: boolean;
}

export const INFRA_TIERS: InfraTier[] = [
  {
    service: "Vercel",
    role: "Hosting, serverless functions, cron",
    free: "Hobby, non-commercial use only",
    paid: "Pro $20 per seat / month (includes $20 usage credit, 1 TB transfer, 10M edge requests)",
    upgradeWhen:
      "Required now. The Hobby plan forbids commercial use, so any revenue means the LLC must be on Pro.",
    actionNow: true,
  },
  {
    service: "Neon (Postgres)",
    role: "Collab docs, directory, relay + billing metadata",
    free: "0.5 GB storage, 100 compute-hours / month",
    paid: "Launch, pay-as-you-go, $5/mo minimum. Storage $0.35/GB-month, compute $0.14/CU-hour",
    upgradeWhen: "Past 0.5 GB stored or 100 compute-hours in a month",
  },
  {
    service: "Cloudflare R2",
    role: "Encrypted file bundles (relay + future durable storage)",
    free: "10 GB storage, ample operations, egress always free",
    paid: "About $0.015 / GB-month storage, operations per million, egress stays free",
    upgradeWhen: "Past 10 GB stored",
  },
  {
    service: "Upstash Redis",
    role: "Rate-limit windows + OTP codes (all TTL'd)",
    free: "256 MB, 500K commands / month",
    paid: "Pay-as-you-go $0.20 / 100K commands, or fixed plans from $10/mo",
    upgradeWhen: "Past 500K commands / month (keys are short-lived, so storage stays tiny)",
  },
  {
    service: "Resend",
    role: "OTP, share invites, deadline reminders, receipts",
    free: "3,000 emails / month, 100 / day, 1 domain",
    paid: "Pro $20 / month, 50,000 emails, no daily cap, 10 domains (Scale from $90 for 100K)",
    upgradeWhen: "Past 3,000 emails / month or the 100 / day cap",
  },
];
