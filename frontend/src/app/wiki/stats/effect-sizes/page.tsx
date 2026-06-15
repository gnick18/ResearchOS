import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function EffectSizesPage() {
  return (
    <WikiPage
      title="Effect sizes and confidence intervals"
      intro="A p-value tells you whether a difference is likely to be real. It does not tell you how big that difference is, or whether it is big enough to care about. The effect size answers the size question, and the confidence interval tells you how precisely you have pinned it down. This is the most useful pair of numbers on any result, and the rest of the stats pages lean on the idea, so it is worth reading first."
    >
      <h2>What a p-value actually says</h2>
      <p>
        A <strong>p-value</strong> is the probability of seeing a difference at
        least as large as yours, if the groups were really identical and only
        chance produced the gap. A small p-value (by long convention, below
        0.05) means &quot;this would be a surprising amount of noise,&quot; so
        you treat the difference as real rather than a fluke.
      </p>
      <p>
        The catch is that the p-value mixes together two things you care about
        separately, how big the effect is and how much data you collected. With
        a large enough sample, a difference far too small to matter biologically
        can still earn a tiny p-value. With a small sample, a real and important
        effect can miss the 0.05 line. So a p-value on its own is a weak summary.
        It is a yes or no flag, not a measurement.
      </p>

      <h2>What an effect size is</h2>
      <p>
        An <strong>effect size</strong> is the answer to &quot;how big is the
        difference?&quot; in units you can reason about. There are two flavors
        you will meet.
      </p>
      <ul>
        <li>
          A <strong>raw effect size</strong> is the difference in the units you
          measured. Two micromolar, fifteen percent more colonies, a 0.4 hour
          shorter doubling time. This is usually the most honest thing to report,
          because anyone in your field can judge whether it matters.
        </li>
        <li>
          A <strong>standardized effect size</strong> rescales the difference by
          how spread out the data are, so it has no units. The common one for two
          groups is <strong>Cohen&apos;s d</strong>, which measures the gap
          between two means in units of standard deviation. A d of 0.2 is small,
          0.5 is medium, and 0.8 or more is large, as rough anchors. It is handy
          when the raw units are hard to interpret or when you want to compare
          effects across different measurements.
        </li>
      </ul>

      <h2>What a confidence interval is</h2>
      <p>
        Your effect size is an estimate from one sample. Run the experiment again
        and you would get a slightly different number. A{" "}
        <strong>95% confidence interval</strong> is the range that captures that
        wobble. Read it as &quot;the true effect is plausibly anywhere in this
        range, and our single best guess sits in the middle.&quot; A narrow
        interval means you have measured the effect precisely. A wide one means
        you have not yet collected enough data to say much, even if the
        p-value happened to clear 0.05.
      </p>
      <Callout variant="tip" title="A quick read on the interval">
        For a difference between two groups, look at whether the 95% interval
        includes zero. If it does not, the difference is statistically clear, the
        same call the p-value makes. But the interval tells you more, it shows
        the smallest and largest difference still consistent with your data, so
        you can see whether even the optimistic end is too small to matter, or
        whether even the pessimistic end is already meaningful.
      </Callout>

      <h2>How to read it in the Data Hub</h2>
      <p>
        When you run a two-group comparison (a t-test), the result reports the{" "}
        <strong>mean of each group</strong>, the{" "}
        <strong>difference between the means</strong> with its{" "}
        <strong>95% confidence interval</strong>, the{" "}
        <strong>p-value</strong>, and <strong>Cohen&apos;s d</strong> as the
        standardized effect size. The plain-language verdict above the table
        already states the direction and whether the difference is statistically
        clear. The table is where you read the size and the precision.
      </p>

      <Screenshot
        src="/wiki/screenshots/datahub-stats-effect-sizes.png"
        alt="A two-group t-test result in the Data Hub, showing the mean of each group, the difference of means with its 95 percent confidence interval, the p-value, Cohen's d with its own interval, and Hedges' g."
        caption="A two-group comparison. BeakerBot states the direction and whether the gap is clear above the table, and the table reports the difference of means with its 95 percent confidence interval alongside Cohen's d and its interval, so you read the size and the precision together."
      />

      <p>
        The bootstrap interval and Hedges&apos; g sit just below. Hedges&apos;
        g is Cohen&apos;s d with a small-sample correction, so on the handful of
        replicates a typical experiment collects it is the more honest
        standardized number.
      </p>
      <p>
        The <strong>bootstrap confidence interval</strong> is a second,
        assumption-light estimate of the uncertainty on the mean difference. It
        works by resampling your data thousands of times with replacement, computing
        the difference of means on each resample, and reading the 2.5th and 97.5th
        percentile off the resulting distribution (using the BCa acceleration
        correction for bias). Because it makes no assumption about normality or
        equal variance, it can disagree with the parametric interval when those
        assumptions are strained. A narrow bootstrap CI matching the parametric
        one is reassuring; a wide disagreement is a sign to look more carefully at
        the data.
      </p>

      <h2 id="test-variants">Welch versus Student, and from-summary-stats</h2>
      <p>
        The two-sample t-test comes in two variants. The default is{" "}
        <strong>Welch&apos;s t-test</strong>, which does not assume the two
        groups have the same variance and adjusts the degrees of freedom using
        the Welch-Satterthwaite equation. The optional{" "}
        <strong>Student&apos;s t-test</strong> pools the variance estimate across
        groups, which is a reasonable shortcut when you are confident the groups
        have equal spread, but Welch is the safer default when you are not.
        Both report the same difference-of-means effect size and its interval.
      </p>
      <p>
        If you already have group means, standard deviations, and sample sizes
        from a published table rather than raw replicates, the Data Hub can run
        the t-test and ANOVA from those entered summaries, reproducing the
        omnibus F and the effect sizes without needing the original data. Post-hoc
        pairwise comparisons require raw replicates and are not available from
        summary-stats entry alone.
      </p>

      <h2>A worked example</h2>
      <p>
        Suppose a treated group averages 42 units and a control averages 30, a
        difference of 12 units with a 95% confidence interval of 7 to 17, a
        p-value of 0.001, and a Cohen&apos;s d of 1.3. You would write that as
        &quot;the treatment raised the readout by 12 units (95% CI 7 to 17, p =
        0.001), a large effect (d = 1.3).&quot; The interval not including zero
        is what makes the difference clear, and even its lower end of 7 units is
        a sizable change, so the result is both real and meaningful, not just
        statistically significant.
      </p>

      <Callout variant="info" title="Where this shows up next">
        Every other test reports its own version of this trio. A correlation has
        an <Link href="/wiki/stats/correlation-and-regression">r and its
        interval</Link>, a survival analysis has a{" "}
        <Link href="/wiki/stats/survival#hazard-ratios">hazard ratio and its
        interval</Link>, a contingency table has an{" "}
        <Link href="/wiki/stats/contingency#odds-ratios">odds ratio and its
        interval</Link>. Once you can read a confidence interval here, you can
        read all of them.
      </Callout>

      <p>
        ResearchOS validates the Welch and Student t-tests, Cohen&apos;s d,
        Hedges&apos; g, the bootstrap CI, and the from-summary-stats path against
        scipy and statsmodels on the{" "}
        <Link href="/transparency">transparency page</Link>, which reruns the
        same inputs through those packages so you can see the numbers match.
      </p>
    </WikiPage>
  );
}
