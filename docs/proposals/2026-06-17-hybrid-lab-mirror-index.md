# Hybrid lab mirror: index everything, eager-light, heavy on-demand

Design, 2026-06-17. Decision by Dr. Grant Nickles: the lab mirror that powers a
PI's lab-wide search and the BeakerBot lab-scoped read should NOT eagerly store
every record's full content in the cloud. It should index everything cheaply,
store light content eagerly, and fetch heavy content on demand. House voice (no
em-dashes, no emojis, no mid-sentence colons).

## Where we are today

The member-side lab mirror (live on main) pushes encrypted snapshots of all
lab-work records to an R2 mirror so the PI can read and search the whole lab. It
already does several good things:

- It mirrors only LAB-WORK records, never the whole local folder, never personal
  or non-lab data.
- It never mirrors binary attachments (images, PDFs, the per-task Files folders).
  Those stay on the member's disk.
- Everything is lab-key ciphertext, so R2 is server-blind.
- It deduplicates by sha256, so only changed records re-upload.

The gap: it pushes the FULL content of every record eagerly, including big Data
Hub tables (their full rows). For small text records (tasks, notes, methods,
purchases, inventory, sequence and phylo and molecule metadata, the experiment
results and notes markdown) that is a few KB and is fine to store eagerly. For a
large data table it is the one place eager-everything actually costs real cloud
storage.

## The hybrid model

Three tiers instead of one.

### 1. The index (always, for everything)

Every sync run writes ONE compact, encrypted index per member, alongside the
content blobs. The index is the keystone. It holds one entry per record:

```
{ recordType, recordId, owner, title, updatedAt, tags?, sizeBytes, preview }
```

- `title` is the human name (task name, note title, table name, etc.).
- `preview` is a short text snippet (first ~200 chars of the body or markdown),
  enough for a search hit to show context.
- `sizeBytes` is the content size, so the reader knows whether the full content
  is in the eager mirror or must be fetched on demand.

The PI's lab-wide search reads only these per-member index files (one small blob
per member), so search is instant and COMPLETE across the lab without pulling a
single content blob. This is what makes "index EVERYTHING in the whole lab" true
and cheap.

### 2. Eager light content (the default)

Records whose content is at or below a size threshold push their full content
eagerly, exactly as today. Opening one is instant because it is already mirrored.
This covers the vast majority of records.

### 3. Heavy content on demand, via a member-approved request

Records above the threshold (big Data Hub tables, unusually large sequences) push
their INDEX entry and preview eagerly but NOT their full content. The PI sees the
record exists, its name, owner, size, and preview, and can search and find it. To
see the FULL content, the PI sends a request.

The request is an offline-async handshake, so nobody has to be online at the same
time:

1. The PI opens a heavy record that is not in the cloud and hits "request full
   table". A request lands in the owning member's queue (relayed, encrypted).
2. The next time that member opens the app, they see "Dr. X requested your table
   Y" and approve. Their client uploads that one record's full content.
3. The PI is notified and opens it.

APPROVE SEMANTICS (Grant 2026-06-17): approve-only, but visible. The member
controls WHEN the upload happens and that it is a deliberate act, not WHETHER the
PI may see it. There is no silent decline. A pending request stays visible to the
member until honored, and the PI sees it as pending. This keeps the locked
principle intact (the PI role grants read over all lab data) while still putting
the member in the loop and making a heavy upload an explicit, member-aware act
rather than background magic.

Optional optimization (later): the member's client may also trickle heavy content
up on the idle periodic cadence so a request is often already satisfied before it
is made. The request/approval path is the primary mechanism; the trickle is a
latency optimization, not a requirement.

This keeps oversight reliably available for everything. Light content is instant;
a heavy item is one approved request away, even if its owner was offline when the
PI asked.

## Build sequence

- Phase A, the index. Add the per-member encrypted index to the sync engine and a
  reader for it. Wire the PI lab-wide search (and the lab-scoped read) to search
  the index instead of pulling content. Highest value, lowest risk, unlocks
  complete cheap search immediately. The eager content push stays as-is in this
  phase, so nothing regresses.
- Phase B, size-gating. Stop pushing full content for records above the threshold
  (push index plus preview only). The PI search and read now show heavy records by
  their index entry plus preview, with the full content not yet present.
- Phase C, the request/approval handshake. The PI can request a heavy record; the
  request is relayed to the owning member; the member approves on their next
  session and their client uploads that one record; the PI is notified and reads
  it. Approve-only but visible (no silent decline, pending requests stay visible to
  both sides). The optional idle-cadence trickle upload is a later optimization on
  top of this.

## Open parameters (recommended defaults)

- Heavy threshold: 256 KB of record content. Below it, eager. Above it,
  index-plus-on-demand. (A big Data Hub table crosses this; a text note never
  does.)
- Preview length: 200 characters of plain text.
- Deferred heavy-upload cadence: on the periodic safety-net run only (every 5
  min), never on the debounced on-write path, so editing a giant table does not
  re-push it on every keystroke.

## What does not change

- Still only lab-work records, never the whole folder, never personal data.
- Still no binary attachments in the mirror.
- Still lab-key ciphertext, server-blind R2, sha256 dedup.
- The PI read stays role-gated and audited; the member transparency panel still
  shows every access. The index is covered by the same audit and transparency.
