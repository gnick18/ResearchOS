"use client";

// Lab tier Phase 8d: the head's lab-membership panel (Settings -> Lab Mode).
//
// Two actions, both over the relay-based lab tier (distinct from the old
// folder-based LabRoster on the same tab):
//   1. Create invite link  -> mint a head-signed join link to share.
//   2. Pending join requests -> review who accepted and add them to the lab
//      (the finalize step that verifies the binding + seals the lab key).
//
// All crypto lives in lib/lab; this is presentation + orchestration only.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLabSession } from "@/hooks/useLabSession";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import {
  mintInviteForHead,
  loadPendingAccepts,
  finalizePendingAccepts,
} from "@/lib/lab/lab-head-membership";
import type { StoredLabAccept } from "@/lib/lab/lab-accept-client";
import type { FinalizeOutcome } from "@/lib/lab/lab-invite-flow";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const primaryBtn =
  "rounded-md bg-brand-action px-3 py-2 text-meta font-medium text-white hover:bg-brand-action/90 disabled:opacity-50 disabled:cursor-not-allowed";
const secondaryBtn =
  "rounded-md border border-border bg-surface px-3 py-2 text-meta font-medium text-foreground hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed";

/** A directory "request to join" row, as returned by the request endpoint. */
interface DirJoinRequest {
  labId: string;
  requesterEmailHash: string;
  requesterPubkey: string;
  requesterName: string;
  status: string;
  createdAt: string;
}

export default function LabMembershipPanel() {
  const { currentUser } = useCurrentUser();
  const session = useLabSession();
  const labId = (session && !session.loading ? session.labId : null) ?? null;

  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<StoredLabAccept[] | null>(null);
  const [outcomes, setOutcomes] = useState<FinalizeOutcome[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Directory listing toggle state
  const [listed, setListed] = useState<boolean | null>(null);
  const [listToggleBusy, setListToggleBusy] = useState(false);
  const [listToggleError, setListToggleError] = useState<string | null>(null);

  // Directory join requests (researchers who found the lab in the directory and
  // asked to join). Separate queue from the invite-link accepts above.
  const [dirRequests, setDirRequests] = useState<DirJoinRequest[] | null>(null);
  // emailHash -> minted invite link, shown after approving so the PI can deliver
  // it to the approved researcher (auto-delivery to their inbox is a follow-up).
  const [approvedLinks, setApprovedLinks] = useState<Record<string, string>>({});

  if (!labId || !currentUser) {
    return (
      <p className="text-meta text-foreground-muted leading-relaxed">
        Lab membership controls appear once you are signed in to your lab.
      </p>
    );
  }

  const requireIdentity = () => {
    const id = getSessionIdentity();
    if (!id) {
      throw new Error(
        "Your identity is locked. Reload and sign in to your lab first.",
      );
    }
    return id;
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setError(null);
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const createLink = () =>
    run("link", async () => {
      const { link: l } = mintInviteForHead({
        labId,
        username: currentUser,
        identity: requireIdentity(),
        origin: window.location.origin,
      });
      setLink(l);
      setCopied(false);
    });

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("Could not copy. Select the link and copy it manually.");
    }
  };

  const refresh = () =>
    run("refresh", async () => {
      setOutcomes(null);
      setPending(await loadPendingAccepts(labId, requireIdentity()));
    });

  const loadDirRequests = () =>
    run("dir-load", async () => {
      const res = await fetch(
        `/api/directory/labs/request?labId=${encodeURIComponent(labId)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Could not load directory requests.");
      const j = (await res.json()) as { requests?: DirJoinRequest[] };
      setDirRequests(j.requests ?? []);
    });

  const resolveDir = (req: DirJoinRequest, action: "approve" | "decline") =>
    run(`dir-${req.requesterEmailHash}`, async () => {
      const res = await fetch("/api/directory/labs/request/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          labId,
          requesterEmailHash: req.requesterEmailHash,
          action,
        }),
      });
      if (!res.ok) throw new Error(`Could not ${action} the request.`);
      if (action === "approve") {
        // Mint a join link for the approved researcher to come in with. The
        // invite carries the lab id + head keys; they open it to join.
        const { link: l } = mintInviteForHead({
          labId,
          username: currentUser,
          identity: requireIdentity(),
          origin: window.location.origin,
        });
        setApprovedLinks((cur) => ({ ...cur, [req.requesterEmailHash]: l }));
      }
      setDirRequests((cur) =>
        (cur ?? []).filter(
          (r) => r.requesterEmailHash !== req.requesterEmailHash,
        ),
      );
    });

  const addAll = () =>
    run("add", async () => {
      const o = await finalizePendingAccepts({
        labId,
        username: currentUser,
        identity: requireIdentity(),
      });
      setOutcomes(o);
      setPending(await loadPendingAccepts(labId, requireIdentity()));
    });

  return (
    <div className="space-y-6">
      {/* Invite a member */}
      <div className="space-y-3">
        <p className="text-meta text-foreground-muted leading-relaxed">
          Invite a member by sharing a one-time link. They open it, sign in with
          any provider they like, and request to join. You add them below. The
          email they sign in with is bound to their membership, whatever address
          you sent the link to.
        </p>
        <button
          type="button"
          onClick={createLink}
          disabled={busy !== null}
          className={primaryBtn}
        >
          {busy === "link" ? "Creating..." : "Create invite link"}
        </button>

        {link && (
          <div className="space-y-2">
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-meta text-foreground"
              />
              <button type="button" onClick={copyLink} className={secondaryBtn}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-meta text-foreground-subtle leading-relaxed">
              Share this link with one person. It expires in 7 days. Anyone with
              the link can request to join, but no one joins until you add them
              below.
            </p>
          </div>
        )}
      </div>

      <hr className="border-border" />

      {/* Pending join requests */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-body font-medium text-foreground">
            Pending join requests
          </h4>
          <button
            type="button"
            onClick={refresh}
            disabled={busy !== null}
            className={secondaryBtn}
          >
            {busy === "refresh" ? "Checking..." : "Check for requests"}
          </button>
        </div>

        {pending === null && (
          <p className="text-meta text-foreground-muted leading-relaxed">
            Click &quot;Check for requests&quot; to see who has opened your
            invite link and asked to join.
          </p>
        )}

        {pending !== null && pending.length === 0 && (
          <p className="text-meta text-foreground-muted leading-relaxed">
            No pending requests right now.
          </p>
        )}

        {pending !== null && pending.length > 0 && (
          <div className="space-y-2">
            <ul className="divide-y divide-border rounded-md border border-border">
              {pending.map((p) => (
                <li
                  key={p.nonce}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="text-meta text-foreground">
                    <span className="font-medium">{p.memberUsername}</span>
                    <span className="text-foreground-subtle">
                      {" "}
                      requested to join
                    </span>
                  </span>
                  <span className="text-meta text-foreground-subtle">
                    {new Date(p.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={addAll}
              disabled={busy !== null}
              className={primaryBtn}
            >
              {busy === "add"
                ? "Adding..."
                : `Add ${pending.length} to the lab`}
            </button>
          </div>
        )}

        {outcomes && outcomes.length > 0 && (
          <ul className="space-y-1">
            {outcomes.map((o) => (
              <li key={o.nonce} className="text-meta text-foreground-muted">
                {o.status === "added" ? "Added " : "Skipped "}
                <span className="font-medium text-foreground">{o.username}</span>
                {o.reason ? ` (${o.reason})` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="text-meta text-red-500 leading-relaxed" role="alert">
          {error}
        </p>
      )}

      <hr className="border-border" />

      {/* Directory listing toggle */}
      <div className="space-y-3">
        <h4 className="text-body font-medium text-foreground">
          Lab directory listing
        </h4>
        <p className="text-meta text-foreground-muted leading-relaxed">
          Your lab is unlisted by default. Turn this on to appear in the
          researcher directory so members can find and request to join you.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={listed === true}
            disabled={listToggleBusy || !labId}
            className={[
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              listed === true ? "bg-sky-600" : "bg-border",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            ].join(" ")}
            onClick={async () => {
              if (!labId) return;
              const next = !(listed === true);
              setListToggleBusy(true);
              setListToggleError(null);
              try {
                const res = await fetch("/api/directory/labs/publish", {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ labId, listed: next }),
                });
                if (!res.ok) {
                  setListToggleError("Failed to update listing. Try again.");
                } else {
                  setListed(next);
                }
              } catch {
                setListToggleError("Failed to update listing. Try again.");
              } finally {
                setListToggleBusy(false);
              }
            }}
          >
            <span
              className={[
                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                listed === true ? "translate-x-6" : "translate-x-1",
              ].join(" ")}
            />
          </button>
          <span className="text-meta text-foreground">
            {listed === true ? "Listed in the directory" : "Unlisted (private)"}
          </span>
          {listToggleBusy && (
            <span className="text-meta text-foreground-muted">Saving...</span>
          )}
        </div>
        {listToggleError && (
          <p className="text-meta text-red-500" role="alert">
            {listToggleError}
          </p>
        )}
        {listed === null && (
          <p className="text-meta text-foreground-subtle">
            The current listing state will load once you toggle it for the first time.
            Your lab starts unlisted.
          </p>
        )}
      </div>

      <hr className="border-border" />

      {/* Requests from the directory: researchers who found the lab and asked to
          join (a separate queue from the invite-link accepts above). */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-body font-medium text-foreground">
            Requests from the directory
          </h4>
          <button
            type="button"
            onClick={loadDirRequests}
            disabled={busy !== null}
            className={secondaryBtn}
          >
            {busy === "dir-load" ? "Loading..." : "Load requests"}
          </button>
        </div>

        {dirRequests === null && (
          <p className="text-meta text-foreground-muted leading-relaxed">
            Researchers who find your lab in the directory and ask to join show
            up here.
          </p>
        )}
        {dirRequests !== null && dirRequests.length === 0 && (
          <p className="text-meta text-foreground-muted leading-relaxed">
            No directory join requests right now.
          </p>
        )}
        {dirRequests !== null && dirRequests.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {dirRequests.map((req) => (
              <li
                key={req.requesterEmailHash}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span className="text-meta text-foreground">
                  <span className="font-medium">{req.requesterName}</span>
                  <span className="text-foreground-subtle"> wants to join</span>
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => resolveDir(req, "approve")}
                    disabled={busy !== null}
                    className={primaryBtn}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveDir(req, "decline")}
                    disabled={busy !== null}
                    className={secondaryBtn}
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {Object.keys(approvedLinks).length > 0 && (
          <div className="space-y-2 rounded-md border border-border bg-surface-sunken p-3">
            <p className="text-meta text-foreground leading-relaxed">
              Approved. Send each researcher their join link so they can come in
              (auto-delivery is coming).
            </p>
            {Object.entries(approvedLinks).map(([hash, l]) => (
              <div key={hash} className="flex items-center gap-2">
                <input
                  readOnly
                  value={l}
                  className="flex-1 truncate rounded border border-border bg-surface px-2 py-1 text-meta text-foreground-muted"
                />
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(l)}
                  className={secondaryBtn}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
