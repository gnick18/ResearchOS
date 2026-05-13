"use client";

import {
  updateEvent as updateGoogleEvent,
  deleteEvent as deleteGoogleEvent,
  type ExternalEventPatch as GooglePatch,
} from "./google-client";
import {
  updateEvent as updateOutlookEvent,
  deleteEvent as deleteOutlookEvent,
  type ExternalEventPatch as OutlookPatch,
} from "./microsoft-client";
import type { CalendarFeed, ExternalEvent } from "@/lib/types";

/**
 * Provider-agnostic write entrypoints. Calendar UI calls these without
 * caring whether the event came from Google or Outlook — they dispatch
 * by `feed.kind` and surface a clear error for ICS feeds (which are
 * read-only by protocol).
 */

export type ExternalEventPatch = GooglePatch & OutlookPatch;

export async function updateExternalEvent(
  username: string,
  feed: CalendarFeed,
  event: ExternalEvent,
  patch: ExternalEventPatch,
): Promise<ExternalEvent> {
  switch (feed.kind) {
    case "google":
      return updateGoogleEvent(username, feed, event.providerEventId, patch);
    case "outlook":
      return updateOutlookEvent(username, feed, event.providerEventId, patch);
    case "ics":
      throw new Error(
        "This calendar is read-only — ICS subscriptions don't support edits. Use the source calendar's app to make changes.",
      );
  }
}

export async function deleteExternalEvent(
  username: string,
  feed: CalendarFeed,
  event: ExternalEvent,
): Promise<void> {
  switch (feed.kind) {
    case "google":
      return deleteGoogleEvent(username, feed, event.providerEventId);
    case "outlook":
      return deleteOutlookEvent(username, feed, event.providerEventId);
    case "ics":
      throw new Error(
        "This calendar is read-only — ICS subscriptions don't support deletes. Use the source calendar's app to remove the event.",
      );
  }
}

/** Convenience predicate used by the UI to flip the external-event modal
 *  from "read-only" to "editable" without duplicating the kind check. */
export function isFeedWritable(feed: CalendarFeed): boolean {
  return feed.kind === "google" || feed.kind === "outlook";
}
