// Daily deadline-reminder cron for the LLC business tracker.
//
// GET /api/cron/business-reminders
//
// Invoked by Vercel Cron once a day (see frontend/vercel.json). It computes the
// upcoming deadlines and emails the operator allow-list when one lands on a
// reminder threshold (14, 7, 3, 1, 0 days out), which makes it idempotent, a
// given deadline fires once per threshold, not every day.
//
// Auth: Vercel Cron sends "Authorization: Bearer ${CRON_SECRET}". The route
// requires that secret and fails closed if CRON_SECRET is unset, so the
// endpoint is never an open trigger. It is also dark unless SHARING_ENABLED is
// on, since the email infrastructure is.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { reminderRecipients } from "@/lib/sharing/admin";
import { isSharingEnabled } from "@/lib/sharing/directory/guard";
import { upcomingDeadlines } from "@/lib/business/calc";
import {
  ensureBusinessSchema,
  getEntity,
  recordBusinessEmail,
} from "@/lib/business/db";
import { sendReminderEmail } from "@/lib/business/mailer";
import {
  dueForReminder,
  reminderHtml,
  reminderSubject,
  reminderText,
} from "@/lib/business/reminders";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    // Fail closed. No secret configured, or a mismatched one, is a 404 so the
    // endpoint's existence is not advertised.
    return new Response("not found", { status: 404 });
  }

  if (!isSharingEnabled()) {
    return Response.json({ ok: true, skipped: "sharing disabled" });
  }
  const recipients = reminderRecipients();
  if (recipients.length === 0) {
    return Response.json({ ok: true, skipped: "no reminder recipients" });
  }

  await ensureBusinessSchema();
  const entity = await getEntity();
  const due = dueForReminder(upcomingDeadlines(entity, new Date()));

  let sent = 0;
  for (const { deadline } of due) {
    const subject = reminderSubject(deadline);
    const text = reminderText(deadline);
    const html = reminderHtml(deadline);
    for (const to of recipients) {
      try {
        await sendReminderEmail(to, subject, text, html);
        sent += 1;
        // Archive as an LLC record. A failed archive must never fail a
        // delivered email, so it is swallowed.
        try {
          await recordBusinessEmail({
            kind: "deadline-reminder",
            toEmail: to,
            subject,
            body: text,
          });
        } catch {
          // ignore
        }
      } catch {
        // One failed recipient must not stop the rest.
      }
    }
  }

  return Response.json({ ok: true, due: due.length, sent });
}
