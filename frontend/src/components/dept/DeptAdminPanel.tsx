"use client";

// Department tier Phase 1: the minimal dept admin surface.
//
// Two states: no department yet (a create form), or a department (the lab-head
// roster + a create-invite-link control). This is the lean Phase 1 surface; the
// full usage + cost command center is the approved Phase 2 dashboard
// (docs/mockups/2026-06-13-department-admin-dashboard.html).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import { patchUserSettings } from "@/lib/settings/user-settings";
import { Icon } from "@/components/icons";
import { createDeptForCurrentUser } from "@/lib/dept/dept-create";
import DeptDashboard from "@/components/dept/DeptDashboard";
import {
  mintInviteForDeptAdmin,
  loadDeptRoster,
  type DeptRosterResult,
} from "@/lib/dept/dept-admin-membership";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const primaryBtn =
  "rounded-md bg-brand-action px-3 py-2 text-meta font-medium text-white hover:bg-brand-action/90 disabled:opacity-50 disabled:cursor-not-allowed";
const inputCls =
  "min-w-0 flex-1 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action";

export default function DeptAdminPanel() {
  const { currentUser } = useCurrentUser();
  const [roster, setRoster] = useState<DeptRosterResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => setRoster(await loadDeptRoster());
  useEffect(() => {
    void refresh();
  }, []);

  const createDept = async () => {
    if (!name.trim()) return;
    setError(null);
    setBusy(true);
    try {
      // The dept is created server-side off the authenticated session; no local
      // device identity needed (the portal works folderless).
      const { deptId } = await createDeptForCurrentUser({ name });
      // Record the org relationship locally ONLY when a folder is connected (the
      // in-app Department lens reads it). Folderless portal use skips this.
      if (currentUser) await patchUserSettings(currentUser, { dept_admin_of: deptId });
      await refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const makeInviteLink = async () => {
    if (!roster?.department) return;
    setError(null);
    // Demo mode has no session; show a representative link so the invite flow is
    // visible without minting a real token.
    if (isDemoOrWikiCapture()) {
      setLink(`${window.location.origin}/dept/join#demo-invite-link`);
      setCopied(false);
      return;
    }
    try {
      const { link: l } = await mintInviteForDeptAdmin({
        deptId: roster.department.deptId,
        origin: window.location.origin,
      });
      setLink(l);
      setCopied(false);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("Could not copy. Select the link and copy it manually.");
    }
  };

  if (roster === null) {
    return <p className="text-meta text-foreground-muted">Loading&hellip;</p>;
  }

  // No department yet: the create form.
  if (!roster.department) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <h1 className="flex items-center gap-2 text-title font-semibold text-foreground">
            <Icon name="labTree" className="h-5 w-5" />
            Start a department
          </h1>
          <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
            A department is a container of labs on one invoice. Name it, then invite
            your lab heads; they enroll their own members. You see the labs and their
            usage, never their research data.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Department of Microbiology"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) void createDept();
              }}
            />
            <button
              type="button"
              className={primaryBtn}
              disabled={busy || !name.trim()}
              onClick={() => void createDept()}
            >
              {busy ? "Creating…" : "Create department"}
            </button>
          </div>
          {error && <p className="mt-2 text-meta text-rose-600">{error}</p>}
        </div>
      </div>
    );
  }

  // Has a department: roster + invite.
  const active = roster.labHeads.filter((h) => h.status === "active");
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-title font-semibold text-foreground">
        {roster.department.name}
      </h1>
      <p className="mt-1 text-meta text-foreground-muted">
        {active.length} {active.length === 1 ? "lab head" : "lab heads"} in your
        department. Charging arrives with billing (Phase 3).
      </p>

      {/* Phase 2: the usage + cost dashboard (plan builder, usage by lab,
          over-time), reading /api/dept/usage. */}
      <div className="mt-5">
        <DeptDashboard />
      </div>

      <div className="mt-5 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-body font-medium text-foreground">Invite a lab head</h2>
        <p className="mt-0.5 text-meta text-foreground-muted">
          Share this link with a PI. They sign in and join; you do not need their
          email.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={primaryBtn} onClick={() => void makeInviteLink()}>
            Create invite link
          </button>
          {link && (
            <>
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-border bg-surface-sunken px-3 py-2 font-mono text-meta text-foreground-muted">
                {link}
              </span>
              <button
                type="button"
                className="rounded-md border border-border bg-surface px-3 py-2 text-meta font-medium text-foreground hover:bg-surface-sunken"
                onClick={() => void copyLink()}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-5">
        <h2 className="mb-2 text-body font-medium text-foreground">Lab heads</h2>
        {roster.labHeads.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-meta text-foreground-muted">
            No lab heads yet. Send an invite link above.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {roster.labHeads.map((h) => (
              <li
                key={h.memberKey}
                className="flex flex-wrap items-center gap-2 bg-surface px-4 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-body text-foreground">
                  {h.label ?? `${h.memberKey.slice(0, 10)}…`}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-meta font-medium ${
                    h.status === "active"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                  }`}
                >
                  {h.status === "active" ? "Active" : "Invited"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="mt-3 text-meta text-rose-600">{error}</p>}
    </div>
  );
}
