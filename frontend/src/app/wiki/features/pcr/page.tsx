import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function PCRFeaturePage() {
  return (
    <WikiPage
      title="PCR Protocols"
      intro="Save reusable PCR programs (temperature steps plus reagent mix) and attach them to experiments the same way you attach a method."
    >
      <Screenshot
        src="/wiki/screenshots/pcr-editor.png"
        alt="The PCR protocol editor showing the thermal gradient at the top with colored temperature blocks for each step, including one or more purple-outlined cycled sections, and the Reaction Recipe table below."
        caption="The protocol editor. One or more cycled sections (purple dashed rectangles) can sit side by side in the gradient, each with its own repeat count and its own set of steps."
      />

      <h2>What a PCR protocol is</h2>
      <p>
        Each protocol opens in a popup with two panels stacked on top of each
        other.
      </p>
      <ul>
        <li>
          The <strong>Thermal Gradient</strong> panel up top is a left-to-right
          row of colored square blocks, one per step. Each block shows the
          temperature and duration of that step. A purple dashed rectangle
          wraps the cycled section and carries a small <code>x30</code> badge
          for the repeat count.
        </li>
        <li>
          The <strong>Reaction Recipe</strong> panel below has one row per
          ingredient with a stock concentration and a per-reaction volume in
          microliters. The bottom <em>Total</em> row is a manual entry where
          you type the target reaction volume. It looks identical to the
          ingredient rows above it (no input border, no edit affordance), so
          click into the volume cell and type your target volume.
        </li>
      </ul>
      <p>
        It is the same library-plus-variation pattern as{" "}
        <Link href="/wiki/features/methods">Methods</Link>. ResearchOS keeps
        the saved protocol in your library and copies its gradient and reagent
        values onto each experiment that attaches it.
      </p>

      <h2>The four zones of a program</h2>
      <p>
        Reading the gradient panel left to right, every protocol moves through
        four zones in this order. The default that a brand-new protocol starts
        with shows all four, so a new protocol is also the quickest way to see
        the layout. A protocol can contain more than one cycled block when the
        chemistry calls for it (for example, a touch-down PCR with two
        consecutive cycle rectangles at different annealing temperatures). Each
        cycled block has its own repeat count and its own set of steps, all
        within the same gradient.
      </p>
      <ul>
        <li>
          An <strong>initial step</strong> is one or more blocks that run
          once before the cycled section. Typically this is initial
          denaturation around 95 °C for three minutes, painted red.
        </li>
        <li>
          The <strong>cycled block</strong> is a group of blocks wrapped in a
          purple dashed rectangle, repeated end-to-end by the count on the
          purple badge above it (30 by default). The usual three are
          denaturation, annealing, and extension. Steps inside this block
          carry a faint purple ring so you can tell at a glance which blocks
          are inside the cycle.
        </li>
        <li>
          A <strong>final step</strong> is one or more blocks after the
          cycled block that run once. Typically final extension at 72 °C for
          five minutes.
        </li>
        <li>
          The <strong>hold</strong> is a single block at the right end with
          the duration <em>Indef.</em>, parking the thermocycler at a low
          temperature (12 °C by default) until you come back to it. Painted
          blue.
        </li>
      </ul>
      <p>
        Block color is keyed to temperature across six bands, blue (≤ 15 °C),
        cyan (≤ 30 °C), green (≤ 50 °C), amber (≤ 70 °C), orange (≤ 85 °C),
        and red (above 85 °C). A step typed in at the wrong temperature is
        visually obvious because its color doesn&apos;t match its neighbors.
      </p>

      <h2>Build a protocol step by step</h2>
      <Steps>
        <Step>
          Go to <Link href="/wiki/features/methods">Methods</Link> and click{" "}
          <strong>+ New Method</strong>. In the type picker that opens, choose
          the <strong>PCR</strong> type. That drops you into the protocol
          editor. Type a name into the <strong>Method Name</strong> field at
          the top of the popup.
        </Step>
        <Step>
          The gradient panel opens with a sensible default loaded in (initial
          denaturation, the three-step cycle at 30 repeats, final extension,
          and a hold). Click the <strong>Edit Cycle</strong> button on the
          toolbar to enter editing mode. The blocks start jiggling to signal
          that they are now interactive.
        </Step>
        <Step>
          <strong>Edit any block.</strong> Double-click a block to open the
          Edit Step popup. It has three fields, <em>Step Name</em> (e.g.{" "}
          <em>Annealing</em>), <em>Temperature (°C)</em> as a number input,
          and <em>Duration</em> as free text (e.g. <em>20 sec</em>,{" "}
          <em>2 min</em>). The <em>Hold</em> checkbox next to the duration
          field locks duration to <em>Indef.</em> for the parking step.
        </Step>
        <Step>
          <strong>Reorder.</strong> Single-click a block to select it (a blue
          ring appears) and a pair of <strong>← →</strong> arrow buttons drop
          in above the block. The arrows swap the block with its neighbor.
          The arrows step <em>around</em> the cycled block rather than into
          it. A block outside the cycle stays outside, and a block inside the
          cycle stays inside.
        </Step>
        <Step>
          <strong>Move a step in or out of the cycle.</strong> When a block
          inside the cycled rectangle is selected, a red{" "}
          <strong>Remove from Cycle</strong> button appears next to the
          arrows. When a block outside the cycle is selected, a purple{" "}
          <strong>Add to Cycle</strong> button appears with a dropdown
          listing each cycle by position and repeat count (e.g.,{" "}
          <em>Cycle 1 (x30)</em>, <em>Cycle 2 (x30)</em>). Cycles have no
          name field, so the positional label is the only identifier. Pick a
          cycle and the block jumps into its rectangle.
        </Step>
        <Step>
          <strong>Adjust the repeat count.</strong> Click the purple{" "}
          <code>x30</code> badge above the cycled rectangle to open the Edit
          Cycle Repeats popup. Type a new number (1–100) and save.
        </Step>
        <Step>
          <strong>Add or remove blocks.</strong> The toolbar has{" "}
          <strong>+ Add Step</strong> (opens a{" "}
          <strong>StepEditPopup</strong> pre-populated with{" "}
          &quot;New Step&quot;, 60 °C, 30 sec, where the block only lands in
          the gradient after you click <strong>Save</strong>) and{" "}
          <strong>+ Add Cycle</strong> (opens an{" "}
          <strong>Add Empty Cycle</strong> confirmation modal with{" "}
          <strong>Cancel</strong> and <strong>Add</strong> buttons, where the
          new empty cycled rectangle only appears after you click{" "}
          <strong>Add</strong>, and you fill it by adding steps and using{" "}
          <em>Add to Cycle</em>). To delete, switch on the red{" "}
          <strong>Gradient Eraser</strong> and click any block to remove it.
          The purple <strong>Cycle Eraser</strong> works differently. Click a{" "}
          <code>x30</code> badge and it removes just the cycle rectangle,
          leaving its steps behind as ordinary final steps. In normal (non-
          eraser) mode, clicking the same <code>x30</code> badge opens the{" "}
          <strong>Edit Cycle Repeats</strong> popup so you can change the
          repeat count. <strong>Clear All</strong> wipes the whole gradient
          back to empty.
        </Step>
        <Step>
          Hit <strong>Done Editing</strong> to leave editing mode. The
          jiggle stops and the toolbar collapses.
        </Step>
        <Step>
          Scroll down to <strong>Reaction Recipe</strong>. Fill in each row
          with a stock concentration (e.g. <em>10x</em>) and a per-reaction
          volume in microliters. Use <strong>+ Add Row</strong> at the bottom
          of the table to add ingredients, and the <strong>x</strong> on each
          row to remove one. The <em>Total</em> row at the bottom is a manual
          entry. Type your target reaction volume there so it sits next to the
          ingredient rows and you can eyeball whether the ingredients add up.
        </Step>
        <Step>
          Type any free-text <strong>Notes</strong> (lot numbers, master mix
          quirks, the day&apos;s primer pair). Click{" "}
          <strong>Create Method</strong>. The card appears in your
          protocol library and shows up in the <strong>Attach a method</strong>{" "}
          picker on any experiment.
        </Step>
      </Steps>

      <Screenshot
        src="/wiki/screenshots/pcr-step-edit.png"
        alt="The Edit Step popup with fields for step name, temperature, and duration, plus a Hold checkbox."
        caption="Double-click any block to open the Edit Step popup."
      />

      <h2>Attaching a protocol to an experiment</h2>
      <p>
        From an experiment popup, the <strong>Attach a method</strong>{" "}
        picker shows every method and protocol in your library, your own and
        any in the public folder. Pick a PCR protocol and ResearchOS copies the
        gradient and the reagent table onto that experiment.
      </p>
      <p>
        From that point on, the experiment carries its own copy. Bump the
        annealing temperature by a degree, add another microliter of primer,
        knock the cycle count down to 28 for a low-template run. The
        experiment records the variation and the library protocol stays
        exactly as you left it. The next experiment that attaches the same
        protocol starts from the unedited values.
      </p>

      <Screenshot
        src="/wiki/screenshots/pcr-reagent-totals.png"
        alt="The Reaction Recipe table showing ingredient rows, each with a checkoff checkbox on the left side and stock concentration and volume columns, plus the Total row at the bottom."
        caption="The recipe table. Each ingredient row has a checkoff checkbox at the left. The Total row at the bottom is a manual entry for your target reaction volume and has no checkbox."
      />

      <h2>Checking off ingredients at the bench</h2>
      <p>
        When you open a PCR protocol on an experiment (via the{" "}
        <strong>Method</strong> tab), the Reaction Recipe table gains a{" "}
        <strong>checkoff column</strong> on the left. Each ingredient row has
        a small checkbox. Tick it as you pipette each reagent into your
        tube. Checked rows turn green and a progress bar at the top of the
        table advances from left to right as you work through the recipe,
        with an <em>X/Y checked</em> count beside it. The Total row has no
        checkbox and is left out of that count (it&apos;s a math row, not an
        ingredient). Checkoff state is per-experiment and does not affect
        the library protocol.
      </p>

      <h2>Sharing</h2>
      <p>
        A PCR protocol is a method like any other, and it shares the same
        Private/Public pill as every other method type. Open the protocol and
        click the <strong>Private</strong> pill in the header to open the share
        popup. Select <strong>All Lab Users</strong> and click{" "}
        <strong>Apply</strong>. The pill flips to <strong>Public</strong> and
        the protocol appears in every labmate&apos;s method picker. See{" "}
        <Link href="/wiki/features/methods">Methods Library</Link> for the full
        sharing model.
      </p>

      <Callout variant="tip" title="Variations stay on the experiment">
        Same model as Methods. When a PCR protocol is attached to an
        experiment, any edits to volumes, temperatures, or cycle counts apply
        only to that run. The library copy stays untouched for the next
        person who attaches it.
      </Callout>
    </WikiPage>
  );
}
