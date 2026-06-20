# Onboarding wizard, name-capture streamline audit (2026-06-20)

Trigger: during a live lab-setup walkthrough the "Set up your lab" step asked for
"PI name" and prefilled it with the user's HANDLE slug (`asp-fumi-seq-initiative`)
rather than their actual name, even though sign-in already had the name. Grant
flagged the redundant asks and asked for a streamline audit. This doc is the audit
only, no code changed yet. House style throughout (no em-dashes, no emojis, no
mid-sentence colons).

## The bug behind the symptom

The lab step prefills "PI name" from the claimed handle, not the user's name:

- `frontend/src/components/onboarding/wizard/OnboardingWizard.tsx:103`
  `defaultPiDisplay: () => handleRef.current`
- The comment at lines 79 to 82 states the intent plainly, "prefill the PI display
  name with it [the handle]". That is the mistake. A handle is a unique directory
  slug (`@asp-fumi-seq-initiative`), not a person's name.
- `LabStep` (`steps/LabStep.tsx`) passes that value straight into the "PI name"
  field (`LabIdentityFields` `piDisplay`), so the user sees their slug where their
  name should be.

The user's real name is available from the OAuth provider at sign-in (NextAuth
session `user.name`), but the wizard never reads it for any prefill.

## Where "name" is captured in the lab (pi-create) track

Track order: Sign in, Handle, Profile, Lab setup, Folder, Your name
(`frontend/src/components/onboarding/wizard/tracks.tsx` `buildPiCreateTrack`).

| Step | Field | Source today | Notes |
| --- | --- | --- | --- |
| Sign in | provider name + email | OAuth (Google) | Captured, then ignored for prefills |
| Handle | `@handle` | user types | A slug, distinct purpose (directory address), NOT redundant |
| Profile (skippable) | "Display name" | blank field | placeholder "Dr. Jane Researcher" |
| Lab setup | "PI name" | prefilled with the HANDLE (bug) | same person as the profile display name |
| Your name (skippable) | preferred greeting name | blank field | "most people just use a first name" |

So the same human's NAME is asked or derivable at four points (OAuth, Profile
display name, Lab PI name, Preferred name), none of them seeded from the name we
already hold, and one of them seeded from the wrong field.

## The solo (free) track has the same shape, minus the lab step

Track order: Sign in, Handle, Profile, Folder, Your name
(`buildSoloFreeTrack`). Name touchpoints: OAuth (ignored), Profile display name
(blank), Preferred name (blank). Three name asks, no OAuth prefill. The
solo-local track has no account, so only the greeting name applies there.

## The three name CONCEPTS (why some asks are legitimate)

Not every name field is duplicate. There are genuinely three concepts:

1. Display name, the formal "Dr. Grant Nickles" shown to other researchers and on
   the lab. The PI name on the lab is the SAME value (the PI is the signed-in
   user), so "PI name" duplicates the profile display name.
2. Handle, the `@slug` directory address. Distinct, keep it.
3. Preferred greeting name, the casual "Grant" the app greets you by. Already
   falls back to the display name's honorific-stripped first word when blank
   (`PreferredNameStep` comment), so it is optional polish, not a required ask.

The redundancy is therefore concentrated in the DISPLAY-NAME concept being asked
up to three times (OAuth, Profile, PI name) instead of sourced once.

## Recommended streamline (the "one name source" model)

Source the display name ONCE from OAuth, then reuse it everywhere with edit
affordances, so the user confirms rather than retypes, and never re-enters a name
the system already knows.

1. Capture `session.user.name` at sign-in into a `nameRef` (mirror the existing
   `handleRef` pattern in `OnboardingWizard.tsx`).
2. Profile step "Display name" prefills from `nameRef` (editable). A confirm, not
   a blank retype.
3. Lab setup drops the standalone "PI name" field. The lab's PI name auto-derives
   from the profile display name (or `nameRef` if Profile was skipped), shown
   read-only as "Led by <name> (this is you), edit in your profile". Lab setup
   then asks only Lab name, plus optional title and logo.
4. Preferred greeting name keeps deriving from the first word by default. Consider
   demoting the dedicated step to a one-line inline confirm, or leaving it as the
   skippable closer it already is.
5. Fix the prefill bug regardless of scope: never seed a name field from the
   handle.

Net effect: one real name ask (a confirm of the OAuth name), the handle as its own
distinct ask, and the greeting name as optional polish.

## Scoped options (for the build decision, when greenlit)

- Full: one name source (items 1 to 5 above). Best UX, touches OnboardingWizard,
  tracks, LabStep, LabIdentityFields, ProfileStep.
- Mid: fix the prefill bug AND remove the standalone PI name field from Lab setup
  (derive it). Leaves Profile and Preferred-name as-is.
- Minimal: fix the prefill bug only, PI name defaults to the real display name
  (OAuth or profile) instead of the handle. Smallest change.

## Files in scope

- `frontend/src/components/onboarding/wizard/OnboardingWizard.tsx` (name source)
- `frontend/src/components/onboarding/wizard/tracks.tsx` (track wiring)
- `frontend/src/components/onboarding/wizard/steps/LabStep.tsx` (PI name field)
- `frontend/src/components/lab/LabIdentityFields.tsx` (shared identity fields, also
  used by Settings and LabCreateResume, so a change here is cross-surface)
- `frontend/src/components/onboarding/wizard/steps/ProfileStep.tsx` (display name)
- `frontend/src/components/onboarding/wizard/steps/PreferredNameStep.tsx` (greeting)

## Coordination note

`LabIdentityFields` is shared by the wizard, Settings lab editor, and
LabCreateResume, so removing or changing the PI name field affects all three. The
audit recommends changing the wizard's USE of it (drop or auto-derive the field at
the wizard call site) rather than ripping the field out of the shared component,
so Settings keeps an explicit PI-name editor.
