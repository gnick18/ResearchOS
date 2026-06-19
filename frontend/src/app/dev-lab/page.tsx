"use client";

// TEMPORARY dev harness for live-testing the lab-tier Phase 5 + sync. NOT committed.
import { useMemo, useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { createLabForCurrentUser } from "@/lib/lab/lab-create";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { createLabSessionEffects } from "@/lib/lab/lab-session-effects";
import { createLabSessionController } from "@/lib/lab/lab-session";
import { runLabSyncForSession } from "@/lib/lab/lab-sync-runner";
import { createLocalApiLabWorkSource } from "@/lib/lab/lab-work-source-localapi";
import { createFileServiceManifestStore } from "@/lib/lab/lab-sync-manifest-store";
import { pullMemberLabRecords } from "@/lib/lab/lab-sync";
import { mintLabInvite, encodeInviteLink, DEFAULT_INVITE_TTL_MS, type LabInvitePayload } from "@/lib/lab/lab-invite";
import { finalizeLabAccepts } from "@/lib/lab/lab-invite-flow";
import { buildAcceptPayload } from "@/lib/lab/lab-accept";
import { postLabAccept } from "@/lib/lab/lab-accept-client";
import { verifyMemberEmailBinding } from "@/lib/lab/lab-binding";
import { getLabRemote } from "@/lib/lab/lab-do-client";
import { encodePublicKey } from "@/lib/sharing/identity/keys";
import { seedSyntheticMemberWork } from "@/lib/lab/dev/synthetic-member-seed";
import { patchUserSettings } from "@/lib/settings/user-settings";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";

// Phase 8a: a FRESH lab id. The old 74a805c6 lab predates the email binding, so
// its head has no emailHashEnc and a login would (correctly) hard-reject. This
// lab is created WITH the head binding so the happy path goes live.
const LAB_ID = "8a000000-b1d1-4e00-9000-000000000001";

const btn: React.CSSProperties = {
  padding: "10px 16px", fontSize: 15, color: "white", border: "none",
  borderRadius: 8, marginRight: 10, cursor: "pointer",
};

export default function DevLabPage() {
  const { currentUser } = useCurrentUser();
  const [out, setOut] = useState("(no action yet)");
  const [busy, setBusy] = useState(false);
  // Phase 8b/8c one-tab testing: the last minted invite + a synthetic member
  // (a throwaway keypair, so no 2nd browser/folder is needed).
  const [lastInvite, setLastInvite] = useState<LabInvitePayload | null>(null);
  const [sim, setSim] = useState<{ username: string; email: string; x25519Priv: Uint8Array } | null>(null);

  const controller = useMemo(
    () => (currentUser ? createLabSessionController(createLabSessionEffects({ labId: LAB_ID, username: currentUser })) : null),
    [currentUser],
  );

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(true);
    try { setOut(await fn()); }
    catch (e) { setOut(`${label} ERROR: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  }

  const createLab = () => run("create", async () => {
    const id = getSessionIdentity();
    if (!id || !currentUser) return "need unlocked identity + user";
    // Phase 8a: bind the head's OAuth email. Read it from the same source the
    // login check uses (getSession), establishing a devmock session if needed,
    // so the email sealed here is exactly the one verified at login.
    let sess = await getSession();
    if (!sess?.user?.email) {
      await signIn("devmock", { redirect: false });
      sess = await getSession();
    }
    const email = sess?.user?.email;
    if (!email) return "no OAuth email (devmock sign-in failed)";
    const r = await createLabForCurrentUser({
      username: currentUser,
      identity: id,
      oauthEmail: email,
      idImpl: () => LAB_ID,
    });
    return `LAB CREATED ✓ labId=${r.labId}\n  boundEmail=${email}  labKey=${r.labKey.length}b`;
  });

  const login = () => run("login", async () => {
    if (!controller) return "no controller";
    controller.start("lab");
    await controller.signIn("devmock");
    const s = controller.getState();
    return s.kind === "live"
      ? `LOGIN ✓ live — labKey=${s.labKey.length}b member=${s.member.username}`
      : `LOGIN state=${s.kind} err=${controller.getError?.()?.message ?? "(none)"}`;
  });

  const sync = () => run("sync", async () => {
    const s = controller?.getState();
    if (s?.kind !== "live") return "login first (session not live)";
    const res = await runLabSyncForSession(s, {
      source: createLocalApiLabWorkSource(),
      manifestStore: createFileServiceManifestStore(),
    });
    return `SYNC ✓ ran=${res.ran} owner=${res.owner}\n  pushed(${res.pushed?.length}): ${JSON.stringify(res.pushed)}\n  skipped(${res.skipped?.length})  tombstoned(${res.tombstoned?.length})`;
  });

  const readBack = () => run("readback", async () => {
    const s = controller?.getState();
    if (s?.kind !== "live") return "login first (session not live)";
    const recs = await pullMemberLabRecords({
      labId: LAB_ID, memberOwner: s.member.username, labKey: s.labKey,
      signerEd25519Priv: s.signingKeyPair.ed25519Priv, signerEd25519Pub: s.signingKeyPair.ed25519Pub,
    });
    const dec = new TextDecoder();
    return `PI READ-BACK ✓ ${recs.length} record(s):\n` +
      recs.map((r) => `  ${r.recordType}/${r.recordId}: ${dec.decode(r.plaintext).slice(0, 120)}`).join("\n");
  });

  // Phase 8b: head mints an invite link to share with a member.
  const createInvite = () => run("invite", async () => {
    const id = getSessionIdentity();
    if (!id || !currentUser) return "need unlocked identity + user";
    const invite = mintLabInvite({
      labId: LAB_ID,
      headUsername: currentUser,
      headEd25519Pub: encodePublicKey(id.keys.signing.publicKey),
      headX25519Pub: encodePublicKey(id.keys.encryption.publicKey),
      headEd25519Priv: id.keys.signing.privateKey,
      expiresAt: Date.now() + DEFAULT_INVITE_TTL_MS,
    });
    setLastInvite(invite);
    const link = encodeInviteLink(window.location.origin, invite);
    return `INVITE LINK created (held for "Simulate member accept").\nTo test with a REAL 2nd identity instead, open this in another browser/folder:\n${link}`;
  });

  // Phase 8c one-tab test: a synthetic member (throwaway keypair) accepts the
  // last invite with a DIFFERENT email than the head. No 2nd browser needed.
  const simulateAccept = () => run("simulate", async () => {
    if (!lastInvite) return 'click "Create invite link" first';
    const edPriv = ed25519.utils.randomSecretKey();
    const edPub = encodePublicKey(ed25519.getPublicKey(edPriv));
    const xk = x25519.keygen();
    const xPub = encodePublicKey(xk.publicKey);
    // Unique per click so repeated tests each add a FRESH member (the finalize
    // idempotency guard would skip a repeated username as "already a member").
    const suffix = Math.random().toString(36).slice(2, 6);
    const username = `sim-${suffix}`;
    const email = `rosa.${suffix}@gmail.com`; // intentionally != the head's email
    const accept = buildAcceptPayload({
      invite: lastInvite,
      memberUsername: username,
      memberEmail: email,
      memberX25519Pub: xPub,
      memberEd25519Pub: edPub,
      memberEd25519Priv: edPriv,
    });
    const res = await postLabAccept(lastInvite.labId, accept);
    if (!res.ok) return `SIMULATE ACCEPT FAILED (HTTP ${res.status})`;
    setSim({ username, email, x25519Priv: xk.secretKey });
    return `SIMULATED MEMBER ACCEPT ✓ posted to the lab queue\n  username=${username}  email=${email} (note: != head email, tests send!=bound)\n  Next: click "Finalize accepts", then "Verify member login".`;
  });

  // Phase 8a closure: prove the binding the head just sealed accepts the
  // member's real email and rejects a wrong one (the exact login check).
  const verifyMemberLogin = () => run("verify-login", async () => {
    const s = controller?.getState();
    if (s?.kind !== "live") return "head Login first (need the lab key)";
    if (!sim) return 'simulate a member accept + finalize first';
    const remote = await getLabRemote(LAB_ID);
    if (!remote) return "lab not found";
    const m =
      remote.record.members.find((x) => x.username === sim.username) ??
      (remote.record.head.username === sim.username ? remote.record.head : null);
    if (!m) return `${sim.username} is not in the roster yet (click "Finalize accepts" first)`;
    const right = verifyMemberEmailBinding({ member: m, oauthEmail: sim.email, labKey: s.labKey });
    const wrong = verifyMemberEmailBinding({ member: m, oauthEmail: "attacker@evil.com", labKey: s.labKey });
    return `MEMBER LOGIN BINDING CHECK (8a) for ${sim.username}:\n` +
      `  correct email (${sim.email}):  ${right.ok ? "ACCEPT ✓" : "REJECT (" + right.reason + ")"}\n` +
      `  wrong email (attacker@evil.com): ${wrong.ok ? "ACCEPT  <-- BUG" : "REJECT ✓ (" + wrong.reason + ")"}`;
  });

  // Phase 8c: head reads pending accepts, verifies, adds members, dismisses.
  const finalize = () => run("finalize", async () => {
    const s = controller?.getState();
    if (s?.kind !== "live") return "login first (session not live)";
    const id = getSessionIdentity();
    if (!id) return "need unlocked identity";
    const outcomes = await finalizeLabAccepts({
      labId: LAB_ID,
      labKey: s.labKey,
      headEd25519Priv: s.signingKeyPair.ed25519Priv,
      headEd25519Pub: encodePublicKey(id.keys.signing.publicKey),
      headX25519Priv: id.keys.encryption.privateKey,
    });
    if (!outcomes.length) return "FINALIZE: no pending accepts";
    return `FINALIZE ✓\n` + outcomes
      .map((o) => `  ${o.username} [${o.status}]${o.reason ? " " + o.reason : ""}`)
      .join("\n");
  });

  // Phase 8d: seed the finalized synthetic member's work into the LIVE mirror,
  // signing with the head's real keys (the relay accepts a member-owner push
  // signed by the head because the head is a roster member). A fresh manifest
  // means every record is treated as new and pushed.
  const seedMemberWork = () => run("seed", async () => {
    const s = controller?.getState();
    if (s?.kind !== "live") return "head Login first (need the lab key + signing keys)";
    if (!sim) return 'simulate a member accept first (click "B. Simulate member accept")';
    const remote = await getLabRemote(LAB_ID);
    const inRoster =
      !!remote &&
      (remote.record.members.some((x) => x.username === sim.username) ||
        remote.record.head.username === sim.username);
    if (!inRoster) {
      return `${sim.username} is not in the roster yet (click "C. Finalize accepts" first)`;
    }
    return seedSyntheticMemberWork({
      labId: LAB_ID,
      owner: sim.username,
      labKey: s.labKey,
      signerEd25519Priv: s.signingKeyPair.ed25519Priv,
      signerEd25519Pub: s.signingKeyPair.ed25519Pub,
    });
  });

  // Phase 8d: flip this account to lab_head so the copilot mounts. The viewer
  // must reload for the new account_type to take effect, then open /lab-overview.
  const makeMeLabHead = () => run("lab-head", async () => {
    if (!currentUser) return "no current user";
    await patchUserSettings(currentUser, { account_type: "lab_head" });
    return (
      `ACCOUNT TYPE set to lab_head for ${currentUser} ✓\n` +
      `  Now RELOAD this page (or any page), then open /lab-overview and ask\n` +
      `  BeakerBot e.g. "give me a lab pulse" or "summarize spending".`
    );
  });

  return (
    <div style={{ padding: 40, fontFamily: "monospace", lineHeight: 1.6 }}>
      <h1>Lab-tier dev harness (login + sync)</h1>
      <p>currentUser: <b>{currentUser ?? "(none)"}</b> · lab: <b>{LAB_ID.slice(0, 8)}…</b></p>
      <div style={{ marginTop: 12 }}>
        <button onClick={createLab} disabled={busy} style={{ ...btn, background: "#64748b" }}>Create lab</button>
        <button onClick={login} disabled={busy} style={{ ...btn, background: "#2563eb" }}>1. Login</button>
        <button onClick={sync} disabled={busy} style={{ ...btn, background: "#16a34a" }}>2. Sync my work → R2</button>
        <button onClick={readBack} disabled={busy} style={{ ...btn, background: "#7c3aed" }}>3. Read back (as PI)</button>
      </div>
      <div style={{ marginTop: 10 }}>
        <button onClick={createInvite} disabled={busy} style={{ ...btn, background: "#0891b2" }}>A. Create invite link</button>
        <button onClick={simulateAccept} disabled={busy} style={{ ...btn, background: "#db2777" }}>B. Simulate member accept</button>
        <button onClick={finalize} disabled={busy} style={{ ...btn, background: "#b45309" }}>C. Finalize accepts</button>
        <button onClick={verifyMemberLogin} disabled={busy} style={{ ...btn, background: "#7c3aed" }}>D. Verify member login</button>
      </div>
      <div style={{ marginTop: 10 }}>
        <button onClick={seedMemberWork} disabled={busy} style={{ ...btn, background: "#0d9488" }}>E. Seed member work</button>
        <button onClick={makeMeLabHead} disabled={busy} style={{ ...btn, background: "#9333ea" }}>F. Make me a lab head</button>
      </div>
      <p style={{ fontSize: 13, color: "#64748b", marginTop: 6 }}>
        One-tab invite test: A → B → C → D (no 2nd browser needed). The synthetic member uses a different email than the head, exercising the full handshake + the 8a binding.
      </p>
      <p style={{ fontSize: 13, color: "#64748b", marginTop: 6 }}>
        Full live copilot flow (no 2nd browser): Create lab → 1. Login → A. Create invite → B. Simulate member accept → C. Finalize accepts → E. Seed member work → F. Make me a lab head → reload → open <b>/lab-overview</b> and ask BeakerBot e.g. &quot;give me a lab pulse&quot;, &quot;summarize spending&quot;, &quot;what is missing a DOI&quot;, &quot;reproduce {sim?.username ?? "the member"}&apos;s t-test&quot;, &quot;list the lab&apos;s plots&quot;. NEXT_PUBLIC_AI_ASSISTANT_ENABLED is already 1 in .env.local, so the copilot mounts once account_type is lab_head.
      </p>
      <pre style={{ marginTop: 24, padding: 16, background: "#f1f5f9", color: "#0f172a", borderRadius: 8, whiteSpace: "pre-wrap", fontSize: 15 }}>{out}</pre>
    </div>
  );
}
