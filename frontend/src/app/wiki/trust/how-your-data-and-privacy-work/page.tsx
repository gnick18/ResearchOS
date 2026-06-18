import Callout from "@/components/wiki/Callout";
import WikiPage from "@/components/wiki/WikiPage";
import DataFlowExplainer from "@/components/data-flow/DataFlowExplainer";

export default function HowYourDataAndPrivacyWorkPage() {
  return (
    <WikiPage
      intro="Where your research actually lives, what touches our servers and when, how shared work is protected, and why all of that keeps ResearchOS both private and cheap. This is the plain-English version, with one interactive you can click through."
    >
      <h2>Start with the one idea</h2>
      <p>
        Your research lives in a folder on your own computer. ResearchOS reads
        and writes that folder directly through your browser, and there is no
        database we control holding your work. A free ResearchOS account is
        your identity, the way other researchers find you and you find them. It
        is not where your data is stored, not even on a paid lab plan.
      </p>
      <p>
        Almost everything in this page follows from that single choice. Click
        through the four steps below to see it.
      </p>

      <DataFlowExplainer />

      <h2>Local-first, in practice</h2>
      <p>
        When you pick a data folder, every experiment, note, measurement,
        image, and attachment lives inside it on your machine. You can open the
        folder in Finder or File Explorer at any time and read every file
        yourself. Quit the app and your data stays exactly where it is.
      </p>
      <Callout variant="tip" title="The short version">
        There is nothing for us to lose, sell, or get breached, because we are
        not holding your data. The website only ever sees what your browser
        shows on screen. The full, verifiable version of this claim lives on
        the <a href="/wiki/security">Security</a> page.
      </Callout>

      <h2>Three ways work leaves the folder, and only three</h2>
      <p>
        Local-first does not mean isolated. There are exactly three ways your
        work can travel, and each one moves only what you choose, never the
        whole folder.
      </p>

      <h3>1. Send a one-time copy</h3>
      <p>
        When you send a method, dataset, sequence, or figure to another
        researcher, ResearchOS seals a one-time copy and routes it through a
        relay that only ever holds the sealed bytes. This send is end-to-end
        encrypted, so the relay cannot read it, and the copy lands in the
        recipient&apos;s own folder. Receiving is always free. Sending a copy is
        a paid feature.
      </p>

      <h3>2. Co-edit one document live</h3>
      <p>
        When two people edit the same note live, only that one shared document
        streams to our relay so each change reaches the other person right away.
        The rest of your folder never moves. Live collaboration is encrypted in
        transit and at rest.
      </p>
      <Callout variant="warning" title="Live collaboration is not end-to-end">
        This is the honest exception. To merge two people&apos;s edits into one
        document in real time, our relay has to read the shared document in
        readable form, so we can see what you co-edit there. A one-time send is
        end-to-end; live collaboration is not. Anything you do not put into a
        live shared document stays on your machine and is never uploaded.
        Hosting live collaboration is a paid feature.
      </Callout>

      <h3>3. Ask the optional AI helper</h3>
      <p>
        The AI helper is off until you use it. When you ask it something, only
        the note or table it needs is sent through our server to an AI provider,
        with the key held on our side and the provider set to keep nothing by
        default. Nothing else from your folder goes along for the ride, and the
        summary tools are built to count and structure your own content rather
        than interpret it.
      </p>
      <Callout variant="info" title="What we do not claim">
        The AI path is private and minimal, but we do not claim HIPAA
        compliance or a Business Associate Agreement. If your work is regulated
        that way, keep it out of the AI helper.
      </Callout>

      <h2>Where the cloud parts are stored</h2>
      <p>
        The small amount that does touch the cloud lives in one of two tiers,
        and the difference is mostly about how live the data is.
      </p>
      <ul>
        <li>
          <strong>Hot storage.</strong> A document being co-edited live sits in
          fast storage so every keystroke reaches the other person quickly.
          This is the more expensive tier, which is exactly why only the one
          live document goes there, not your folder.
        </li>
        <li>
          <strong>Cold storage.</strong> Backups and anything you deliberately
          publish sit in cheap object storage. It is roughly an order of
          magnitude cheaper than the hot tier, because it does not need to be
          instant.
        </li>
        <li>
          <strong>Local disk.</strong> Everything else, which is to say the vast
          majority of your work, sits on your own disk and costs us nothing.
        </li>
      </ul>

      <h2>Your folder can be its own backup</h2>
      <p>
        Because your data is a folder of ordinary files, you can put it inside a
        sync app your institution already pays for, like OneDrive, Google Drive,
        Box, Dropbox, or iCloud Drive. That gives you a second copy and
        cross-device access without us hosting anything. Version history is
        written into the folder too, under a per-record history log, so your
        edit history rides along in that same backup and still never lands on
        our servers.
      </p>
      <Callout variant="tip" title="Redundancy you already have">
        A folder inside your university&apos;s existing cloud drive is a free,
        familiar second copy. ResearchOS does not need to run a backup service,
        because your institution already runs one. The{" "}
        <a href="/wiki/shared-lab-accounts">Shared Lab Accounts</a> guides walk
        through setting each provider to keep files on the device.
      </Callout>

      <h2>Why it stays affordable</h2>
      <p>
        Both the low cost and the strong privacy come from the same place. We
        are not paying to store everyone&apos;s research, so we do not have to
        charge for it. The app is free, every feature works locally at no cost,
        and receiving shared work is free. The paid parts are the thin streams,
        sending a sealed copy and hosting live collaboration, because those are
        the only things that use our relay.
      </p>
      <p>
        For labs, only the PI ever pays, and they pay one pooled cost while
        members join for free. Storage is billed at roughly what it costs us,
        not as a markup to profit from. The honest, full breakdown of the model
        is on <a href="/wiki/trust/how-we-fund-it">How it stays free</a>.
      </p>

      <h2>The spending brake</h2>
      <p>
        Cloud usage has a built-in safety valve. If usage would run past the
        budget set for an account, ResearchOS engages a brake that pauses cloud
        writes rather than letting a bill run away. It pauses syncing, not your
        work. Your local research keeps running and nothing is lost; the brake
        is reset deliberately, on your terms.
      </p>
      <Callout variant="tip" title="The worst case is paused sync, never lost work">
        The brake only ever stops the cloud streams. Editing, saving, and
        reading your local folder continue exactly as before, because that part
        was never going through our servers in the first place.
      </Callout>

      <h2>Where to go next</h2>
      <p>
        For the audit-grade version of the local-first claim, including how to
        watch the network yourself in DevTools, read the{" "}
        <a href="/wiki/security">Security</a> page. For the account tiers and
        what each one unlocks, see{" "}
        <a href="/wiki/getting-started/accounts">Account tiers</a>. For the
        funding model in full, see{" "}
        <a href="/wiki/trust/how-we-fund-it">How it stays free</a>.
      </p>
    </WikiPage>
  );
}
