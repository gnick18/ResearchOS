# BeakerBot x Network integration, design doc

Date 2026-06-19. Status: proposed (two tools building in parallel; this doc is the design of record for sign-off). Memory: `[[feedback_network_purpose_seamless_sharing]]`, `[[project_cross_boundary_sharing]]`, `[[project_researcher_social_layer]]`.

## The gap

The `/network` feature is the researcher discovery and one-step sharing surface. Its own pitch is "the shortest path from your data to a collaborator, share a method, sequence, dataset, or figure straight to them, with no files or email needed." Today none of it is reachable from BeakerBot. Every sharing path is GUI only (`UnifiedShareDialog`, the "Send to..." pickers, the `/network` page). The only adjacent AI tools are `find_across_lab` (searches your OWN lab internally) and `dept_invite` (department tier). So a user cannot say "find people working on X and send them my dataset" in chat.

The building blocks already exist, so this is a thin tool layer, not new infrastructure:
- Collaborator search: `GET /api/directory/search?q=` and `/api/directory/public-search` (wrap `searchPublicProfiles` / `searchProfiles` in `lib/sharing/directory/db.ts`). The directory deliberately NEVER returns raw emails to the client.
- Sharing transport: `lib/sharing/relay/client.ts` (the existing send path the GUI already uses).
- Paid gate: `isProduceEntitled` (outbound sharing is paid; receiving is always free).

## Vision

Turn the network from a place you visit into something BeakerBot drives. Two tools, mirroring the proven lab-head copilot pattern (thin tools over existing engines, a read and a consent-gated action, the tool owns the facts, the model only narrates).

## Tool 1: find_collaborators (read-only)

Discovery. Never writes, never sends.

- Args: `{ query: string, institution?: string, limit?: number (default ~8) }`.
- Calls the client-callable public search endpoint (`/api/directory/search`), NOT the server db function.
- Returns matched researchers with the fields the directory already exposes publicly: display name, institution, research area or handle, and an OPAQUE recipient handle that `share_with_researcher` can consume. It does NOT return raw emails (the directory never gives them out), so the model never sees or compiles personal contact data.
- Never fabricates people. Returns an empty list cleanly when nothing matches. Degrades to a clear "could not reach the researcher directory" when the endpoint errors.
- BeakerBot narrates the matches and stops. It never ranks people by quality or makes claims about a researcher beyond the directory facts.

Example: "Who works on fungal comparative genomics?" or "Find people at UW-Madison studying CRISPR."

## Tool 2: share_with_researcher (consent-gated action)

The one-step send, driven from chat. This is the sensitive tool, so the design is conservative.

- Args: `{ recipient: string, objectType: string, objectId: string, message?: string }`.
- `recipient` provenance rule (HARD): the recipient may ONLY be an opaque handle returned by `find_collaborators` in this conversation, or an email the USER themselves typed into chat. A recipient that came from any tool result, document, web page, or other observed content is refused. This blocks an injected "send to attacker@x" from ever resolving.
- Never auto-sends. `execute` resolves the recipient and the object and returns a PREVIEW payload (who, which object, the message). The actual send fires only through the harness action-consent path, the same gating every other write tool uses. There is always a visible confirm step before anything leaves the device.
- Paid gate: outbound sharing is paid (`isProduceEntitled`). If the user is not entitled, the tool returns a clear "this needs a paid plan" result with the upsell and sends nothing. Receiving is always free, and the confirmation says so to the recipient.
- Reuses the existing share transport (`lib/sharing/relay/client.ts`). It does NOT invent a new send path or a new server route.
- On success, a concise confirmation: recipient, object, and that receiving is free for them.

Example: "Send my phylogenetics method to Dr. Gluck-Thaler" (after `find_collaborators` surfaced him), BeakerBot previews the send, the user confirms, it goes.

## Safety and honesty rules

- Consent and preview before any send. Never auto-send. This satisfies both the assistant safety rule on sending content on a user's behalf and the product expectation that sharing is deliberate.
- Recipient provenance restricted to search results or user-typed input. Observed content can never become a recipient.
- No PII compiling. The model never sees raw emails; the directory hands out opaque handles, and resolution happens server-side at send time.
- Paid gate respected. Sending is paid, receiving is free, stated honestly.
- No end-to-end claim. One-time send is end-to-end, live collab is not (the relay merges edits). These tools do the one-time SEND path, which is end-to-end, but the copy never overclaims.
- BeakerBot never interprets. It surfaces directory matches and the share outcome as facts. It does not judge researchers or recommend who to contact beyond what was asked.

## Integration points (real handles)

- Search: `src/app/api/directory/search/route.ts` (and `public-search`), over `searchPublicProfiles` in `src/lib/sharing/directory/db.ts`.
- Send: `src/lib/sharing/relay/client.ts`.
- Entitlement: `isProduceEntitled` (the outbound paid gate).
- Tool home: a new `src/lib/ai/tools/network-tools.ts`, registered into the general BeakerBot tool set (not lab-head), `find_collaborators` always available, `share_with_researcher` gated like the other action tools.

## Decisions for Grant

1. Recipient surface. Restrict `share_with_researcher` to directory handles plus user-typed emails (recommended, in this doc), or also allow a lab member by name. Recommendation: directory + user-typed only for v1, add lab members later.
2. Object scope for v1. Allow all shareable types (note, method, sequence, dataset, figure) from the start, or start with one (method) and expand. Recommendation: all types, since they share one send path.
3. Free-tier behavior. On a send attempt by a free user, upsell-and-stop (recommended), versus letting the preview build but blocking at confirm. Recommendation: upsell as early as the preview so there is no dead-end.
4. find_collaborators reach. Public directory only (recommended for v1), or also institution-internal directories. Recommendation: public only for v1.

## Phasing

- Phase 1 (in build): the two tools over the existing endpoints, unit-tested with mocked deps, never-auto-send and the paid gate enforced. Flag-aligned with the rest of the sharing surface.
- Phase 2: a richer preview card in chat (recipient profile + object thumbnail), and a "share to several people at once" batch with one confirm.
- Phase 3: lab-member recipients and institution directories.

## Out of scope

- No new server routes or directory schema changes. If the build hits a missing endpoint, it stops and flags rather than adding one.
- No live-collaboration hosting (that is the separate external-collab gate). These tools do the one-time send only.
- No social-graph or follow features. The network sells seamless sharing, not a social network.
