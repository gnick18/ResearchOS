# Global Identity meets Local Accounts, Interaction Design

A design pass on how the new global sharing identity (Google/GitHub or email login, plus a keypair) coexists with ResearchOS's existing folder-local account model (pick a user, optional password, lab-head management, user switching). Triggered by Grant's observation that the login system has impacts beyond the sharing feature. The setup UI waits on these decisions.

---

## The resolving principle, two layers

There are two identity layers, and they answer different questions. Keeping them distinct resolves almost everything.

**The local layer (unchanged).** A folder-local account is "who I am acting as inside this shared folder." It is loose by design, you pick a user, the password is an optional soft gate, lab heads can manage member accounts, and you can switch between accounts freely. This layer must keep working fully offline with no account anywhere, which is the locked clone-and-run-local tenet. So this layer does not change.

**The global layer (new, optional, strict).** A global identity is "who I provably am to the outside world." It is a verified email plus a keypair, and it is cryptographically bound to the actual person, the private key lives on their device, the login is their own Google, GitHub, or email. It is used for one thing only, sending and receiving across folders. Nobody else can touch it, fake it, or act as it, not even a lab head.

A local account optionally CLAIMS a global identity. That link is the only connection between the layers. The global login is never required to open the app.

---

## Decisions

### D1. Does claiming a global identity change how you log in locally?
The local password stays as the offline gate. Once an account has claimed a global identity, it ALSO offers "Sign in with Google/GitHub to unlock" when online, with the password kept as the offline fallback. This is the sense in which "the password goes away" for connected users, without breaking offline use.
Status, DECIDED (Grant, 2026-06-03), yes. A claimed account can use its global login to unlock locally when online; the local password is the offline fallback.

### D2. What can you do in a claimed account you are not authenticated as?
Everything local (view and edit the folder data, exactly as today). Nothing global, you cannot send a cross-folder share as that person, cannot open their received end-to-end-encrypted shares, and cannot change their identity. The UI shows a quiet "viewing locally, sign in as this person to share" state, with the sharing actions present but locked. This is the correct, secure behavior, not a limitation to fix.

### D3. Received shares are device-bound.
A received share is encrypted to the recipient's key, which lives in that person's browser on the device where they set up. So another person switching into the account sees sealed items they cannot open, and the recipient on a NEW device must restore their key (via recovery words) before they can read shares. This is inherent to end-to-end encryption and is acceptable, the UI just needs to say "encrypted items waiting, sign in / restore your key to open" rather than show an error.

### D4. The login and onboarding flow keeps its current spine.
Folder picker, then user picker, then the app, unchanged. The global-identity setup is NOT a new step in that path. It is intent-triggered, the first time a user clicks "Share outside this folder," they are walked through claiming an identity. So onboarding does not front-load any of this.

### D5. Lab-head management is local-only.
A lab head still manages members' local accounts (name, color, the folder data). They cannot control, impersonate, or read into a member's global identity or sealed shares. A lab head MAY see which members have a global identity (a small badge, useful for knowing who can receive cross-lab shares), but has no power over it. So the existing lab-management feature survives for local config and simply does not extend to the global layer.

### D6. Resetting a local password does not touch the global login.
A lab head resetting a member's local password only resets the offline password fallback. It cannot reset the member's Google/GitHub login (that is the provider's), and it grants no access to the member's sealed shares or keys. So "manage accounts" cannot be used to snoop on someone's cross-lab sharing.

### D7. Only personal accounts can claim a global identity.
A shared or pseudo account (the old Lab pseudo-account, already being retired) cannot claim a global identity, because a global identity is one real person. Only a personal folder-local account can claim one.

### D8. The global identity outlives the local account.
The directory keys identity by email and keypair, not by the folder account. So deleting a local account does not delete the global identity, and the same person can claim the same global identity from a different folder later. Identity anchors to the keypair, not the folder, which is also what makes moving folders and multi-device work.

---

## The one real fork for Grant

Everything above except D1 has a clear secure default. D1 is a genuine product choice.

**Should a claimed account be able to use its Google/GitHub login to unlock the local account when online (so the password effectively goes away for connected users), with the local password kept only as the offline fallback?**

- Yes, gives the smooth "just log in with Google" feel you were picturing, at the cost of a bit more logic tying the local unlock to the global identity. The password never fully disappears (offline needs it), it just becomes the fallback.
- No, keeps the two layers fully separate, the local password is always the local gate and the global login is only ever for sharing. Simpler and more clearly separated, but you keep "two logins" for connected users.

---

## What this changes in the build

- The setup UI (next piece) presents the claim flow as intent-triggered, not a login step.
- The user-switcher and any "manage members" surfaces gain a small "has sharing identity" badge, and lock the sharing actions when you are not the authenticated owner.
- If D1 is "yes," the user-unlock screen gains an optional "Sign in with Google/GitHub to unlock" alongside the password.
- None of this changes the offline path or the folder-local model itself.
