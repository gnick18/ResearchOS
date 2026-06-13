# Phone push notifications (a real buzz, not a synced list)

Status: proposal, not built. Author: orchestrator (notifications lane), 2026-06-12.

## The problem

The phone notification channel shipped today (phase 3) delivers a synced LIST,
not an operating-system push. The laptop seals the user's phone-routed
notifications into a "notifications" relay snapshot, and the companion shows that
list when it polls (and when the laptop was open to publish). Two limits fall out
of that:

1. The laptop must be open for anything to reach the phone. A notification
   created while the laptop is closed never gets published, so the phone never
   sees it until the laptop comes back.
2. The phone does not buzz. The user has to open the companion to find out
   something happened.

For a bench tool that is the right default for most things (the phone is a
glance, the laptop is the record). But some categories genuinely want a buzz,
for example a shift alert, a 1:1 reminder, or a lab head flagging a result. This
proposal is how we get a real push without giving up the local-first and
end-to-end-encrypted posture that the rest of the product holds.

## What we already have

- The companion is an Expo app and already depends on `expo-notifications`
  (~0.32.17). It fires LOCAL notifications today (the demo timer pop). Remote
  push is the same library plus a device push token and a server that sends to
  the Expo Push Service (which fans out to APNs and FCM for us).
- Device pairing already binds a phone to a user with an Ed25519 device key and
  an X25519 seal key, and the relay already holds only sealed bytes. The push
  token is one more per-device value to register alongside those keys.
- Notifications are account-only on the phone already (pairing requires an
  account), so a push token is an account-tier value, consistent with the
  existing gating.

## The core tension and how we resolve it

A push has to be sent by a server, and that server (and Expo, and APNs/FCM) sees
the push payload. Our content is end-to-end encrypted, so the push payload must
NOT carry research content. The resolution is the standard "wake and fetch":

- The push payload carries only a generic, content-free body, for example "New
  activity in your lab" plus a category hint and the data needed to fetch. It
  never contains the notification text, an item name, or any lab data.
- On receipt the companion fetches the sealed "notifications" snapshot it already
  knows how to open, decrypts it locally, and shows the real content from the
  device. The plaintext only ever exists on the phone.

This keeps the relay and the push services blind, exactly like the snapshot model
today. The buzz is generic, the content is local.

## Who triggers the push

This is the real design question, and it splits into two cases.

### Case A: the laptop is open (easy)

The laptop already publishes the snapshot when a phone-routed notification lands.
It can additionally POST to a small "send push" endpoint at that moment. The
endpoint looks up the user's registered device push tokens and sends a generic
push via the Expo Push Service. This is a modest extension of the existing
publisher and covers "I am at my laptop and want the phone to buzz too."

### Case B: the laptop is closed (the actual goal)

For a notification created while the user's laptop is closed, something
server-side has to both publish the sealed snapshot AND send the push. Two of our
notification sources can do this without the laptop:

- Cross-user events (someone shares an item with you, a lab head flags your
  result). These already flow through the sharing relay, so the relay is the
  natural place to also seal-and-publish the recipient's snapshot and send the
  push. This is the same infrastructure the deferred "phase 2.5 sender-triggered
  email" needs, so the two should be designed together.
- Scheduled events (shift alerts, reminders). A scheduled server task can compute
  due reminders and push them. This overlaps with the standing Accountant and
  Maintainer scheduled-task roles.

Case B is where the cost lives, because it means the relay (or a Vercel function)
gains the ability to compose a recipient's snapshot, which today only the
recipient's own laptop can do. The snapshot is built from the recipient's data,
which the server does not hold in plaintext. So Case B realistically only covers
notifications whose content originates server-side already (the share event text,
the reminder title), not a full re-derivation of the recipient's local data. That
is fine: those are exactly the categories that want a buzz.

## Privacy and ops

- Push tokens are per-device identifiers. Store them with the device record
  (account-tier), the same place the device public keys live. They are not
  research data and never leave with a folder export.
- The Expo Push Service, APNs, and FCM are all free at our scale. No new paid
  dependency.
- A revoked or unpaired device drops its token. A failed send is logged and
  retried, never surfaced as a user error (a missed buzz is not a failure state).
- The push payload must be reviewed to guarantee no content leak (generic body
  only). This is the single most important correctness check.

## Scope and phasing

Recommended order, smallest useful slice first:

- Phase P1 (laptop-open buzz). Register the Expo push token at pairing, add the
  "send push" endpoint, and have the existing laptop publisher call it. Generic
  payload, tap-to-open, the companion fetches the snapshot it already reads.
  This is mostly additive and proves the wake-and-fetch path end to end.
- Phase P2 (cross-user offline buzz). Co-designed with phase 2.5 email. The
  relay seals-and-publishes the recipient snapshot and sends the push for
  cross-user events, so a share buzzes the phone with the laptop closed.
- Phase P3 (scheduled offline buzz). A scheduled task pushes due shift alerts and
  reminders, reusing the standing scheduled-role infrastructure.

Quiet hours and the per-category phone toggle already exist in the preferences
resolver, so a push must run through the same gate before it sends. A category
the user did not route to the phone must never buzz.

## What this is not

This is not a redesign of the snapshot list. The synced list stays as the
low-stakes default for everything. Push is the opt-in escalation for the few
categories that warrant a buzz, layered on top of the same sealed snapshot the
phone already reads. House voice and the account-only gating are unchanged.
