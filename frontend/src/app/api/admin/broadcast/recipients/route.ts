import { requireOperator } from "@/lib/sharing/operator-access";
import { isSharingEnabled, json } from "@/lib/sharing/directory/guard";
import {
  addBetaTester,
  listBetaTesters,
  removeBetaTester,
} from "@/lib/sharing/directory/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!isSharingEnabled()) return json(404, { error: "not found" });
  const blocked = await requireOperator();
  if (blocked) return blocked;

  try {
    const testers = await listBetaTesters();
    return json(200, { testers });
  } catch {
    return json(500, { error: "failed to list recipients" });
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!isSharingEnabled()) return json(404, { error: "not found" });
  const blocked = await requireOperator();
  if (blocked) return blocked;

  let body: { email?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return json(400, { error: "valid email required" });
  }

  try {
    const tester = await addBetaTester(email, body.name);
    return json(200, { tester });
  } catch {
    return json(500, { error: "failed to add recipient" });
  }
}

export async function DELETE(req: Request): Promise<Response> {
  if (!isSharingEnabled()) return json(404, { error: "not found" });
  const blocked = await requireOperator();
  if (blocked) return blocked;

  let body: { id?: number };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  if (!body.id || typeof body.id !== "number") {
    return json(400, { error: "numeric id required" });
  }

  try {
    await removeBetaTester(body.id);
    return json(200, { ok: true });
  } catch {
    return json(500, { error: "failed to remove recipient" });
  }
}
