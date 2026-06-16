# Department Commons architecture

Date 2026-06-15. Status proposal, not built. House voice no em-dashes, no emojis, no mid-sentence colons.

## Thesis

A Department Commons is a curated, governed shared library that sits one level above labs in the membership tree (member, lab, department, institution). The department publishes structured resources (standardized methods and protocols, Data Hub reference tables, sequence/plasmid/strain collections, molecules, calculators, templates, controls, validated analysis pipelines). Every member lab inherits them, can search them, and can pull them into its own work. Resources stay structured, searchable, embeddable, and versioned. They are never a file dump.

The claim this doc defends is that the Commons is cheap because it is almost entirely a re-composition of primitives that already ship. The org tier already has a department layer with its own admin, invites, and billing. The app already has a cross-user shared library (`users/public/`), a portable structured-object bundle engine, an embed-and-pin system, and a read-time decoration for not-mine items. The Commons is those pieces wired into a department-owned namespace.

## 1. The org-owned namespace

### Where it sits in the hierarchy

The department already exists as a real entity. `frontend/src/lib/dept/dept-create.ts:24` creates a department and derives its admin owner key server-side from the session, and `frontend/src/lib/invites/invite-tokens.ts:43` already carries `InviteLayer = "lab" | "dept" | "institution"` so a department admin can mint membership tokens for member labs with the same primitive labs use for members. The Commons is not a new entity. It is a new kind of content owned by the department entity that already governs those labs.

The publisher is the department admin (the same role `dept-admin-membership.ts` tracks). The consumers are every lab whose head accepted a `layer: "dept"` invite token. Membership in the department is therefore the subscription. There is no separate Commons opt-in to build.

### Where it lives on disk (Model B, recommended default)

The chosen default is Model B, the institution-managed-storage model. The department publishes into a single department-shared cloud folder (a OneDrive/Dropbox/iCloud/SharePoint folder the institution provisions and pays for), and every member lab mounts that folder as a read-only library source. This mirrors exactly how a lab today mounts one shared cloud folder as its workspace. The Commons is a second mounted folder, opened read-only.

The on-disk layout reuses the existing `users/public/` shape verbatim, lifted up one level into the department folder. Today `users/public/methods/{id}.json` holds cross-user shared methods (AGENTS.md:199, `frontend/src/lib/local-api.ts:2409`) and is read with a `public:` ref scope (`frontend/src/lib/references.ts:206` `methodRefId`, `splitMethodRefId`). The Commons folder is the same idea, namespaced to a department:

```
{deptCommonsRoot}/
  commons/
    methods/{id}.json
    datahub/{id}.{loro,json}
    sequences/{id}.gb + {id}.meta.json
    molecules/{id}.mol + {id}.meta.json
    calculators/{id}.json
    notes/{id}.md           (templates)
    _commons_manifest.json  (catalog + version + governance state)
    _counters.json
```

Because the publish store is structurally `users/public/` one directory up, the read path is the existing public-scope read path pointed at a different root. The owner of every Commons record is the sentinel `"dept:{deptId}"`, the exact analogue of today's `owner: "public"` sentinel.

### How a lab subscribes and inherits

A lab head who accepts the `layer: "dept"` invite gets `dept_admin_of` style settings written (mirroring `dept-create.ts`) plus the path to the department Commons folder. The session-effects layer (`frontend/src/lib/lab/lab-session-effects.ts`) gains a parallel mount step that opens the Commons folder read-only and registers it as a third work source alongside the member's own folder and the lab folder. Inheritance is automatic. A new lab joining the department sees the full Commons on first sync, because it is just another mounted read-only source, not a per-lab copy.

### The dept storage-pool alternative

The alternative to institution-managed storage is the department storage-pool model, where the Commons lives inside the department's own billed storage pool rather than an institution OneDrive. `frontend/src/lib/dept/plan.ts:59` already derives a department rate from pooled storage across member labs, so a Commons quota line item is a natural addition to that plan builder. Model B is the recommended default because it requires zero new billing wiring (the institution already owns and pays for the folder) and because read-only-mount is the cheapest possible distribution. The storage-pool model is the upgrade path once departments want the Commons metered and governed inside their own plan.

## 2. How each object type plugs in

Every Commons resource is an object that already has three things the app relies on: a portable serialization, an embed renderer, and a deep-link ref. The Commons adds no new object model. It reuses the object-export and embed primitives:

- The portable bundle engine (`frontend/src/lib/sharing/bundle.ts`) already serializes methods, notes, projects, and embedded objects into an RO-Crate-in-BagIt bag, and `frontend/src/lib/sharing/embedded-object-collect.ts` already walks a note and packs every embedded object (sequence as GenBank, molecule as molfile, method body, Data Hub as a frozen snapshot or full dataset) into that bag. Publishing to the Commons is collecting an object into this bundle and writing it under `commons/`. Pulling into a lab is the existing import side (`embedded-object-import.ts`, `method-transfer.ts`, `sequence-transfer.ts`, `calculator-transfer.ts`) with full id-remap, which already exists per type.
- The embed layer renders any Commons object inline. `frontend/src/components/embeds/ObjectEmbed.tsx:76` dispatches by `descriptor.type` to per-type renderers (method, sequence, molecule, datahub, note, project, collection). A Commons object is embedded by the same `[name](deepLink#ros=view)` markdown the app already produces (`frontend/src/lib/references.ts` `objectEmbedMarkdown`), with a Commons ref scope analogous to the `public:` scope. The Pin/Freeze machinery in `ObjectEmbed.tsx` (lines 414 to 506) gives a lab a frozen snapshot of a Commons resource as of a chosen version for free, which is exactly what a published protocol embedded in a lab notebook wants.
- The insert and Send to flows already exist (`SendToNotePicker.tsx`, `SendReferencePicker.tsx`, the BeakerBot insert bridges). A Commons tab in the object picker surfaces department resources next to the lab's own, so pulling a reference table or plasmid into a note is the same gesture as inserting a local one.

### Which object types light up first

Recommend methods and protocols, Data Hub reference tables, and the sequence/plasmid repository as the first wave, in that order.

- Methods and protocols are first because the cross-user public-method path is already built end to end (`users/public/methods`, the `public:` ref scope, `is_shared_with_me` read-time decoration at `local-api.ts:3105`, and `method-transfer.ts` for full structured transfer). A standardized department protocol is the single highest-value Commons resource and the lowest-cost to ship, because the publish and consume code largely exists.
- Data Hub reference tables are second because `embedded-object-collect.ts` already supports a frozen-snapshot or full-dataset publish (decisions D8), and the Data Hub figure source already registers as an embed (`frontend/src/lib/datahub/figure-source.ts:206`). A department reference table (standard curve, control values, validated parameter set) embeds and pins cleanly.
- The sequence/plasmid repository is third because the sequence transfer adapter (`sequence-transfer.ts`) and the GenBank-plus-meta on-disk shape already exist, and a shared plasmid/strain collection is a known high-demand shared asset. Molecules, calculators, and note templates follow on the same seams (`calculator-transfer.ts` already serializes a calculator for transfer).

## 3. Versioning, official standard, and governance

The Commons manifest (`_commons_manifest.json`) is the one new governance record. It holds, per resource, a version number, a status (`draft | official | deprecated`), a mandatory/optional flag, a publisher, a published-at timestamp, and an inherited-by-default flag. Each field hooks into existing code:

- Versioning reuses the embed pin and staleness machinery. `ObjectEmbed.tsx:447` already compares a pinned snapshot identity against the live source identity and shows a quiet source-changed-since-you-froze-this badge with View current and Re-freeze actions. A Commons resource that the department republishes is exactly a source that moved on. A lab that embedded version 2 of a protocol sees the stale badge and can pull the new version deliberately. Nothing silently rewrites their notebook.
- Official standard is a status field on the manifest entry. An official resource is published by the department admin and shown with an official badge in the picker and the embed frame. Promotion is an admin write to the manifest.
- Deprecation is a status the read path honors. A deprecated resource stays readable (so existing embeds do not break, consistent with the no-soft-locks rule) but is hidden from the picker and flagged in any embed of it, mirroring the not-available card in `ObjectEmbed.tsx:132`.
- Mandatory versus optional is a manifest flag. A mandatory resource is auto-listed in every member lab and surfaced in onboarding. An optional resource is search-and-pull only.
- New-lab inheritance is automatic by construction, because the Commons is a mounted read-only source. A lab joining the department reads the live manifest on first sync, so it inherits the current official set with no per-lab provisioning.
- Usage analytics reuse the existing audit pattern. `frontend/src/lib/lab/pi-audit.ts` already emits append-only audit entries (for example method-transient-read), so a Commons pull or embed can append a `commons-pull` entry that the department admin aggregates into a most-used-resources view. The publish and curation actions reuse the `pi-actions.ts` admin-action surface.

Governance authority is the department admin role that already exists (`dept-admin-membership.ts`). No new permission model is required. Publish, promote, deprecate, and set-mandatory are admin-only writes to `commons/`. Member labs have read-only mounts, so the filesystem itself enforces the read-only contract in Model B.

## 4. The key decision, read-only top-down versus labs-contribute-upward

The decision is whether the Commons is read-only top-down (the department publishes, labs only consume) or whether labs can contribute upward (a lab submits a resource and the department promotes it to official through an approval queue).

Read-only top-down tradeoffs. Strongly cheaper, because the read-only mount needs no write path from a lab into the department folder, no submission inbox, no approval queue, and no provenance merge. It maps one to one onto the existing public-methods read model and the read-only source mount. The cost is that it under-serves the real social pattern in a department, where good protocols usually originate in one lab and spread, so a pure top-down model makes the admin author everything and tends to go stale.

Labs-contribute-upward tradeoffs. Matches how departments actually standardize, and the submission and import plumbing already exists, because a lab submitting a resource is the existing cross-boundary share targeted at the department entity (the same `bundle.ts` plus relay path that shares a method to a person today, addressed to `dept:{deptId}` instead of a username). The genuinely new pieces are a submission queue record, an admin approve/reject UI, and a promote step that copies an approved bundle into `commons/` and stamps it official. The cost is moderate, and it adds a moderation surface the admin must staff.

Recommendation. Phase it. Ship Phase 1 as read-only top-down, because it is nearly free and proves the namespace, the mount, the embed, and the inheritance with the lowest risk. Add labs-contribute-upward as Phase 2 once Phase 1 is in real use, implemented as a submission queue on top of the existing share-to-entity path, with the department admin as the single approver. This sequencing gets a working Commons in front of departments fast, then layers the social contribution loop on top without reworking the foundation, because promotion is just a publish (a Phase 1 primitive) triggered by an approved submission.

## 5. Build cost, reuses X needs net-new Y

Phase 1, read-only top-down, methods first.

- Reuses. The department entity, admin role, and `layer: "dept"` invite tokens (`dept-create.ts`, `invite-tokens.ts`). The `users/public/` cross-user library shape and the `public:` ref scope (`local-api.ts`, `references.ts`). The portable bundle and embedded-object collect/import engines (`bundle.ts`, `embedded-object-collect.ts`, `*-transfer.ts`). The embed render, pin, and staleness system (`ObjectEmbed.tsx`). The read-only source mount pattern (`lab-session-effects.ts`, `lab-work-source-localapi.ts`). The audit-append pattern (`pi-audit.ts`).
- Net-new. A Commons read source that mounts the department folder read-only and exposes a `dept:{deptId}` owner scope (small, modeled on the existing public scope). A `_commons_manifest.json` schema plus a read-time decorator that tags Commons items the way `is_shared_with_me` tags shared items. A publish action for the admin (collect object into bundle, write under `commons/`, manifest entry). A Commons tab in the object picker and search index entry type (the global search already supports adding an entry type, see the `note` type addition in AGENTS.md). An official/deprecated badge in the embed frame and picker.

Phase 1 is therefore mostly glue. The hard parts (structured serialization, id-remap import, embed rendering, versioned snapshots, the entity and its admin) are all done.

Phase 2, labs-contribute-upward.

- Reuses. The cross-boundary share path and relay, addressed to the department entity. The Phase 1 publish primitive as the promote step.
- Net-new. A submission queue record under `commons/_submissions/`, an admin approve/reject UI on the `pi-actions` surface, and a provenance line on a promoted resource recording the originating lab.

## 6. Risks and open questions

- Encryption. The lab tier seals shared data under a lab key (`frontend/src/lib/lab/lab-key.ts`, `encryptLabData`, `distributeLabKey`). A department Commons spans many labs that do not share a lab key, so the Commons cannot reuse a single lab key. Model B sidesteps this for the common case, because the department folder is institution-managed shared storage protected by the cloud provider and the OS ACL, not by a ResearchOS lab key, so a read-only Commons can be cleartext-at-rest the way `users/public/` is today. If a department wants the Commons E2E sealed across labs, that needs a department key distributed to each member lab head via the existing `sealToRecipient` sealed-box, which is a real but bounded extension. Decision needed on whether Commons-at-rest encryption is in scope for v1 or deferred.
- Search across the namespace. The global search index is per-folder today. A Commons search must index the mounted Commons source as an additional source. The index already supports adding an entry type and a fuzzy tier (AGENTS.md global-search note), so this is additive, but the index lifecycle (when to re-index after a department republish) is an open question.
- Local-first conflict. The Commons is read-only for labs, so there is no write-conflict surface for consumers, which fits the local-first model cleanly. The only writer is the department admin, single-writer into the department folder, so there is no multi-writer merge to solve in Model B. A lab that wants to customize a pulled resource pulls a copy into its own folder (the existing import id-remap), which decouples the lab copy from the Commons original, the correct local-first behavior.
- Permissioning. Read-only is enforced by the mount in Model B, but a defense-in-depth check should also gate writes at the API layer so a lab cannot write a `dept:{deptId}`-owned record even if the mount is misconfigured. This is the same owner-sentinel guard the public store already uses.
- Offline. A lab offline cannot reach a freshly republished Commons version. The pin/staleness model already handles this gracefully, the lab keeps the last-synced version and sees the stale badge when it reconnects.
