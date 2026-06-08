"use client";

// Intent-scoped hover-prefetch (docs/proposals/HOVER_PREFETCH.md, Phase 1).
//
// Detail popups already have their list record in memory (the lists are eagerly
// cached at shell mount), so the open-time cost is the SECONDARY load the popup
// fires after it mounts. For notes and experiments that is a Loro document load
// from disk. This hook warms that load while the pointer rests on the row, so
// the real open reuses the already-resident handle and feels instant.
//
// One delegated `pointerover` listener does the whole app: every list row
// already carries `data-beaker-target="<kind>:...:<id>"` (added for BeakerSearch),
// so there is no per-row wiring. We parse the target, look the record up in the
// React Query cache, and warm it. Guards keep it cheap: a dwell debounce so a
// fast scan does not fire dozens of loads, a per-session dedup + cap, and a small
// in-flight cap. Warming is best-effort; a failure just means the real open loads
// it, exactly as today.
//
// Network note: we warm ONLY local (non-collab) records. openNote / openTaskDoc
// do a one-shot relay snapshot GET for a collaborative doc, and we do not want
// hover to make network calls, so collab records are skipped here and load
// normally on real open. (The live collab websocket was never part of these
// calls; it lives in the popup effect.)

import { useEffect } from "react";

import { appQueryClient } from "@/lib/query-client";
import { openNote } from "@/lib/loro/store";
import { openTaskDoc } from "@/lib/loro/task-store";
import type { Note, Task } from "@/lib/types";
import { HOVER_PREFETCH_ENABLED } from "./config";

/** Rest this long on a row before warming, so scanning a list does not fire. */
const DWELL_MS = 120;
/** Hard cap on distinct records warmed per session (bounds resident handles). */
const SESSION_CAP = 30;
/** Most warms allowed in flight at once, so hover never contends with a real open. */
const MAX_IN_FLIGHT = 2;

// Module-level so the budget survives remounts of the host component.
const warmed = new Set<string>();
let inFlight = 0;

type Parsed = { kind: "note" | "experiment"; owner: string; id: number };

/** Parse a `data-beaker-target` value into the records we warm (notes/experiments). */
function parseTarget(raw: string): Parsed | null {
  const firstColon = raw.indexOf(":");
  if (firstColon < 0) return null;
  const kind = raw.slice(0, firstColon);
  const rest = raw.slice(firstColon + 1);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon < 0) return null;
  const id = Number(rest.slice(lastColon + 1));
  if (!Number.isInteger(id)) return null;

  if (kind === "note") {
    // rest is "note-<username>:<id>"
    const seg = rest.slice(0, lastColon);
    const owner = seg.startsWith("note-") ? seg.slice(5) : seg;
    return owner ? { kind: "note", owner, id } : null;
  }
  // Experiments (and any "task:"-prefixed rows) warm the same way.
  if (kind === "experiment" || kind === "task") {
    const owner = rest.slice(0, lastColon);
    return owner ? { kind: "experiment", owner, id } : null;
  }
  return null;
}

function track(promise: Promise<unknown> | undefined) {
  if (!promise) return;
  inFlight += 1;
  void promise
    .catch(() => {
      /* best-effort: the real open will load it */
    })
    .finally(() => {
      inFlight -= 1;
    });
}

function warm(target: Parsed): Promise<unknown> | undefined {
  if (target.kind === "note") {
    const notes = appQueryClient.getQueryData<Note[]>(["notes"]);
    const note = notes?.find((n) => n.id === target.id && n.username === target.owner);
    // Only warm a local note; skip until found (the real open handles a miss).
    if (!note || note.collab_doc_id) return undefined;
    return openNote(note, target.owner);
  }
  // Experiment / task: warm the default Lab Notes doc. Skip collab docs to stay
  // network-free; the Task carries collab_doc_id once shared.
  const currentUser = appQueryClient.getQueryData<string>(["current-user"]);
  const tasks =
    appQueryClient.getQueryData<Task[]>(["tasks", currentUser]) ??
    appQueryClient.getQueryData<Task[]>(["tasks", "with-shared", currentUser]);
  const task = tasks?.find((t) => t.id === target.id && t.owner === target.owner);
  if (task?.collab_doc_id) return undefined;
  return openTaskDoc({ owner: target.owner, id: target.id }, "notes", currentUser ?? undefined);
}

/**
 * Mount once (in AppShell). Warms note / experiment Loro docs on row hover when
 * HOVER_PREFETCH_ENABLED is on. No-op when the flag is off, on coarse-pointer
 * devices (no hover intent), or when the user has Save-Data on.
 *
 * `currentUser` is taken so the experiment lookup hits the right user-scoped
 * cache; it is also mirrored into the query cache under ["current-user"] so the
 * non-React warm() helper can read it.
 */
export function usePrefetchOnHover(currentUser: string | null | undefined) {
  useEffect(() => {
    if (currentUser) appQueryClient.setQueryData(["current-user"], currentUser);
  }, [currentUser]);

  useEffect(() => {
    if (!HOVER_PREFETCH_ENABLED || typeof window === "undefined") return;

    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    if (nav.connection?.saveData) return;
    // Only on devices with a real hovering pointer.
    if (!window.matchMedia || !window.matchMedia("(hover: hover)").matches) return;

    let timer: number | undefined;
    let pendingKey: string | null = null;

    const cancel = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      pendingKey = null;
    };

    const onOver = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-beaker-target]");
      const raw = el?.getAttribute("data-beaker-target");
      if (!raw) return;
      const target = parseTarget(raw);
      if (!target) return;

      const key = `${target.kind}:${target.owner}:${target.id}`;
      if (key === pendingKey || warmed.has(key)) return;

      cancel();
      pendingKey = key;
      timer = window.setTimeout(() => {
        pendingKey = null;
        timer = undefined;
        if (warmed.has(key) || warmed.size >= SESSION_CAP || inFlight >= MAX_IN_FLIGHT) {
          return;
        }
        const promise = warm(target);
        if (promise) {
          warmed.add(key);
          // Dogfood breadcrumb: confirms a warm actually fired (flag is already
          // on to reach here). Quiet debug level, no-op in normal use.
          console.debug(`[hover-prefetch] warming ${key} (${warmed.size}/${SESSION_CAP})`);
          track(promise);
        }
      }, DWELL_MS);
    };

    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerout", cancel, { passive: true });
    return () => {
      cancel();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", cancel);
    };
  }, []);
}
