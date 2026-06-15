import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
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
        names in computational biology and statistics.
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
          <strong>pydna</strong> for restriction-ligation and Golden Gate
          assembly products. Gateway recombination is checked separately
          against the published attB site sequence.
        </li>
        <li>
          <strong>scipy</strong> and <strong>statsmodels</strong> for the Data
          Hub statistics engine: t-tests (Welch and Student), ANOVA (one-way,
          two-way, repeated-measures, Kruskal-Wallis, Friedman), correlation
          (Pearson and Spearman), simple and multiple regression, logistic
          regression (including the Firth penalized-likelihood fallback),
          dose-response curve fitting, Grubbs outlier tests, power and
          sample-size calculations, and the assumption checks (Shapiro-Wilk,
          Levene, Brown-Forsythe).
        </li>
        <li>
          <strong>lifelines</strong> for the Kaplan-Meier estimator, log-rank
          test, Gehan-Breslow-Wilcoxon test, and Cox proportional hazards
          regression (including the likelihood-ratio test and concordance).
        </li>
        <li>
          <strong>scikit-learn</strong> and <strong>R&apos;s pROC</strong> for
          ROC curve and AUC (including the Hanley-McNeil standard error).
        </li>
        <li>
          <strong>R&apos;s survival library</strong> as a second reference for
          the Kaplan-Meier, log-rank, and Cox outputs.
        </li>
      </ul>
      <p>
        For every showcase case, ResearchOS records its own value, the pinned
        oracle value, the exact tool version, the specific function called,
        and the committed script that re-derives the reference number. A
        reader can follow that trail and reproduce it.
      </p>

      <h2>Reproducing published results</h2>
      <p>
        Matching a reference tool shows ResearchOS computes the same thing
        another program computes. A stronger check is reproducing what the
        literature itself reports, so the same validation now includes cases
        drawn straight from primary sources. ResearchOS translates a gene and
        reproduces the protein that gene&apos;s own GenBank record annotates,
        digests a known plasmid and reproduces its fragment sizes, and takes a
        published qPCR standard-curve slope and reproduces the amplification
        efficiency the paper reports. Each case cites its accession or DOI,
        every input and reported value is transcribed verbatim from the source
        rather than paraphrased, and the comparison runs through the same gate
        as the rest.
      </p>
      <p>
        Where our result and a familiar figure differ for a real reason, we show
        the real one and explain it rather than matching the textbook out of
        habit. The lambda HindIII digest is the clean example. The deposited
        sequence yields seven fragments, not the eight bands of the classic gel
        marker, because the extra band comes from the cohesive ends annealing
        during marker preparation, not from an additional cut site. We pin the
        honest in-silico result and say why.
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

      <Screenshot
        src="/wiki/screenshots/transparency-method-validation.png"
        alt="The public Method validation page showing a summary of exact matches, cases within a documented tolerance, and a small number of larger documented differences, with a differences spotlight calling out the cases that diverge."
        caption="The public Method validation page. Every comparison is counted (exact, within tolerance, or a documented difference), and the cases that diverge are spotlighted rather than hidden."
      />

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
