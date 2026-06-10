# Lab archive and PI data continuity

Status: DRAFT for sign-off. Captures the model shaped with Grant on 2026-06-10.
No code yet. House style: no em-dashes, no emojis, no mid-sentence colons.

## Why this exists

ResearchOS is local-first and every member owns their own folder. That is the
whole pitch, your data lives on your disk, not on someone's server. But it leaves
a real hole for a lab head (PI), and it is the one thing a centralized notebook
like LabArchives gives a PI for free.

A PI cannot currently guarantee they retain the lab's records. Each student's
data sits on that student's laptop, and at graduation it walks out the door. NIH's
Data Management and Sharing Policy requires retention (commonly three or more years
past the close of the grant, and many institutions require longer). "I hope my
former student still has the hard drive" is not a compliance answer.

So the local-first model needs a deliberate answer to: how does a PI prove, years
later, that the lab's data is retained and intact, when the people who made it have
left? This feature is that answer. It is also the strongest justification for the
optional paid cloud tier the LLC already built (see METERED_STORAGE_PRICING.md and
the lab billing pool).

## The reframe: system of record for retention

The instinct is to call this "lab cloud backup." That is too small and it trips on
the trust-flip ("wait, you store all our data now?"). The better framing, which is
also more accurate:

ResearchOS is the system of record for data retention, agnostic to where the bytes
physically live. We complement institutional storage, we do not replace it.

A PI gets one dashboard that proves every member's data is accounted for and
retained for NIH, whether the bytes sit on our R2, on a hard drive in a desk
drawer, or on the university's research drive. For most labs, most of the time, we
do not hold the bytes at all. We track them, with provenance. That sidesteps the
trust worry honestly, because it is true.

## Ownership and consent (the easy part)

Research data created in a lab is, in the normal academic arrangement, the
institution's property, with the PI as the steward and custodian. This is
especially clear on grant-funded work, where the awardee institution is
responsible for retention. We state it that way everywhere, "institutional
research data, the PI is the custodian," not "your work belongs to the PI
personally." It is more correct, it is harder for a member to dispute, and it is
literally why the retention requirement exists.

Consent is collected once, at lab join, as a lab membership agreement the member
accepts:

- Plain-language acknowledgment that research data created in the lab is
  institutional or lab data, that the PI is the custodian, and that finished work
  may be archived and retained for compliance.
- Recorded the right way: a timestamp, the exact version of the terms accepted,
  and the member's identity signature. That recorded acceptance is consent of
  record, which is legally meaningful evidence, not a pinky-swear.

We are not a law firm and must not pretend to be. So:

- We ship a sensible default agreement template, editable by the PI.
- We show a clear note that it is a template, not legal advice, and that the lab
  should check it against the institution's own policy.
- We let the PI attach the institution's actual data or IP policy if they have one.

The real legal force comes from the institution's existing policies and the grant
terms. Our job is to record the acknowledgment and the provenance, not to invent
new law. Do not promise "legally binding" anywhere in the UI or copy.

## Lifecycle model

### Lab storage posture (declared up front)

When a lab is set up, the PI declares the lab's storage posture, because it changes
the defaults:

- ResearchOS cloud: the lab relies on our R2 for continuity and retention.
- Institutional drive: the lab already lives on a shared university or network
  drive (some labs get dozens of free terabytes). ResearchOS is the working layer
  and the retention registry, the bytes stay on the drive.
- Mixed: some of each.

### Active members

While a member is active, their finished or stale experiments back up to the lab's
chosen retention target automatically, so the PI never has to remember to do
anything and continuity is guaranteed by default.

- For a ResearchOS-cloud lab, that target is R2 (lab-paid).
- For an institutional-drive lab, the PI may already have access through the shared
  drive, so R2 is not needed for live continuity. ResearchOS records the retention
  attestation instead of holding the bytes.

What gets archived is a frozen, point-in-time snapshot of finished work, not a live
sync. Immutability is cheaper and it is what compliance actually wants, a record of
what the experiment was at the time.

Triggers for "finished":
- Auto-surface candidates that have not been touched in N months.
- Explicit "mark finished and archive" by the member or the PI.

### Offboarding (graduation or departure)

When a member leaves, the PI records where that member's data is retained. This is
the key decision point, and it is per departing member.

Targets:

1. ResearchOS R2. We hold the bytes, the lab keeps paying, the data stays instantly
   accessible.
2. Physical hard drive. The PI confirms they hold a full-folder copy on physical
   media. We store an attestation, not the bytes, and the R2 cost drops.
3. Institutional research drive or network storage. The PI confirms the data lives
   on the university drive. We store an attestation with the location, again no
   bytes, no R2 cost.

For everything except R2 we store an attestation, not the bytes: location,
custodian, date, and a SHA-256 manifest of the files. The manifest is the integrity
anchor. It lets the PI later prove the data is intact, or re-point ResearchOS at the
drive to re-verify the hashes still match, which is a bit-rot and missing-file check
for compliance (a later enhancement, not v1).

The physical handoff and the institutional copy should happen regardless of what we
store. We are recording that retention occurred and proving its provenance.

## Seamless per-user export

The export is the enabler for every non-R2 path. One action for a lab head:
"Export this member's full folder." It produces a complete, portable copy of the
member's data that the PI drops on a hard drive, the institutional drive, or keeps.
Any R2 archive is also exportable to physical later, so R2 versus drive is only ever
a cost lever, never lock-in.

One mechanism, three destinations.

## Retention registry (data model sketch)

A per-lab registry, owned by the PI, with one entry per archived unit (per member,
or per member-and-project). Each entry records:

- member identity, the archived unit, archived-at date, archived-by
- retention target (r2 | hard_drive | institutional_drive)
- location label (drive name, institutional path, or "ResearchOS R2")
- SHA-256 manifest of the files (always, even for R2)
- the membership-agreement version the member accepted, and when
- retention clock: a policy period the PI sets (for example seven years), with the
  computed eligible-for-disposition date surfaced

The registry is the dashboard. It is what a PI shows an auditor.

## Open decision: encryption and access (for R2-held data)

Grant did not pick this yet. It only matters for the R2 path, where we actually hold
bytes. The continuity requirement either way: an R2 archive must be unlockable by
the lab, never dependent on a departed member's key or device.

- Recommended default: sealed to the lab key, with the PI's access independent of
  the departed student's key. We store ciphertext, we cannot read it, the lab holds
  the unlock. Preserves the trust-flip. Requires rock-solid lab-key recovery, or a
  lost lab key means a lost archive.
- Alternative: server-readable, lab-membership-gated (like the Option-B collab
  model). Easiest recovery, enables cross-lab search, survives any key loss, but
  archived data is readable by us, which dents the trust-flip.

Recommendation stands at sealed-to-lab-key unless cross-lab search or bulletproof
recovery turns out to matter more than the brand promise.

## Cost model

Archive storage is a new, cheap dimension on the lab plan, paid by the PI through
the existing lab billing pool. R2 is roughly 0.015 dollars per GB-month, and frozen
archive data is a candidate for an even cheaper cold or infrequent-access class. The
attestation paths (hard drive, institutional drive) cost us nothing but the registry
row. So a lab pays R2 only for active people plus the graduates the PI chooses to
keep hot, and everyone else converts to a free attestation with a clean export. The
cost circuit breaker still applies.

## Positioning and copy guidance

- Lead with the PI guarantee: your lab's data is retained and provable for NIH, even
  after a student graduates.
- Say plainly that ResearchOS tracks retention wherever the data lives, and that for
  most labs we do not hold the bytes, we hold the proof.
- Do not imply we own or monetize lab data. The archive is lab-controlled,
  lab-paid, lab-deletable, and exists for the lab's own compliance.
- Institutional-data, PI-as-custodian framing, never "belongs to the PI personally."
- No "legally binding" claims about the membership agreement.
- House voice (see the branding billing-facts file for the same rules).

## Phasing (proposed, smallest useful slice first)

1. Retention registry plus the membership agreement: the per-lab registry data model,
   the join-time agreement (default template, recorded acceptance), and the PI
   dashboard that lists members and their retention status. No bytes moved yet, this
   alone gives a PI a compliance dashboard and is the spine everything hangs on.
2. Seamless per-user full-folder export plus the attestation paths (hard drive,
   institutional drive): the PI can export and record retention. Still no R2.
3. R2 archive for active members and the keep-on-R2 offboarding option, including the
   encryption decision and lab-key recovery.
4. Later enhancements: auto-surface stale-finished candidates, re-verify a drive
   against its manifest, retention-clock disposition reminders, cross-lab search if
   we went server-readable.

## Open questions for Grant

1. Encryption for R2-held archives: sealed-to-lab-key (recommended) or
   server-readable? Decide before phase 3.
2. Retention clock: do we ship a default period (for example seven years) and let
   the PI override, or require the PI to set it per lab? What is the default.
3. Phase 1 scope: is the registry-plus-agreement dashboard the right first slice to
   ship and put in front of a real lab (your mass-spec colead), before any bytes
   move?
4. Does the membership agreement need to be per-institution (template varies by
   school) or is one editable default enough to start.
