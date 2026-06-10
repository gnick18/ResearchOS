import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function CompanionCaptureRoutePage() {
  return (
    <WikiPage
      title="Capture and route"
      intro="Take a photo at the bench, caption it, and send it straight into the experiment it belongs to. Capture and route is the difference between a phone full of unlabeled gel photos and a notebook where every image is already filed under the right experiment, in the right tab, the moment you walk away from the bench."
    >
      <p>
        The everyday problem the Companion solves is the camera roll. You photograph
        a gel, a plate, a colony, a whiteboard, and three days later you are
        squinting at twenty near-identical images trying to remember which
        experiment each one was for. Capture and route fixes that at the source.
        When you take the photo, you also say where it goes, and the laptop files
        it there for you.
      </p>

      <Screenshot
        src="/wiki/screenshots/companion-capture.png"
        alt="The Companion capture screen on a phone, showing a just-taken gel photo with a caption field and a destination chooser below it."
        caption="A fresh capture with its caption and the destination it will be routed into."
      />
      {/* SCREENSHOT: Companion capture screen on a phone with a photo taken,
          caption field, and the Notebook Chooser destination. Capture from the
          dev-client. Save to frontend/public/wiki/screenshots/companion-capture.png */}

      <h2>Capture, caption, route</h2>
      <p>
        A capture is three small decisions made in a row, all on the phone, all
        at the bench.
      </p>
      <Steps>
        <Step>
          <p>
            <strong>Capture.</strong> Take a new photo with the camera, or upload
            one you already have on the phone. The image queues locally first, so
            you can shoot even with no signal and it uploads once the phone is
            paired and online.
          </p>
        </Step>
        <Step>
          <p>
            <strong>Caption.</strong> Add a short caption while you still
            remember what you are looking at (&quot;Colony PCR, lanes 1 to 8,
            expecting 1.2 kb&quot;). This is the line you will be glad you wrote
            when you find the image later.
          </p>
        </Step>
        <Step>
          <p>
            <strong>Route.</strong> Pick the destination in the{" "}
            <strong>Notebook Chooser</strong> sheet. You choose the experiment
            and whether the image lands in its{" "}
            <strong>Lab Notes</strong> or its <strong>Results</strong> tab.
          </p>
        </Step>
      </Steps>

      <h2>How routing reaches the right experiment</h2>
      <p>
        When you pick a destination, the phone sends the laptop a sealed
        route-capture command alongside the image. That command tells the laptop
        which experiment and which tab to file the photo into, so the laptop does
        the filing rather than you doing it by hand later. The command is sealed
        end-to-end to your phone&apos;s key, so the relay carries the instruction
        without being able to read it, and the photo itself is deleted from the
        relay the instant the laptop pulls it down.
      </p>

      <Callout variant="info" title="No experiment focused? It lands in your Inbox">
        If no experiment is open and focused on the laptop, a routed capture has
        nowhere obvious to go, so it lands in your{" "}
        <Link href="/wiki/features/notifications">Inbox</Link> instead of being
        lost. You file it into an experiment from there when you are back at the
        laptop, so a capture is never dropped just because nothing was selected.
      </Callout>

      <h2>Annotate without touching the original</h2>
      <p>
        Some images are worth marking up, circling the product band, arrowing the
        colony you picked. The Companion lets you draw an annotation overlay on a
        capture, and that overlay is saved as a separate{" "}
        <code>.annot.json</code> file next to the image rather than painted into
        the photo. The original capture stays byte-for-byte the file your camera
        produced, and the markup stays re-editable and removable. This is the same
        sidecar model used by{" "}
        <Link href="/wiki/features/image-annotation">image annotation</Link> on
        the laptop, so a capture you annotate on the phone reads correctly
        everywhere the image appears.
      </p>

      <Callout variant="tip" title="Local-first means you can shoot anywhere">
        Captures queue on the phone and upload when paired, so a cold room or a
        basement scope with no signal does not stop you. Shoot the photo, caption
        it, choose where it goes, and the routing completes the moment the phone
        and laptop can reach the relay again.
      </Callout>
    </WikiPage>
  );
}
