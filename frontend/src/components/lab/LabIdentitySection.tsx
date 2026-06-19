"use client";

// Lab identity + branding: the Settings -> Lab settings editor.
//
// Lets a lab head change the lab name, PI title, PI display name, and logo after
// the lab exists. Reads the current profile from the relay (open read), edits via
// the shared LabIdentityFields, and saves with the head-signed updateLabProfile +
// uploadLabLogo. Head-only: it self-gates on account_type === "lab_head" + a
// lab_id in settings + an unlocked identity.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import {
  fetchLabProfile,
  updateLabProfile,
  uploadLabLogo,
  labLogoUrl,
  describeLabWriteError,
} from "@/lib/lab/lab-profile-client";
import LabIdentityFields, {
  resolvePiTitle,
  PI_TITLE_PRESETS,
  type LabIdentityValue,
} from "./LabIdentityFields";
import type { PreparedLogo } from "@/lib/lab/lab-logo-image";
import type { UserSettings } from "@/lib/settings/user-settings";

/** Map a stored title string back into the preset/custom field shape. */
function titleToFields(piTitle: string): {
  piTitlePreset: string;
  piTitleCustom: string;
} {
  if (!piTitle) return { piTitlePreset: "None", piTitleCustom: "" };
  if ((PI_TITLE_PRESETS as readonly string[]).includes(piTitle)) {
    return { piTitlePreset: piTitle, piTitleCustom: "" };
  }
  return { piTitlePreset: "Custom", piTitleCustom: piTitle };
}

export default function LabIdentitySection({
  settings,
}: {
  settings: UserSettings | null | undefined;
}) {
  const labId = settings?.lab_id ?? null;
  const isHead = settings?.account_type === "lab_head";

  const [value, setValue] = useState<LabIdentityValue>({
    labName: "",
    piTitlePreset: "Dr.",
    piTitleCustom: "",
    piDisplay: "",
  });
  // A newly chosen logo (downscaled), or null. An existing logo is shown via
  // existingLogoUrl when no fresh pick is staged.
  const [logo, setLogo] = useState<PreparedLogo | null>(null);
  const [existingLogoUrl, setExistingLogoUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(
    null,
  );

  // Load the current profile once.
  useEffect(() => {
    if (!LAB_TIER_ENABLED || !labId || !isHead) return;
    let cancelled = false;
    void (async () => {
      const profile = await fetchLabProfile(labId);
      if (cancelled) return;
      if (profile) {
        const t = titleToFields(profile.piTitle ?? "");
        setValue({
          labName: profile.labName ?? "",
          piTitlePreset: t.piTitlePreset,
          piTitleCustom: t.piTitleCustom,
          piDisplay: profile.piDisplay ?? "",
        });
        if (profile.hasLogo) setExistingLogoUrl(labLogoUrl(labId));
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [labId, isHead]);

  const onLogoChange = useCallback((next: PreparedLogo | null) => {
    setLogo(next);
    // Choosing a fresh logo supersedes the existing one in the preview.
    if (next) setExistingLogoUrl(null);
  }, []);

  const save = useCallback(async () => {
    if (!labId) return;
    const identity = getSessionIdentity();
    if (!identity) {
      setStatus({ kind: "err", msg: "Unlock your workspace to save." });
      return;
    }
    if (!value.labName.trim()) {
      setStatus({ kind: "err", msg: "Give your lab a name." });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const res = await updateLabProfile(
        labId,
        {
          labName: value.labName.trim(),
          piTitle: resolvePiTitle(value),
          piDisplay: value.piDisplay.trim(),
        },
        identity.keys.signing.privateKey,
      );
      if (!res.ok) {
        const { message, raw } = await describeLabWriteError(res);
        console.warn("[LabIdentitySection] lab profile save failed:", raw);
        throw new Error(message);
      }
      if (logo) {
        const logoRes = await uploadLabLogo(
          labId,
          logo.bytes,
          logo.contentType,
          identity.keys.signing.privateKey,
        );
        if (!logoRes.ok) {
          const { raw } = await describeLabWriteError(logoRes);
          console.warn("[LabIdentitySection] lab logo upload failed:", raw);
          throw new Error(
            `Saved the name, but the logo upload failed (${raw}).`,
          );
        }
        // Re-point the existing-logo preview at the freshly uploaded one.
        setLogo(null);
        setExistingLogoUrl(labLogoUrl(labId));
      }
      setStatus({ kind: "ok", msg: "Lab identity saved." });
    } catch (e) {
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "Could not save.",
      });
    } finally {
      setSaving(false);
    }
  }, [labId, value, logo]);

  if (!LAB_TIER_ENABLED || !labId || !isHead) return null;

  // The preview the shared fields render: a freshly picked logo, else the
  // existing one (as a synthetic previewUrl-only shape), else none.
  const previewLogo = logo ?? (existingLogoUrl ? { previewUrl: existingLogoUrl } : null);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-body font-medium text-foreground">Lab identity</h3>
        <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
          Your lab name, your title, and an optional logo. Members see these on
          the invite screen and while they work.
        </p>
      </div>

      {!loaded ? (
        <p className="text-meta text-foreground-muted">Loading...</p>
      ) : (
        <>
          <LabIdentityFields
            value={value}
            onChange={setValue}
            logo={previewLogo}
            onLogoChange={onLogoChange}
            onLogoError={(msg) => setStatus({ kind: "err", msg })}
            disabled={saving}
          />

          {status && (
            <p
              className={`text-meta leading-relaxed ${status.kind === "ok" ? "text-green-600" : "text-red-500"}`}
              role={status.kind === "err" ? "alert" : undefined}
            >
              {status.msg}
            </p>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="ros-btn-raise rounded-md bg-brand-action px-4 py-2 text-meta font-medium text-white hover:bg-brand-action/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save lab identity"}
          </button>
        </>
      )}
    </div>
  );
}
