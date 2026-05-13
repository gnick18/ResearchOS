import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function PCRFeaturePage() {
  return (
    <WikiPage
      title="PCR Protocols"
      intro="Build PCR programs with a visual gradient editor, then attach them to experiments."
    >
      <Screenshot
        src="/wiki/screenshots/pcr-editor.png"
        alt="The PCR protocol editor with a temperature gradient and reagent table."
      />

      <h2>Build a protocol</h2>
      <Steps>
        <Step>
          Click <strong>New Protocol</strong>. Give it a name and an optional
          description.
        </Step>
        <Step>
          Add steps in the gradient editor. Each step has a temperature, a
          duration, and an optional cycle count. Drag points on the chart to
          adjust visually, or type exact values in the table.
        </Step>
        <Step>
          Fill in the <strong>Reagents</strong> table (e.g., name, stock
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
        Same model as methods. When a PCR protocol is attached to an
        experiment, you can override volumes or cycle counts for that run
        without modifying the shared protocol.
      </Callout>
    </WikiPage>
  );
}
