import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function NetworkFeaturePage() {
  return (
    <WikiPage
      title="Researcher network"
      intro="The researcher network is how your work leaves your lab. It is the shortest path from your data to a collaborator, find anyone else on ResearchOS, in your department or across the world, and share a method, sequence, dataset, or figure straight to them, with no zipped files, no email chains, and no drive permissions. It is not a feed or a follower count."
    >
      <h2>What it is for</h2>
      <p>
        Most of ResearchOS is about your own work, your methods, sequences, data,
        and figures, all kept in your own folder. The researcher network is the one
        place that looks outward, and it exists for a single purpose, to make
        sharing that work with another researcher seamless. It lives at{" "}
        <code>/network</code> and is reachable from the top navigation and the
        footer, the same way the <Link href="/wiki/features/library">icon library</Link>{" "}
        is.
      </p>
      <p>
        It is not a social network, a feed, or a publications profile to compete
        with ResearchGate. The directory, the search, and the verified-domain badge
        are all in service of one thing, getting your data to the right person with
        as little friction as possible. It never exposes an email address.
      </p>

      <h2>Find who you want to share with</h2>
      <p>
        The hub has a single search box. Type a name or an institution and it
        returns the researchers who have opted in to the directory, with their
        display name, affiliation, and a key fingerprint. Each result links to that
        person&rsquo;s public profile. The search runs over listed profiles only, so
        someone who has opted out never appears.
      </p>
      <p>
        It is especially quick for the people closest to you. Every institution has
        a public page that lists the researchers there who are on ResearchOS, so you
        can find a colleague in your own department or across your institution and
        share with them as easily as someone on the other side of the world.
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
