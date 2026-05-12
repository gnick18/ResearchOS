export const DONATION_CONFIG = {
  enabled: true,
  paypalLink: "https://paypal.me/GrantNickles",
  venmoHandle: "@Grant-Nickles",
  message: "This is a solo dev project paid for out of my own pocket. Any donations help with covering server costs!",
};

export function isDonationConfigured(): boolean {
  return !!(DONATION_CONFIG.paypalLink || DONATION_CONFIG.venmoHandle);
}
