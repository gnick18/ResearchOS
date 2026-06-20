"use client";

// Wizard step: name the org (department or institution). Required (the name is
// needed to create the org). On Continue it creates the org via the existing
// folderless create helper (server derives the admin owner key from the session)
// and hands the new id back to the host so later steps (invites, billing) can act
// on it.
//
// Asks for the org name only. The parent institution is captured by the next
// step (OrgParentLinkStep, department track), so this step does not also ask for
// it. A free-text affiliation field used to live here, but it was redundant with
// that step and not persisted, so it was removed (no redundant or dead asks).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import BeakerBot from "@/components/BeakerBot";

export type OrgKind = "department" | "institution";

export interface OrgNameStepProps {
  kind: OrgKind;
  /** Advance once the org is created, with its new id. */
  onCreated: (orgId: string) => void;
  /**
   * Test/host seam: override the create call. Defaults to the real folderless
   * create helper for the kind.
   */
  createOrg?: (name: string) => Promise<{ ok: boolean; orgId?: string; error?: string }>;
}

async function defaultCreate(
  kind: OrgKind,
  name: string,
): Promise<{ ok: boolean; orgId?: string; error?: string }> {
  try {
    if (kind === "department") {
      const { createDeptForCurrentUser } = await import("@/lib/dept/dept-create");
      const r = await createDeptForCurrentUser({ name });
      return { ok: true, orgId: r.deptId };
    }
    const { createInstitutionForCurrentUser } = await import(
      "@/lib/institution/institution-create"
    );
    const r = await createInstitutionForCurrentUser({ name });
    return { ok: true, orgId: r.institutionId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the account." };
  }
}

export default function OrgNameStep({ kind, onCreated, createOrg }: OrgNameStepProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const noun = kind === "department" ? "department" : "institution";

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(`Give your ${noun} a name to continue.`);
      return;
    }
    setError(null);
    setSaving(true);
    const create = createOrg ?? ((n: string) => defaultCreate(kind, n));
    const result = await create(trimmed);
    setSaving(false);
    if (result.ok && result.orgId) {
      onCreated(result.orgId);
    } else {
      setError(result.error ?? `Could not create the ${noun}.`);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
      <div className="mb-3 h-16 w-16">
        <BeakerBot
          pose="idle"
          alive
          className="h-full w-full text-sky-400"
          ariaLabel="BeakerBot"
        />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        Name your {noun}
      </h1>
      <p className="mb-6 mt-2 text-sm text-foreground-muted">
        This is the org admin account. There is no research workspace here, no
        handle and no data folder, just the tools to manage your {noun}.
      </p>

      <div className="w-full space-y-4 text-left">
        <div>
          <label
            htmlFor="wizard-org-name"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
          >
            {kind === "department" ? "Department name" : "Institution name"}
          </label>
          <input
            id="wizard-org-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder={
              kind === "department"
                ? "Department of Biochemistry"
                : "State University"
            }
            className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9]"
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 w-full text-left text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving || !name.trim()}
        className="mt-6 w-full rounded-xl bg-[#1283c9] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f6fa8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Creating..." : "Create and continue"}
      </button>
    </div>
  );
}
