import { requireOperator } from "@/lib/sharing/operator-access";
import { auth } from "@/lib/sharing/auth";
import { adminEmails } from "@/lib/sharing/admin";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import {
  sendBroadcastEmail,
  type BroadcastPayload,
} from "@/lib/admin/broadcast-mailer";
import { listBetaTesters } from "@/lib/sharing/directory/db";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  if (!isSharingEnabled()) return json(404, { error: "not found" });
  const blocked = await requireOperator();
  if (blocked) return blocked;

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
    // The test send goes to the operator's own address. An OAuth operator has it
    // on the session; a code-authenticated operator has no email, so fall back to
    // the first ADMIN_EMAILS entry.
    const session = await auth();
    const adminEmail = session?.user?.email ?? adminEmails()[0];
    if (!adminEmail) {
      return json(400, { error: "no operator email available for a test send" });
    }
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
