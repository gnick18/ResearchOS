"use client";

// Merged wizard step: claim the @handle, set the display + greeting name, and
// (optionally) fill the rest of the researcher profile, all on one page. This
// replaces the former three separate steps (Handle -> Profile -> Preferred name)
// so a fresh sign-in has fewer pages to clear before reaching the folder. The
// handle is the only required field; everything else is optional and editable
// later in Settings, so the page never soft-locks.
//
// On submit it does a SINGLE save: one POST /api/account/profile that both claims
// the handle and persists displayName + affiliation + avatar + bio + links, then
// saves the greeting name via savePreferredName. The optional profile fields
// (photo, affiliation, bio, ORCID, ResearchGate, website) live behind a
// collapsed "More (optional)" disclosure so the default view stays short.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { getSession } from "next-auth/react";

import BeakerBot from "@/components/BeakerBot";
import FileDropzone from "@/components/ui/FileDropzone";
import ProfileAvatar from "@/components/account/ProfileAvatar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { savePreferredName } from "@/lib/account/preferred-name";
import { firstName } from "@/lib/greeting/greeting-name";
import {
  validateAvatar,
  validateBio,
  BIO_MAX_CHARS,
  type ProfileLinks,
} from "@/lib/account/account-profile-validation";

/** The full set of fields the single profile save sends. */
export interface IdentityStepFields {
  handle: string;
  displayName: string;
  affiliation: string;
  avatarUrl: string | null;
  bio: string;
  links: ProfileLinks;
}

/** What the on-mount prefill fetch returns: a suggested handle plus any saved name. */
export interface IdentityPrefill {
  suggestedHandle: string;
  displayName: string;
}

export interface IdentityStepProps {
  /**
   * Advance once the handle is claimed and the profile + greeting are saved. The
   * claimed handle is passed back so the host can prefill the lab-setup PI name.
   */
  onSubmit: (handle: string) => void;
  /**
   * Test/host seam: override the single profile claim + save. Returns ok plus an
   * optional error so a preview or test can drive the step without a live API.
   */
  saveIdentity?: (
    fields: IdentityStepFields,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Test/host seam: override the greeting-name save. */
  savePreferred?: (name: string) => Promise<{ ok: boolean }>;
  /**
   * Test/host seam: override the on-mount prefill fetch (suggested handle + any
   * saved display name).
   */
  fetchPrefill?: () => Promise<IdentityPrefill>;
  /**
   * Test/host seam: override the signed-in name lookup, used to prefill the
   * greeting field's first name when the profile has no display name yet.
   */
  fetchSessionName?: () => Promise<string>;
}

async function defaultSave(
  fields: IdentityStepFields,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // One POST claims the handle and persists the rest of the profile in the same
    // call (the API requires a handle in the body, which we now send up front).
    const res = await fetch("/api/account/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handle: fields.handle,
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

async function defaultPrefill(): Promise<IdentityPrefill> {
  try {
    const res = await fetch("/api/account/profile");
    const data = (await res.json().catch(() => ({}))) as {
      profile?: { displayName?: string | null } | null;
      suggestedHandle?: string;
    };
    return {
      suggestedHandle: data.suggestedHandle ?? "",
      displayName: data.profile?.displayName ?? "",
    };
  } catch {
    return { suggestedHandle: "", displayName: "" };
  }
}

async function defaultSessionName(): Promise<string> {
  // Mirror AccountHome: derive the signed-in name from the session (the OAuth
  // provider name, else the email local part).
  try {
    const s = await getSession();
    return s?.user?.name || s?.user?.email?.split("@")[0] || "";
  } catch {
    return "";
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

export default function IdentityStep({
  onSubmit,
  saveIdentity = defaultSave,
  savePreferred,
  fetchPrefill = defaultPrefill,
  fetchSessionName = defaultSessionName,
}: IdentityStepProps) {
  const { currentUser } = useCurrentUser();

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [greeting, setGreeting] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [orcid, setOrcid] = useState("");
  const [researchgate, setResearchgate] = useState("");
  const [website, setWebsite] = useState("");

  // The optional profile fields default collapsed so the page stays short.
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Prefill the handle suggestion, the display name, and the greeting first name
  // on mount. The greeting is the first name of whatever name we have (the saved
  // display name, else the signed-in session name).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const prefill = await fetchPrefill();
      if (!alive) return;
      if (prefill.suggestedHandle) setHandle(prefill.suggestedHandle);

      let name = prefill.displayName;
      if (!name) {
        // No saved display name yet: fall back to the signed-in session name so
        // both the display field and the greeting first name have a sensible
        // starting point.
        name = await fetchSessionName();
        if (!alive) return;
      }
      if (name) {
        setDisplayName(name);
        setGreeting(firstName(name));
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetchPrefill, fetchSessionName]);

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
    const trimmedHandle = handle.trim().replace(/^@/, "");
    if (!trimmedHandle) {
      setError("Pick a handle to continue.");
      return;
    }
    const bioErr = validateBio(bio);
    if (bioErr) {
      setError(bioErr);
      return;
    }
    setError(null);
    setSaving(true);
    const result = await saveIdentity({
      handle: trimmedHandle,
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
    if (!result.ok) {
      setSaving(false);
      setError(result.error ?? "Could not save your profile.");
      return;
    }
    // Save the greeting name after the profile claim succeeds. Best-effort and
    // non-throwing, so a write hiccup never blocks the wizard.
    const doSavePreferred =
      savePreferred ?? ((value: string) => savePreferredName(currentUser ?? "", value));
    await doSavePreferred(greeting);
    setSaving(false);
    onSubmit(trimmedHandle);
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
        Your handle is how other researchers find you. Everything else is optional
        and editable anytime in Settings.
      </p>

      <div className="w-full space-y-4 text-left">
        <div>
          <label
            htmlFor="wizard-handle"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
          >
            Your handle
          </label>
          <div className="flex items-center rounded-xl border border-border bg-surface-raised focus-within:ring-2 focus-within:ring-[#1283c9]">
            <span className="pl-3 text-sm font-semibold text-foreground-muted">@</span>
            <input
              id="wizard-handle"
              type="text"
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                if (error) setError(null);
              }}
              placeholder="your-handle"
              className="w-full bg-transparent px-1 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none"
            />
          </div>
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
            htmlFor="wizard-greeting"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
          >
            What do you want BeakerBot to call you?
          </label>
          <input
            id="wizard-greeting"
            type="text"
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            placeholder="Jane"
            autoComplete="off"
            className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9]"
          />
          <p className="mt-1.5 text-xs text-foreground-muted">
            This can be a nickname, and you can change it anytime later.
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-controls="wizard-identity-more"
            className="text-xs font-semibold text-[#1283c9] hover:underline"
          >
            {moreOpen ? "Hide optional details" : "More (optional)"}
          </button>
        </div>

        {moreOpen && (
          <div id="wizard-identity-more" className="space-y-4">
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
        )}
      </div>

      {error && (
        <p className="mt-3 w-full text-left text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving || !handle.trim()}
        className="mt-6 w-full rounded-xl bg-[#1283c9] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f6fa8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save and continue"}
      </button>
    </div>
  );
}
