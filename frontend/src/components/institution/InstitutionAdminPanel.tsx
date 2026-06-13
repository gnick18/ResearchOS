"use client";

// Institution tier Phase 4: the institution admin surface, one tier up from
// DeptAdminPanel.
//
// Two states: no institution yet (a create form), or an institution (the
// department roster + a create-invite-link control + the usage/cost dashboard). An
// institution invites DEPARTMENT admins; each department enrolls its own labs, and
// each lab head enrolls its own members. The admin sees the dept/lab/account names
// and usage totals, never any research data.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { patchUserSettings } from "@/lib/settings/user-settings";
import { Icon } from "@/components/icons";
import { createInstitutionForCurrentUser } from "@/lib/institution/institution-create";
import InstitutionDashboard from "@/components/institution/InstitutionDashboard";
import {
  mintInviteForInstitutionAdmin,
  loadInstitutionRoster,
  type InstitutionRosterResult,
} from "@/lib/institution/institution-admin-membership";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const primaryBtn =
  "rounded-md bg-brand-action px-3 py-2 text-meta font-medium text-white hover:bg-brand-action/90 disabled:opacity-50 disabled:cursor-not-allowed";
const inputCls =
  "min-w-0 flex-1 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action";

export default function InstitutionAdminPanel() {
  const { currentUser } = useCurrentUser();
  const [roster, setRoster] = useState<InstitutionRosterResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => setRoster(await loadInstitutionRoster());
  useEffect(() => {
    void refresh();
  }, []);

  const requireIdentity = () => {
    const id = getSessionIdentity();
    if (!id) throw new Error("Your identity is locked. Reload and sign in first.");
    return id;
  };

  const createInstitution = async () => {
    if (!name.trim() || !currentUser) return;
    setError(null);
    setBusy(true);
    try {
      const { institutionId } = await createInstitutionForCurrentUser({
        identity: requireIdentity(),
        name,
      });
      // Record the org relationship locally (the Institution lens reads this).
      await patchUserSettings(currentUser, { institution_admin_of: institutionId });
      await refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const makeInviteLink = () => {
    if (!roster?.institution) return;
    setError(null);
    // Demo mode has no identity to sign with; show a representative link.
    if (isDemoOrWikiCapture()) {
      setLink(`${window.location.origin}/institution/join#demo-invite-link`);
      setCopied(false);
      return;
    }
    if (!currentUser) return;
    try {
      const { link: l } = mintInviteForInstitutionAdmin({
        institutionId: roster.institution.institutionId,
        institutionName: roster.institution.name,
        username: currentUser,
        identity: requireIdentity(),
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

  // No institution yet: the create form.
  if (!roster.institution) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <h1 className="flex items-center gap-2 text-title font-semibold text-foreground">
          <Icon name="labTree" className="h-5 w-5" />
          Start an institution
        </h1>
        <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
          An institution is a container of departments on one invoice. Name it, then
          invite your department admins; they enroll their own labs, and each lab
          head enrolls members. You see the departments and their usage, never any
          research data.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="University of Example"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void createInstitution();
            }}
          />
          <button
            type="button"
            className={primaryBtn}
            disabled={busy || !name.trim()}
            onClick={() => void createInstitution()}
          >
            {busy ? "Creating…" : "Create institution"}
          </button>
        </div>
        {error && <p className="mt-2 text-meta text-rose-600">{error}</p>}
      </div>
    );
  }

  // Has an institution: roster + invite + dashboard.
  const active = roster.depts.filter((d) => d.status === "active");
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-title font-semibold text-foreground">
        {roster.institution.name}
      </h1>
      <p className="mt-1 text-meta text-foreground-muted">
        {active.length} {active.length === 1 ? "department" : "departments"} in your
        institution. Charging arrives with billing.
      </p>

      {/* The usage + cost dashboard (plan builder, usage by dept/lab, over-time),
          reading /api/institution/usage. */}
      <div className="mt-5">
        <InstitutionDashboard />
      </div>

      <div className="mt-5 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-body font-medium text-foreground">Invite a department admin</h2>
        <p className="mt-0.5 text-meta text-foreground-muted">
          Share this link with a department admin. They sign in and join with their
          department; you do not need their email.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={primaryBtn} onClick={makeInviteLink}>
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
        <h2 className="mb-2 text-body font-medium text-foreground">Departments</h2>
        {roster.depts.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-meta text-foreground-muted">
            No departments yet. Send an invite link above.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {roster.depts.map((d) => (
              <li
                key={d.deptId}
                className="flex flex-wrap items-center gap-2 bg-surface px-4 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-body text-foreground">
                  {d.label ?? `${d.deptId.slice(0, 10)}…`}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-meta font-medium ${
                    d.status === "active"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                  }`}
                >
                  {d.status === "active" ? "Active" : "Invited"}
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
