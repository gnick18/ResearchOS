import { auth } from "@/lib/sharing/auth";
import { isAdminEmail } from "@/lib/sharing/admin";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import {
  sendBroadcastEmail,
  type BroadcastPayload,
} from "@/lib/admin/broadcast-mailer";
import { listBetaTesters } from "@/lib/sharing/directory/db";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  if (!isSharingEnabled()) return json(404, { error: "not found" });
  const session = await auth();
  if (!isAdminEmail(session?.user?.email))
    return json(404, { error: "not found" });

  let body: BroadcastPayload & { testOnly?: boolean };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  if (!body.subject?.trim() || !body.body?.trim()) {
    return json(400, { error: "subject and body required" });
  }

  const msg: BroadcastPayload = {
    subject: body.subject,
    body: body.body,
    ctaLabel: body.ctaLabel,
    ctaUrl: body.ctaUrl,
  };

  if (body.testOnly) {
    const adminEmail = session!.user!.email!;
    try {
      await sendBroadcastEmail(adminEmail, msg);
      return json(200, { sent: 1, recipients: [adminEmail], testOnly: true });
    } catch (err) {
      return json(500, {
        error: `test send failed: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  const testers = await listBetaTesters();
  if (testers.length === 0) {
    return json(400, { error: "no recipients in the beta list" });
  }

  const results: { email: string; ok: boolean; error?: string }[] = [];
  for (const t of testers) {
    try {
      await sendBroadcastEmail(t.email, msg);
      results.push({ email: t.email, ok: true });
    } catch (err) {
      results.push({
        email: t.email,
        ok: false,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  return json(200, { sent, failed: failed.length, details: results });
}
