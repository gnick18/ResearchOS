# Chrome-Claude prompt: enroll the LLC Apple Developer organization

Hand this to a Claude-in-Chrome session to drive the Apple Developer Program
ORGANIZATION enrollment for ResearchOS LLC. The goal is an organization (company)
membership so the App Store seller of record is "ResearchOS LLC" from day one, not
a personal name.

Background (2026-06-17): the individual enrollment was never completed (Grant
reached the final page but never paid), so there is no Apple membership yet and
nothing to cancel. Enroll fresh as the organization. Apple does NOT convert an
individual membership to an org, so the entity type MUST be chosen as
Company / Organization early in the flow.

The agent drives the navigable parts. Grant does the human-only steps (Apple ID
sign-in / 2FA, the $99 payment, accepting the Apple Developer Agreement, and any
identity / authority verification or phone call).

Have ready before starting:
- The LLC role Apple ID signed in (researchos.llc@gmail.com), with two-factor on.
  This Apple ID becomes the permanent account holder. Do NOT use a personal Apple ID.
- The Mercury LLC card for the $99/year fee.
- The exact legal name, address, and phone that Dun & Bradstreet has on file for the
  D-U-N-S (Apple matches them against the D&B record).
- The LLC formation docs in case Apple asks for entity proof.
- Confirmation that Apple's D-U-N-S lookup finds the entity first (see step 1).

---

## Paste to Chrome-Claude

You are enrolling an organization in the Apple Developer Program in the browser.
Read all of the rules before you touch anything.

GOAL
Enroll ResearchOS LLC as an ORGANIZATION (company) in the Apple Developer Program.
The organization type is the whole point: the seller of record must be the LLC, not
a person. Do NOT choose Individual / Sole Proprietor. If the flow is already on an
Individual path, back out and restart so the entity type is Company / Organization.

FACTS to use when forms ask
- Entity type: Company / Organization (NOT Individual).
- Legal entity name: ResearchOS LLC (must match the D-U-N-S / D&B record exactly).
- D-U-N-S number: 145038194.
- Website: https://research-os.app
- Work email: the LLC role Apple ID / account you are signed in as.
- Business phone: the LLC Tello business number (NOT a VoIP / Google Voice number).
- Address and phone: the exact ones on file for the D-U-N-S. If you are unsure what
  they are, STOP and ask Grant rather than guessing.
- Role / job title: the title Grant gives you (he has authority to bind the LLC).

HARD RULES
1. Operate only on apple.com domains (developer.apple.com, appleid.apple.com,
   idmsa.apple.com). Do not navigate anywhere else. Do not click external links.
2. STOP and hand control to Grant for, and never attempt yourself:
   - Apple ID sign-in and any two-factor / verification code.
   - The $99/year payment and any card entry.
   - Accepting the Apple Developer Agreement or any legal terms.
   - Any "authority to bind" attestation, government-ID step, or phone-verification.
   - The final "Submit" / "Purchase" click.
   At each of these, say clearly: "This step is yours, Grant. I have filled in
   everything up to here. Tell me when you have completed it and I will continue."
3. Never invent an address, phone number, title, or any value. If a field needs a
   value you were not given, STOP and ask.
4. Choose the most privacy-preserving option on any cookie / consent banner.
5. Do not enable marketing emails or any optional add-on. Decline upsells.
6. Read fields back to Grant before any irreversible step so he can confirm.

STEPS
1. PRE-CHECK (do this first). Go to https://developer.apple.com/enroll/duns-lookup/
   and search "ResearchOS LLC". Confirm Apple's tool returns the entity with the
   D-U-N-S 145038194 and that the name / address match what Grant has. If it does
   NOT find the entity, STOP and tell Grant (the D&B record may not have propagated
   to Apple yet; do not proceed with enrollment until it resolves).
2. Go to https://developer.apple.com/enroll and start enrollment. Grant signs in
   with the LLC Apple ID and clears 2FA (his step, rule 2).
3. When asked for entity type, select Company / Organization. If you find yourself
   on an Individual path, back out and restart to reach the org path.
4. Fill the organization details from the FACTS above: legal name, D-U-N-S, website,
   work email, business phone, address. Read them back to Grant before continuing.
5. At the authority-to-bind attestation, STOP and hand to Grant (rule 2).
6. At the Apple Developer Agreement, STOP and hand to Grant (rule 2).
7. At payment ($99/year), STOP and hand to Grant for the Mercury card and the final
   purchase (rule 2).
8. After Grant submits, report the resulting state (Pending / Enrollment ID if
   shown) and tell Grant what to expect next.

WHAT TO REPORT BACK
- Whether the D-U-N-S lookup found the entity (step 1) and any mismatch you saw.
- Every field you filled, with the value used.
- Each point where you stopped for Grant.
- The final enrollment status and any enrollment ID / reference number shown.

---

## After enrollment (operator follow-ups)

- Enrollment goes Pending, then Active. Apple review can take a few days to ~2
  weeks after the D-U-N-S verifies; Apple may call to verify the entity.
- Once active: note the Team ID (the app workstream needs it for signing + the
  `app.researchos.companion` bundle ID), and confirm App Store Connect loads.
- Record the $99/year in `/admin/business` as money OUT, category "Dev accounts",
  paid with the Mercury card, and add the renewal date to the deadline strip so the
  membership does not lapse.
- Clear any leftover premature `appleEnrollmentId` / date in the entity card from
  the abandoned individual attempt, then set the real org enrollment id once active.
- This replaces the route-A "App Transfer later" plan; the LLC is the seller from
  day one, so no transfer task is needed.
