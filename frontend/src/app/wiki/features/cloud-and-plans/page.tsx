import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function CloudAndPlansPage() {
  return (
    <WikiPage
      title="Cloud storage and plans"
      intro="Your notebook is local-first and yours. The cloud is an optional layer for sync, sharing, and real-time collaboration, and a whole lab shares one allowance that only the lab head ever pays for."
    >
      <h2>Your data lives on your computer</h2>
      <p>
        Every note, experiment, method, sequence, image, and file is a plain
        file in a folder you own. ResearchOS reads and writes that folder, and
        that folder is always the original. Nothing uploads unless you choose to
        sync, share, or co-edit, so private work never leaves your machine and
        the app keeps working offline.
      </p>
      <p>
        The cloud does not hold your research. It holds only the optional copies
        used for the three paths below, which is why the storage limits are a
        limit on cloud copies, not on how much research you can do.
      </p>

      <h2>Three ways data can leave your machine</h2>
      <p>
        Each path is different, so it is worth being precise about what uploads
        and how it is protected.
      </p>
      <ul>
        <li>
          <strong>Private, on your disk.</strong> Your own notes and files stay
          on your machine. Nothing uploads unless you pick one of the two paths
          below.
        </li>
        <li>
          <strong>A one-time send.</strong> Send a note, method, project, or
          photo to someone. It is end-to-end encrypted and transient, deleted
          the moment they pick it up, and it does not count against the storage
          pool.
        </li>
        <li>
          <strong>Real-time collaboration.</strong> So collaborators stay in
          sync even when one of them is offline, the server holds the shared
          copy. It is encrypted in transit and at rest. This is the only copy
          that counts against the storage allowance.
        </li>
      </ul>

      <h2>The lab&apos;s shared storage allowance</h2>
      <p>
        The cloud copies count against a free allowance, and the key fact is
        that a lab shares one allowance no matter how many members join. Only
        the lab head pays. It is not per-person.
      </p>
      <ul>
        <li>
          <strong>One 5 GB free pool per lab.</strong> The whole lab shares it.
          Adding members does not add more free space, because the pool belongs
          to the lab, not to each seat.
        </li>
        <li>
          <strong>Only the PI ever pays.</strong> Members never pay and never
          see a bill. They work against the lab&apos;s ceiling, so a full lab is
          the PI&apos;s decision, not a member&apos;s problem.
        </li>
        <li>
          <strong>Solo users get their own 5 GB.</strong> A solo researcher has
          the same free tier as a lab, independent of any lab.
        </li>
      </ul>
      <Callout variant="tip" title="Text barely counts">
        Notes and methods are tiny. A lab would need roughly half a million text
        notes to fill the free pool. The pool only fills with the heavy things,
        mostly images and large file attachments in shared work.
      </Callout>

      <h2>Plans and how it is paid for</h2>
      <p>
        The local-first core is free and open source under the AGPLv3, with
        every feature included. It is supported by a UW-Madison RISE fellowship
        and by voluntary contributions. Cloud storage above the free pool comes
        as flat-price plans, priced to recover what it costs us to run rather
        than to make a profit.
      </p>
      <p>
        The plans are flat, not metered per gigabyte, so the bill is a known
        monthly number with no surprises. If a lab leans on the cloud heavily,
        the lab head can move the lab to a larger plan. Specific plan prices are
        still being set from real usage, so they are not published yet.
      </p>
      <Callout variant="info" title="Why it can stay this cheap">
        Because the app is local-first, your everyday work never touches our
        servers, so our costs are small and the price can be too. Bulk storage
        costs us about a penny and a half per gigabyte-month, so a 5 GB free
        pool costs us pennies and the paid plans only need to recover real cost.
      </Callout>
      <p>
        If you want to support the project beyond your own use, the best way is
        to buy only the storage you actually use and to support us through
        GitHub Sponsors. A sponsorship is a direct contribution that funds
        development, and a donation is not subject to sales tax the way a product
        purchase can be, so more of the money reaches the work.
      </p>

      <h2>What happens at the cap</h2>
      <p>
        Reaching the cap means paused, not charged. If a lab fills its pool,
        cloud sync pauses and nobody is billed by surprise. The local-first app
        keeps working against the folder on each person&apos;s disk, and sync
        resumes once space is freed or the lab head moves to a larger plan. Your
        data is never at risk, because it lives on your machine the whole time.
      </p>

      <Callout variant="info" title="During the beta, everything is free">
        Cloud billing is not turned on yet. The whole system is free while we
        gather real usage to set the plan prices, so nothing charges you today.
      </Callout>

      <h2>Related</h2>
      <p>
        <Link href="/wiki/getting-started/accounts">Accounts and tiers</Link>{" "}
        covers Local-only, Free, and Lab accounts.{" "}
        <Link href="/wiki/trust/how-we-fund-it">How it stays free</Link>{" "}
        explains the funding model, and{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        covers who can see what.
      </p>
    </WikiPage>
  );
}
