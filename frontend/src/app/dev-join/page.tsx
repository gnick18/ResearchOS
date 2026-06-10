"use client";

// TEMPORARY dev harness for live-testing the lab-tier 8c member ACCEPT. NOT
// committed. Open this in the SECOND identity's browser/folder (a different user
// than the head). Paste the invite link the head minted (or open the real link,
// which lands here with the payload in the hash), then click Accept.
import { useEffect, useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { decodeInviteFragment, type LabInvitePayload } from "@/lib/lab/lab-invite";
import { acceptLabInvite } from "@/lib/lab/lab-invite-flow";

const btn: React.CSSProperties = {
  padding: "10px 16px", fontSize: 15, color: "white", border: "none",
  borderRadius: 8, marginRight: 10, cursor: "pointer",
};

export default function DevJoinPage() {
  const { currentUser } = useCurrentUser();
  const [link, setLink] = useState("");
  const [out, setOut] = useState("(paste the invite link, then Accept)");
  const [busy, setBusy] = useState(false);

  // If opened via the real link, the payload is already in the hash fragment.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash.length > 1) {
      setLink(window.location.href);
    }
  }, []);

  const invite: LabInvitePayload | null = (() => {
    const frag = link.includes("#") ? link.split("#")[1] : link.trim();
    return frag ? decodeInviteFragment(frag) : null;
  })();

  const accept = async () => {
    setBusy(true);
    try {
      if (!invite) { setOut("could not parse an invite from that link"); return; }
      const id = getSessionIdentity();
      if (!id || !currentUser) { setOut("need an unlocked identity + user in THIS browser"); return; }
      // Ensure an OAuth session so we accept with a verified email.
      let sess = await getSession();
      if (!sess?.user?.email) {
        await signIn("devmock", { redirect: false });
        sess = await getSession();
      }
      const email = sess?.user?.email;
      if (!email) { setOut("no OAuth email (devmock sign-in failed)"); return; }
      const r = await acceptLabInvite(invite, { username: currentUser, identity: id, oauthEmail: email });
      setOut(r.ok
        ? `ACCEPT ✓ posted to lab ${invite.labId.slice(0, 8)}…\n  as user=${currentUser} email=${email}\n  Now click "Finalize accepts" in the head's /dev-lab tab.`
        : `ACCEPT FAILED: ${r.reason}`);
    } catch (e) {
      setOut(`ACCEPT ERROR: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 40, fontFamily: "monospace", lineHeight: 1.6 }}>
      <h1>Lab invite accept (member side)</h1>
      <p>currentUser: <b>{currentUser ?? "(none)"}</b></p>
      <textarea
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="paste the invite link here"
        style={{ width: "100%", maxWidth: 900, height: 80, fontFamily: "monospace", fontSize: 13, padding: 10, borderRadius: 8 }}
      />
      <p style={{ fontSize: 13, color: "#64748b" }}>
        parsed: {invite ? `lab ${invite.labId.slice(0, 8)}… from ${invite.headUsername}, expires ${new Date(invite.expiresAt).toLocaleString()}` : "(no valid invite)"}
      </p>
      <div style={{ marginTop: 12 }}>
        <button onClick={accept} disabled={busy || !invite} style={{ ...btn, background: "#16a34a" }}>Accept invite</button>
      </div>
      <pre style={{ marginTop: 24, padding: 16, background: "#f1f5f9", color: "#0f172a", borderRadius: 8, whiteSpace: "pre-wrap", fontSize: 15 }}>{out}</pre>
    </div>
  );
}
