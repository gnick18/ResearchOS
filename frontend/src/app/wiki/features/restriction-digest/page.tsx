import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function RestrictionDigestFeaturePage() {
  return (
    <WikiPage
      title="Restriction digest"
      intro="The restriction digest tools find where enzymes cut your sequence, what overhangs they leave, and what fragment sizes you would see on a gel."
    >
      <Callout variant="info" title="Split out of the Sequences page">
        This page used to be one section of the{" "}
        <Link href="/wiki/features/sequences">Sequences</Link> workbench page. The
        enzyme catalog and digest tools grew enough depth to stand on their own, so
        they live here now. The digest still runs inside the Sequences editor, on
        whatever sequence you have open.
      </Callout>

      <h2>What a digest tells you</h2>
      <p>
        A restriction enzyme recognizes a short, specific sequence of DNA and cuts
        the double helix at or near that site. Knowing where an enzyme cuts a
        plasmid, and how many times, is the everyday question behind picking cloning
        sites, designing a diagnostic digest, and reading a gel. The restriction
        digest tools in the{" "}
        <Link href="/wiki/features/sequences">Sequences</Link> workbench answer that
        question for any DNA sequence you have open. They tell you which enzymes cut,
        at what positions, on which strand, what overhang each cut leaves, and what
        fragment sizes result.
      </p>
      <p>
        The digest is a display layer on the open sequence. Turn on the Enzyme
        sites chip in the display strip above the viewer to overlay cut sites on
        the circular or linear map, and open the enzyme picker (the Choose enzymes
        action under the Cut operation in the right sidebar) to choose which
        enzymes are active. The digest overlay itself saves nothing. The active
        enzyme set lives in the editor&apos;s view state for the session, though
        you can name and keep a set of your own from the picker (see below).
      </p>

      <TryInDemo href="/sequences">Try the Sequences workbench</TryInDemo>

      <Screenshot
        src="/wiki/screenshots/restriction-digest-map.png"
        alt="A circular plasmid map of pEGFP-N1 with restriction cut sites overlaid as labeled tick marks around the ring (NcoI, XhoI, NotI, SphI and others), each with a leader line to its cut position, shown beside the base-level sequence."
        caption="Cut sites overlaid on the plasmid map once the Enzyme menu's Cut sites toggle is on. Each label points a leader line at the exact cut position, and a count next to an enzyme (XhoI x8) shows how many times it cuts."
      />

      <h2>The enzyme catalog</h2>
      <p>
        The Workspace ships with a catalog of 236 restriction enzymes drawn from a
        standard NEB-derived dataset. Each enzyme carries its recognition sequence
        and its cut geometry, and from that the catalog derives the metadata you
        filter on. That covers how long the recognition site is, whether the site
        is palindromic, whether it contains a degenerate (non-ACGT) code, and
        what overhang the cut leaves. You never have to type an enzyme&apos;s
        recognition site or cut position, it all comes from the bundled data.
      </p>

      <h2>Cut detection on both strands</h2>
      <p>
        For a given sequence and enzyme set, the digest searches the recognition site
        on both strands, the forward strand and the reverse complement, so a cut site
        is found regardless of which way the recognition sequence reads. Each cut
        records its position and which strand the recognition site sat on. The result
        is a per-enzyme breakdown that lists every enzyme in the active set, each
        place it cuts, and a total cut count. That count is what drives the unique-cutter and
        N-cutter filters described below.
      </p>

      <h2>Overhangs, 5 prime, 3 prime, and blunt</h2>
      <p>
        When an enzyme cuts, the top-strand cut and the bottom-strand cut may land at
        the same position or at offset positions. When they coincide, the cut leaves a
        blunt end. When the top strand cuts before the bottom strand, the cut leaves a
        5&apos; overhang. When the top strand cuts after, it leaves a 3&apos;
        overhang. The catalog labels each enzyme&apos;s overhang type, so you can pick
        for the geometry your downstream ligation needs (compatible sticky ends, or
        blunt ends for a blunt ligation). This is the same overhang typing the{" "}
        <Link href="/wiki/features/cloning">Cloning Workspace</Link> uses when it
        ligates pieces, so a cut you reason about here behaves the same way in an
        assembly.
      </p>

      <h2>Fragment sizes and topology</h2>
      <p>
        Once the cut positions are known, the digest computes the fragment sizes you
        would see on a gel, sorted from largest to smallest. Topology matters here.
        For a linear molecule the two ends are open, so the cuts divide it into
        fragments with a piece at each end. For a circular molecule the fragments
        wrap around the origin, and a cut that spans the origin is handled correctly
        rather than splitting the molecule at an artificial seam. A sequence with no
        cuts reports a single fragment of the full length, which is the honest answer
        for a non-cutter.
      </p>

      <h2>Filters and enzyme sets</h2>
      <p>
        The enzyme picker mirrors the SnapGene chooser. You can search enzymes by
        name, hide enzymes that never cut the open sequence, and restrict the list by
        cut-count category. You can show only the enzymes that cut exactly once (unique cutters),
        or those that cut exactly N times, or the non-cutters. You can also require a
        minimum recognition-site length (longer sites cut more rarely and more
        cleanly), restrict to palindromic sites only, restrict to non-degenerate ACGT
        sites only, and restrict to a single overhang type.
      </p>
      <p>
        Alongside the manual filters, a few computed presets give you a one-click set
        that is always derived from the current sequence. Common is the everyday
        workhorse set (EcoRI, BamHI, HindIII, and friends) intersected with the
        enzymes that actually cut this molecule. Unique cutters is every enzyme that
        cuts exactly once. The six-plus preset is every cutter whose recognition site
        is six bases or longer. All cutters is every bundled enzyme that cuts this
        sequence at least once. Because the presets are recomputed from the open
        sequence, Unique cutters really means unique on this molecule, not unique in
        general.
      </p>
      <p>
        When you settle on a selection you want to reuse, the Saved sets control
        lets you name it and keep it. Saved sets are stored per user in a small
        sidecar file (<code>users/&lt;you&gt;/_enzyme_sets.json</code>) and
        follow you across every sequence you open. They are not shared with
        labmates, so each user builds their own panel of go-to sets. A saved set
        is one click away the next time, not something you rebuild by hand.
      </p>

      <Callout variant="tip" title="The digest is validated band-for-band">
        Where an enzyme cuts is a question with one correct answer, so the cut
        detection is not an approximation. The digest is validated band-for-band
        against Biopython&apos;s <code>Bio.Restriction</code> module, the standard
        reference for restriction analysis, and that comparison runs as part of the
        test suite and is published openly on the{" "}
        <Link href="/transparency">Transparency page</Link>.
      </Callout>

      <h2>From a digest to a clone</h2>
      <p>
        The restriction digest and the{" "}
        <Link href="/wiki/features/cloning">Cloning Workspace</Link> are two views of
        the same enzyme model. Use the digest to find the cutters and overhangs you
        want, then carry the same enzymes into a restriction-ligation or Golden Gate
        assembly in the Cloning Workspace to build the construct. Because both share
        the bundled enzyme dataset and the same cut geometry, what you see in the
        digest is what the assembly does.
      </p>
    </WikiPage>
  );
}
