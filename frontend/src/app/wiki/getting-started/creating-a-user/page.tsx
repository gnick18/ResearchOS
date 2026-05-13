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
        alt="The user-picker screen with the New User button and the existing-user list."
        caption="The user-picker screen, shown right after you connect a folder."
      />

      <h2>What &quot;user&quot; means here</h2>
      <p>
        ResearchOS has no central account system. A &quot;user&quot; is just a
        named subdirectory inside <code>users/</code> in your folder. Each user
        has their own projects, tasks, methods, and notes. Multiple users can
        share one folder (see{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link>).
      </p>

      <h2>Creating a user</h2>
      <Steps>
        <Step>
          Click <strong>New User</strong> on the user-picker screen.
        </Step>
        <Step>
          Type a username. Lowercase letters, numbers, and hyphens are safest
          across operating systems (e.g., <code>grant</code>,{" "}
          <code>sarah-lab</code>).
        </Step>
        <Step>
          A directory at <code>users/&lt;your-name&gt;/</code> is created and
          you&apos;re signed in.
        </Step>
      </Steps>

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

      <h2>The special &quot;lab&quot; user</h2>
      <p>
        Choosing <code>lab</code> on the user-picker is a shortcut. It takes
        you straight to the Lab Mode page, which aggregates data across every
        user in the folder. Useful when you want a top-down view rather than
        your own work. See <Link href="/wiki/features/lab-mode">Lab Mode</Link>.
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
