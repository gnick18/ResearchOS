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
        alt="The user-picker screen with the + Create New User button, the existing-user list, and a Lab Mode button."
        caption="The user-picker screen, shown right after you connect a folder."
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
          and type a username in the input field. Lowercase letters, numbers,
          and hyphens are safest across operating systems (e.g.,{" "}
          <code>grant</code>, <code>sarah-lab</code>).
        </Step>
        <Step>
          Click <strong>Create</strong>.
        </Step>
        <Step>
          A directory at <code>users/&lt;your-name&gt;/</code> is created and
          you&apos;re signed in.
        </Step>
      </Steps>

      <Callout variant="info" title="What happens right after Create">
        Brand-new users land in a seven-step welcome wizard that picks the
        tabs you see and offers to set up Telegram, a calendar feed, and an
        AI Helper prompt. See{" "}
        <Link href="/wiki/getting-started/welcome-wizard">
          The Welcome Wizard
        </Link>{" "}
        for the full walkthrough, or skip it and explore on your own.
      </Callout>

      <h2>Optional password</h2>
      <p>
        If you share a laptop, or you&apos;re storing the folder in a shared
        cloud, you can set a per-user password. Go to{" "}
        <strong>Settings → Profile → Set Password</strong>. The password is
        PBKDF2-hashed and stored in{" "}
        <code>users/&lt;your-name&gt;/_auth.json</code>.
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

      <h2>Jumping straight to Lab Mode</h2>
      <p>
        The user-picker has a dedicated <strong>Lab Mode</strong> button below
        the user list. Clicking it skips picking a personal user and takes you
        straight to the Lab Mode page, which aggregates data across every user
        in the folder. Useful when you want a top-down view rather than your
        own work. See <Link href="/wiki/features/lab-mode">Lab Mode</Link>.
      </p>

      <h2>Renaming or deleting a user</h2>
      <p>
        There&apos;s no in-app rename today. To rename, close ResearchOS,
        rename the <code>users/&lt;old-name&gt;/</code> directory in Finder /
        Explorer, and reopen the app. To delete a user, delete that
        subdirectory the same way.
      </p>
    </WikiPage>
  );
}
