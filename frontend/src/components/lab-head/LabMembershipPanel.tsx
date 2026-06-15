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

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLabSession } from "@/hooks/useLabSession";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { isRealSharingEnabled } from "@/lib/sharing/oauth-availability";
import { readUserSettings } from "@/lib/settings/user-settings";
import { Icon } from "@/components/icons";
import {
  mintInviteForHead,
  loadPendingAccepts,
  finalizePendingAccepts,
} from "@/lib/lab/lab-head-membership";
import { getLabRemote } from "@/lib/lab/lab-do-client";
import {
  fetchLabRoster,
  type UnifiedLabRoster,
  type LabBillingStatus,
} from "@/lib/billing/client";
import type { StoredLabAccept } from "@/lib/lab/lab-accept-client";
import type { FinalizeOutcome } from "@/lib/lab/lab-invite-flow";

/** The chip copy + tone for each billing status, shown next to a member. */
const BILLING_CHIP: Record<
  LabBillingStatus,
  { label: string; tone: string }
> = {
  active: {
    label: "Paid seat",
    tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  pending: {
    label: "Seat pending",
    tone: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  unbilled: {
    label: "Not billed yet",
    tone: "bg-surface-sunken text-foreground-muted",
  },
  no_identity: {
    label: "No billing identity yet",
    tone: "bg-surface-sunken text-foreground-muted",
  },
};

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

/**
 * One matching researcher from GET /api/directory/search. The directory NEVER
 * returns an email (privacy by design), so a directory invite cannot be mailed.
 * We mint a copyable link for the PI to deliver out of band instead.
 */
interface DirSearchResult {
  fingerprint: string;
  displayName: string;
  affiliation: string | null;
  affiliationDomain: string | null;
}

/**
 * Where the by-email invite currently stands. The mint always succeeds locally,
 * the email send is best effort, so a failure still leaves the copyable link.
 */
type EmailInvite =
  | { status: "sent"; email: string; link: string }
  | { status: "failed"; email: string; link: string }
  | { status: "link-only"; email: string; link: string };

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

  // The unified roster: data-lab members (from the DO membership log) annotated
  // with a billing chip, plus billing-only sponsored collaborators. Best-effort,
  // null until loaded or when billing is off (then members show without a chip).
  const [unifiedRoster, setUnifiedRoster] = useState<UnifiedLabRoster | null>(
    null,
  );
  const [dataMembersFallback, setDataMembersFallback] = useState<
    { pubkey: string; username: string | null }[] | null
  >(null);

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

  // Add-a-member: search the directory for an existing account.
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<DirSearchResult[] | null>(
    null,
  );
  // fingerprint -> minted link for a directory match (no email to mail to).
  const [searchLinks, setSearchLinks] = useState<Record<string, string>>({});

  // Add-a-member: invite any email address.
  const [inviteEmail, setInviteEmail] = useState("");
  const [emailInvite, setEmailInvite] = useState<EmailInvite | null>(null);

  // The head's display label for the email body. Read once from settings, with
  // the username as a calm fallback. Editable lab name is prefilled from it so
  // the email reads well without any new persisted field.
  const [senderLabel, setSenderLabel] = useState<string>(currentUser ?? "");
  const [labName, setLabName] = useState<string>("");
  const [labNameTouched, setLabNameTouched] = useState(false);

  const sharingOn = isRealSharingEnabled();

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const settings = await readUserSettings(currentUser);
        if (cancelled) return;
        const label = settings.displayName?.trim() || currentUser;
        setSenderLabel(label);
        setLabName((cur) => (labNameTouched || cur ? cur : `${label}'s lab`));
      } catch {
        // Keep the username fallback already in state.
      }
    })();
    return () => {
      cancelled = true;
    };
    // labNameTouched intentionally excluded: we only seed the default once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // Load the unified roster: read the data-lab roster from the DO, then resolve
  // each member's billing status. Re-runs after a finalize (outcomes) adds people.
  useEffect(() => {
    if (!labId) return;
    let cancelled = false;
    (async () => {
      try {
        const remote = await getLabRemote(labId);
        if (cancelled || !remote) return;
        const members = (remote.record.members ?? [])
          .filter(
            (m) =>
              m.role !== "head" && typeof m.ed25519PublicKey === "string",
          )
          .map((m) => ({ pubkey: m.ed25519PublicKey, username: m.username }));
        setDataMembersFallback(members);
        const billing = await fetchLabRoster(members);
        if (!cancelled) setUnifiedRoster(billing);
      } catch {
        // Best-effort; the roster section just stays hidden on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [labId, outcomes]);

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

  const mintLink = () =>
    mintInviteForHead({
      labId,
      username: currentUser,
      identity: requireIdentity(),
      origin: window.location.origin,
    }).link;

  /** POST the minted link to the recipient's inbox. Best effort. */
  const deliverInviteEmail = async (toEmail: string, inviteUrl: string) => {
    const res = await fetch("/api/lab/invite-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        toEmail,
        senderLabel: senderLabel.trim() || currentUser,
        labName: labName.trim() || `${currentUser}'s lab`,
        inviteUrl,
      }),
    });
    if (!res.ok) throw new Error(`invite email failed (HTTP ${res.status})`);
  };

  const searchDirectory = () =>
    run("search", async () => {
      const q = searchQ.trim();
      if (!q) {
        setSearchResults([]);
        return;
      }
      const res = await fetch(
        `/api/directory/search?q=${encodeURIComponent(q)}`,
        { credentials: "include" },
      );
      if (res.status === 404) {
        throw new Error("Directory search is off in this deployment.");
      }
      if (!res.ok) throw new Error("Could not search the directory.");
      const j = (await res.json()) as { results?: DirSearchResult[] };
      setSearchResults(j.results ?? []);
    });

  // Directory matches carry no email, so an invite here mints a copyable link
  // for the PI to deliver (a sent-to-inbox path needs the recipient's address,
  // which the directory deliberately withholds).
  const inviteDirectoryMatch = (r: DirSearchResult) =>
    run(`search-${r.fingerprint}`, async () => {
      const link = mintLink();
      setSearchLinks((cur) => ({ ...cur, [r.fingerprint]: link }));
    });

  const inviteByEmail = () =>
    run("email", async () => {
      const email = inviteEmail.trim();
      if (!email) throw new Error("Enter an email address to invite.");
      const link = mintLink();
      if (!sharingOn) {
        // Email infra is dark in this deployment, hand over the copyable link.
        setEmailInvite({ status: "link-only", email, link });
        return;
      }
      try {
        await deliverInviteEmail(email, link);
        setEmailInvite({ status: "sent", email, link });
        setInviteEmail("");
      } catch {
        // Mint succeeded, send did not. Leave the link so the PI can deliver it.
        setEmailInvite({ status: "failed", email, link });
      }
    });

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

  const rosterMembers =
    unifiedRoster?.members ??
    (dataMembersFallback ?? []).map((m) => ({
      username: m.username,
      pubkey: m.pubkey,
      memberKey: null as string | null,
      billingStatus: null as LabBillingStatus | null,
      usageVisible: false,
      usedBytes: null as number | null,
      writes: null as number | null,
    }));
  const sponsored = unifiedRoster?.sponsored ?? [];

  return (
    <div className="space-y-6">
      {/* Lab roster: who has data access, each with a billing chip. */}
      {rosterMembers.length > 0 || sponsored.length > 0 ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <h4 className="flex items-center gap-2 text-body font-medium text-foreground">
              <Icon name="users" className="h-4 w-4" />
              Lab roster
            </h4>
            <p className="text-meta text-foreground-muted leading-relaxed">
              Everyone with access to your lab&apos;s data. The chip shows whether
              their cloud storage sits on a paid seat in your lab&apos;s pool.
            </p>
          </div>
          {rosterMembers.length > 0 ? (
            <ul className="space-y-2">
              {rosterMembers.map((m) => {
                const chip = m.billingStatus
                  ? BILLING_CHIP[m.billingStatus]
                  : null;
                return (
                  <li
                    key={m.pubkey}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-body text-foreground">
                        {m.username ?? `${m.pubkey.slice(0, 10)}…`}
                      </span>
                      {m.usedBytes != null ? (
                        <span className="text-meta text-foreground-muted">
                          {(m.usedBytes / 1e9).toFixed(2)} GB stored
                        </span>
                      ) : null}
                    </span>
                    {chip ? (
                      <span
                        className={`rounded-full px-2.5 py-1 text-meta font-medium ${chip.tone}`}
                      >
                        {chip.label}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-meta text-foreground-muted">
              No members yet. Add someone below.
            </p>
          )}

          {/* Sponsored outside collaborators (billing-only seats, no data access). */}
          {sponsored.length > 0 ? (
            <div className="space-y-2">
              <p className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Sponsored collaborators
              </p>
              <ul className="space-y-2">
                {sponsored.map((s) => (
                  <li
                    key={s.memberKey}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-surface px-4 py-2.5"
                  >
                    <span className="block truncate text-body text-foreground">
                      {s.label ?? `${s.memberKey.slice(0, 10)}…`}
                    </span>
                    <span className="text-meta text-foreground-muted">
                      {s.status === "active" ? "Paid seat" : "Invited"} · no data
                      access
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Add a member: PI-initiated invite, two paths (directory + email). */}
      <div className="space-y-4">
        <div className="space-y-1">
          <h4 className="flex items-center gap-2 text-body font-medium text-foreground">
            <Icon name="userPlus" className="h-4 w-4" />
            Add a member
          </h4>
          <p className="text-meta text-foreground-muted leading-relaxed">
            Look up an existing ResearchOS account, or invite anyone by email.
            The person you invite signs in with any provider, and that address
            binds to their membership. No one joins until you add them below.
          </p>
        </div>

        {/* Path 1: search the directory for an existing account. */}
        <div className="space-y-2">
          <label className="block text-meta font-medium text-foreground">
            Search the directory
          </label>
          <form
            className="flex items-stretch gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy === null) searchDirectory();
            }}
          >
            <div className="relative flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-foreground-subtle">
                <Icon name="search" className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Name or affiliation"
                className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-3 text-meta text-foreground placeholder:text-foreground-subtle"
              />
            </div>
            <button
              type="submit"
              disabled={busy !== null || !searchQ.trim()}
              className={secondaryBtn}
            >
              {busy === "search" ? "Searching..." : "Search"}
            </button>
          </form>

          {!sharingOn && (
            <p className="text-meta text-foreground-subtle leading-relaxed">
              The researcher directory is off in this deployment, so search and
              email delivery are unavailable. The invite link below still works.
            </p>
          )}

          {searchResults !== null && searchResults.length === 0 && (
            <p className="text-meta text-foreground-muted leading-relaxed">
              No matching accounts. Invite them by email instead.
            </p>
          )}

          {searchResults !== null && searchResults.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {searchResults.map((r) => {
                const minted = searchLinks[r.fingerprint];
                return (
                  <li key={r.fingerprint} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 text-meta text-foreground">
                        <span className="font-medium">{r.displayName}</span>
                        {r.affiliation && (
                          <span className="text-foreground-subtle">
                            {" "}
                            {r.affiliation}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => inviteDirectoryMatch(r)}
                        disabled={busy !== null || Boolean(minted)}
                        className={secondaryBtn}
                      >
                        {busy === `search-${r.fingerprint}`
                          ? "Inviting..."
                          : minted
                            ? "Link ready"
                            : "Invite"}
                      </button>
                    </div>
                    {minted && (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center gap-2">
                          <input
                            readOnly
                            value={minted}
                            onFocus={(e) => e.currentTarget.select()}
                            className="flex-1 truncate rounded border border-border bg-surface px-2 py-1 text-meta text-foreground-muted"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              void navigator.clipboard.writeText(minted)
                            }
                            className={secondaryBtn}
                          >
                            Copy
                          </button>
                        </div>
                        <p className="text-meta text-foreground-subtle leading-relaxed">
                          Directory profiles do not expose an email, so send this
                          link to {r.displayName} yourself. It expires in 7 days.
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Path 2: invite any email address, delivered to the inbox. */}
        <div className="space-y-2">
          <label
            htmlFor="lab-invite-email"
            className="block text-meta font-medium text-foreground"
          >
            Invite by email
          </label>
          <form
            className="flex items-stretch gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy === null) inviteByEmail();
            }}
          >
            <div className="relative flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-foreground-subtle">
                <Icon name="mail" className="h-4 w-4" />
              </span>
              <input
                id="lab-invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@university.edu"
                className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-3 text-meta text-foreground placeholder:text-foreground-subtle"
              />
            </div>
            <button
              type="submit"
              disabled={busy !== null || !inviteEmail.trim()}
              className={primaryBtn}
            >
              {busy === "email"
                ? "Sending..."
                : sharingOn
                  ? "Send invite"
                  : "Create link"}
            </button>
          </form>

          {sharingOn && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="lab-invite-labname"
                className="shrink-0 text-meta text-foreground-subtle"
              >
                Lab name in the email
              </label>
              <input
                id="lab-invite-labname"
                type="text"
                value={labName}
                onChange={(e) => {
                  setLabName(e.target.value);
                  setLabNameTouched(true);
                }}
                placeholder="the Nickles Lab"
                className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-meta text-foreground placeholder:text-foreground-subtle"
              />
            </div>
          )}

          {emailInvite && (
            <div className="space-y-2">
              {emailInvite.status === "sent" && (
                <p className="flex items-center gap-2 text-meta text-foreground leading-relaxed">
                  <Icon
                    name="check"
                    className="h-4 w-4 text-emerald-600 shrink-0"
                  />
                  Invite sent to {emailInvite.email}. They join once you add them
                  below.
                </p>
              )}
              {emailInvite.status === "failed" && (
                <p className="text-meta text-foreground-muted leading-relaxed">
                  We could not email {emailInvite.email} just now. The invite link
                  is ready below, send it to them yourself.
                </p>
              )}
              {emailInvite.status === "link-only" && (
                <p className="text-meta text-foreground-muted leading-relaxed">
                  Email delivery is off in this deployment. Copy the invite link
                  below and send it to {emailInvite.email}.
                </p>
              )}
              {emailInvite.status !== "sent" && (
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={emailInvite.link}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 truncate rounded border border-border bg-surface px-2 py-1 text-meta text-foreground-muted"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard.writeText(emailInvite.link)
                    }
                    className={secondaryBtn}
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <hr className="border-border" />

      {/* Invite link (manual fallback): share a reusable link yourself. */}
      <div className="space-y-3">
        <h4 className="text-body font-medium text-foreground">
          Or share an invite link
        </h4>
        <p className="text-meta text-foreground-muted leading-relaxed">
          Mint a reusable link and share it however you like (your lab email
          list, chat, a printed QR, in person). Anyone who opens it signs in
          with any provider and requests to join, and you approve each request.
          The link stays valid for 7 days. The email each person signs in with
          is bound to their membership, whatever address you sent the link to.
        </p>
        <button
          type="button"
          onClick={createLink}
          disabled={busy !== null}
          className={secondaryBtn}
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
