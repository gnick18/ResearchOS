// Infrastructure service tiers, free vs paid, for the /admin/business page.
//
// A scaling reference so the operator can see each service's free ceiling and
// the next paid step at a glance, and plan upgrades as usage grows. Prices and
// limits change, so the page labels this "verify current pricing" and carries
// the date these were checked. Update here in one place.
//
// Reflects the storage migration OFF Neon and onto Cloudflare (D1 + Durable
// Objects + R2). Neon's $0.35/GB-month storage is being retired.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export const INFRA_TIERS_CHECKED = "2026-06-06";

/** Why the stack looks Cloudflare-heavy now, shown under the table. */
export const INFRA_TIERS_NOTE =
  "Durable data is migrating off Neon onto Cloudflare (collab docs to Durable " +
  "Objects, directory/metadata to D1, files to R2), so Neon's $0.35/GB-month " +
  "storage cost is being retired. Cloudflare storage is far cheaper, R2 file " +
  "storage is about $0.015/GB-month with free egress.";

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
    service: "Cloudflare Workers (Paid)",
    role: "Compute base for the data layer (Workers, D1, Durable Objects)",
    free: "Generous free tier; production needs the paid plan",
    paid: "$5 / month base, unlocks the large D1 / Durable Objects / Workers allowances",
    upgradeWhen: "Once D1 or Durable Objects usage passes the free tier, or for production headroom",
  },
  {
    service: "Cloudflare Durable Objects",
    role: "Real-time collab docs + their SQLite storage",
    free: "5 GB SQLite storage",
    paid: "$0.20/GB-month storage, plus $0.15/M requests and $12.50/M GB-s duration",
    upgradeWhen: "Past 5 GB of collab storage (notes are tiny, so this is far off)",
  },
  {
    service: "Cloudflare D1",
    role: "Directory + relational metadata (SQLite)",
    free: "5 GB storage, ~150M row reads + ~3M row writes / month",
    paid: "$0.75/GB-month storage, reads $0.001/M rows, writes $1.00/M rows",
    upgradeWhen: "Past 5 GB or the free read/write limits",
  },
  {
    service: "Cloudflare R2",
    role: "Encrypted file bundles + durable file storage",
    free: "10 GB storage, egress always free",
    paid: "About $0.015/GB-month storage, operations per million, egress stays free",
    upgradeWhen: "Past 10 GB stored (this is where paid storage blocks land)",
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
