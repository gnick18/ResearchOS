import Callout from "@/components/wiki/Callout";
import WikiPage from "@/components/wiki/WikiPage";

export default function MethodValidationPage() {
  return (
    <WikiPage
      intro="An ELN that gets a melting temperature wrong is worse than no ELN at all, because you would trust the wrong number. ResearchOS answers that worry by checking its own math, on every commit, against the published tools your field already relies on."
    >
      <h2>The concept</h2>
      <p>
        ResearchOS runs its sequence and lab calculations in your browser.
        Melting temperature, sequence alignment, restriction digest,
        translation, protein parameters, the lab calculators, and the cloning
        engine all execute locally on your machine, with no server round-trip
        and no proprietary black box. That is good for privacy and speed, but
        it raises a fair question. How do you know the numbers are right?
      </p>
      <p>
        The answer is that ResearchOS does not ask you to take its math on
        faith. For each capability, it compares its own output against a
        peer-reviewed reference implementation that the field already trusts.
        These are not numbers we invented. They come from the same tools
        working scientists cite in papers.
      </p>

      <h2>What it is checked against</h2>
      <p>
        The reference tools, called oracles in the code, are the established
        names in computational biology.
      </p>
      <ul>
        <li>
          <strong>Biopython</strong> for melting temperature, alignment,
          restriction digest, translation, and protein parameters (molecular
          weight, isoelectric point, and related properties).
        </li>
        <li>
          <strong>primer3</strong> for nearest-neighbor melting temperature,
          the workhorse behind most primer-design pipelines.
        </li>
        <li>
          <strong>pydna</strong> for cloning and assembly products, so a
          Gibson or Gateway result can be checked against a published
          reference sequence.
        </li>
      </ul>
      <p>
        For every showcase case, ResearchOS records its own value, the pinned
        oracle value, the exact tool version, the specific function called,
        and the committed script that re-derives the reference number. A
        reader can follow that trail and reproduce it.
      </p>

      <h2>Why the numbers cannot silently drift</h2>
      <p>
        The honest part is not just that ResearchOS matches these tools once.
        It is that the match is re-checked automatically and can never quietly
        fall out of agreement. The public{" "}
        <a href="/transparency" target="_blank" rel="noopener noreferrer">
          Method validation page
        </a>{" "}
        and the test that gates the build both call the exact same function,{" "}
        <code>buildTransparencyReport()</code> in{" "}
        <code>frontend/src/lib/transparency/run.ts</code>. The page can never
        advertise a comparison the test is not enforcing, because they are
        computed from one source.
      </p>
      <p>
        That gating test, <code>report.test.ts</code>, runs on every commit. If
        a future change to a ResearchOS calculation pushes its output past the
        agreed tolerance for any case, the comparison fails, the test fails,
        and the build fails before the change can reach you. A documented,
        explained difference (for example, primer3 using a different
        nearest-neighbor table) is allowed and shown on the page with its
        reason. A true, unexplained drift is treated as a bug and stops the
        release.
      </p>

      <Callout variant="tip" title="See it for yourself">
        The{" "}
        <a href="/transparency" target="_blank" rel="noopener noreferrer">
          Method validation page
        </a>{" "}
        is public and needs no account. It lists every comparison, our number
        next to theirs, the delta, the tolerance, and the source script. No
        sign-in, no demo data, just the agreement table.
      </Callout>

      {/* SCREENSHOT TODO: the /transparency agreement table, showing a domain
          (e.g. primer melting temperature) with our value, the oracle value,
          the delta, the tolerance band, and the pass/warn pills. Capture with
          ?wikiCapture=1 fixture mode. */}

      <h2>What this does not claim</h2>
      <p>
        Matching a reference tool means ResearchOS computes the same thing the
        reference computes, faithfully. It does not mean the underlying method
        is the only valid one, and it does not replace your own judgment about
        which method fits your experiment. The point is narrower and more
        useful. When ResearchOS gives you a number, you can confirm it agrees
        with the tool you would have reached for anyway.
      </p>
    </WikiPage>
  );
}
