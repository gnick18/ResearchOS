import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function CompanionViewMethodPage() {
  return (
    <WikiPage
      title="View a method on your phone"
      intro="Send the method for the experiment you are running to your phone, where it reads big and scrolls cleanly at the bench. When you change something on the fly, log the variation right there and it lands back on the laptop as a timestamped note on that method, so what you actually did is recorded while it is fresh."
    >
      <p>
        Following a protocol at the bench off a laptop screen is awkward. The
        screen is across the room, the text is small, and your hands are busy.
        Viewing the method on your phone puts the steps where you are working,
        sized to read at arm&apos;s length. And because real protocols drift, you
        ran the gel five minutes longer, you bumped the anneal temperature, the
        phone also lets you record that change without breaking stride.
      </p>

      <Screenshot
        src="/wiki/screenshots/companion-method.png"
        alt="A method rendered on a phone in the Companion, with large scrollable steps and an Add a variation button at the bottom."
        caption="A method projected to the phone, rendered large and scrollable, with the option to log a variation."
      />
      {/* SCREENSHOT: Companion method viewer on a phone showing a rendered method
          and the Add a variation action. Capture from the dev-client. Save to
          frontend/public/wiki/screenshots/companion-method.png */}

      <h2>Send a method to the phone</h2>
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
