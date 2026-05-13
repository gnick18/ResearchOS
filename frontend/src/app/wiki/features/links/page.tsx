import WikiPage from "@/components/wiki/WikiPage";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function LinksFeaturePage() {
  return (
    <WikiPage
      title="Lab Links"
      intro="A shared bookmark library for the lab (e.g., protocol databases, ordering portals, journal access pages)."
    >
      <Screenshot
        src="/wiki/screenshots/links.png"
        alt="The Lab Links page with grouped categories and a New Link button."
        caption="Links grouped into categories. Every link is visible to every lab member."
      />

      <h2>What Lab Links is</h2>
      <p>
        A page of bookmarks, grouped into categories (e.g., Bioinformatics,
        Ordering, Journal access), that everyone in the folder sees the same
        way. Use it for the URLs every member of the lab eventually needs
        to find: the IDT ordering portal, the protocols.io account, the
        cluster login page.
      </p>

      <h2>Add a link</h2>
      <Steps>
        <Step>
          Click <strong>New Link</strong> at the top of the page.
        </Step>
        <Step>
          Paste a URL, give it a title, and pick a category (or create a new
          one).
        </Step>
        <Step>
          Save. The link appears in its category. Every lab member sees it.
        </Step>
      </Steps>

      <h2>Drag to reorder</h2>
      <p>
        Drag links within a category to reorder, or drag across categories to
        recategorize. Order is shared across the whole lab.
      </p>
    </WikiPage>
  );
}
