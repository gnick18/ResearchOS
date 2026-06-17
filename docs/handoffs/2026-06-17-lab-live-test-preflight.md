# Lab live test pre-flight (PI + Emile, two machines)

Pre-flight for the first real two-party test of the lab mirror, whole-lab search,
and the transparency panel. The CODE path is verified (end-to-end integration
test with real crypto, relay contract audit, session field-match, error
hardening). The remaining risks are configuration and the join sequence, both
listed below. House voice (no em-dashes, no emojis, no mid-sentence colons).

## What the test proves

1. Emile joins the lab.
2. Emile does some work; his client auto-pushes encrypted snapshots to the R2
   mirror.
3. The PI opens /search, "Search the whole lab" shows Emile's work.
4. Emile opens Settings, "Your lab view" shows the PI's access.

## Config to verify on Vercel prod (do this BEFORE test day)

Open Vercel, ResearchOS project, Settings, Environment Variables, Production.

- `NEXT_PUBLIC_COLLAB_RELAY_URL` must be the deployed relay (a `wss://...workers.dev`
  URL), NOT unset. If it is unset in prod, the app THROWS at load (a loud crash,
  config.ts has a hard guard), so this one is self-announcing, but set it so the
  app loads at all.
- `NEXT_PUBLIC_LAB_TIER_ENABLED=1` (master gate for the whole lab tier).
- `NEXT_PUBLIC_REQUIRE_ACCOUNT=1` (OAuth-first path. Our records say this was
  flipped on prod; confirm it. If off, Emile may land on the old folder path and
  never reach a live lab session).
- `SHARING_ENABLED=true` and `NEXT_PUBLIC_SHARING_ENABLED=true` (the directory
  the join flow needs).
- `NEXT_PUBLIC_LAB_TOKENS_V2` should be 0 or absent (we use the head-signed
  invite link, not the token path).

If you change any var, trigger a redeploy.

## State to confirm (on prod, as the PI)

- Settings shows your account as a lab head (account_type lab_head, set when the
  lab was created). The "Search the whole lab" panel only renders for a lab head.
- Settings, Lab Mode, Lab membership shows a "Create invite link" button.

## Day-of sequence (strict order, there is no real-time push to the PI)

1. Emile opens the prod URL, signs in with OAuth, and finishes account setup
   (this publishes his keypair to the directory, which the next step needs).
2. PI creates the invite link (Settings, Lab Mode, Lab membership, Create invite
   link) and sends it to Emile out of band.
3. Emile opens the link and clicks Accept invite. He will see a pending state.
4. PI goes to Settings, Lab Mode, Lab membership, Pending join requests, and
   clicks Add to the lab. THIS IS MANUAL. There is no notification, so the PI has
   to open this panel and look.
5. PI tells Emile he is added. Emile returns to the join page and clicks Enter
   lab. The session should reach live.
6. Emile does some work (a note, a task, an experiment).
7. Wait about 30 seconds (the push fires on write with a debounce, on window
   focus, and on a 5 minute safety net).
8. PI opens /search. The "Search the whole lab" panel should list Emile's work.
   Search a keyword from his note or table.
9. Emile opens Settings, Your lab view. After the PI has searched or read his
   data, the access shows here.

## Known rough edges (not blockers)

- No PI notification when a join request arrives (step 4 is a manual check).
- Emile may need to click Enter lab again after the PI adds him (no auto-poll on
  the pending state).
- "Your lab view" is empty until the PI actually reads or searches Emile's data.
- Heavy items (large Data Hub tables) appear in search with an "On request" badge
  but the request handshake (Phase C) is not built yet, so the PI can see they
  exist but cannot pull the full content on demand. Light content (notes, tasks,
  methods, the results and notes sheets) is in the mirror and fully readable.

## If something fails, where to look

- App will not load: the relay URL env var is missing (the hard guard fired).
- Emile reaches live but the PI search shows nothing: confirm Emile actually did
  work AND waited for the push (30s), and confirm Emile is enrolled in the roster
  (the Add to the lab step completed). A 401 on his pushes means he is not on the
  roster yet.
- "Lab-wide search is not available: ..." with a reason: the reason is now
  surfaced (the relay error hardening), so read it. "requires the lab-head role"
  means the account_type is not lab_head; "not bound to a lab" means no lab_id in
  settings; a relay message means a network or relay issue.
