import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function CreatingAUserPage() {
  return (
    <WikiPage
      intro="Each person in the folder picks a unique username. Their data lives under users/<username>/."
    >
      <Screenshot
        src="/wiki/screenshots/user-login.png"
        alt="The user-picker screen with the + Create New User button, the existing-user list, and the BeakerBot brand mark in the gradient pill at the top."
        caption="The user-picker screen, shown right after you connect a folder. (Screenshot pending recapture; the Lab Mode button shown in older captures has been removed and the BeakerBot brand mark added. Use ?wikiCapture=1 when recapturing.)"
      />

      <h2>What &quot;user&quot; means here</h2>
      <p>
        Each &quot;user&quot; is a named folder inside <code>users/</code> in
        your data directory, with their own projects, tasks, methods, and notes
        underneath. ResearchOS has cloud accounts (Free and Lab tiers) that are
        separate from and independent of the data folder. An account lets you
        sign in with Google, GitHub, ORCID, or LinkedIn, gives you an{" "}
        <strong>@handle</strong> and a researcher profile, and enables sharing
        and real-time co-editing. The data folder is always local.
      </p>
      <p>
        On a folder that is shared via OneDrive / Google Drive / Dropbox /
        iCloud, everyone with read-write access can pick or create a username
        on the user-picker. Cloud accounts and the Lab tier are the preferred
        way to collaborate. See{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link> for
        the legacy shared-folder cloud setup, and{" "}
        <Link href="/wiki/getting-started/accounts">Accounts</Link> for the
        cloud account tiers.
      </p>

      <h2>Creating a user</h2>
      <Steps>
        <Step>
          On the user-picker screen, click <strong>+ Create New User</strong>{" "}
          and type a username in the input field. The app accepts{" "}
          <strong>letters, numbers, and underscores only</strong> (e.g.,{" "}
          <code>grant</code>, <code>sarah_lab</code>). Hyphens are not
          accepted and will trigger a validation error.
        </Step>
        <Step>
          Click <strong>Create &amp; Login</strong>.
        </Step>
        <Step>
          A directory at <code>users/&lt;your-name&gt;/</code> is created and
          you&apos;re signed in. The app initializes a full subdirectory tree
          inside it, with <code>projects/</code>, <code>tasks/</code>,{" "}
          <code>dependencies/</code>, <code>methods/</code>,{" "}
          <code>events/</code>, <code>goals/</code>,{" "}
          <code>pcr_protocols/</code>, <code>purchase_items/</code>,{" "}
          <code>lab_links/</code>, <code>notes/</code>, <code>Images/</code>,{" "}
          <code>Files/</code>, and <code>_counters.json</code>.
        </Step>
      </Steps>

      <Callout variant="info" title="What happens right after Create">
        Once your user exists, you&apos;re signed in and the app is ready to go.
        Explore at your own pace. A good place to start is your first project,
        covered in{" "}
        <Link href="/wiki/getting-started/welcome-wizard">
          Getting Started
        </Link>.
      </Callout>

      <h2>Optional password</h2>
      <p>
        A password is optional only when you&apos;re a genuinely solo folder
        (one user, no PI). The moment a folder is shared (two or more users) or
        a PI is present, every account needs a login, so the password becomes
        required. To set one, open <strong>Settings</strong> from your avatar
        in the header and find the password section, then click{" "}
        <strong>Set password</strong> (it reads <strong>Change password</strong>{" "}
        once you have one). The password unlocks that account&apos;s local keypair,
        which is wrapped and stored in{" "}
        <code>users/&lt;your-name&gt;/_account.json</code> on your disk and
        never sent to any server. (An older PBKDF2{" "}
        <code>_auth.json</code> file was retired, the app cleans up any leftover
        copies on its own.)
      </p>

      <Callout variant="warning" title="Password recovery">
        When you first set a password, the app shows a one-time recovery code
        (twelve words). Save it somewhere safe, because it&apos;s the only way
        back in if you forget the password. On the sign-in screen, click your
        account and choose <strong>Use your recovery code</strong> instead of
        the password. A password isn&apos;t real security here, the raw markdown
        and images stay readable to anyone with folder access, it&apos;s a
        deterrent on a shared machine. (For a solo folder you can also remove
        the login outright from that same password section in Settings, but a
        shared folder keeps the login by policy.)
      </Callout>

      <Callout variant="info" title="PI accounts always have a password">
        The optional password above is for members and solo accounts. A PI
        (an account flagged <code>account_type === &quot;lab_head&quot;</code>)
        is the exception. A PI must set a password during account setup before
        they can finish, and it&apos;s enforced at login. So there&apos;s never
        a PI account with no password behind it.
      </Callout>

      <h2>Switching users</h2>
      <p>
        Click your avatar in the top-right of the header, then{" "}
        <strong>Switch user</strong>. Pick another user from the list. Your view
        and data reload to that user&apos;s namespace.
      </p>
      <p>
        If any accounts have been archived (a way to retire a member without
        deleting their data), they&apos;re hidden from the picker by default. A{" "}
        <strong>Show archived</strong> link appears below the user grid whenever
        archived accounts exist, so an occasional returner can reveal their tile
        and sign back in.
      </p>

      <h2>Main user</h2>
      <p>
        One user can be marked as the <strong>main user</strong>. They get a
        star badge on their avatar in the picker and are auto-selected as the
        default on the next visit. To set a main user, hover any user row on
        the picker and click the star (outline) icon that appears on the
        right. The main badge persists between sessions.
      </p>

      <h2>Renaming or deleting a user</h2>
      <p>
        To <strong>rename</strong> a user, hover their row on the user-picker
        and click the pencil (edit) icon. The row switches to an inline input
        with the current username pre-filled. Edit the name and press{" "}
        <strong>Enter</strong> or click the green checkmark to save. Press{" "}
        <strong>Escape</strong> or the red X to cancel. The same username
        rules apply (letters, numbers, underscores only). The rename
        renames the <code>users/&lt;old-name&gt;/</code> directory on disk
        and updates all internal references.
      </p>
      <p>
        To <strong>delete</strong> a user, hover their row and click the trash
        icon. A two-step confirmation dialog appears with an optional
        &ldquo;Archive data before deletion&rdquo; checkbox (checked by
        default). The archive step downloads a ZIP of the user&apos;s folder
        before the directory is removed.
      </p>
    </WikiPage>
  );
}
