import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function ResearchersFeaturePage() {
  return (
    <WikiPage
      title="Researcher directory"
      intro="The researcher directory is the opt-in, in-app way to find another researcher on ResearchOS and share your work with them. Search by name or institution from inside the app, confirm who you are sharing with using a verified-institution badge and a key fingerprint, and reach a shareable profile page for anyone listed. It is the in-app counterpart to the public discovery hub."
    >
      <h2>What it is for</h2>
      <p>
        Most of ResearchOS is about your own work. The researcher directory is the
        piece that helps you get that work to someone else. It lives at{" "}
        <code>/researchers</code> and exists for one purpose, to let you find a
        colleague or collaborator who is also on ResearchOS and share a method,
        sequence, dataset, or figure straight to them.
      </p>

      <h2>Find a researcher</h2>
      <p>
        Search the directory by name or by institution from inside the app. Results
        return the researchers who have opted in, so you can find a labmate, a
        collaborator across campus, or someone at another institution and start
        sharing without leaving your workspace.
      </p>

      <h2>Confirming who you are sharing with</h2>
      <p>
        Each result carries a verified-institution badge, so you can trust that a
        person really is at the institution they claim. Alongside the badge, every
        researcher has a key fingerprint. Confirm that fingerprint out of band, over
        a channel you already trust, before you share, and you know your work is
        going to the right person and no one else.
      </p>
      <Callout variant="info" title="Why the out-of-band check matters">
        The verified-institution badge tells you where someone is, and the key
        fingerprint tells you it is really them. Reading the fingerprint back over a
        channel you already trust is the step that makes secure sharing certain
        rather than hopeful.
      </Callout>

      <h2>Shareable profile pages</h2>
      <p>
        Every listed researcher has a standalone, shareable profile page at{" "}
        <code>/researchers/&lt;fingerprint&gt;</code>. It is a stable address you can
        link to, and the fingerprint in the URL is the same one you confirm before
        sharing.
      </p>

      <h2>How it relates to the public hub</h2>
      <p>
        It is worth keeping two surfaces straight. The researcher directory at{" "}
        <code>/researchers</code> is the in-app directory you use while you work. The{" "}
        <Link href="/wiki/features/network">public discovery hub</Link> is the
        public, login-free hub that looks outward. They serve the same goal,
        connecting your work to other researchers, from two sides, one inside the
        app and one open to the world.
      </p>

      <h2>Listed by choice, email never shown</h2>
      <p>
        You appear in the directory only by opting in, and you can change that at any
        time. When you are listed, the directory shows your name and affiliation, and
        it never shows your email address. Reaching someone goes through the normal
        share flow, never a harvested inbox.
      </p>
      <Callout variant="info" title="Rolling out">
        The researcher directory is a new surface and is being turned on gradually.
        Live directory search and profile pages light up as the directory backend is
        enabled, and your own listing and its privacy controls are yours to set.
      </Callout>
    </WikiPage>
  );
}
