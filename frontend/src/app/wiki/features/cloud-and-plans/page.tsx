import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import {
  isBillingEnabled,
  isAiBillingEnabled,
} from "@/lib/billing/config";

export default async function CloudAndPlansPage() {
  const billingOn = isBillingEnabled();
  const aiBillingOn = isAiBillingEnabled();
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
        Notes and methods are tiny, so a lab would need roughly half a million
        text notes to fill the free pool. The pool only fills with the heavy
        things, mostly images and large file attachments in shared work. A gel
        or bench photo is about the size of a photo from a modern phone, a few
        megabytes, so the shared 5 GB still holds on the order of a thousand of
        them.
      </Callout>

      <h2>Plans and how it is paid for</h2>
      <p>
        The local-first core is free and open source under the AGPLv3, with
        every feature included. Because your data lives on your own disk there is
        very little to run, and voluntary contributions help sustain it. Cloud
        storage above the free pool comes
        as flat-price plans. Individuals and labs pay only what it costs us to
        run, and larger institutions pay a modest sustaining rate above that,
        which keeps ResearchOS free for individual researchers and funds the
        open-source development.
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

      <h2>BeakerBot AI usage (a separate meter)</h2>
      <p>
        Cloud storage is the only flat-plan item. The optional AI assistant,
        BeakerBot, is metered separately on actual use, because each turn
        calls a hosted model that costs real money. Local search and all other
        features are free forever.
      </p>
      <ul>
        <li>
          <strong>Free trial.</strong> Every new account gets a one-time
          sign-up gift of about 1.6 million tokens, no card needed. That
          covers roughly 15 full tasks or 30-plus quick questions. It is a
          one-time trial, not a recurring monthly allowance.
        </li>
        <li>
          <strong>After the trial, prepaid top-ups.</strong> No subscription.
          You add credit when you want it and pay only for what you use. Your
          current balance and the cost of the last task are always visible.
        </li>
        <li>
          <strong>What tasks actually cost.</strong> A quick question is about
          50,000 tokens. A full task that reads across your work is about
          110,000 tokens. Near our cost, a full task is about two cents of
          compute.
        </li>
        <li>
          <strong>Balance is shown in tokens.</strong> A token is a small
          chunk of text. Your balance is always shown in tokens, paired with
          a plain-value hint and a note that cost varies with question size.
        </li>
        <li>
          <strong>Labs can fund a shared AI pool.</strong> A lab, department,
          or institution can fund a shared pool so members never enter a card.
        </li>
      </ul>
      {aiBillingOn ? (
        <Callout variant="info" title="BeakerBot is billed at cost">
          AI metering is active. Each BeakerBot turn draws from your token
          balance at the rate shown on the pricing page. The cost is what the
          AI actually costs us, nothing more. Sales tax is handled automatically
          by our payment processor.
        </Callout>
      ) : (
        <Callout variant="info" title="BeakerBot billing is off during the beta">
          The AI meter is built but not yet active. During the beta, every
          BeakerBot turn is free. The trial balance will be applied when billing
          turns on.
        </Callout>
      )}

      <h2>Account tiers</h2>
      <p>
        There are four audiences, and each picks from a fixed set of plans.
        Individuals and labs choose from Free, Plus, and Pro bundles (with
        Lab variants for labs). Departments and institutions use an automated
        self-serve plan builder instead of a fixed bundle. The structure is
        locked and final. The only item not yet published is the Plus and Pro
        sticker prices, which will be set from real usage before launch.
      </p>
      <ul>
        <li>
          <strong>Free</strong> (individuals and labs). 5 GB shared pool,
          full feature access, no card, no expiry. A real working tier, not
          a trial.
        </li>
        <li>
          <strong>Plus and Pro</strong>. Larger storage pools. Prices are
          provisional and not yet published.
        </li>
        <li>
          <strong>Lab Free / Lab Plus / Lab Pro</strong>. The same tiers as
          above, with a shared pool covering the whole lab. Only the PI pays.
        </li>
        <li>
          <strong>Department and Institution</strong>. Self-serve automated
          plan builder at <code>/pricing</code>. You enter labs, average
          members, and estimated adoption, and it derives a monthly rate. A
          modest sustaining rate above bare cost on these larger tiers keeps
          ResearchOS free for individual researchers and funds open-source
          development.
        </li>
      </ul>

      <h2>What happens at the cap</h2>
      <p>
        Reaching the cap means paused, not charged. If a lab fills its pool,
        cloud sync pauses and nobody is billed by surprise. The local-first app
        keeps working against the folder on each person&apos;s disk, and sync
        resumes once space is freed or the lab head moves to a larger plan. Your
        data is never at risk, because it lives on your machine the whole time.
      </p>

      {billingOn ? (
        <Callout variant="info" title="Cloud billing is active">
          Cloud storage and optional AI are billed at what they cost us. Sales
          tax is handled automatically by our payment processor. The local
          notebook and all core features are free forever.
        </Callout>
      ) : (
        <Callout variant="info" title="During the beta, everything is free">
          Cloud billing is not turned on yet. The whole system is free while we
          gather real usage to set the plan prices, so nothing charges you today.
        </Callout>
      )}

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
