import { NextRequest } from "next/server";
import {
  MICROSOFT_CONFIG,
  readClientCreds,
} from "@/lib/calendar/oauth-config";
import { refreshAccessToken } from "@/lib/calendar/oauth-server";

/** POST { refreshToken } → fresh access token. Same shape as the Google
 *  refresh route. Microsoft *does* rotate refresh tokens on each refresh,
 *  so callers must persist the new one if present. */
export async function POST(req: NextRequest): Promise<Response> {
  let clientId: string;
  let clientSecret: string;
  try {
    ({ clientId, clientSecret } = readClientCreds("outlook"));
  } catch (err) {
    return new Response(
      err instanceof Error ? err.message : "OAuth not configured",
      { status: 500 },
    );
  }

  let refreshToken: string | undefined;
  try {
    const body = (await req.json()) as { refreshToken?: string };
    refreshToken = body.refreshToken;
  } catch {
    return new Response("Body must be JSON with { refreshToken }", { status: 400 });
  }
  if (!refreshToken) {
    return new Response("Missing refreshToken", { status: 400 });
  }

  try {
    const tokens = await refreshAccessToken(
      MICROSOFT_CONFIG,
      clientId,
      clientSecret,
      refreshToken,
    );
    return Response.json({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresIn: tokens.expires_in,
      scope: tokens.scope ?? null,
    });
  } catch (err) {
    return new Response(
      err instanceof Error ? err.message : "Token refresh failed",
      { status: 502 },
    );
  }
}
