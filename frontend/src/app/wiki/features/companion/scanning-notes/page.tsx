import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function CompanionScanningNotesPage() {
  return (
    <WikiPage
      title="Scanning handwritten notes"
      intro="Scan a page from a paper notebook and the handwriting becomes searchable text on your laptop. The Companion reads the page with the phone's own on-device text recognition, so the words you wrote by hand end up findable in search without you retyping a line, and without the page ever being read by a server."
    >
      <p>
        Plenty of real lab notes still start on paper, a quick calculation, a
        plate map, a scribbled observation while the timer runs. Those pages are
        useful only if you can find them again, and a photo of handwriting is not
        searchable. Scanning closes that gap. You scan the page, the phone reads
        the handwriting on the device, and the laptop stores the recognized text
        next to the image so a search for a primer name or a date turns it up.
      </p>

      <Screenshot
        src="/wiki/screenshots/companion-scan.png"
        alt="The Companion document scanner on a phone, with a handwritten notebook page detected and its edges auto-cropped, ready to capture."
        caption="The native document scanner detects the page edges and cleans the scan before recognition runs."
      />
      {/* SCREENSHOT: Companion document scanner with a handwritten page framed and
          edge-detected. Capture from the dev-client. Save to
          frontend/public/wiki/screenshots/companion-scan.png */}

      <h2>Scan a page</h2>
      <Steps>
        <Step>
          <p>
            Tap <strong>Scan a handwritten note</strong> on the Notebook tab and
            hold the phone over the page. The native document scanner detects the
            page edges, rectifies the perspective, and cleans the image, so a
            photo taken at an angle comes out flat and legible.
          </p>
        </Step>
        <Step>
          <p>
            The phone runs <strong>on-device text recognition</strong> on the
            cleaned scan to extract the words. On iOS this is Apple Vision; on
            Android it is ML Kit. Either way the recognition happens on the
            phone, not on a server. The OCR result travels as its own sealed
            command, independent of the image upload, so the two never block each
            other.
          </p>
        </Step>
        <Step>
          <p>
            After the scan queues, the <strong>Notebook Chooser</strong> opens
            exactly as it does for a photo capture. Pick the experiment tab (Lab
            Notes or Results), a note, or another notebook. Choosing nothing
            leaves the scan in your laptop inbox. The OCR sidecar follows the
            image to the same destination.
          </p>
        </Step>
      </Steps>

      <h2>What lands on the laptop</h2>
      <p>
        When the laptop receives a scan, it stores the image and writes the
        recognized text into a small companion file next to it, an{" "}
        <code>{"{image}"}.ocr.json</code> sidecar. The OCR arrives as a separate
        sealed ocr-sidecar command keyed to the image&apos;s capture ID, so the
        relay carries it without being able to read it, and the sidecar is written
        wherever the image lands (inbox, experiment, or note). Because the text
        lands in the sidecar, it is indexed by search right away, and a query for
        something you wrote by hand finds the scanned page immediately.
      </p>

      <Callout variant="info" title="Recognition runs on your phone, not a server">
        The handwriting is read on the device by the phone&apos;s built-in text
        recognition, so the page itself is never sent off to a cloud service to
        be read. The relay only ever carries the sealed image and the sealed
        sidecar text, and it cannot open either. Your paper notes stay as private
        as the rest of your notebook.
      </Callout>

      <Callout variant="tip" title="The Scan button hides where there is no scanner">
        Scanning leans on the operating system&apos;s native document scanner. On
        a device or platform where that scanner is not available, the Scan button
        is not shown rather than offering a worse fallback. If you do not see it,
        your phone does not provide the native scanner the feature relies on.
      </Callout>

      <p>
        Searchable handwriting connects the paper half of your work to the
        digital half. Once a scanned page is indexed, it shows up in{" "}
        <Link href="/wiki/features/search">search</Link> right alongside your
        typed notes, so where a note started, on paper or on the keyboard, stops
        mattering for finding it again.
      </p>
    </WikiPage>
  );
}
