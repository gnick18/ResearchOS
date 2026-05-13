import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function PCRFeaturePage() {
  return (
    <WikiPage
      title="PCR Protocols"
      intro="Save reusable PCR programs (temperature steps + reagent mix) and attach them to experiments."
    >
      <Screenshot
        src="/wiki/screenshots/pcr-editor.png"
        alt="The PCR protocol editor with a temperature gradient and reagent table."
        caption="Top half is the temperature gradient editor, bottom half is the reagent table."
      />

      <h2>What a PCR protocol is</h2>
      <p>
        A <strong>PCR protocol</strong> in ResearchOS is two things saved
        together:
      </p>
      <ul>
        <li>
          A <strong>gradient</strong>: the ordered list of temperature steps
          the thermocycler will run (e.g., initial denaturation, the main
          cycle, hold). Each step has a temperature, a duration, and (for the
          cycled block) a repeat count.
        </li>
        <li>
          A <strong>reagent table</strong>: the per-reaction master mix. Each
          row is one ingredient with a stock concentration and a volume per
          reaction. Totals recompute as you type.
        </li>
      </ul>
      <p>
        The protocol mirrors the <em>snapshot-on-attach</em> model that
        Methods uses. When you attach a PCR protocol to an experiment,
        ResearchOS copies its parameters onto that experiment, so per-run
        overrides (e.g., the annealing temp was a degree off this time) stay
        on the experiment and don&apos;t dirty the shared protocol.
      </p>

      <h2>Build a protocol</h2>
      <Steps>
        <Step>
          Click <strong>New Protocol</strong>. Give it a name and an optional
          description.
        </Step>
        <Step>
          Add steps in the gradient editor. Drag points on the chart to adjust
          visually, or type exact values in the table beside it.
        </Step>
        <Step>
          Fill in the <strong>Reagents</strong> table (i.e., name, stock
          concentration, volume per reaction, final concentration). Totals
          recompute as you type.
        </Step>
        <Step>
          Save. The protocol now lives in your protocol library and shows up
          on the Attach PCR Protocol picker in any experiment.
        </Step>
      </Steps>

      <h2>Sharing</h2>
      <p>
        Protocols can be saved <strong>privately</strong> (under your user) or
        as <strong>shared</strong>, which writes to{" "}
        <code>users/public/pcr_protocols/</code> and is visible to the whole
        lab.
      </p>

      <Callout variant="tip" title="Variations stay on the experiment">
        Same model as Methods. When a PCR protocol is attached to an
        experiment, you can override volumes or cycle counts for that run
        without modifying the shared protocol.
      </Callout>
    </WikiPage>
  );
}
