"use client";

// Wizard step: fill the researcher profile. Skippable (the profile is editable
// anytime in /settings). The richer profile API (POST /api/account/profile) now
// persists a photo, a short bio, and typed links (ORCID / ResearchGate /
// website) alongside display name and affiliation, so the go-live step captures
// all of them. Everything is optional, and a blank Continue still advances.
//
// Photo is a small capped data URL (validateAvatar gates it client-side before
// it ever reaches the API). On Continue it saves and advances. Skip (handled by
// the shell) advances without saving.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import FileDropzone from "@/components/ui/FileDropzone";
import BeakerBot from "@/components/BeakerBot";
import ProfileAvatar from "@/components/account/ProfileAvatar";
import {
  validateAvatar,
  validateBio,
  BIO_MAX_CHARS,
  type ProfileLinks,
} from "@/lib/account/account-profile-validation";

/** The fields the step collects and hands to the save seam. */
export interface ProfileStepFields {
  displayName: string;
  affiliation: string;
  avatarUrl: string | null;
  bio: string;
  links: ProfileLinks;
}

export interface ProfileStepProps {
  /** Advance once the profile fields are saved (or left blank and saved). */
  onSaved: () => void;
  /**
   * Test/host seam: override the network save. Returns ok plus an optional
   * error.
   */
  saveProfile?: (fields: ProfileStepFields) => Promise<{ ok: boolean; error?: string }>;
}

async function defaultSave(
  fields: ProfileStepFields,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // The handle is already claimed in the prior step, so the profile row
    // exists; read it back to send the save under the claimed handle (the API
    // requires a handle in the body).
    const current = await fetch("/api/account/profile");
    const cur = (await current.json().catch(() => ({}))) as {
      profile?: { handle?: string } | null;
    };
    const handle = cur.profile?.handle;
    if (!handle) {
      // No claimed handle (should not happen after the handle step); skip the
      // save rather than error the user out of the wizard.
      return { ok: true };
    }
    const res = await fetch("/api/account/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handle,
        displayName: fields.displayName,
        affiliation: fields.affiliation,
        avatarUrl: fields.avatarUrl,
        bio: fields.bio,
        links: fields.links,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (res.ok && data.ok) return { ok: true };
    return { ok: false, error: data.error ?? `Could not save (HTTP ${res.status})` };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

export default function ProfileStep({
  onSaved,
  saveProfile = defaultSave,
}: ProfileStepProps) {
  const [displayName, setDisplayName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [orcid, setOrcid] = useState("");
  const [researchgate, setResearchgate] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const avatarErr = validateAvatar(dataUrl);
      if (avatarErr) {
        setError(avatarErr);
        return;
      }
      setAvatarUrl(dataUrl);
    } catch {
      setError("Could not read that image. Try a PNG, JPEG, or WEBP under 64 KB.");
    }
  };

  const submit = async () => {
    const bioErr = validateBio(bio);
    if (bioErr) {
      setError(bioErr);
      return;
    }
    setError(null);
    setSaving(true);
    const result = await saveProfile({
      displayName: displayName.trim(),
      affiliation: affiliation.trim(),
      avatarUrl,
      bio: bio.trim(),
      links: {
        orcid: orcid.trim() || null,
        researchgate: researchgate.trim() || null,
        website: website.trim() || null,
      },
    });
    setSaving(false);
    if (result.ok) {
      onSaved();
    } else {
      setError(result.error ?? "Could not save your profile.");
    }
  };

  const bioLeft = BIO_MAX_CHARS - bio.trim().length;

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
        Set up your profile
      </h1>
      <p className="mb-6 mt-2 text-sm text-foreground-muted">
        How you appear to other researchers. All optional, and editable anytime in
        Settings.
      </p>

      <div className="w-full space-y-4 text-left">
        <div className="flex flex-col items-center gap-2">
          <ProfileAvatar
            avatarUrl={avatarUrl}
            name={displayName || "?"}
            sizePx={72}
          />
          <FileDropzone
            compact
            className="w-full"
            accept="image/png,image/jpeg,image/webp"
            label={avatarUrl ? "Drag and drop to replace" : "Drag and drop a photo"}
            hint="PNG, JPG, WebP"
            icon="camera"
            ariaLabel="Upload a profile photo"
            onFiles={(files) => void pickPhoto(files[0])}
            onReject={(msg) => setError(msg)}
          />
          {avatarUrl && (
            <button
              type="button"
              onClick={() => setAvatarUrl(null)}
              className="text-xs text-foreground-muted hover:underline"
            >
              Remove photo
            </button>
          )}
        </div>

        <div>
          <label
            htmlFor="wizard-display-name"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
          >
            Display name
          </label>
          <input
            id="wizard-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Dr. Jane Researcher"
            className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9]"
          />
        </div>
        <div>
          <label
            htmlFor="wizard-affiliation"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
          >
            Affiliation
          </label>
          <input
            id="wizard-affiliation"
            type="text"
            value={affiliation}
            onChange={(e) => setAffiliation(e.target.value)}
            placeholder="University, department, or lab"
            className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9]"
          />
        </div>
        <div>
          <label
            htmlFor="wizard-bio"
            className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-foreground-muted"
          >
            <span>Short bio</span>
            <span
              className={bioLeft < 0 ? "text-red-600" : "font-normal normal-case text-foreground-muted"}
            >
              {bioLeft}
            </span>
          </label>
          <textarea
            id="wizard-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            placeholder="What you research, in a sentence or two."
            className="w-full resize-none rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9]"
          />
        </div>
        <div>
          <label
            htmlFor="wizard-orcid"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
          >
            ORCID
          </label>
          <input
            id="wizard-orcid"
            type="text"
            value={orcid}
            onChange={(e) => setOrcid(e.target.value)}
            placeholder="0000-0000-0000-0000"
            className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9]"
          />
        </div>
        <div>
          <label
            htmlFor="wizard-researchgate"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
          >
            ResearchGate
          </label>
          <input
            id="wizard-researchgate"
            type="url"
            value={researchgate}
            onChange={(e) => setResearchgate(e.target.value)}
            placeholder="https://www.researchgate.net/profile/..."
            className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9]"
          />
        </div>
        <div>
          <label
            htmlFor="wizard-website"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
          >
            Website
          </label>
          <input
            id="wizard-website"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://yourlab.example.edu"
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
        disabled={saving}
        className="mt-6 w-full rounded-xl bg-[#1283c9] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f6fa8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save and continue"}
      </button>
    </div>
  );
}
