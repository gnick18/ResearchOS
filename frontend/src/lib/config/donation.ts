export const DONATION_CONFIG = {
  enabled: true,
  paypalLink: "https://paypal.me/GrantNickles",
  venmoHandle: "@Grant-Nickles",
  message: "This is a solo dev project, funded for a limited time by a UW–Madison RISE-AI fellowship. Any support goes a long way toward covering server costs and ensuring the longevity of this tool as a hosted website. Note that the GitHub repo will ALWAYS remain clonable, so a local version of ResearchOS can be run even if we're ever unable to pay to host the application.",
};

export function isDonationConfigured(): boolean {
  return !!(DONATION_CONFIG.paypalLink || DONATION_CONFIG.venmoHandle);
}
