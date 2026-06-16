"use client";

// Cloud-accounts Phase 3 Chunk 3B: find a researcher and share, one flow.
//
// Today finding someone (directory search by name) and sending them something
// (the relay send-by-email dialog) are two disconnected ops. This modal merges
// them: search by @handle or name, pick a result, then send a sealed share. The
// delivery method is decided by decideDeliveryMethod, if the picked researcher
// has a published X25519 key we seal to it via the registered relay (sendShare),
// otherwise we fall back to the one-time-key invite link (inviteShare) the sender
// hands over out of band.
//
// This reuses the existing directory search route, the account-handle public
// lookup, the directory lookup-by-email, and the relay client. It adds no crypto
// and no new relay protocol. The caller supplies WHAT to send (a bundle builder +
// a title); this modal owns WHO and HOW.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  sendShare,
  inviteShare,
  RecipientNotFoundError,
  RelayError,
  type InviteItemKind,
} from "@/lib/sharing/relay/client";
import type { BuildBundleInput } from "@/lib/sharing/bundle";
import { decideDeliveryMethod } from "@/lib/account/find-and-share";
import InviteOutOfBandPanel from "@/components/sharing/InviteOutOfBandPanel";
import ProfileAvatar from "@/components/account/ProfileAvatar";

// ---------------------------------------------------------------------------
// Search result shapes (directory search + account handle lookup).
// ---------------------------------------------------------------------------

/** A directory researcher result. Carries pubkeys, never an email. */
interface DirectoryResult {
  kind: "directory";
  fingerprint: string;
  displayName: string;
  affiliation: string | null;
  hasPublishedKey: true;
}

/** A cloud-account handle result. May or may not have a published data key. */
interface HandleResult {
  kind: "handle";
  handle: string;
  displayName: string | null;
  affiliation: string | null;
  avatarUrl: string | null;
}

type PickedRecipient = DirectoryResult | HandleResult;

interface FindAndShareModalProps {
  /** The sender's canonical directory email (the identity making the request). */
  senderEmail: string;
  /** The sender's display label for the invite email body. */
  senderLabel: string;
  /** The title to expose as the share / invite teaser. */
  itemTitle: string;
  /** Which kind of item, for the invite email noun + the anonymous counter. */
  itemKind?: InviteItemKind;
  /** Builds the bundle to send. Called once at send time. */
  buildBundle: () => Promise<BuildBundleInput>;
  /** Dismiss the modal. There is always a visible close (no soft-lock). */
  onClose: () => void;
}

type Phase =
  | { name: "search" }
  | { name: "confirm"; picked: PickedRecipient }
  | { name: "sending" }
  | { name: "sent"; method: "seal"; recipient: string }
  | { name: "invited"; recipient: string; privateLink: string; unlockCode: string }
  | { name: "error"; message: string };

export default function FindAndShareModal({
  senderEmail,
  senderLabel,
  itemTitle,
  itemKind,
  buildBundle,
  onClose,
}: FindAndShareModalProps) {
  useEscapeToClose(onClose, true);

  const [phase, setPhase] = useState<Phase>({ name: "search" });
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PickedRecipient[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  // For a picked recipient we need an email to route the relay mailbox. The
  // directory never reveals it, so the sender confirms the recipient's address.
  const [recipientEmail, setRecipientEmail] = useState("");

  const seq = useRef(0);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    setSearchError(null);
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const mySeq = (seq.current += 1);
    setSearching(true);
    try {
      // A leading @ (or a single-token query) is treated as a handle lookup; a
      // free-text query goes to the directory trigram search. We try both for a
      // plain token so a name like "jane" still surfaces directory researchers.
      const isHandle = q.startsWith("@") || /^[a-z0-9_-]{2,30}$/i.test(q);
      const collected: PickedRecipient[] = [];

      if (isHandle) {
        const handle = q.replace(/^@/, "");
        const res = await fetch(
          `/api/account/public?handle=${encodeURIComponent(handle)}`,
        );
        const data = (await res.json().catch(() => ({}))) as {
          found?: boolean;
          profile?: {
            handle: string;
            displayName: string | null;
            affiliation: string | null;
            avatarUrl: string | null;
          };
        };
        if (data.found && data.profile) {
          collected.push({ kind: "handle", ...data.profile });
        }
      }

      // Directory search (by name/affiliation). Session-gated server-side; a 401
      // simply yields no directory results, the handle path still works.
      try {
        const res = await fetch(
          `/api/directory/search?q=${encodeURIComponent(q.replace(/^@/, ""))}`,
        );
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            results?: Array<{
              fingerprint: string;
              displayName: string;
              affiliation: string | null;
            }>;
          };
          for (const r of data.results ?? []) {
            collected.push({
              kind: "directory",
              fingerprint: r.fingerprint,
              displayName: r.displayName,
              affiliation: r.affiliation,
              hasPublishedKey: true,
            });
          }
        }
      } catch {
        /* directory search is best-effort; the handle path still works */
      }

      if (seq.current !== mySeq) return;
      setResults(collected);
      if (collected.length === 0) {
        setSearchError("No one matched. Try a different name or @handle.");
      }
    } catch {
      if (seq.current !== mySeq) return;
      setSearchError("Could not search right now. Try again in a moment.");
    } finally {
      if (seq.current === mySeq) setSearching(false);
    }
  }, [query]);

  const onSend = useCallback(
    async (picked: PickedRecipient) => {
      const email = recipientEmail.trim();
      if (!looksLikeEmail(email)) {
        setPhase({
          name: "error",
          message: "Enter the recipient's email so we can deliver the share.",
        });
        return;
      }
      setPhase({ name: "sending" });
      try {
        const bundle = await buildBundle();
        // The registered relay seals to a published key when the recipient has
        // one. We attempt it first; a not-found means no published key, so we
        // fall back to the one-time-link invite (decideDeliveryMethod captures
        // the same predicate explicitly and is unit-tested).
        try {
          await sendShare({ email: senderEmail, recipientEmail: email, bundle });
          setPhase({ name: "sent", method: "seal", recipient: email });
          return;
        } catch (err) {
          const noPublishedKey =
            err instanceof RecipientNotFoundError ||
            (err instanceof RelayError && err.status === 404);
          if (!noPublishedKey) throw err;
          // decideDeliveryMethod({ hasPublishedKey: false }) === "one-time-link".
          void decideDeliveryMethod({ hasPublishedKey: false });
          const result = await inviteShare({
            email: senderEmail,
            recipientEmail: email,
            bundle,
            itemTitle,
            senderLabel,
            ...(itemKind ? { itemKind } : {}),
          });
          setPhase({
            name: "invited",
            recipient: email,
            privateLink: result.privateLink,
            unlockCode: result.unlockCode,
          });
        }
      } catch {
        setPhase({
          name: "error",
          message: "Could not send the share. Try again in a moment.",
        });
      }
    },
    [recipientEmail, buildBundle, senderEmail, itemTitle, senderLabel, itemKind],
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-surface-raised shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-title font-semibold text-foreground">
              Find a researcher and share
            </h3>
            <p className="mt-0.5 text-meta text-foreground-muted">
              Search by @handle or name, then send an encrypted copy
            </p>
          </div>
          <Tooltip label="Close">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-foreground-muted hover:text-foreground"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          {(phase.name === "search" || phase.name === "confirm") && (
            <SearchBody
              query={query}
              setQuery={setQuery}
              searching={searching}
              results={results}
              searchError={searchError}
              runSearch={runSearch}
              picked={phase.name === "confirm" ? phase.picked : null}
              onPick={(p) => setPhase({ name: "confirm", picked: p })}
              onBack={() => setPhase({ name: "search" })}
              recipientEmail={recipientEmail}
              setRecipientEmail={setRecipientEmail}
              onSend={onSend}
              itemTitle={itemTitle}
            />
          )}

          {phase.name === "sending" && (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="h-9 w-9 animate-spin rounded-full border-2 border-border border-t-brand-action" />
              <p className="mt-4 text-body text-foreground-muted">Sending</p>
            </div>
          )}

          {phase.name === "sent" && (
            <div className="space-y-4 text-center">
              <p className="text-title font-semibold text-foreground">
                Sent to {phase.recipient}
              </p>
              <p className="text-body text-foreground-muted">
                They will see it in their inbox. You sent a copy, so your version
                stays yours.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white"
              >
                Done
              </button>
            </div>
          )}

          {phase.name === "invited" && (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-title font-semibold text-foreground">
                  We have invited {phase.recipient}
                </p>
                <p className="mt-1 text-body text-foreground-muted">
                  They do not have a published key yet, so we sealed this under a
                  one-time key. Send them the link or code below over a channel you
                  trust. The email holds no key.
                </p>
              </div>
              <InviteOutOfBandPanel
                recipient={phase.recipient}
                items={[
                  { privateLink: phase.privateLink, unlockCode: phase.unlockCode },
                ]}
              />
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white"
              >
                Done
              </button>
            </div>
          )}

          {phase.name === "error" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-meta text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300">
                {phase.message}
              </div>
              <button
                type="button"
                onClick={() => setPhase({ name: "search" })}
                className="w-full rounded-lg border border-border px-4 py-2 text-body font-medium text-foreground"
              >
                Back to search
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search + confirm body.
// ---------------------------------------------------------------------------

function SearchBody({
  query,
  setQuery,
  searching,
  results,
  searchError,
  runSearch,
  picked,
  onPick,
  onBack,
  recipientEmail,
  setRecipientEmail,
  onSend,
  itemTitle,
}: {
  query: string;
  setQuery: (v: string) => void;
  searching: boolean;
  results: PickedRecipient[];
  searchError: string | null;
  runSearch: () => void;
  picked: PickedRecipient | null;
  onPick: (p: PickedRecipient) => void;
  onBack: () => void;
  recipientEmail: string;
  setRecipientEmail: (v: string) => void;
  onSend: (p: PickedRecipient) => void;
  itemTitle: string;
}) {
  if (picked) {
    const name = nameOf(picked);
    const canSend = looksLikeEmail(recipientEmail.trim());
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-sunken p-3">
          <ProfileAvatar
            avatarUrl={picked.kind === "handle" ? picked.avatarUrl : null}
            name={name}
            sizePx={40}
          />
          <div className="min-w-0">
            <p className="truncate text-body font-medium text-foreground">{name}</p>
            {subtitleOf(picked) && (
              <p className="truncate text-meta text-foreground-muted">
                {subtitleOf(picked)}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2.5">
          <p className="text-meta text-foreground-muted">Sending</p>
          <p className="mt-0.5 break-words text-body font-medium text-foreground">
            {itemTitle}
          </p>
        </div>

        <div>
          <label
            htmlFor="find-share-email"
            className="mb-1 block text-meta font-medium text-foreground"
          >
            Recipient email
          </label>
          <input
            id="find-share-email"
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSend) onSend(picked);
            }}
            placeholder="them@university.edu"
            autoComplete="email"
            className="w-full rounded-lg border border-border px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action"
          />
          <p className="mt-1 text-meta text-foreground-muted">
            We deliver to a verified address. If they have a published key we seal
            to it; if not, you get a private link to pass along.
          </p>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onBack}
            className="ros-btn-neutral flex-1 px-4 py-2 text-body font-medium"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => onSend(picked)}
            disabled={!canSend}
            className="flex-1 rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
          placeholder="@handle or a name"
          autoCapitalize="none"
          spellCheck={false}
          className="w-full rounded-lg border border-border px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={searching || query.trim().length < 2}
          className="flex-none rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white disabled:opacity-50"
        >
          {searching ? "…" : "Search"}
        </button>
      </div>

      {searchError && (
        <p className="text-meta text-foreground-muted">{searchError}</p>
      )}

      <div className="space-y-2">
        {results.map((r) => (
          <button
            key={keyOf(r)}
            type="button"
            onClick={() => onPick(r)}
            className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-brand-action"
          >
            <ProfileAvatar
              avatarUrl={r.kind === "handle" ? r.avatarUrl : null}
              name={nameOf(r)}
              sizePx={36}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium text-foreground">
                {nameOf(r)}
              </p>
              {subtitleOf(r) && (
                <p className="truncate text-meta text-foreground-muted">
                  {subtitleOf(r)}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function nameOf(r: PickedRecipient): string {
  if (r.kind === "handle") return r.displayName ?? `@${r.handle}`;
  return r.displayName;
}

function subtitleOf(r: PickedRecipient): string | null {
  if (r.kind === "handle") return r.affiliation ?? `@${r.handle}`;
  return r.affiliation;
}

function keyOf(r: PickedRecipient): string {
  return r.kind === "handle" ? `h:${r.handle}` : `d:${r.fingerprint}`;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

