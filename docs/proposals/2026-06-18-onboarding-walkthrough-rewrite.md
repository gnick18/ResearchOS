# Onboarding walkthrough rewrite: audit + new teaching structure

Date 2026-06-18. Owner: orchestrator (manager bot). Status: DRAFT for Grant's voice/brand pass. Nothing wired into live onboarding yet.

Flagged by Grant 2026-06-17 mid test session. The post-login "3-minute walkthrough" was built about a month ago and the site has changed so much that it now misexplains how things work. This doc is step 1 (audit) and step 2 (a rewrite plan plus content draft). The companion artifact is the animated explainer prototype at `docs/mockups/2026-06-18-local-vs-cloud-explainer.html`.

The single most important thing the new content must land, in Grant's words: your research data lives in a folder on your own computer, only specific things ever touch the cloud, and that stays true even on a paid lab account. That is why ResearchOS is both cheap and private.

---

## 1. What the "3-minute walkthrough" actually is today

It is a four-beat opt-in modal, `PickerWalkthroughModal`, opened only by the "Take the 3-minute walkthrough" button next to BeakerBot on the folder-connect screen (`components/onboarding/FolderConnectGate.tsx:411`). It does not connect a folder, it just teaches, then returns you to the picker. Returning users skip it. The four beats:

1. Welcome (`WelcomeBeat.tsx`). "Hi, I'm BeakerBot." Two sentences. ResearchOS is a free and open source digital lab notebook from a registered Wisconsin company, grew out of a UW-Madison fellowship. Closes on "Every experiment, note, and result stays on your computer and under your control."
2. Security (`SecurityBeat.tsx`). "Your data stays on your computer." Three bullets: your folder never uploads, we cannot see your data, one anonymous pageview ping. Footer: backups and sharing are your call.
3. Folder choice (`FolderChoiceBeat.tsx`). "Where should your folder live?" Two cards: Local folder (recommended for solo) vs Cloud-synced folder (Dropbox, OneDrive, Google Drive, Box, iCloud).
4. Cloud provider (`CloudProviderBeat.tsx`, conditional). Only if they picked cloud-synced. Links to the per-provider sync setup wiki pages.

This was salvaged from the retired pre-onboarding gate (commit 75c6107b) and rehomed. The copy is well-written and on-brand. The problem is not the prose, it is the model it teaches.

---

## 2. Audit: what is stale or missing

### 2.1 It teaches the pre-account model

The walkthrough is built entirely around "pick a folder" with no account in sight. But the site has pivoted (see `project_require_account_local_first`): a free account via OAuth is now REQUIRED, the no-account local-only mode is retired, and the order is sign-in THEN connect folder. The walkthrough never mentions accounts, sign-in, identity, OAuth, or the @handle. A user who takes it comes away thinking ResearchOS is folder-only, which is no longer true.

This is the same staleness already visible in sibling copy. `StartScreen.tsx:135` still says an account "only adds sharing and team sync," framed as optional. The wiki getting-started pages have already been corrected ("A free account is required... The account is your identity, not your storage"). The walkthrough is the surface that still teaches the old story.

### 2.2 It conflates "cloud" with cloud-sync drives, and omits the real cloud layer

The walkthrough's only notion of "cloud" is Dropbox/OneDrive style folder sync, which is the user's OWN cloud, not ours. It says nothing about the ResearchOS cloud layer that actually exists now:

- the sharing relay (one-time end-to-end-encrypted sends between researchers),
- live collaboration (real-time co-editing in a lab),
- account identity and the researcher directory (@handle, name, institution),
- the AI assistant and its token budget.

So the walkthrough leaves out exactly the distinction Grant wants taught: LOCAL by default, OPTIONAL and SELECTIVE cloud for specific actions, and COLLAB syncing only the one shared doc. A user finishes the walkthrough with no mental model for any of it.

### 2.3 It never tells the cost-and-privacy story

Grant's core point is that local-first is WHY ResearchOS is cheap and private: we are not paying to store everyone's research data, so we do not have to charge for it, and we cannot lose or sell what we never hold. None of that is in the walkthrough. The "we cannot see your data" bullet gestures at privacy but never connects it to cost, and never makes the "not even on a paid lab account" promise that is the strongest version of the claim.

### 2.4 Minor accuracy notes for the rewrite

- The "one anonymous pageview ping" detail is accurate and worth keeping (single Vercel beacon per route, no IDs, off in Offline mode), but it should not be the only thing said about the network. Right now it is the walkthrough's entire account of "what leaves your machine," which badly understates the (still small, still optional) real picture.
- Truthful nuance on encryption, do not overclaim. A one-time SHARE is end-to-end encrypted, the relay holds only ciphertext. LIVE COLLAB is different: the relay holds the shared copy of that one doc and it is encrypted in transit and at rest but NOT end-to-end (the relay compacts canonical bytes, see `relay/src/worker.ts`). The wiki already gets this right ("encrypted in transit and at rest"). The new content must keep sends (E2E) and live collab (in-transit/at-rest) distinct and must not claim collab is E2E. The fully-sealed lab-tier blob store is real in code but dormant (Phase 3), so do not teach it yet.

### 2.5 Surfaces that are already correct (reuse their language)

The wiki has been kept current and is the source of truth for voice. Borrow from:
- `wiki/getting-started/accounts/page.tsx`: "The account is your identity, not your storage." "There is no cloud storage involved in the Free account tier." "Each member's files still live on their own disk. The cloud layer only relays edits in real time."
- `wiki/features/cloud-and-plans/page.tsx`: "The cloud does not hold your research. It holds only the optional copies used for the three paths below, which is why the storage limits are a limit on cloud copies, not on how much research you can do."
- `wiki/start-here/page.tsx`: "Nothing is uploaded, and there is no ResearchOS server holding your research. Want a backup? Copy the folder. Want to leave? Delete it."

---

## 3. The accurate model the content must teach

A clean three-layer mental model, verified against the code (`relay/src/worker.ts`, `lib/account/account-profile.ts`, `lib/billing/ai-ledger.ts`, `ARCHITECTURE.md`).

LAYER 1, LOCAL by default. Every project, note, experiment, method, sequence, table, image, and file is a plain file in a folder you picked on your own disk. The browser reads and writes that folder directly. Nothing uploads. The app works offline. This is everything, by default.

LAYER 2, your account is identity, not storage. A free account (OAuth sign-in, one time) is required to use the app, but it stores only who you are in the cloud: an @handle, display name, and affiliation in the researcher directory. It does not store your research. After that first sign-in the app is fully local and offline.

LAYER 3, the cloud is an optional, thin stream for three specific actions:
- a one-time send, end-to-end encrypted, deleted the moment the recipient picks it up, the relay only ever holds ciphertext,
- live collaboration, where only the ONE document you are co-editing syncs (not the folder), encrypted in transit and at rest,
- the AI assistant, where only the text of the turn you send goes to the model, metered against a token budget.

THE PAYOFF. Because we are not storing everyone's research, we do not have to charge to store it, and we cannot lose, sell, or leak what we never hold. This is true on a paid lab account too: a lab pays for the live-collaboration relay and AI, never for bulk storage of the lab's data, which still lives on each member's disk.

This is the spine of both the new walkthrough copy and the animated explainer.

---

## 4. Proposed new structure

Keep the four-beat shape (it is the right length and the opt-in placement is good), but re-aim the beats and add the missing layer. Proposed five short beats, the last two replacing the old folder-choice / cloud-provider pair:

1. Welcome. Keep almost as-is. Add one line that you sign in once to create your free account, and that the account is your identity, not your storage.
2. Where your work lives (was Security). "Your research stays on your computer." Keep the three trust bullets. This is Layer 1.
3. NEW, the one big idea: local by default, cloud only when you ask. The animated three-layer explainer lives here (laptop holds everything, a thin stream leaves only for send / collaborate / ask AI). This is the beat that carries the whole reframe. This is Layer 3 framed against Layer 1.
4. NEW, why this makes it cheap and private. The cost-and-privacy payoff, including the "not even on a paid lab account" promise.
5. Set up your folder (merge old beats 3 and 4). Local vs cloud-synced drive choice, plus the provider setup links, kept as the practical close that hands back to the picker.

Open question for Grant, flagged not decided: whether to keep this as a static slide modal or fold the three-layer explainer into a single richer animated beat. The mockup is built so the animated explainer could be the whole of beat 3, or a standalone page in the wiki, or both.

### 4.1 Coordinate with the LLM onboarding tutor

There is a separate, larger effort, the BeakerBot-driven LLM onboarding tutor on `feat/onboarding-tour-mount` (see `project_llm_onboarding_tutor`), which is the post-sign-in feature showcase. That is a different surface (it fires after account creation, it is about feature awareness). This walkthrough is the pre-folder-connect trust-and-architecture primer. They should not duplicate. Recommendation: this rewrite owns the architecture explainer (local vs cloud vs collab, cost, privacy), and the tutor links to it rather than re-teaching it. The animated explainer in the mockup is designed to be reusable in both, and in the wiki.

---

## 5. Content draft (for Grant's voice pass)

House style enforced: no em-dashes, no mid-sentence colons, no emojis, custom inline SVG only.

BEAT 1, Welcome.
> Hi, I'm BeakerBot. Welcome to ResearchOS, a free and open source digital lab notebook from ResearchOS LLC, a registered Wisconsin company that grew out of a UW-Madison Distinguished Research Fellowship. You sign in once to create your free account, and from there I will help you set up. Your account is just your identity. Your research stays on your computer.

BEAT 2, Where your work lives.
> Your research stays on your computer. ResearchOS is local-first. The folder you pick is yours, and every experiment, note, and measurement lives inside it on your machine. The browser reads and writes that folder directly.
> - Your folder never uploads. There is no ResearchOS server reading it.
> - We cannot see your data. The website only sees what your browser shows on screen.
> - One anonymous pageview ping, and you can turn it off in Settings.

BEAT 3, Local by default, cloud only when you ask (the animated beat).
> Almost everything you do never leaves your laptop. The cloud is a thin stream you open only for three things. Send something to another researcher, and it goes end-to-end encrypted, then deletes itself once they pick it up. Co-edit live with your lab, and only that one shared document syncs, not your folder. Ask the AI a question, and only that question goes. The rest stays home.

BEAT 4, Why this is cheap and private.
> Here is the part most tools get backwards. Because we never store your research, we do not have to charge you to store it, and we cannot lose it, sell it, or leak it. That stays true on a paid lab account. A lab pays for live collaboration and AI, never for storing the lab's data, which still lives on each person's own disk.

BEAT 5, Set up your folder.
> (Keep the existing local vs cloud-synced choice and the provider setup links. Re-headline to "Where should this folder live?" and close with "Back to setup.")

---

## 6. The animated explainer (prototype)

`docs/mockups/2026-06-18-local-vs-cloud-explainer.html`. Light default, self-contained, no dependencies. A clickable four-step walk through the model:

1. Local. A laptop holding the whole folder, everything pulsing gently "at home," cloud dim and idle.
2. Share. One item lifts off the laptop as an encrypted parcel, travels a thin line to the cloud and on to a colleague's laptop, then the cloud copy dissolves (one-time, E2E).
3. Collaborate. One document (not the folder) opens a two-way live link through a small cloud node to a labmate, while the rest of the folder stays visibly put on the disk.
4. Why it's cheap. A simple visual contrast: "what we store" (a tiny identity card) vs "what we never store" (the big folder), with the cost-and-privacy payoff line.

It is built so any single step can be lifted out (for example step 3 alone for a collab help doc), and so it can be embedded as beat 3 of the walkthrough or as a standalone wiki page.

---

## 7. Open decisions for Grant

1. Voice pass on the beat copy in section 5.
2. Beat 3 form: full animated explainer inline, or a static slide that links to the explainer page. (Recommendation: inline the animation, it is the whole point of the reframe.)
3. How hard to lean on the "not even on a paid lab account" promise in the walkthrough itself vs the wiki. (Recommendation: say it once, plainly, in beat 4.)
4. Division of labor with the LLM onboarding tutor (section 4.1).
5. Collab encryption wording: confirm we message live collab as "encrypted in transit and at rest" and reserve "end-to-end" for one-time sends, to stay truthful to the current relay.

---

## 8. Next steps after sign-off

1. Grant reviews this doc plus the mockup, does the voice pass, answers section 7.
2. Build the production animated explainer component (reuse-friendly, in `components/`), tested, behind no flag (it is just content).
3. Rewire `PickerWalkthroughModal` beats to the new five-beat structure, update `PickerWalkthroughModal.test.tsx`.
4. Update the wiki getting-started pages that describe the walkthrough's old beat list.
5. Fix the stale `StartScreen.tsx:135` "account only adds sharing" line in the same pass.
