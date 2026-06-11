// LLC business tracker, deadline-reminder logic + email copy (pure).
//
// A daily cron computes the upcoming deadlines and calls dueForReminder. A
// reminder fires only on specific threshold days before a due date, which makes
// the cron naturally idempotent, it sends once per threshold rather than every
// day, with no "last sent" table to maintain.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type { Deadline } from "./calc";
import {
  EMAIL_COLORS,
  emailAssetOrigin,
  escapeHtml,
  renderEmailLayout,
} from "@/lib/email/layout";

/** Send a reminder when a deadline is exactly this many days out. */
export const REMINDER_THRESHOLD_DAYS = [14, 7, 3, 1, 0];

export interface DueReminder {
  deadline: Deadline;
  /** The threshold day it matched (one of REMINDER_THRESHOLD_DAYS). */
  threshold: number;
}

/** The deadlines that land on a reminder threshold today. */
export function dueForReminder(deadlines: Deadline[]): DueReminder[] {
  const out: DueReminder[] = [];
  for (const d of deadlines) {
    if (REMINDER_THRESHOLD_DAYS.includes(d.daysUntil)) {
      out.push({ deadline: d, threshold: d.daysUntil });
    }
  }
  return out;
}

function whenPhrase(daysUntil: number): string {
  if (daysUntil <= 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  return `in ${daysUntil} days`;
}

export function reminderSubject(d: Deadline): string {
  return `Reminder: ${d.label} due ${whenPhrase(d.daysUntil)} (${d.dueDate})`;
}

export function reminderText(d: Deadline): string {
  const lines = [
    `${d.label} is due ${whenPhrase(d.daysUntil)}, on ${d.dueDate}.`,
  ];
  if (d.note) lines.push("", d.note);
  lines.push("", "From the ResearchOS LLC business tracker (/business).");
  return lines.join("\n");
}

/**
 * Branded HTML body for the deadline reminder. Admin-only operational email, so
 * it gets a light brand touch (the small wordmark lockup + a button into the
 * tracker) rather than the full marketing card. Pure, unit-testable.
 */
export function reminderHtml(d: Deadline): string {
  const { ink, muted } = EMAIL_COLORS;
  const due = escapeHtml(`${d.label} is due ${whenPhrase(d.daysUntil)}, on ${d.dueDate}.`);
  const note = d.note
    ? `<p style="font-size:14px;line-height:1.6;color:${muted};margin:0 0 16px;">${escapeHtml(d.note)}</p>`
    : "";
  return renderEmailLayout({
    preheader: `${d.label} due ${whenPhrase(d.daysUntil)} (${d.dueDate}).`,
    wordmarkSuffix: " &middot; business tracker",
    mascotSize: 34,
    bodyHtml: `<p style="font-size:15px;font-weight:600;color:${ink};margin:0 0 6px;">${due}</p>${note}`,
    cta: { label: "Open business tracker", url: `${emailAssetOrigin()}/business` },
  });
}
