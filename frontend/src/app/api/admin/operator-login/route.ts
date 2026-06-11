// Operator access-code login.
//
// POST { code }  - exchange the operator access code for a signed 30-day cookie.
// DELETE         - clear the cookie (sign out of the code session).
//
// Dark (404) unless SHARING_ENABLED is on AND an OPERATOR_ACCESS_CODE + AUTH_SECRET
// are configured, so the endpoint does not advertise itself. Constant-time code
// check (in operator-token.ts) plus a small in-process rate limit; the real
// protection is a long, high-entropy code. The cookie is httpOnly + SameSite=Lax,
// and Secure in production.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import {
  OPERATOR_COOKIE,
  OPERATOR_COOKIE_MAX_AGE_S,
  operatorCodeConfigured,
  signOperatorToken,
  verifyOperatorCode,
} from "@/lib/sharing/operator-token";

export const runtime = "nodejs";

// Per-instance attempt limiter. Serverless instances are short-lived, so this is
// defense in depth on top of the code's own entropy, not the primary guard.
const ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = ATTEMPTS.get(ip);
  if (!e || now > e.resetAt) {
    ATTEMPTS.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  e.count += 1;
  return e.count > MAX_ATTEMPTS;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function cookieAttrs(maxAgeS: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure}`;
}

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) return json(404, { error: "not found" });
  if (!operatorCodeConfigured()) return json(404, { error: "not found" });

  if (rateLimited(clientIp(request))) {
    return json(429, { error: "too many attempts, try again later" });
  }

  let code: unknown;
  try {
    const body = (await request.json()) as { code?: unknown };
    code = body?.code;
  } catch {
    return json(400, { error: "invalid json" });
  }

  if (!verifyOperatorCode(code)) {
    return json(401, { error: "invalid code" });
  }

  const token = signOperatorToken(Date.now() + OPERATOR_COOKIE_MAX_AGE_S * 1000);
  if (!token) return json(500, { error: "operator login unavailable" });

  const res = json(200, { ok: true });
  res.headers.append(
    "Set-Cookie",
    `${OPERATOR_COOKIE}=${token}; ${cookieAttrs(OPERATOR_COOKIE_MAX_AGE_S)}`,
  );
  return res;
}

export async function DELETE(): Promise<Response> {
  const res = json(200, { ok: true });
  res.headers.append("Set-Cookie", `${OPERATOR_COOKIE}=; ${cookieAttrs(0)}`);
  return res;
}
