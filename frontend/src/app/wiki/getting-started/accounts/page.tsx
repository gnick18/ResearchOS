import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function AccountsPage() {
  return (
    <WikiPage
      intro="ResearchOS has three tiers, each designed around how much you want to share and collaborate. You pick one when you create your account, and you can switch later."
    >
      <h2>How you get here</h2>
      <p>
        The account-first entry is the default. When you open ResearchOS
        signed in but without a data folder connected, you land on the{" "}
        <strong>/account</strong> home rather than the folder-connect wall.
        From there you choose a tier before linking any folder. If you arrived
        via OAuth (Google, GitHub, ORCID, or LinkedIn) the provider sign-in
        happens first, and the tier-chooser screen follows once the OAuth
        handshake completes.
      </p>

      <Screenshot
        src="/wiki/screenshots/accounts-start-screen.png"
        alt="The account start screen with the three-path tier chooser."
        caption="The account start screen. Choose a path before connecting your folder."
      />

      <Screenshot
        src="/wiki/screenshots/accounts-tier-chooser.png"
        alt="The tier chooser showing the Just me local tile, Free account tile, and Lab tile."
        caption="The tier-chooser. The Lab tile is shown when the Lab tier is available."
      />

      <h2>The three tiers</h2>
      <p>
        The tier chooser presents three paths. Understanding what each one is
        will save you from picking the wrong one and wondering why a feature
        is missing.
      </p>

      <h3>Just me, local (solo, no login)</h3>
      <p>
        The lightest path. You connect a folder, pick a username, and
        ResearchOS is ready to go. No account is created, no sign-in happens,
        and nothing leaves your machine. All features that don&apos;t involve
        sharing are available, including the full Workbench, notes, methods,
        sequences, calculators, and purchases.
      </p>
      <p>
        Pick this if you work alone and have no need to share data or
        collaborate with people outside your folder. If you share a lab folder
        via OneDrive, Dropbox, or Google Drive, the existing{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link> setup
        is a local-only workflow too. &ldquo;Just me, local&rdquo; is the right
        pick for anyone who wants to try the app without committing to an
        account.
      </p>

      <h3>Free account (solo + sharing)</h3>
      <p>
        You sign in with Google, GitHub, ORCID, or LinkedIn. Your data still
        lives on your disk. Signing in creates a cloud identity with an{" "}
        <strong>@handle</strong> and a researcher profile (name, institution,
        ORCID, and other typed links) that other researchers can find. It
        unlocks two sharing surfaces.
      </p>
      <ul>
        <li>
          <strong>Cross-boundary sharing.</strong> Send notes, methods, and
          files to any ResearchOS user who has an account, even if they are not
          in your folder. Recipients get a copy in their own folder. The
          transfer is end-to-end encrypted, so the relay holds only ciphertext
          and neither ResearchOS nor the relay can read what you sent.
        </li>
        <li>
          <strong>Researcher directory.</strong> You become findable by name
          and institution so collaborators can find you without an out-of-band
          email exchange.
        </li>
      </ul>
      <p>
        There is no cloud storage involved in the Free account tier. The
        sharing relay is a one-time encrypted handoff, not a persistent store.
        Your data folder doesn&apos;t leave your machine.
      </p>

      <h3>Lab (team collaboration)</h3>
      <p>
        All the sharing features of the Free account, plus real-time
        co-editing inside a lab. Notes, experiments, and notebooks sync live
        between lab members. The PI gets a{" "}
        <Link href="/wiki/features/lab-overview">Lab Overview</Link> with
        cross-member views of workload, the purchase-approval queue, and a
        running feed of lab activity.
      </p>
      <p>
        Each member&apos;s files still live on their own disk. The cloud layer
        only relays edits in real time. When you are offline, the app keeps
        working against the local copy and syncs when you reconnect.
      </p>
      <p>
        When you create a Lab account you become the Lab Head for that lab.
        Members join by following your invite link, or by finding your lab
        in the lab directory and requesting to join (you approve the request).
        The Lab tile is only shown when the Lab tier is available (it is
        currently live for free PI lab accounts).
      </p>

      <Callout variant="tip" title="Not sure which to pick?">
        Start with &ldquo;Just me, local.&rdquo; You can connect a folder,
        build out your projects, and switch to a Free account or a Lab later
        without losing any data. The tier is tied to your account, not to your
        folder.
      </Callout>

      <h2>A side-by-side comparison</h2>
      <div className="not-prose overflow-x-auto my-4">
        <table className="w-full text-body border border-border rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-surface-sunken text-foreground-muted text-meta uppercase tracking-wide">
              <th className="px-4 py-2.5 text-left font-semibold">Feature</th>
              <th className="px-4 py-2.5 text-center font-semibold">Just me, local</th>
              <th className="px-4 py-2.5 text-center font-semibold">Free account</th>
              <th className="px-4 py-2.5 text-center font-semibold">Lab</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr>
              <td className="px-4 py-2.5 text-foreground">Sign-in required</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">No</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes (OAuth)</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes (OAuth)</td>
            </tr>
            <tr className="bg-surface-sunken/40">
              <td className="px-4 py-2.5 text-foreground">Your data stays on your disk</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 text-foreground">Full Workbench, methods, sequences</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
            </tr>
            <tr className="bg-surface-sunken/40">
              <td className="px-4 py-2.5 text-foreground">Works fully offline</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes, but live co-editing needs internet</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 text-foreground">Send notes/files to other researchers</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">No</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
            </tr>
            <tr className="bg-surface-sunken/40">
              <td className="px-4 py-2.5 text-foreground">Researcher directory listing</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">No</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 text-foreground">Real-time co-editing with labmates</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">No</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">No</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
            </tr>
            <tr className="bg-surface-sunken/40">
              <td className="px-4 py-2.5 text-foreground">PI Lab Overview dashboard</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">No</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">No</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes (Lab Head)</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 text-foreground">Cloud sync for real-time collaboration</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">No</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">No</td>
              <td className="px-4 py-2.5 text-center text-foreground-muted">Yes</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>How to create a &ldquo;Just me, local&rdquo; account</h2>
      <Steps>
        <Step>
          On the start screen, choose <strong>Just me, local</strong>.
        </Step>
        <Step>
          Connect your data folder using the browser&apos;s folder picker. See{" "}
          <Link href="/wiki/getting-started/connecting-your-folder">
            Connecting your folder
          </Link>{" "}
          if you are new to this step.
        </Step>
        <Step>
          Pick a username. You land on your Workbench.
        </Step>
      </Steps>

      <h2>How to create a Free account</h2>
      <Steps>
        <Step>
          On the start screen, choose <strong>Free account</strong>.
        </Step>
        <Step>
          Sign in with Google, GitHub, ORCID, or LinkedIn. This creates a
          cloud identity with an <strong>@handle</strong> and a researcher
          profile other researchers can find in the directory. The sign-in
          happens once, and ResearchOS remembers it so you don&apos;t have to
          sign in again on this device.
        </Step>
        <Step>
          Connect your data folder. Your folder stays on your machine. The
          OAuth credential is stored only in your browser, not in your folder.
        </Step>
        <Step>
          Pick a username. You land on your Workbench. The sharing features
          are now active.
        </Step>
      </Steps>

      <h2>How to create a Lab</h2>
      <Steps>
        <Step>
          On the start screen, choose <strong>Lab</strong>, then{" "}
          <strong>Create a new lab</strong>.
        </Step>
        <Step>
          Sign in with Google, GitHub, ORCID, or LinkedIn.
        </Step>
        <Step>
          Give your lab a name. This becomes the display name in the lab
          directory.
        </Step>
        <Step>
          Connect your data folder. You are now the Lab Head for this lab.
        </Step>
        <Step>
          Invite your team. The lab settings screen gives you an invite link
          to share. Anyone who follows it and signs in is added as a member
          pending your approval.
        </Step>
      </Steps>

      <h2>How to join an existing lab</h2>
      <p>
        There are two ways to join a lab someone else created.
      </p>

      <h3>Via an invite link</h3>
      <p>
        Your Lab Head shares a link with you (by email, Slack, or any other
        channel they prefer). Follow the link, sign in if you have not already,
        connect your data folder, and pick a username. The Lab Head sees your
        join request in their Lab Overview and approves it. Once approved, your
        real-time collaboration features are active.
      </p>

      <h3>Via the lab directory</h3>
      <Steps>
        <Step>
          On the start screen, choose <strong>Lab</strong>, then{" "}
          <strong>Find and join a lab</strong>.
        </Step>
        <Step>
          Browse or search the lab directory. Each lab entry shows the Lab
          Head&apos;s name, institution, and the date the lab was created.
        </Step>
        <Step>
          Click <strong>Request to join</strong> on the lab you want. This
          sends a notification to the Lab Head.
        </Step>
        <Step>
          The Lab Head approves or declines. You will see the outcome the next
          time you open the app.
        </Step>
      </Steps>

      <Callout variant="info" title="Joining does not affect your existing data">
        When you join a lab, your folder stays exactly as it is. The
        collaboration layer connects your local data to the shared sync
        channel without moving or overwriting your files.
      </Callout>

      <h2>Cost and the free tier</h2>
      <p>
        The local app is free. The Lab plan is pay-for-what-you-use, a flat
        per-lab base fee plus your lab&apos;s actual cloud usage, billed to the
        PI.
      </p>
      <ul>
        <li>
          <strong>&ldquo;Just me, local&rdquo; and Free accounts:</strong> free,
          no cloud storage used, no billing ever.
        </li>
        <li>
          <strong>Lab accounts:</strong> a flat per-lab base fee plus your
          lab&apos;s metered cloud usage, billed only to the PI. A settable
          monthly cap keeps it predictable, and the local app keeps working if
          you hit the cap.
        </li>
      </ul>

      <Callout variant="warning" title="Pay only for what you use">
        Paid plans are pay-for-what-you-use, a small base fee plus your actual
        cloud usage at a fair markup, with storage at roughly cost. A settable
        monthly cap means no surprise bills, and the local app always keeps
        working. If a lab ever runs past its cap, cloud sync
        pauses and the local-first app keeps working until there is room again.
        See <Link href="/wiki/trust/how-we-fund-it">How it stays free</Link>{" "}
        for the broader funding story.
      </Callout>

      <h2>Upgrading later</h2>
      <p>
        None of your data is locked to a tier. If you start Local-only and
        later want sharing features, go to{" "}
        <strong>Settings &rarr; Account</strong> and sign in with OAuth to
        upgrade to a Free account. If you want to move into a lab, the Lab Head
        can send you an invite link at any point. Your folder, projects, notes,
        and methods carry over without any migration step.
      </p>

      <Callout variant="tip" title="Lab Head: you can invite someone who is already a Free account user">
        If a researcher already has a ResearchOS Free account, sending them
        your invite link is all it takes. They sign in with their existing
        identity, connect their folder, and join your lab. There is no
        separate re-registration.
      </Callout>
    </WikiPage>
  );
}
