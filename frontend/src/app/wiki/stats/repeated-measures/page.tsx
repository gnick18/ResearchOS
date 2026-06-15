import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function RepeatedMeasuresPage() {
  return (
    <WikiPage
      title="Repeated measures, mixed models, and nested designs"
      intro="Ordinary ANOVA assumes every data point is an independent sample. Real experiments often break that assumption. You measure the same animal before and after, or you read three wells from the same dish, or you count cells within mice within litters. These designs share structure that you have to account for, otherwise you fool yourself into thinking you have far more independent data than you really do. This page covers the three common cases."
    >
      <h2>The problem these designs solve</h2>
      <p>
        Independence is the quiet assumption behind most simple tests. Two
        measurements are independent when knowing one tells you nothing about the
        other. The moment they share a source, a subject, a dish, an animal, they
        are correlated, and treating them as independent makes your sample look
        bigger and your p-values look smaller than they should. The fix is not to
        throw data away. It is to use a method that knows about the structure.
      </p>

      <h2>Repeated-measures ANOVA</h2>
      <p>
        Use a <strong>repeated-measures ANOVA</strong> when the same subjects are
        measured under every condition. A classic case is a crossover, the same
        ten patients receive drug and placebo in turn, or the same cell line is
        read at four timepoints. Because each subject acts as its own control,
        the analysis can subtract out the steady differences between subjects (one
        patient just runs high across the board) and look only at how each subject
        <em> moves</em> across conditions. That makes the test more sensitive than
        treating the measurements as unrelated groups.
      </p>
      <p>
        The result reports an <strong>F statistic</strong> and{" "}
        <strong>p-value</strong> for the within-subject factor, plus a{" "}
        <strong>partial eta-squared</strong> effect size. Partial eta-squared is
        the fraction of the within-subject variance that the condition factor
        explains, computed as the condition sum of squares divided by the sum of
        condition and error sums of squares (the subject-to-subject baseline is
        excluded from the denominator). A partial eta-squared of 0.30 means the
        condition accounts for 30% of the within-subject variation, the part you
        can actually change by manipulating the condition.
      </p>

      <h2 id="sphericity">Sphericity and its corrections</h2>
      <p>
        Repeated-measures ANOVA relies on an assumption called{" "}
        <strong>sphericity</strong>: the variances of the differences between
        every pair of conditions should be equal. When you have only two
        conditions the assumption is automatically met. With three or more, it can
        fail, and when it does the standard F test&apos;s p-value is too small,
        giving more false positives than it should.
      </p>
      <p>
        The Data Hub reports two corrected p-values alongside the standard one.
        The <strong>Greenhouse-Geisser correction</strong> adjusts the degrees of
        freedom by a factor epsilon (between 1/(k minus 1) and 1) estimated from
        the covariance matrix of the conditions. The smaller epsilon is, the worse
        the sphericity violation. The{" "}
        <strong>Huynh-Feldt correction</strong> uses a slightly less conservative
        epsilon that corrects the downward bias in the Greenhouse-Geisser estimate.
        Both corrected p-values are reported with their epsilon. When the standard
        and corrected p-values agree you have little to worry about; when they
        diverge, report the corrected one. If either epsilon is well below 1, a{" "}
        <Link href="/wiki/stats/anova#kruskal-wallis">
          nonparametric Friedman test
        </Link>{" "}
        is worth considering as an alternative.
      </p>

      <Screenshot
        src="/wiki/screenshots/datahub-stats-repeated-measures.png"
        alt="A repeated-measures ANOVA result in the Data Hub across three within-subject timepoints, with an ANOVA table splitting variation into conditions, subjects, and error, plus partial eta-squared and the Greenhouse-Geisser and Huynh-Feldt epsilon corrections."
        caption="Three timepoints measured on the same subjects. The table splits the variation into the condition effect, the subject-to-subject differences, and the leftover error, and F is tested against that within-subject error. Partial eta-squared below it captures how much of the within-subject spread the condition explains. The Greenhouse-Geisser and Huynh-Feldt corrections adjust the p-value when sphericity is in doubt."
      />

      <h2 id="mixed-models">Mixed models</h2>
      <p>
        A <strong>mixed model</strong> is the flexible generalization. The name
        comes from mixing two kinds of effect. A <strong>fixed effect</strong> is
        the thing you care about and chose deliberately, the drug, the genotype,
        the dose. A <strong>random effect</strong> is a source of variation you
        are sampling from rather than studying, the particular animals, the
        particular plates, the particular days. The model estimates your fixed
        effect while explicitly accounting for the wobble each random effect adds.
      </p>
      <p>
        Mixed models earn their keep when the design is unbalanced or has gaps, a
        patient missed a visit, a well failed. Repeated-measures ANOVA gets
        awkward with missing cells; a mixed model handles them gracefully because
        it works from the data you have rather than requiring a perfect grid. The
        result reports, for each fixed effect, an{" "}
        <strong>estimate</strong> with its <strong>standard error</strong>,{" "}
        <strong>confidence interval</strong>, and <strong>p-value</strong>. It
        also reports, for each random effect, the estimated variance component,
        which tells you how much of the total spread each random source (animals,
        plates, days) is responsible for. A large random-effect variance on
        &quot;animal&quot; means animals differ a lot from each other, and
        collecting more replicates within each animal will not help much; you
        need more animals.
      </p>

      <Callout variant="info" title="Nonparametric option">
        If normality is in doubt, the Friedman test is the nonparametric
        counterpart of the repeated-measures ANOVA. It ranks observations within
        each subject rather than working on raw values, and is covered on the{" "}
        <Link href="/wiki/stats/anova#friedman">ANOVA page</Link>.
      </Callout>

      <h2 id="nested">Nested designs and the replicate trap</h2>
      <p>
        This is the one that quietly invalidates a lot of published work, so it
        is worth being plain about. A <strong>nested design</strong> is when your
        observations sit inside a hierarchy. You image 30 cells, but those cells
        come from 3 mice, 10 cells each.
      </p>
      <Callout variant="warning" title="Technical replicates are not your sample size">
        Counting 30 cells as n = 30 is the mistake. The cells within one mouse
        are <strong>technical replicates</strong>, they tell you about that one
        mouse measured precisely, not about mice in general. Your real
        independent unit, the <strong>biological replicate</strong>, is the
        mouse. Your n is 3, not 30. Treating the 30 cells as independent inflates
        your significance dramatically, because most of those points are not
        adding new information, they are just remeasuring the same three animals.
      </Callout>
      <p>
        The honest analysis respects the nesting. Either you summarize each
        animal to one number and compare animals, or you use a{" "}
        <strong>nested t-test</strong> or <strong>nested ANOVA</strong> (a mixed
        model with animal as a random effect) that pools the cell-level data while
        still counting animals as the unit of replication. The Data Hub frames the
        verdict for a nested test at the biological-replicate level on purpose, so
        the conclusion is about your mice, not your microscope.
      </p>
      <p>
        The nested result reports the effect estimated at the{" "}
        <strong>group level</strong> (the difference between conditions across
        animals), its <strong>confidence interval</strong>, and a{" "}
        <strong>p-value</strong> based on the number of animals. The within-animal
        spread is used to weight the estimate, not to inflate the sample size.
      </p>

      <h2>A worked example</h2>
      <p>
        You treat 4 mice with a drug and 4 with vehicle, imaging 25 cells per
        mouse. A naive t-test on all 200 cells gives p {"<"} 0.0001, which looks
        spectacular and is wrong. The nested analysis, counting mice as the unit,
        returns a mean difference of 8% (95% CI -2 to 18, p = 0.10). You would
        report the nested result and say the effect is suggestive but not
        statistically clear with four animals per arm, which is the truth. The
        first p-value was an artifact of pretending 200 cells were 200 mice.
      </p>

      <Callout variant="info" title="When the design is simpler">
        If every measurement really is independent and you just have three or
        more groups, the plain{" "}
        <Link href="/wiki/stats/anova">one-way ANOVA</Link> is the right tool. If
        you have two groups, see{" "}
        <Link href="/wiki/stats/effect-sizes">effect sizes</Link> for the t-test.
        These structured designs are for when independence does not hold.
      </Callout>

      <p>
        ResearchOS validates repeated-measures ANOVA (including sphericity
        corrections), the mixed-model fits, and the nested tests against
        statsmodels, pingouin, and R on the{" "}
        <Link href="/transparency">transparency page</Link>.
      </p>
    </WikiPage>
  );
}
