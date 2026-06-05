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
