import { requireOperator } from "@/lib/sharing/operator-access";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import { buildBroadcastHtml, type BroadcastPayload } from "@/lib/admin/broadcast-mailer";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  if (!isSharingEnabled()) return json(404, { error: "not found" });
  const blocked = await requireOperator();
  if (blocked) return blocked;

  let body: BroadcastPayload;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  if (!body.subject?.trim() || !body.body?.trim()) {
    return json(400, { error: "subject and body required" });
  }

  const html = buildBroadcastHtml(body);
  return json(200, { html });
}
