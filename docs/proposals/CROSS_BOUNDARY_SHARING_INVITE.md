# Cross-Boundary Sharing, Invite a Non-User (growth loop)

Turning the "that email is not on ResearchOS" dead-end into a growth loop that still delivers the data securely. Grant reopened this 2026-06-04, the registered-to-registered-only rule was deliberately cut earlier, this adds back a non-user path, designed as the standard "someone shared X with you, sign up to view" mechanism (Figma, Notion, Calendly).

This is a design contract for its own build phase. It reuses the relay, identity, and bundle work already shipped.

---

## Decisions locked (Grant, 2026-06-04)

- The invite email is **sent by us, branded from research-os.app** (BeakerBot, professional footer, signup CTA). Not the user's own mail client.
- The data is **parked encrypted and delivered on signup**, with the decryption key carried in the invite link's URL fragment (recommended option). No research data in the email itself.

---

## Why this is not spammy if built right

A branded "X shared research with you" email from our domain is transactional, not marketing, a named sender, one specific item, one real triggering action (a user typed that address to share a specific thing), low organic volume, and an unsubscribe path. That is exactly how the big products run this loop and it lands in inboxes. The risks are domain reputation (if abused) and looking like phishing (if sloppy), both managed by proper email auth, abuse controls, and clean transactional framing (below).

---

## The flow

### Send (sender's browser)
1. Sender sends to an email with no account. Instead of the dead-end, offer "Invite them to ResearchOS and share this."
2. The browser seals the bundle under a fresh ONE-TIME symmetric key (not the recipient's identity key, they have none yet).
3. The sealed bundle is parked on the relay as a PENDING INVITE (a distinct relay state, addressed by the invite email hash, not a registered recipient key).
4. The browser builds an accept link, `https://research-os.app/accept/<inviteId>#k=<one-time-key>`. The key lives ONLY in the fragment (after the #).
5. The browser calls a signed send-invite endpoint with the recipient email + inviteId (NOT the key). The server sends the branded email via Resend with that accept link.

The one-time key never reaches the relay or our send path in a stored form, the relay holds only the sealed bytes, the email carries the link (key in fragment), and browsers never transmit URL fragments to servers. So our infrastructure stays blind.

### Accept (recipient's browser)
1. Recipient clicks the link, lands on `/accept/<inviteId>`. The page explains who shared what and prompts a free signup (the existing claim wizard, OAuth or email code, claiming THIS email).
2. After they claim the email (proving control of it), their browser fetches the parked sealed bundle, decrypts it with the fragment key, files it into their folder (the existing review-then-import flow), and re-seals nothing, it is now local.
3. The pending invite is acked and deleted from the relay (delete-on-pickup, same as a normal share).

From this point the new user is a full registered identity, all future sharing with them is the normal fully-zero-knowledge registered-to-registered path.

---

## The branded email

- From a verified research-os.app address. Clear transactional subject ("{SenderName} shared a research note with you on ResearchOS").
- BeakerBot mascot, a one-line explanation, the accept button (the link), and what ResearchOS is in a sentence.
- Professional footer, what ResearchOS is, a physical mailing address (CAN-SPAM), and an unsubscribe / "do not invite me again" link.
- NO research content in the body (the data is parked, not attached). The body teaser is only the note/experiment TITLE the sender chose to expose, nothing more.

---

## Crypto and trust boundary (honest)

- Registered-to-registered stays fully end-to-end and zero-knowledge, unchanged.
- For an INVITE to a keyless person, the email is the trust channel for the first handoff, whoever can read the invite email can open the data via the fragment key. This is inherent to sending to someone who has no key yet, and it is the sender's explicit choice to invite them. We state this in the send UI so the sender understands an invite is a lower-assurance channel than a registered send.
- Our servers and relay never see the one-time key (fragment-only), so a relay or server compromise alone does not expose invited data, the email account is the exposure surface.

---

## Abuse, deliverability, legal (mandatory, not optional)

- PREREQUISITE, verify research-os.app in Resend with SPF, DKIM, DMARC before any branded send. (Currently a TODO; also the single biggest deliverability lever.)
- Per-sender invite rate limit (an authenticated user can only invite N new addresses per day) so we cannot be used as a spam relay. Reuse the existing Upstash ratelimit.
- An abuse / report path and an unsubscribe list, an address that unsubscribes or reports is never emailed again.
- Bounce and complaint handling (Resend webhooks), repeated bounces suppress the address.
- Transactional framing + physical address + unsubscribe to stay within CAN-SPAM. GDPR posture, the sender supplies the email of a person they know and is sharing specific requested content, mirror the existing data-minimization stance and do not retain invited addresses beyond the pending invite + suppression list.
- Pending invites expire (same 30-day TTL as normal shares), an unaccepted invite is swept.

---

## Scope and phasing

Build (its own phase, after the experiment work or in parallel since it is mostly relay + a new page + email, not export/import),
1. Resend domain verification for research-os.app (Grant, DNS; prerequisite).
2. Relay PENDING INVITE support, park a bundle keyed by invite id / email hash, the signed send-invite endpoint, the accept-fetch endpoint, rate limit + suppression + expiry.
3. The `/accept/<inviteId>` page, claim the email via the existing wizard, decrypt with the fragment key, file via the existing import flow, ack.
4. The branded Resend email template (BeakerBot, footer, unsubscribe).
5. Send-side UI, when the recipient is not on ResearchOS, replace the dead-end with "Invite them and share this," including the lower-assurance-channel note.

Out of scope, inviting many addresses at once (single-recipient invite first); any non-note entity invite (notes first, mirrors the main feature's tiering).
