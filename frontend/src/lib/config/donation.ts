// Sustainability notice shown by BetaDonationButton.
//
// ResearchOS is free and open source, supported now by a UW Distinguished
// Research Fellowship at UW-Madison and, later, by voluntary contributions from
// labs that can afford it. The local app and every feature are free. This panel
// explains that model. If a voluntary-donation path is set up later (a
// university gift fund or an Open Collective, say), add the link here.
export const DONATION_CONFIG = {
  enabled: true,
  message:
    "ResearchOS is free and open source, for every lab. You can always run it yourself for free from the public repo, and the hosted version is free too. There are no paid tiers and no per-seat fees.",
};

export function isDonationConfigured(): boolean {
  return DONATION_CONFIG.enabled;
}
