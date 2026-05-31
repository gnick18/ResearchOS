// Beta-phase sustainability notice shown by BetaDonationButton.
//
// No personal payment handles here. ResearchOS is becoming a Wisconsin LLC and
// the hosted pricing is not live yet, so this panel EXPLAINS the open-core model
// rather than collecting money. When the LLC + a real payment path exist
// (Phase 2), add a checkout link here and wire it into the modal.
export const DONATION_CONFIG = {
  enabled: true,
  message:
    "ResearchOS is free and open source. The whole site is free for everyone while we are in beta, and you can always run it yourself for free from the public repo, even if the hosted version ever goes away.",
};

export function isDonationConfigured(): boolean {
  return DONATION_CONFIG.enabled;
}
