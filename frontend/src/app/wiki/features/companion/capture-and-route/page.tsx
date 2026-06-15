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
        src="/wiki/screenshots/companion-notebook-tab.png"
        alt="The Companion Notebook tab on a phone, showing the Take a photo and Quick note action cards at the top, the Scan a handwritten note card, and the Upload from camera roll button below."
        caption="The Notebook tab is the bench capture hub. Take a photo, write a quick note, scan a page, or upload from the camera roll."
      />

      <h2>Capture, caption, route</h2>
      <p>
        A capture is three small decisions made in a row, all on the phone, all
        at the bench.
      </p>
      <Steps>
        <Step>
          <p>
            <strong>Capture.</strong> Take a new photo with the camera, upload
            one you already have on the phone, or pick multiple from the camera
            roll. The image queues locally first, so you can shoot even with no
            signal and it uploads once the phone is paired and online.
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
            <strong>Route.</strong> After the photo uploads, the{" "}
            <strong>Notebook Chooser</strong> sheet opens. If an experiment is
            open on the laptop, you see a fast-path alert first: choose{" "}
            <strong>Lab Notes</strong>, <strong>Results</strong>, or{" "}
            <strong>More notebooks...</strong> to open the full chooser. The
            full chooser lists every notebook you can write to (your own, shared
            with edit permission, or a 1:1 notebook). Picking a notebook or
            entry files the photo there. Choosing{" "}
            <strong>Send to inbox instead</strong> leaves the photo in your
            laptop inbox to file later.
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

      <Callout variant="info" title="No experiment focused? The chooser shows all your notebooks">
        If no experiment is open on the laptop, the fast-path alert is skipped
        and the Notebook Chooser shows directly, listing every notebook you can
        write to. Choosing nothing (closing the sheet) leaves the photo in your
        inbox, where you can file it from the laptop later. A capture is never
        dropped.
      </Callout>

      <h2>Bulk upload from the camera roll</h2>
      <p>
        Uploading multiple photos at once opens the{" "}
        <strong>bulk upload screen</strong> (<code>app/bulk.tsx</code>). A grid
        shows every photo you picked, all selected by default. You can deselect
        any you do not want to send, write one caption that applies to every
        selected photo, and optionally annotate the first selected photo. Tapping{" "}
        <strong>Send to lab</strong> queues each selected photo through the same
        outbox pipeline a single capture uses. If the phone is not paired, they
        wait in the outbox until it is.
      </p>

      <h2>Annotate without touching the original</h2>
      <p>
        Some images are worth marking up: circling the product band, arrowing the
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

      <h2>Offline retry and backoff</h2>
      <p>
        Captures queue on the phone when the relay is unreachable. A failed send
        retries automatically up to two times, with increasing backoff (the row
        reads &quot;Waiting for connection&quot; while it retries). After two
        automatic attempts the row settles into a manual{" "}
        <strong>Retry</strong> link so you can try again when you have signal.
        Swipe a row left to delete it from the phone outbox; if the capture
        already reached the laptop, that copy stays there.
      </p>

      <Callout variant="tip" title="Local-first means you can shoot anywhere">
        Captures queue on the phone and upload when paired, so a cold room or a
        basement scope with no signal does not stop you. Shoot the photo, caption
        it, and the routing completes the moment the phone and laptop can reach
        the relay again.
      </Callout>
    </WikiPage>
  );
}
