import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function CloningWorkspaceFeaturePage() {
  return (
    <WikiPage
      title="Cloning Workspace"
      intro="The Cloning Workspace assembles new constructs in silico. Pick a chemistry, add your fragments, and review the product before it ever touches the bench."
    >
      <Callout variant="info" title="Split out of the Sequences page">
        This page used to be one section of the{" "}
        <Link href="/wiki/features/sequences">Sequences</Link> workbench page. The
        cloning chemistries grew their own depth, so they now live here. The
        Cloning Workspace is still launched from inside the Sequences library, and
        the products it makes land back in that same library.
      </Callout>

      <h2>What the Cloning Workspace is</h2>
      <p>
        Cloning is the act of joining DNA fragments into a new molecule. Before you
        order primers or set up a reaction at the bench, it helps to know exactly
        what the assembled construct will be, where each fragment lands, and which
        oligos you need. The Cloning Workspace is the tool that answers those
        questions without leaving ResearchOS. It is a pure in-silico assembly
        engine. You describe the reaction, and it computes the product sequence, the
        features carried across the junctions, and the primers (when a chemistry
        needs them), all in your browser.
      </p>
      <p>
        The Workspace opens from the Assemble button in the header of the{" "}
        <Link href="/wiki/features/sequences">Sequences</Link> library, not from an
        editor tab or the top navigation. Inside, a single method picker offers four
        assembly chemistries, and every one of them runs the same two-step flow.
        First you pick and order your fragments and set the method&apos;s options.
        Then you review the computed product and save it to the library.
      </p>

      <TryInDemo href="/sequences">Try the Sequences workbench</TryInDemo>

      <Screenshot
        src="/wiki/screenshots/sequences-cloning-methods.png"
        alt="The Cloning Workspace open over the Sequences library, showing the four method tabs (Overlap, Restriction, Golden Gate, Gateway) across the top, a fragments-in-order panel on the left, and the DNA library on the right."
        caption="The Cloning Workspace. Pick a chemistry from the four method tabs, add fragments from your library or paste a sequence, then set the method's options."
      />

      <h2>The two-step flow</h2>
      <p>
        Every chemistry shares the same shape, so once you have done one assembly
        the rest feel familiar. The first step is the pick step. You choose the
        method, add the fragments or substrate molecules the reaction needs (from
        the library or pasted directly), order and orient them, and set whatever
        options the method exposes. The second step is the review step. The Workspace
        renders the assembled product with its features, the junctions it formed, and
        any warnings worth a second look (an internal cut site that the chosen enzyme
        would sever, an overlap that came out below target, an orientation-ambiguous
        ligation that yields more than one product). Saving the product creates a new
        sequence in the active collection, where it opens in the normal editor like
        any other sequence.
      </p>

      <h2>Overlap assembly (Gibson / NEBuilder HiFi)</h2>
      <p>
        Overlap assembly joins an ordered set of fragments that share short
        homologous ends. At the bench you amplify each fragment with primers whose
        5&apos; ends carry a homology tail matching the neighbouring fragment. The
        exonuclease chews back, the matching single strands anneal, and the fragments
        fuse with the shared homology present exactly once at each junction. This is
        the chemistry behind Gibson assembly and NEBuilder HiFi.
      </p>
      <p>
        In the Workspace you add two or more fragments in the order you want them
        joined, choose whether the product is linear or circular, decide whether to
        carry the source fragments&apos; annotations onto the product (on by default),
        and pick how the homology overlap is sized. You can fix the overlap to a length in base pairs
        (the default is 25 bp) or let the engine grow it until the homology reaches a
        target melting temperature (48 degrees C by default). From there the Workspace does two things. It
        computes the assembled product as the fragment bodies joined in order, with
        the homology living once at each seam. And it designs the per-fragment PCR
        primers, where each primer is an annealing region sized to a target Tm (about 60
        degrees C, using the same nearest-neighbor model as the rest of the app) plus
        a 5&apos; homology tail copied from the adjacent fragment&apos;s end, so the
        amplicons carry the overlap.
      </p>
      <p>
        The designed oligos are yours to use directly. The review step offers them as
        a copyable oligo order list, or you can have them saved as{" "}
        <code>primer_bind</code> features on the product so the primers travel with
        the template they belong to. The junction report flags any overlap that came
        out shorter than you asked for (a flanking fragment was too short) or any two
        junctions that share the same overlap sequence (the assembly may be
        ambiguous).
      </p>
      <Callout variant="tip" title="Orientation is yours to set">
        Overlap assembly takes each fragment in the orientation you supply it (top
        strand, 5&apos; to 3&apos;, left to right). The engine does not silently
        reverse-complement a fragment to find a better junction, which keeps the
        result predictable. Order and orient the fragments the way the construct
        should read before you assemble.
      </Callout>

      <h2>Restriction and ligation</h2>
      <p>
        Restriction-ligation is the classic cut-and-paste of molecular cloning. A
        restriction enzyme cuts double-stranded DNA at a defined site, and when the
        two strands are cut at offset positions it leaves a single-stranded overhang
        (a sticky end). Two ends ligate when their overhangs are complementary and
        the same length, or when both ends are blunt. DNA ligase seals the strands and
        the overhang appears once, as the seam between the fragments.
      </p>
      <p>
        In the Workspace you choose two or more sequences and pick from a fixed
        set of eight common cutters: EcoRI, BamHI, HindIII, PstI, KpnI, SmaI,
        XhoI, and NotI. This set covers the most widely-used single-cut and
        compatible-overhang combinations in subcloning work. For any site not in
        this set, use the full enzyme picker in the{" "}
        <Link href="/wiki/features/restriction-digest">Restriction Digest</Link>{" "}
        tool to confirm cut positions, then work backwards to a compatible set
        from the eight available here. The engine digests each sequence on both
        strands, types every resulting end as blunt, a 5&apos; overhang, or a
        3&apos; overhang, and then enumerates the products whose ends form a
        consistent ligation chain. Because a fragment can ligate in either
        orientation, a pair of identical overhangs is genuinely ambiguous and
        yields more than one product. The Workspace returns every distinct
        product rather than guessing, so you pick the intended one in the review
        step.
      </p>

      <h2>Golden Gate (Type IIS)</h2>
      <p>
        Golden Gate assembly is a one-pot, scarless method built on Type IIS enzymes.
        Unlike a classic restriction enzyme, a Type IIS enzyme such as BsaI, BsmBI,
        BbsI, or SapI cuts outside and downstream of its recognition site. That means
        the recognition sequence ends up on a flanking piece that gets discarded, and
        the central part keeps a custom four-base overhang (three bases for SapI) with
        no scar left behind. Design the overhangs to be unique and the parts only fit
        together one way.
      </p>
      <p>
        In the Workspace you add your parts and choose one of the four supported
        Type IIS enzymes: BsaI, BsmBI, BbsI, or SapI. These cover the most
        common Golden Gate systems (MoClo, GoldenBraid, Loop, and SapI-based
        scarless cloning). The engine digests every part with the chosen enzyme,
        drops the pieces that still carry the recognition site (the flanks), and
        ligates the central parts by their custom overhangs into a seamless
        product. The review step warns you if a kept piece has a blunt end,
        which usually means a part is missing a flanking Type IIS site.
      </p>

      <h2>Gateway (BP and LR)</h2>
      <p>
        Gateway cloning moves a DNA segment between vectors by site-specific
        recombination, with no restriction digestion and no ligation. The reaction
        happens between short att sites that share a common core. BP Clonase
        recombines an attB-flanked insert with an attP donor to make an attL entry
        clone (and an attR byproduct), and LR Clonase recombines an attL entry clone
        with an attR destination to make an attB expression clone (and an attP
        byproduct). The att sites carry a specificity number, and a site 1 recombines
        only with the partner&apos;s site 1, which is what makes Gateway directional.
      </p>
      <p>
        In the Workspace you pick the reaction (BP or LR) and the two substrate
        molecules. The engine locates the att sites on each substrate by matching the
        published site sequences on both strands, checks that each substrate presents
        one site 1 and one site 2, and then computes each product att site as the true
        crossover recombinant of the two inputs. The gene of interest transfers onto
        the partner backbone and the cassette transfers out, exactly as in the
        wet-lab reaction. The result is the desired clone plus the byproduct, each a
        circular molecule with its features carried across.
      </p>
      <Callout variant="info" title="Gateway substrate topology">
        Gateway substrates are normally supercoiled circles. The donor and
        destination vectors must be circular to recombine, and the entry clone in an
        LR reaction should be circular too, while the attB-PCR product fed into a BP
        reaction can be linear. The review step warns you when an input topology
        would not recombine in the standard reaction.
      </Callout>

      <h2>Reviewing and saving the product</h2>
      <p>
        Whichever chemistry you used, the review step is the same surface. It shows
        the assembled product sequence with its features, the junctions it formed, and
        any warnings. A compact header above the sequence displays the product name,
        topology, length in base pairs, and <strong>GC%</strong>, so you can
        spot a GC-extreme construct before you move to primer ordering. Features
        from each input fragment are rebased into the product coordinates, so a
        CDS or a promoter that started on an input fragment lands at the right
        place on the new construct. When a chemistry designs primers, those
        appear here too, ready to copy or to save as <code>primer_bind</code> features.
        When you accept the product, it is saved as a new sequence in the active
        collection and opens in the editor like any other sequence.
      </p>
      <Screenshot
        src="/wiki/screenshots/sequences-cloning-review.png"
        alt="The Cloning Workspace review step showing the recombinant construct sequence, a per-junction breakdown with primer overlaps and annealing temperatures, and a Save to library button."
        caption="The review step. The recombinant construct, each junction's primers and annealing temperatures, and the oligo order list are shown before you save to your library."
      />

      <Callout variant="tip" title="The assembled construct is validated, not estimated">
        A wrong cloning product is a real molecular-biology error, so the assembly
        engines are not approximations. The overlap and cut-and-ligate products are
        cross-validated against the independent pydna simulator, and the Gateway
        crossover is validated against the published canonical att-site sequences.
        Those checks run as part of the test suite and are recomputed on every commit,
        and the comparison is published openly on the{" "}
        <Link href="/transparency">Transparency page</Link>.
      </Callout>

      <h2>Where the products go</h2>
      <p>
        A product saved from the Cloning Workspace is a first-class sequence in the{" "}
        <Link href="/wiki/features/sequences">Sequences</Link> library, filed under
        the active collection. It opens in the same editor, renders the same circular
        and linear maps, carries the features the assembly rebased onto it, and goes
        through the same trash flow as every other record if you delete it. The
        primers you designed during an overlap assembly, if you saved them as features,
        travel with the construct as <code>primer_bind</code> annotations.
      </p>
    </WikiPage>
  );
}
