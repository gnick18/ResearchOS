// Account theme preference API.
//
// GET  /api/account/theme  -> { theme: string | null }
//   Returns the caller's last saved theme preference. Returns { theme: null }
//   rather than 500 on a store error so theme never blocks a page load.
//
// PUT  /api/account/theme  body { theme }
//   Saves the caller's theme choice. Validates "light" | "dark" | "system".
//
// Authenticated by the OAuth session (same pattern as /api/account/profile).
// Theme is account-private but NOT in the E2E-encrypted settings blob because
// it must apply immediately after login, before the user unlocks their key.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { getAccountTheme, setAccountTheme } from "@/lib/account/account-profile";

export const runtime = "nodejs";

const VALID_THEMES = new Set(["light", "dark", "system"]);

export async function GET(): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const ownerKey = ownerKeyForEmailSafe(email);
  if (!ownerKey) return json(503, { error: "account identity unavailable" });

  try {
    const theme = await getAccountTheme(ownerKey);
    return json(200, { theme });
  } catch {
    // Fail-open: a store error must not prevent the page from loading.
    // The client falls back to localStorage when theme is null.
    return json(200, { theme: null });
  }
}

export async function PUT(request: Request): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const ownerKey = ownerKeyForEmailSafe(email);
  if (!ownerKey) return json(503, { error: "account identity unavailable" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid JSON body" });
  }

  const theme = (body as { theme?: unknown })?.theme;
  if (typeof theme !== "string" || !VALID_THEMES.has(theme)) {
    return json(400, { error: "theme must be light, dark, or system" });
  }

  try {
    await setAccountTheme(ownerKey, theme);
    return json(200, { ok: true });
  } catch {
    return json(503, { error: "could not save theme preference" });
  }
}
