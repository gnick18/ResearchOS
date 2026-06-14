"use client";

// Cloud-accounts Phase 1: the folderless account home (Chunk A + B).
//
// What a signed-in user sees with NO data folder connected. The account is the
// cloud identity (OAuth session + @handle profile, bound off the session with no
// keypair); the data folder is an optional, post-login attachment. Renders inside
// PortalShell, so it is only reached when signed in.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { useFileSystem } from "@/lib/file-system/file-system-context";

interface AccountProfile {
  handle: string;
  displayName: string | null;
  affiliation: string | null;
}

interface QuickLink {
  href: string;
  label: string;
  desc: string;
}

const LINKS: QuickLink[] = [
  { href: "/department", label: "Department admin", desc: "Sponsor your labs on one invoice." },
  { href: "/institution", label: "Institution admin", desc: "Cover your departments, roll up usage." },
  { href: "/researchers", label: "Researcher directory", desc: "Find researchers and share with them." },
];

export default function AccountHome() {
  const { isConnected, connect } = useFileSystem();
  const [connecting, setConnecting] = useState(false);

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/account/profile");
        const data = (await res.json().catch(() => ({}))) as {
          profile?: AccountProfile | null;
          suggestedHandle?: string;
        };
        if (!alive) return;
        if (data.profile) {
          setProfile(data.profile);
          setHandle(data.profile.handle);
          setDisplayName(data.profile.displayName ?? "");
          setAffiliation(data.profile.affiliation ?? "");
        } else {
          // No profile yet: open the claim form prefilled with the suggestion.
          setHandle(data.suggestedHandle ?? "");
          setEditing(true);
        }
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, displayName, affiliation }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        profile?: AccountProfile;
        error?: string;
      };
      if (res.ok && data.ok && data.profile) {
        setProfile(data.profile);
        setEditing(false);
      } else {
        setError(data.error ?? `Could not save (HTTP ${res.status})`);
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const onConnect = async () => {
    setConnecting(true);
    try {
      await connect();
      window.location.assign("/");
    } catch {
      setConnecting(false);
    }
  };

  const initial = (profile?.displayName ?? profile?.handle ?? "?").slice(0, 1).toUpperCase();
  const inputCls =
    "w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action";

  return (
    <div className="space-y-5">
      {/* Profile card / claim+edit form. */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        {!loaded ? (
          <p className="text-meta text-foreground-muted">Loading your profile&hellip;</p>
        ) : editing ? (
          <div className="space-y-3">
            <h2 className="text-body font-bold text-foreground">
              {profile ? "Edit your profile" : "Claim your handle"}
            </h2>
            <label className="block">
              <span className="text-meta font-semibold text-foreground-muted">Handle</span>
              <div className="mt-1 flex items-center gap-1">
                <span className="text-body font-semibold text-foreground-muted">@</span>
                <input
                  className={inputCls}
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="yourname"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
            </label>
            <label className="block">
              <span className="text-meta font-semibold text-foreground-muted">Display name</span>
              <input
                className={`${inputCls} mt-1`}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Dr. Jane Researcher"
              />
            </label>
            <label className="block">
              <span className="text-meta font-semibold text-foreground-muted">Affiliation</span>
              <input
                className={`${inputCls} mt-1`}
                value={affiliation}
                onChange={(e) => setAffiliation(e.target.value)}
                placeholder="University of Wisconsin-Madison"
              />
            </label>
            {error && <p className="text-meta text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !handle.trim()}
                className="rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : profile ? "Save" : "Claim handle"}
              </button>
              {profile && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setError(null);
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-meta font-medium text-foreground-muted"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 flex-none place-items-center rounded-full bg-brand-purple text-lg font-extrabold text-white">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-title font-bold text-foreground">
                {profile?.displayName ?? `@${profile?.handle}`}
              </div>
              <a
                href={`/u/${profile?.handle}`}
                className="text-meta font-semibold text-brand-purple hover:underline"
              >
                @{profile?.handle}
              </a>
              {profile?.affiliation && (
                <div className="truncate text-meta text-foreground-muted">{profile.affiliation}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex-none rounded-lg border border-border bg-surface px-3 py-1.5 text-meta font-semibold text-foreground hover:border-brand-action"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Connect-your-data CTA (the optional, post-login folder attach). */}
      {!isConnected && (
        <div className="rounded-2xl border border-brand-action/30 bg-brand-action/5 p-5">
          <h2 className="text-body font-bold text-foreground">Connect your data folder</h2>
          <p className="mt-1 text-meta text-foreground-muted">
            Your notes, experiments, and files live in a folder on this computer,
            never on our servers. Connect one to start working. You can do this any
            time, from any device that has your data.
          </p>
          <button
            type="button"
            onClick={() => void onConnect()}
            disabled={connecting}
            className="mt-3 rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
          >
            {connecting ? "Opening…" : "Connect a data folder"}
          </button>
        </div>
      )}

      {/* Account-level surfaces that need no folder. */}
      <div>
        <h2 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-muted">
          Your account
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand-action"
            >
              <span className="flex items-center gap-2 text-body font-semibold text-foreground">
                {l.label}
                <span aria-hidden className="text-brand-action">
                  &rarr;
                </span>
              </span>
              <span className="text-meta text-foreground-muted">{l.desc}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
