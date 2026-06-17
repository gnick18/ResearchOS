"use client";

/**
 * OrcidField - Settings -> Profile ORCID iD input (metadata implementation
 * bot, 2026-05-28).
 *
 * The person's ORCID iD lives on `UserMetadataEntry.orcid` in
 * `users/_user_metadata.json` (NOT on tasks, NOT in `settings.json`). This
 * field reads via `getUserMetadata` and writes via `setUserMetadataField`,
 * mirroring the dedicated-helper pattern already used for
 * `native_calendar_color`.
 *
 * Behavior locked by the design brief:
 *   - Paste-tolerant: a full `https://orcid.org/...` URL or a no-hyphen
 *     string is normalized to the canonical bare hyphenated 16-char form
 *     on blur.
 *   - Live, NON-blocking MOD 11-2 checksum check with an inline SVG
 *     check/warn glyph (no emoji). A bad checksum is a soft warning, never a
 *     hard block - the value still saves.
 *   - A "Where is this stored?" hint matching the Settings convention.
 *   - A small external link to the ORCID record once the iD is valid.
 */

import { useEffect, useState } from "react";
import {
  getUserMetadata,
  setUserMetadataField,
} from "@/lib/file-system/user-metadata";
import {
  isValidOrcid,
  normalizeOrcid,
  orcidRecordUrl,
} from "@/lib/metadata/orcid";
import { stripControlChars } from "@/lib/validation/input-hardening";

/** Rejects any scheme that is not http(s) (javascript:, vbscript:, data:, etc.). */
const DANGEROUS_SCHEME_RE = /^\s*(?!https?:\/\/)[a-z][a-z0-9+\-.]*\s*:/i;

interface OrcidFieldProps {
  /** Active folder username - the metadata key the iD is stored under. */
  currentUser: string | null;
}

export default function OrcidField({ currentUser }: OrcidFieldProps) {
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [schemeError, setSchemeError] = useState(false);

  // Load the persisted iD once per user. Re-runs when the active user
  // changes so switching folders re-seeds the field. The async metadata
  // read resolves in a `.then` callback (off the effect body, so it doesn't
  // trip the cascading-render rule); the only synchronous setState is the
  // "no folder connected" reset path, which is genuine cross-folder
  // synchronization (mirrors the justified disable in useAccountType.ts).
  useEffect(() => {
    let cancelled = false;
    if (!currentUser) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- folder-disconnect transition: the previous user's iD must clear immediately and there is no I/O to await, so the synchronous reset is the correct shape here.
      setDraft("");
      setLoaded(true);
      return;
    }
    void getUserMetadata(currentUser).then((entry) => {
      if (cancelled) return;
      setDraft(entry?.orcid ?? "");
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // Live, non-blocking signals derived from the current draft.
  const trimmed = draft.trim();
  const hasValue = trimmed.length > 0;
  const valid = hasValue && isValidOrcid(trimmed);
  const recordUrl = valid ? orcidRecordUrl(trimmed) : null;

  const commit = async () => {
    if (!currentUser) return;
    setSchemeError(false);
    // Strip control characters before any further check.
    const cleaned = stripControlChars(trimmed);
    // Hard-reject any non-http(s) scheme (javascript:, vbscript:, data:,
    // etc.). The ORCID field value may be used as an href; a dangerous
    // scheme must never reach the store. This is a hard block, not a soft
    // warning.
    if (cleaned.length > 0 && DANGEROUS_SCHEME_RE.test(cleaned)) {
      setSchemeError(true);
      // Reset the draft to the last saved value (which is always safe).
      const meta = await getUserMetadata(currentUser);
      setDraft(meta?.orcid ?? "");
      return;
    }
    // Persist the canonical bare hyphenated form when we can normalize it
    // (even if the checksum is off - the warning is soft). An empty field
    // clears the stored value back to null.
    const next = cleaned.length > 0 ? (normalizeOrcid(cleaned) ?? cleaned) : null;
    // Reflect the normalized form in the input so the user sees the
    // canonical 4-4-4-4 shape after pasting a URL / no-hyphen string.
    if (next !== null) setDraft(next);
    await setUserMetadataField(currentUser, "orcid", next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div>
      <label
        htmlFor="settings-orcid-input"
        className="block text-meta font-medium text-gray-700 mb-1"
      >
        ORCID iD
      </label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            id="settings-orcid-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder="0000-0002-1825-0097"
            disabled={!currentUser || !loaded}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            }}
            className="w-full px-3 py-2 pr-9 border border-gray-300 rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          {/* Inline status glyph: only shown when there's something typed.
              Green check = valid checksum; amber warn triangle = could not
              validate (soft, never blocks). Custom inline SVGs - no emoji,
              no lucide. */}
          {hasValue && (
            <span
              className="absolute right-2 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            >
              {valid ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-emerald-600"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-amber-500"
                >
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              )}
            </span>
          )}
        </div>
        {recordUrl && (
          <a
            href={recordUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-meta text-blue-600 hover:text-blue-800 whitespace-nowrap"
          >
            View record
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}
      </div>

      {/* Hard error: dangerous scheme rejected outright (not saved). */}
      {schemeError && (
        <p className="text-meta text-red-600 dark:text-red-400 mt-1" role="alert">
          That value looks like a URL with an unsafe scheme (for example,{" "}
          <code>javascript:</code>). Enter a bare ORCID iD (0000-0000-0000-0000)
          or a full https://orcid.org/... link. The previous value was kept.
        </p>
      )}
      {/* Live, non-blocking validity line. */}
      {hasValue && !valid && !schemeError && (
        <p className="text-meta text-amber-600 mt-1">
          This doesn&apos;t look like a valid ORCID iD (the checksum
          doesn&apos;t match). It will still be saved, but double-check it.
        </p>
      )}
      {saved && (
        <p className="text-meta text-emerald-600 mt-1" role="status">
          Saved.
        </p>
      )}

      {/* "Where is this stored?" hint - matches the Settings convention
          (e.g. the header's "Stored in users/<u>/settings.json" line). */}
      <p className="text-meta text-gray-400 mt-1">
        Stored in{" "}
        <code className="px-1 py-0.5 bg-gray-100 rounded text-meta">
          users/_user_metadata.json
        </code>
        . Paste a full orcid.org link or the bare digits; we normalize it to
        the standard 0000-0000-0000-0000 form.
      </p>
    </div>
  );
}
