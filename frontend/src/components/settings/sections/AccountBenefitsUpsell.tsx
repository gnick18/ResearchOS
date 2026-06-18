"use client";

// Solo-only gentle upsell shown in Settings, You. A solo ResearchOS install is
// fully local, so the cloud-tier features (BeakerBot AI, cloud storage and sync,
// email + phone notifications, companion pairing, sharing) are hidden rather than
// shown as locked pages. This callout takes their place: it tells a solo user
// what a free account adds and where to add it, in the same gentle framing the
// notification phone/email upsell uses.
//
// Why state the cost reason plainly: solo stays on your machine, so these are
// the few things that genuinely need an account, not a paywall on local work.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

const ACCOUNT_FEATURES: { title: string; detail: string }[] = [
  {
    title: "BeakerBot, the AI assistant",
    detail:
      "Summaries, filters, and app actions, metered so you only pay for what you run.",
  },
  {
    title: "Cloud storage and sync",
    detail:
      "A pooled cloud copy of finished work, and your folder synced across machines.",
  },
  {
    title: "Email and phone notifications",
    detail:
      "Route any notification to your inbox or the companion phone app, not just the bell.",
  },
  {
    title: "Receive shared work",
    detail:
      "Get notes, methods, and files others send you, filed into your own folder and end to end encrypted. Sending your own work outside your folder is a paid feature.",
  },
];

export function AccountBenefitsUpsell() {
  return (
    <div className="rounded-2xl border border-brand-action/30 bg-gradient-to-br from-brand-action/[0.05] to-brand-purple/[0.05] px-5 py-5">
      <div className="text-body font-extrabold text-foreground">
        Add a free account to unlock the cloud features
      </div>
      <div className="mt-1 text-meta leading-relaxed text-foreground-muted">
        Solo ResearchOS stays on your machine, so everything you see here already
        works. A free account adds the few things that genuinely need the cloud.
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {ACCOUNT_FEATURES.map((f) => (
          <li key={f.title} className="flex gap-3">
            <span
              aria-hidden
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-action"
            />
            <div className="min-w-0">
              <div className="text-meta font-bold text-foreground">
                {f.title}
              </div>
              <div className="text-meta leading-relaxed text-foreground-muted">
                {f.detail}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 text-meta leading-relaxed text-foreground-muted">
        You can add one any time from Profile and appearance, under Account and
        keys. Nothing on your machine moves until you choose to share or sync it.
      </div>
    </div>
  );
}
