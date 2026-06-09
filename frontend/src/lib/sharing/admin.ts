// Operator (admin) access gate.
//
// The admin metrics page is gated on the signed-in OAuth email being in the
// ADMIN_EMAILS env list (comma-separated, case-insensitive). When ADMIN_EMAILS
// is unset, NO ONE is an admin, the gate fails closed, so a misconfigured
// deployment never exposes operator data. This reuses the Auth.js session we
// already have, so there is no separate admin password to manage.

/** Whether an email is on the ADMIN_EMAILS allow-list. Fails closed. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return false;
  const allow = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.trim().toLowerCase());
}

/**
 * The ADMIN_EMAILS list, trimmed, in original case for delivery. Empty when
 * unset. This is the OPERATOR ACCESS list (who can open /admin + /admin/business).
 */
export function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * Who the deadline-reminder cron emails. Separate from ADMIN_EMAILS so the
 * access list (every operator who can open the page) can differ from the inbox
 * the reminders land in (e.g. just the LLC address). Reads BUSINESS_REMINDER_EMAILS
 * (comma-separated); falls back to the full admin list when unset, so an existing
 * deployment with only ADMIN_EMAILS keeps sending exactly as before.
 */
export function reminderRecipients(): string[] {
  const raw = process.env.BUSINESS_REMINDER_EMAILS;
  if (!raw) return adminEmails();
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}
