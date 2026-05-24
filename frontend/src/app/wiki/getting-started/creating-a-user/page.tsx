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
        ResearchOS has no central account system. Each &quot;user&quot; is
        a named folder inside <code>users/</code> in your data directory,
        with their own projects, tasks, methods, and notes underneath.
      </p>
      <p>
        In this model, <strong>the folder is the lab</strong>. Anyone with
        access to the same folder can pick a username on the user-picker and
        become a member, no invite step needed. If a folder is private to you,
        you&apos;re a lab of one. If a folder is shared via OneDrive / Google
        Drive / Dropbox / iCloud, everyone with read-write access to that
        folder is in the same lab. See{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link> for
        the cloud setup.
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
          inside it: <code>projects/</code>, <code>tasks/</code>,{" "}
          <code>dependencies/</code>, <code>methods/</code>,{" "}
          <code>events/</code>, <code>goals/</code>,{" "}
          <code>pcr_protocols/</code>, <code>purchase_items/</code>,{" "}
          <code>lab_links/</code>, <code>notes/</code>, <code>Images/</code>,{" "}
          <code>Files/</code>, and <code>_counters.json</code>.
        </Step>
      </Steps>

      <Callout variant="info" title="What happens right after Create">
        Brand-new users land in BeakerBot&apos;s welcome tour, a short guided
        walkthrough on your real account. Plan on roughly five to ten
        minutes, depending on which features you opt into. See{" "}
        <Link href="/wiki/getting-started/welcome-wizard">
          Welcome Tour (BeakerBot)
        </Link>{" "}
        for the full walkthrough, or skip it and explore on your own.
      </Callout>

      <h2>Optional password</h2>
      <p>
        If you share a laptop, or you&apos;re storing the folder in a shared
        cloud, you can set a per-user password. Go to{" "}
        <strong>Settings → Security → Set Password</strong>. The password is
        PBKDF2-hashed and stored in{" "}
        <code>users/&lt;your-name&gt;/_auth.json</code>. You can also set or
        change a password directly from the user-picker by hovering a user
        row and clicking the padlock icon that appears.
      </p>

      <Callout variant="warning" title="Password recovery">
        Forgot your password? Delete{" "}
        <code>users/&lt;your-name&gt;/_auth.json</code> from your folder (in
        Finder or Explorer) and the password gate goes away. Your data is
        untouched. This means a password isn&apos;t real security, it&apos;s a
        deterrent on a shared machine.
      </Callout>

      <h2>Switching users</h2>
      <p>
        Click your avatar in the top-right of the header, then{" "}
        <strong>Switch user</strong>. Pick another user from the list. Your view
        and data reload to that user&apos;s namespace.
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
