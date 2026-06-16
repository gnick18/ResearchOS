import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function NetworkFeaturePage() {
  return (
    <WikiPage
      title="Researcher network"
      intro="The researcher network is the people side of ResearchOS. It is a public directory of researchers, listed by their own choice, that lets you find a colleague by name or institution, confirm who they are, and open a profile of the work they share. It needs no login to browse."
    >
      <h2>What it is</h2>
      <p>
        Most of ResearchOS is about your own work, your methods, sequences, data,
        and figures, all kept in your own folder. The researcher network is the one
        place that looks outward, at the other people using ResearchOS. It lives at{" "}
        <code>/network</code> and is reachable from the top navigation and the
        footer, the same way the <Link href="/wiki/features/library">icon library</Link>{" "}
        is.
      </p>
      <p>
        It is a discovery surface, not a messaging product. The network tells you
        who is on ResearchOS and lets you confirm that a person is who they say they
        are. It never exposes an email address.
      </p>

      <h2>Finding a researcher</h2>
      <p>
        The hub has a single search box. Type a name or an institution and it
        returns the researchers who have opted in to the directory, with their
        display name, affiliation, and a key fingerprint. Each result links to that
        person&rsquo;s public profile. The search runs over listed profiles only, so
        someone who has opted out never appears.
      </p>

      <h2>Your public profile</h2>
      <p>
        Every account has a public profile at <code>/u/your-handle</code>, the
        shareable, login-free page for your work. It shows your name, affiliation,
        avatar, a short bio, and your typed links, an ORCID record, a ResearchGate
        page, and a personal website. You edit all of it from{" "}
        <Link href="/wiki/start-here">Settings</Link> under your profile. Nothing on
        the public profile is private data, and your email is never shown.
      </p>

      <h2>Verified institutional identity</h2>
      <p>
        When you sign in with an institutional account, your profile carries a
        verified-domain badge, for example <code>wisc.edu</code>, so a collaborator
        can trust that you really are at the institution you claim. Alongside the
        badge, every profile has a key fingerprint you can read out of band to
        confirm you are sending work to the right person.
      </p>

      <h2>Listed by choice, private by default of email</h2>
      <p>
        A profile is included in the directory by default once you claim a handle,
        because being findable is the point of a network. You can opt out at any
        time, which removes you from search and from any institution member list. In
        every case the directory stays un-walkable for email, search results and
        profiles show names and affiliations, never a contact address. Reaching
        someone goes through the normal share flow, not a harvested inbox.
      </p>

      <Callout variant="info" title="Rolling out">
        The researcher network is a new surface and is being turned on gradually.
        Some parts, like live directory search and institution pages, light up as
        the directory backend is enabled. Your profile at <code>/u</code> and its
        privacy controls work today.
      </Callout>
    </WikiPage>
  );
}
