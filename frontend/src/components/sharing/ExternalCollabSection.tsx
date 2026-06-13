"use client";

// External-collab chunk 2, PIECE B: owner-side grant UI for a note.
//
// A small section inside the share dialog's "Outside your lab" tab that lets the
// note owner LIVE-collaborate with an outside ResearchOS user (distinct from the
// one-time encrypted-copy send above it). It searches the directory for the user
// by email, then sends a signed grant to the collab DO that activates the access
// lock and adds them as a member (with the in-lab sharers backfilled).
//
// Chunk 5 adds the owner's revoke surface: a list of the current external
// collaborators with a per-person Revoke that signs a /revoke to the DO. Revoke
// stops the person's live access only; their last snapshot stays as a read-only
// copy in their folder (we never reach in to delete it, Grant's locked decision).
//
// The whole section is gated behind EXTERNAL_COLLAB_ENABLED (default OFF).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";

import type { Note } from "@/lib/types";
import { openNote } from "@/lib/loro/store";
import { getCollabDocId } from "@/lib/collab/client/doc-id";
import { collabSessionFromDocId } from "@/lib/loro/collab/doc-id-session";
import {
  lookupOutsideUser,
  grantExternalCollab,
  listMembers,
  revokeExternalCollab,
  type CollabMember,
} from "@/lib/collab/client/external-grant";

interface ExternalCollabSectionProps {
  note: Note;
  ownerUsername: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "granted"; email: string }
  | { kind: "error"; message: string };

function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return v.length > 3 && v.includes("@") && v.includes(".");
}

export default function ExternalCollabSection({
  note,
  ownerUsername,
}: ExternalCollabSectionProps) {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // External-collab chunk 5: the doc's collab session id (derived from its
  // collab_doc_id) plus the current external collaborators, for the revoke UI.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [members, setMembers] = useState<CollabMember[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const canSubmit = phase.kind !== "working" && looksLikeEmail(email);

  // Resolve the collab session id from the note's live doc, then load the
  // current member list. An OPEN (never-granted) note has no member table, so
  // listMembers fails and we render the empty state. Re-runs after a grant
  // flips the doc to enforced (phase -> granted) so the new collaborator shows.
  const refreshMembers = useCallback(async () => {
    try {
      const handle = await openNote(note, ownerUsername);
      const docId = getCollabDocId(handle.doc);
      if (!docId) {
        setSessionId(null);
        setMembers([]);
        return;
      }
      const { sessionId: sid } = collabSessionFromDocId(docId);
      setSessionId(sid);
      const result = await listMembers(sid);
      // request-failed on an open / never-enforced doc is expected; show empty.
      setMembers(result.ok ? result.members : []);
    } catch {
      setMembers([]);
    }
  }, [note, ownerUsername]);

  useEffect(() => {
    void refreshMembers();
  }, [refreshMembers]);

  const onRevoke = useCallback(
    async (member: CollabMember) => {
      if (!sessionId) return;
      setRevoking(member.email);
      try {
        const result = await revokeExternalCollab({
          sessionId,
          email: member.email,
        });
        if (result.ok) {
          setMembers((prev) =>
            (prev ?? []).filter((m) => m.email !== member.email),
          );
        }
      } finally {
        setRevoking(null);
      }
    },
    [sessionId],
  );

  // The owner and any in-lab backfill members are managed through the in-lab
  // ACL, not here. This list shows only EXTERNAL collaborators (role "external"),
  // the people this surface granted, so the owner revokes exactly what they added.
  const externalMembers = (members ?? []).filter((m) => m.role === "external");

  const onGrant = useCallback(async () => {
    const target = email.trim();
    setPhase({ kind: "working" });
    try {
      const outside = await lookupOutsideUser(target);
      if (!outside) {
        setPhase({
          kind: "error",
          message: `${target} is not a ResearchOS user yet.`,
        });
        return;
      }

      // Open the note's live Loro doc so the collab doc id can be minted and
      // signed against. This is the same handle the editor uses.
      const handle = await openNote(note, ownerUsername);
      const result = await grantExternalCollab({
        doc: handle.doc,
        outside,
        sharedWith: note.shared_with ?? null,
        title: note.title ?? null,
      });

      if (result.ok) {
        setPhase({ kind: "granted", email: outside.email });
        // Reflect the newly-granted collaborator in the list immediately.
        void refreshMembers();
        return;
      }
      const message =
        result.reason === "no-identity"
          ? "Set up your sharing identity first (Settings -> Sharing)."
          : result.reason === "self"
            ? "That is your own address."
            : "Could not reach the collaboration server. Try again.";
      setPhase({ kind: "error", message });
    } catch {
      setPhase({
        kind: "error",
        message: "Something went wrong. Try again.",
      });
    }
  }, [email, note, ownerUsername, refreshMembers]);

  // The current external collaborators with a per-person Revoke. Rendered under
  // both the input form and the post-grant confirmation. Revoke stops the
  // person's LIVE access; their last snapshot stays as a read-only copy in their
  // folder (we never reach in to delete it).
  const collaboratorList =
    externalMembers.length > 0 ? (
      <div className="mt-3 border-t border-border pt-3">
        <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold mb-2">
          People with live access
        </p>
        <ul className="space-y-1.5">
          {externalMembers.map((m) => (
            <li
              key={m.email}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-body text-foreground truncate">
                {m.email}
              </span>
              <button
                type="button"
                disabled={revoking === m.email}
                onClick={() => void onRevoke(m)}
                className="text-meta font-medium text-red-600 dark:text-red-300 hover:underline disabled:opacity-50"
              >
                {revoking === m.email ? "Revoking..." : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-meta text-foreground-muted mt-2 leading-relaxed">
          Revoking stops their live editing. They keep a read-only copy of what
          they last synced.
        </p>
      </div>
    ) : null;

  if (phase.kind === "granted") {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3">
        <p className="text-body text-foreground">
          {phase.email} can now edit this note with you live.
        </p>
        <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
          They will see it under their shared notes once they are notified.
        </p>
        {collaboratorList}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-body font-medium text-foreground">Collaborate live</p>
      <p className="text-meta text-foreground-muted mt-0.5 mb-2 leading-relaxed">
        Edit this note together with another ResearchOS user, in real time.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (phase.kind === "error") setPhase({ kind: "idle" });
          }}
          placeholder="their@email.edu"
          className="flex-1 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-body text-foreground placeholder:text-foreground-muted"
        />
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onGrant}
          className="rounded-md bg-brand-action px-3 py-1.5 text-body font-medium text-white transition-colors hover:bg-brand-action/90 disabled:opacity-50"
        >
          {phase.kind === "working" ? "Granting..." : "Grant"}
        </button>
      </div>
      {phase.kind === "error" ? (
        <p className="text-meta text-red-600 mt-2">{phase.message}</p>
      ) : null}
      {collaboratorList}
    </div>
  );
}
