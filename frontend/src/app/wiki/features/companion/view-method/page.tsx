import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function CompanionViewMethodPage() {
  return (
    <WikiPage
      title="View a method on your phone"
      intro="The Methods tab is your full protocol library on the phone, searchable and available offline. Tap any method to read it big and scrollable at the bench. When you change something on the fly, log the variation right there and it lands back on the laptop as a timestamped note on that method."
    >
      <p>
        Following a protocol at the bench off a laptop screen is awkward. The
        screen is across the room, the text is small, and your hands are busy.
        The Methods tab puts your entire library on the phone, sized to read at
        arm&apos;s length. And because real protocols drift, you ran the gel five
        minutes longer, you bumped the anneal temperature, the phone also lets you
        record that change without breaking stride.
      </p>

      <Screenshot
        src="/wiki/screenshots/companion-notebook-tab.png"
        alt="The Companion Notebook tab on a phone showing the View method on phone button, which opens the focused experiment's method in the big-text read mode."
        caption="The Notebook tab offers a View method on phone button when a laptop is paired. The Methods tab gives you the full offline library."
      />

      <h2>Two paths to a method</h2>
      <p>
        Methods reach the phone in two ways, and both end up in the same
        big-text read mode.
      </p>

      <h3>The Methods tab (primary path)</h3>
      <p>
        The <strong>Methods</strong> tab is the method library for the phone. It
        shows all your methods with search, type filter chips, and a sort toggle
        (by Type, A to Z, or Recent). Tap any row to open that method in read
        mode.
      </p>
      <ul>
        <li>
          <strong>Offline download.</strong> The library is cached on the phone
          so read mode works at the bench with no signal. A status chip at the
          top of the tab shows the download state: &quot;Download for offline&quot;,
          &quot;Downloading&quot;, a count of cached methods when ready, or
          &quot;Update available&quot; when the laptop has newer versions. Tap
          the chip to start the first download or apply an update.
        </li>
        <li>
          <strong>Favorites.</strong> Tap the star icon on any row to save that
          method as a favorite. Favorites are stored locally on the phone.
        </li>
        <li>
          <strong>Active-experiment recommendations band.</strong> When the
          laptop has an open experiment, a sky-tinted card appears at the top of
          the library list (above search results) showing the methods attached to
          that experiment, with a live green dot. Tapping a recommendation opens
          the focused experiment&apos;s method projection from the laptop. This
          band is hidden when you are searching or filtering.
        </li>
      </ul>

      <h3>View method on phone (Notebook tab path)</h3>
      <Steps>
        <Step>
          <p>
            On the laptop, open the experiment and go to its{" "}
            <strong>Method</strong> tab.
          </p>
        </Step>
        <Step>
          <p>
            Press <strong>View method on phone</strong>. This button appears when
            a phone is paired, so it shows up exactly when it can do something.
          </p>
        </Step>
        <Step>
          <p>
            The laptop publishes a sealed, read-only projection of the method,
            and the phone renders it large and scrollable for the bench.
          </p>
        </Step>
      </Steps>
      <p>
        The <strong>View method on phone</strong> button also appears on the
        Notebook tab, giving you a shortcut to the focused experiment&apos;s
        method without needing to navigate to it first on the laptop.
      </p>

      <h2>It reads every method type</h2>
      <p>
        The phone renders whichever kind of method the experiment uses, so a
        structured protocol stays structured rather than collapsing into a wall
        of text. That covers a{" "}
        <Link href="/wiki/features/pcr">PCR program</Link> with its thermal
        steps, an LC-MS method, a compound method, and a plain Markdown protocol.
        The projection is read-only on the phone by design, so you are reading the
        canonical method, not editing it from a small screen.
      </p>

      <Callout variant="info" title="Why the projection is sealed and read-only">
        The method is sent as a sealed projection, so the relay passes it to your
        phone without being able to read your protocol. It is read-only because
        the method of record lives on the laptop, where version history tracks
        every change. The phone is the bench-side reading surface, and the one
        thing it writes back is a variation, covered next.
      </Callout>

      <h2>Log a variation from the bench</h2>
      <p>
        When you deviate from the written method, tap <strong>Add a
        variation</strong> and describe what you actually did. The phone posts
        that back to the laptop, where it lands as a timestamped variation note
        on that experiment&apos;s method. You capture the real conditions in the
        moment they happen, instead of trying to reconstruct them from memory
        later, and the method itself stays intact with the variation recorded
        against it.
      </p>

      <Callout variant="tip" title="The method and your reality stay in sync">
        The written protocol is the plan; the variation note is what occurred.
        Keeping both, with the variation timestamped against the method, is what
        makes the record reproducible. Pair this with a{" "}
        <Link href="/wiki/features/companion/capture-and-route">
          routed photo
        </Link>{" "}
        of the result and the experiment carries both what you intended and what
        you got.
      </Callout>
    </WikiPage>
  );
}
