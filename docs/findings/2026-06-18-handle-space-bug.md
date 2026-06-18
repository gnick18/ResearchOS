# Findings: handle rendering with a space ("@Aspergillus fumigatus")

Date: 2026-06-18
Branch: `fix/handle-space-slug` (off `origin/main`, not merged)
Repro account: prod-test lab whose PI display name is "Aspergillus fumigatus" (investigated read-only, never modified)

## TL;DR: stored vs displayed

There are two distinct identities in the app. The bug is a conflation of them, not a corrupt account handle.

1. The account `@handle` (Neon `account_profiles.handle`) is stored correctly and is always space-free. `validateHandle` rejects spaces and `baseHandleFrom`/`suggestHandle` slugify name and email into a hyphenated handle. Nothing wrong here.

2. The folder-local workspace username is a separate, human-readable identity. It is STORED WITH A SPACE on purpose. `deriveWorkspaceUsername` (frontend/src/lib/account/workspace-username.ts) takes the account display name first ("Aspergillus fumigatus"), sanitizes only path-hostile characters, and deliberately preserves spaces and capitalization so greetings read naturally ("Welcome back, Aspergillus fumigatus"). This value is also used as a folder name (`users/<username>/`) and as `project.owner`.

So the answer to "stored vs displayed" is BOTH, for different fields:
- The handle a user claims is stored space-free (correct).
- The workspace username that gets rendered as "@..." is stored with a space (by design), and was being shown verbatim where a slugified handle was expected.

## Where it surfaces

The workspace username was interpolated straight after "@" at these display sites:

- People page member rows + detail header: `frontend/src/components/people/PeoplePage.tsx:212`, `:309` (the exact "@Aspergillus fumigatus" in the report)
- Lab roster member card: `frontend/src/components/lab-head/LabRoster.tsx:317`
- Share dialog member list + aria labels + whole-lab roster: `frontend/src/components/sharing/ShareDialog.tsx:276`, `:292`, `:353`
- Sharing chips (owner + per-member): `frontend/src/components/sharing/SharingChips.tsx:60`, `:78`

The project Timeline key `Aspergillus fumigatus:1` comes from `${project.owner}:${project.id}` (e.g. `frontend/src/components/project-surface/ProjectDetailPopup.tsx:472`, `frontend/src/components/Toolbar.tsx:55`). The owner segment is the workspace username, so its space rides into the key. URL-encoding masks it (`%20`), but the underlying key is fragile.

## The fix in this branch (display-only, safe)

- Added `toHandleSlug()` and `formatUsernameHandle()` to the client-safe `workspace-username.ts`. `toHandleSlug` lowercases and collapses every disallowed run, spaces included, to a single hyphen, matching the account-handle charset (`[a-z0-9_-]`). "Aspergillus fumigatus" becomes "aspergillus-fumigatus".
- Applied `formatUsernameHandle` as a defensive display-time fallback at all five surfaces above. Greetings and folder paths that intentionally keep the readable name are untouched.
- Unit tests in `workspace-username.test.ts` cover the slug, the "no space ever" invariant, the charset, trimming, and the empty-input fallback (20 tests passing).

This makes new and existing displays space-free without rewriting any stored data.

## FLAG: data-shape change NOT performed

The stored workspace username still contains a space, which keeps leaking into folder paths and project owner keys. Normalizing the stored value is a data-shape change and is NOT done here. If we decide to do it, the safe shape is:

- Idempotent: re-running produces no further change once usernames are slug-form.
- Trash-not-delete: any folder rename (`users/Aspergillus fumigatus/` to `users/aspergillus-fumigatus/`) moves the old path to trash rather than deleting, and rewrites `project.owner` plus any manifest/share entries that key off the old owner string in lockstep so cross-references do not dangle.
- Must rewrite, atomically with the username: `project.owner` on owned projects, shared-manifest `owner` fields, and any persisted `project=<owner>:<id>` references.

Because it touches folder names, project owner keys, and share manifests across local + collab, treat it as a migration with its own design pass and verification, gated behind the existing auto-migration lane. Do not run it as part of this display fix.

## Not changed, noted for follow-up

These also render a workspace username after "@" but belong to systems where display and match must stay in sync (changing display alone would break matching), so they were left as-is and flagged:

- `frontend/src/components/MentionPicker.tsx:171` and `frontend/src/components/CommentsThread.tsx` mention tokens (the inserted `@username` must round-trip to the stored value).
- `frontend/src/components/lab-head/AuditTrailViewer.tsx:279`.

If we run the stored-value migration, these resolve naturally; until then, slugging only their display would desync the mention match.
