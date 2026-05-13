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
        The PCR editor has two panels stacked on top of each other:
      </p>
      <ul>
        <li>
          The <strong>gradient</strong> panel up top: the temperature steps
          the thermocycler will run (initial denaturation, the cycled block
          with its repeat count, the hold). Drag the points on the chart or
          type values in the table next to it.
        </li>
        <li>
          The <strong>reagents</strong> panel below: the per-reaction master
          mix. Each row is one ingredient with a stock concentration and a
          volume. Totals recompute as you type.
        </li>
      </ul>
      <p>
        Attaching a PCR protocol to an experiment works the same way as
        attaching a method: ResearchOS copies the gradient and reagents onto
        the experiment, you tweak whatever was off this run (e.g., the
        annealing temp), and the library copy stays untouched for the next
        person who attaches it.
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
