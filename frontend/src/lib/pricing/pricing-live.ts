// Single source of truth for whether public pricing is live.
//
// NEXT_PUBLIC so the SAME flag is readable by both the server pricing page and
// client surfaces (the welcome page links), instead of a server-only flag the
// client cannot see. Set NEXT_PUBLIC_PRICING_LIVE=true to expose pricing
// everywhere at once; leave it unset to keep the "Pricing is getting an update"
// maintenance state on prod and hide the pricing links on the welcome page.
//
// This replaces the older server-only PRICING_LIVE gate on the pricing page so
// the page and the welcome links can never drift (one flag, one helper). Local
// `next dev` always shows pricing for development regardless of the flag.
//
// No emojis, no em-dashes, no mid-sentence colons.

/** True only when the public-pricing flag is explicitly turned on. */
export function isPricingLive(): boolean {
  return process.env.NEXT_PUBLIC_PRICING_LIVE === "true";
}

/**
 * Whether public pricing should be SHOWN (real pricing page + welcome links).
 * Always shown in local dev so developers see the real page; in production it
 * is gated behind the flag. Use this for both the pricing page maintenance gate
 * and the welcome-page pricing links so they stay in lockstep.
 */
export function isPricingPublic(): boolean {
  return process.env.NODE_ENV !== "production" || isPricingLive();
}
