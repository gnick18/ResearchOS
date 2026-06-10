# Chrome-Claude prompt: create the LLC Google Play organization account

Hand this to a Claude-in-Chrome session to drive the Google Play Console org
signup. The goal is an ORGANIZATION developer account for ResearchOS LLC, which is
exempt from the 12-tester / 14-day closed-test that personal accounts must run, so
Android can launch without burning that clock.

The agent drives the navigable parts. Grant does the human-only steps (Google
sign-in / 2FA, the $25 payment, any government-ID or document verification).

Have ready before starting: the LLC Google account signed in, the LLC card
(Mercury) for the $25 fee, the LLC formation docs (in case Google asks for entity
proof), and the exact legal name + address that Dun & Bradstreet has on file for
the D-U-N-S (Google matches them character for character).

---

## Paste to Chrome-Claude

You are setting up a Google Play Console developer account in the browser. Read all
of the rules before you touch anything.

GOAL
Create an ORGANIZATION (business) Google Play developer account for ResearchOS LLC.
The organization type is the whole point, it is exempt from the closed-testing
requirement that personal accounts have. Do NOT create a personal account.

FACTS to use when forms ask
- Account type: An organization or business (NOT "Yourself" / personal).
- Organization legal name: ResearchOS LLC (must match the D-U-N-S record exactly).
- D-U-N-S number: 145038194.
- Public developer name (what users see on the store): ResearchOS.
- Website: https://research-os.app
- Contact email: the LLC role Google account you are signed in as.
- Address and phone: the exact ones on file for the D-U-N-S. If you are unsure
  what they are, STOP and ask Grant rather than guessing.

HARD RULES
1. Operate only on accounts.google.com and play.google.com. Do not navigate
   anywhere else. Do not click external links.
2. The account type MUST be Organization. Confirm that selection is shown on screen
   before continuing past it. If you cannot find or confirm the Organization
   option, STOP and report.
3. Do NOT enter card details or submit the $25 payment. When you reach payment,
   pause and hand control to Grant.
4. Do NOT complete identity or government-ID verification, and do NOT upload any
   document. If Google asks for an ID or an entity document, pause and tell Grant.
5. Sign-in and 2FA are Grant's. If a login or a 2FA prompt appears, pause for him.
6. Enter the D-U-N-S 145038194 and the legal entity details when prompted. If
   Google does not recognize the D-U-N-S or cannot match the organization, STOP and
   report. Never try a different number.
7. Take a screenshot at each major step, and ALWAYS take one right before any
   button that submits or pays.
8. Before any final submit, write out exactly what is about to be submitted
   (account type, legal name, D-U-N-S, address, public developer name) and WAIT for
   Grant to confirm.

STEPS
1. Confirm Grant is signed in as the LLC Google account. If the signed-in account
   looks like a personal account, pause and confirm with him which account to use.
2. Go to https://play.google.com/console/signup
3. When asked who the account is for, choose the organization / business option,
   NOT yourself. Confirm it is selected.
4. Fill the developer account details: public developer name = ResearchOS, the
   organization legal name = ResearchOS LLC, the address, the contact email, the
   phone, and the website https://research-os.app
5. At the organization-verification step, enter the D-U-N-S 145038194. Check that
   the legal name and address Google echoes back match the formation docs exactly.
   If anything is off by even a character, STOP and report.
6. Stop at the $25 payment screen. Hand to Grant for payment.
7. Stop if any identity or document verification appears. Hand to Grant.
8. After Grant pays and submits, capture: the developer account ID, the account
   type shown (should read Organization / Business), the public developer name, and
   whether verification is pending or complete.

REPORT BACK (one short block)
- Account type confirmed Organization: yes / no
- D-U-N-S accepted and org matched: yes / no
- Developer account ID and public developer name
- $25 paid by Grant: yes / no
- Verification status: pending / complete
- Anything that blocked you or looked wrong

---

## After the account exists (Grant)

- In `/admin/business`, fill the "Google Play account" and "Google Play
  registration date" fields on the entity card. The $25 fee auto-logs to the ledger
  as money out, category "Dev accounts", once the account field is set.
- Hand the Play Console + package name to the app agent. Android then builds FRESH
  on this org account (do not transfer the personal-account app in, the closed-test
  rule can follow a transferred app). See `docs/ops/mobile-dev-accounts-setup.md`.
