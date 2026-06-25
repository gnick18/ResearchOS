"use client";

// Phase 2 of the thin-account-settings-home refactor: ONE self-contained editor
// for the CLOUD account identity (account_profiles, the canonical store that
// already drives /u/<handle>). It reads and writes ONLY /api/account/profile, so
// it touches NO data folder (no useFileSystem, no readUserSettings, no
// currentUser) and can mount both with a folder connected and folderless.
//
// It folds the fields that today live in three different surfaces (the Account
// hub Identity card, the onboarding profile step, and the local-folder
// Appearance/ORCID editors) into a single form: handle, display name,
// affiliation, avatar, bio, and the typed links (ORCID / ResearchGate /
// website).
//
// The load + avatar-draft + save shape mirrors the Account hub Identity card
// (AccountHubShell.tsx); the bio + links form mirrors the onboarding profile
// step (ProfileStep.tsx). Validation is reused, not reinvented: validateAvatar
// and validateBio gate client-side before a save, BIO_MAX_CHARS drives the
// counter, and the link shape is validated authoritatively by the server's
// normalizeLinks (run inside the POST), whose error this surfaces.
//
// This component is a pure addition. It is NOT mounted anywhere yet; a later
// step wires it in behind the PROFILE_CONSOLIDATION_ENABLED flag.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";

import FileDropzone from "@/components/ui/FileDropzone";
import ProfileAvatar from "@/components/account/ProfileAvatar";
import { fileToAvatarDataUrl } from "@/lib/account/avatar-image";
import {
  validateAvatar,
  validateBio,
  BIO_MAX_CHARS,
  type ProfileLinks,
} from "@/lib/account/account-profile-validation";

// Local mirror of the cloud profile shape so this client component reads the
// /api/account/profile JSON without importing the Neon-backed account-profile.ts
// module (which would pull the database driver into the browser bundle). The
// validators + BIO_MAX_CHARS above come from the driver-free validation module.
interface AccountProfile {
  handle: string;
  displayName: string | null;
  affiliation: string | null;
  avatarUrl: string | null;
  bio: string | null;
  links: ProfileLinks;
}

export interface ProfileEditorProps {
  /** Fired after a successful save (the caller can refresh or advance). */
  onSaved?: () => void;
  /**
   * Chrome hint. When true the editor drops its own outer card so it can sit
   * inside a host surface that already provides the framing (a modal or a
   * settings section). Default false renders the standalone card.
   */
  embedded?: boolean;
}

/**
 * A self-contained editor for the cloud account profile. Self-loads from
 * GET /api/account/profile on mount and saves with POST /api/account/profile.
 */
export default function ProfileEditor({
  onSaved,
  embedded = false,
}: ProfileEditorProps) {
  // Loaded profile (the claimed handle row) and load state.
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Form fields.
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [bio, setBio] = useState("");
  const [orcid, setOrcid] = useState("");
  const [researchgate, setResearchgate] = useState("");
  const [website, setWebsite] = useState("");

  // Avatar draft: undefined = leave the saved avatar untouched, null = clear,
  // string = a new data URL (same omit/clear/set contract as the API).
  const [avatarDraft, setAvatarDraft] = useState<string | null | undefined>(
    undefined,
  );
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Self-load from the cloud profile on mount. When the row is unclaimed the
  // route returns a suggested handle, which we seed so a first save can claim it.
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
          setBio(data.profile.bio ?? "");
          setOrcid(data.profile.links.orcid ?? "");
          setResearchgate(data.profile.links.researchgate ?? "");
          setWebsite(data.profile.links.website ?? "");
        } else {
          setHandle(data.suggestedHandle ?? "");
        }
      } catch {
        // Leave the form blank; the user can still claim a handle and save.
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Avatar pick: resize + cap client-side (fileToAvatarDataUrl), then stage as a
  // draft. The server still caps authoritatively on save.
  const onPickAvatar = async (file: File | null | undefined) => {
    setAvatarError(null);
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setAvatarDraft(dataUrl);
    } catch (e) {
      setAvatarError(
        e instanceof Error ? e.message : "Could not read that image.",
      );
    }
  };

  const save = async () => {
    setError(null);

    // Client-side pre-gates, reusing the same pure validators the server runs.
    const bioErr = validateBio(bio.trim());
    if (bioErr) {
      setError(bioErr);
      return;
    }
    if (avatarDraft !== undefined) {
      const avatarErr = validateAvatar(avatarDraft);
      if (avatarErr) {
        setAvatarError(avatarErr);
        return;
      }
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        handle,
        displayName: displayName.trim(),
        affiliation: affiliation.trim(),
        bio: bio.trim(),
        // The server's normalizeLinks validates + normalizes each link field and
        // returns a human error we surface below, so we send the raw trimmed
        // values rather than duplicating its URL/ORCID parsing here.
        links: {
          orcid: orcid.trim() || null,
          researchgate: researchgate.trim() || null,
          website: website.trim() || null,
        },
      };
      // Only send avatarUrl when the user touched it, so an untouched save leaves
      // the stored avatar in place.
      if (avatarDraft !== undefined) body.avatarUrl = avatarDraft;

      const res = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        profile?: AccountProfile;
        error?: string;
      };
      if (res.ok && data.ok && data.profile) {
        setProfile(data.profile);
        setAvatarDraft(undefined);
        setAvatarError(null);
        onSaved?.();
      } else {
        setError(data.error ?? `Could not save (HTTP ${res.status})`);
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const bioLeft = BIO_MAX_CHARS - bio.trim().length;
  // What the avatar bubble shows: the staged draft if any, else the saved one.
  const previewAvatar =
    avatarDraft !== undefined ? avatarDraft : profile?.avatarUrl ?? null;

  const inputClass =
    "w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9]";
  const labelClass =
    "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted";

  if (!loaded) {
    return (
      <p className="text-body text-foreground-muted">Loading your profile...</p>
    );
  }

  const form = (
    <div className="space-y-4 text-left">
      <div className="flex flex-col items-center gap-2">
        <ProfileAvatar
          avatarUrl={previewAvatar}
          name={displayName || handle || "?"}
          sizePx={72}
        />
        <FileDropzone
          compact
          className="w-full"
          accept="image/png,image/jpeg,image/webp"
          label={previewAvatar ? "Drag and drop to replace" : "Drag and drop a photo"}
          hint="PNG, JPG, WebP"
          icon="camera"
          ariaLabel="Upload a profile photo"
          onFiles={(files) => void onPickAvatar(files[0])}
          onReject={(msg) => setAvatarError(msg)}
        />
        {previewAvatar && (
          <button
            type="button"
            onClick={() => setAvatarDraft(null)}
            className="text-xs text-foreground-muted hover:underline"
          >
            Remove photo
          </button>
        )}
        {avatarError && (
          <p className="w-full text-left text-xs text-red-600" role="alert">
            {avatarError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="profile-handle" className={labelClass}>
          Handle
        </label>
        <input
          id="profile-handle"
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="your-handle"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="profile-display-name" className={labelClass}>
          Display name
        </label>
        <input
          id="profile-display-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Dr. Jane Researcher"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="profile-affiliation" className={labelClass}>
          Affiliation
        </label>
        <input
          id="profile-affiliation"
          type="text"
          value={affiliation}
          onChange={(e) => setAffiliation(e.target.value)}
          placeholder="University, department, or lab"
          className={inputClass}
        />
      </div>

      <div>
        <label
          htmlFor="profile-bio"
          className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-foreground-muted"
        >
          <span>Short bio</span>
          <span
            className={
              bioLeft < 0
                ? "text-red-600"
                : "font-normal normal-case text-foreground-muted"
            }
          >
            {bioLeft}
          </span>
        </label>
        <textarea
          id="profile-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          placeholder="What you research, in a sentence or two."
          className={`${inputClass} resize-none`}
        />
      </div>

      <div>
        <label htmlFor="profile-orcid" className={labelClass}>
          ORCID
        </label>
        <input
          id="profile-orcid"
          type="text"
          value={orcid}
          onChange={(e) => setOrcid(e.target.value)}
          placeholder="0000-0000-0000-0000"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="profile-researchgate" className={labelClass}>
          ResearchGate
        </label>
        <input
          id="profile-researchgate"
          type="url"
          value={researchgate}
          onChange={(e) => setResearchgate(e.target.value)}
          placeholder="https://www.researchgate.net/profile/..."
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="profile-website" className={labelClass}>
          Website
        </label>
        <input
          id="profile-website"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://yourlab.example.edu"
          className={inputClass}
        />
      </div>

      {error && (
        <p className="w-full text-left text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="w-full rounded-xl bg-[#1283c9] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f6fa8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save profile"}
      </button>
    </div>
  );

  if (embedded) return form;

  return (
    <section className="bg-surface-raised rounded-xl border border-border p-6">
      <div className="mb-4">
        <h2 className="text-title font-semibold text-foreground">
          Your profile
        </h2>
        <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
          How you appear to other researchers across ResearchOS. This is your
          account identity, so it follows you regardless of which folder you have
          open.
        </p>
      </div>
      {form}
    </section>
  );
}
