import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function AnovaPage() {
  return (
    <WikiPage
      title="ANOVA, post-hoc tests, and two-way ANOVA"
      intro="A t-test compares two groups. The moment you have three or more, you need ANOVA, which asks whether any of the groups differ before you go hunting for which ones. This page covers the one-way ANOVA, the post-hoc tests that find the specific pairs that differ, the two-way ANOVA for when two factors are in play at once, and the nonparametric alternatives for when normality does not hold."
    >
      <h2>What ANOVA is</h2>
      <p>
        <strong>ANOVA</strong> stands for analysis of variance. Despite the
        name, the question it answers is about means. Given three or more groups,
        it asks &quot;is at least one of these group means different from the
        rest, more than chance alone would produce?&quot; It does this by
        comparing how much the group averages spread apart against how much the
        data wobble within each group.
      </p>
      <p>
        Why not just run a t-test on every pair? Because each test carries a
        chance of a false positive, and running many of them stacks those chances
        up until a &quot;significant&quot; result is likely somewhere by luck
        alone. ANOVA asks the single overall question once, with one controlled
        error rate, and only then do you drill into pairs.
      </p>

      <h2>When a lab reaches for it</h2>
      <p>
        You have a dose series (vehicle, low, medium, high) and one readout, and
        you want to know whether dose changes the readout at all. Or you have
        cells from four genotypes and a single growth measurement. Any time the
        design is &quot;one measured outcome split across three or more
        conditions,&quot; the one-way ANOVA is the starting point.
      </p>

      <h2>How to read the result</h2>
      <p>
        The Data Hub reports an <strong>F statistic</strong>, its{" "}
        <strong>degrees of freedom</strong>, and an overall{" "}
        <strong>p-value</strong>. The F statistic is the ratio of
        between-group spread to within-group spread, so a large F with a small
        p-value means the groups really do differ somewhere. A non-significant
        ANOVA is a stopping point, if the overall test finds nothing, you do not
        go fishing for pairwise differences.
      </p>

      <Screenshot
        src="/wiki/screenshots/datahub-stats-anova.png"
        alt="A one-way ANOVA result in the Data Hub comparing four groups, with the source-of-variation table (between groups, within groups, total) reporting SS, DF, MS, F, and the p-value, plus eta-squared and omega-squared effect sizes, and a Multiple comparisons tab."
        caption="The ANOVA table breaks the variation into between-group and within-group parts, and F is the ratio of the two. Eta-squared and omega-squared below it say how much of the spread the grouping explains, and the Multiple comparisons tab holds the post-hoc pairs."
      />

      <h2 id="effect-sizes">Effect sizes: eta-squared and omega-squared</h2>
      <p>
        The F statistic and its p-value tell you whether the groups differ. They
        do not tell you by how much in a scale you can reason about. For that,
        the Data Hub reports two effect sizes.{" "}
        <strong>Eta-squared</strong> is the fraction of total variation the
        grouping factor explains, computed as the between-groups sum of squares
        divided by the total sum of squares. An eta-squared of 0.10 means the
        grouping accounts for 10% of the spread in the data. It is
        straightforward but slightly upward-biased, because it is calculated
        on the specific sample rather than the underlying population.{" "}
        <strong>Omega-squared</strong> corrects for that bias by subtracting an
        estimate of the degrees-of-freedom penalty from the numerator, which
        makes it a more honest estimate of the population effect when the sample
        is small. For large samples the two are nearly identical; for small ones,
        prefer omega-squared in write-ups. The 95% confidence interval on
        eta-squared is reported using the noncentral F pivot, so you can see the
        range of plausible effect sizes.
      </p>

      <h2 id="post-hoc">Post-hoc tests: which pairs differ</h2>
      <p>
        A significant ANOVA tells you that <em>some</em> group differs, not{" "}
        <em>which</em>. The <strong>post-hoc</strong> tests answer that, by
        comparing each pair of groups while correcting for the fact that you are
        making many comparisons at once. The Data Hub reports, for each pair, the{" "}
        <strong>difference in means</strong>, its{" "}
        <strong>95% confidence interval</strong>, and an{" "}
        <strong>adjusted p-value</strong>. &quot;Adjusted&quot; means the
        p-value has already been corrected for the number of comparisons, so you
        can read each one at face value.
      </p>
      <p>
        The Data Hub offers five post-hoc families. <strong>Tukey HSD</strong>{" "}
        (the default) compares every group to every other using the studentized
        range, and is the standard choice when you have no pre-specified
        contrasts. <strong>Dunnett</strong> compares each treatment to a single
        named control, which is the right choice when the only comparisons you
        planned are treatment versus control. <strong>Sidak</strong> and{" "}
        <strong>Bonferroni</strong> are all-pairs corrections based on the t
        distribution, Bonferroni the most conservative, Sidak slightly less so
        for uncorrelated comparisons. <strong>Holm-Sidak</strong> is a
        step-down version of Sidak that gains power by adjusting each comparison
        based on its rank in the ordered p-value list while enforcing monotonicity.
        The verdict tells you which pairs cleared the bar in plain words.
      </p>
      <Callout variant="tip" title="Read the post-hoc intervals, not just the stars">
        A pair can clear significance with a difference that is still tiny. As on
        the{" "}
        <Link href="/wiki/stats/effect-sizes">effect sizes</Link> page, the
        confidence interval on each pairwise difference tells you the size and
        the precision, which is what you actually report.
      </Callout>

      <h2 id="two-way">Two-way ANOVA: two factors at once</h2>
      <p>
        A <strong>two-way ANOVA</strong> is for when two things vary together.
        Say you cross genotype (wild type vs mutant) with treatment (drug vs
        vehicle). Now there are three questions, and the two-way ANOVA answers
        all three.
      </p>
      <ul>
        <li>
          The <strong>main effect of genotype</strong>: averaging over treatment,
          do the genotypes differ?
        </li>
        <li>
          The <strong>main effect of treatment</strong>: averaging over genotype,
          does the drug do anything?
        </li>
        <li>
          The <strong>interaction</strong>: does the drug&apos;s effect depend on
          the genotype? This is usually the interesting one. A significant
          interaction means you cannot describe the drug with a single number,
          its effect is different in the mutant than in the wild type.
        </li>
      </ul>
      <p>
        The result reports an F statistic and p-value for each of the three
        rows. Read the interaction first. If it is significant, the two main
        effects are no longer the whole story and you interpret each combination
        on its own, often with post-hoc comparisons of the specific cells.
      </p>

      <h2 id="kruskal-wallis">Kruskal-Wallis: nonparametric one-way comparison</h2>
      <p>
        When the normality assumption is in doubt or your data are ranks or
        scores rather than measured quantities, the{" "}
        <strong>Kruskal-Wallis test</strong> is the nonparametric replacement
        for the one-way ANOVA. Instead of working on the raw values, it ranks all
        observations pooled across groups and tests whether the mean ranks of the
        groups are more spread apart than chance would produce. The result reports
        an H statistic (corrected for tied ranks) and a chi-square p-value on
        k minus 1 degrees of freedom. A significant Kruskal-Wallis is followed by{" "}
        <strong>Dunn&apos;s post-hoc test</strong> (Bonferroni-adjusted), which
        compares mean ranks pairwise. The reported effect size is{" "}
        <strong>epsilon-squared</strong>, the rank analogue of eta-squared.
      </p>

      <h2 id="friedman">Friedman: nonparametric repeated measures</h2>
      <p>
        The <strong>Friedman test</strong> is the nonparametric counterpart of a
        one-way repeated-measures ANOVA. It is the right choice when the same
        subjects are measured under each condition but you cannot assume
        normality. Within each subject (block), observations are ranked across
        conditions; the test then asks whether the mean ranks differ more across
        conditions than chance would produce. Like Kruskal-Wallis, a significant
        Friedman result is followed by Dunn&apos;s pairwise post-hoc. Use
        Friedman when you would otherwise reach for repeated-measures ANOVA but
        the assumption of a normal within-subject distribution is questionable.
      </p>

      <h2>A worked example</h2>
      <p>
        Three media give colony counts averaging 50, 65, and 80. The one-way
        ANOVA returns F = 14.2, p = 0.0003, so the media differ somewhere. The
        Tukey post-hoc shows medium vs rich differs by 15 colonies (95% CI 6 to
        24, adjusted p = 0.002) while minimal vs medium does not clear the bar.
        You would write &quot;media affected colony count (one-way ANOVA, p =
        0.0003); the rich medium yielded 15 more colonies than the medium one
        (95% CI 6 to 24, adjusted p = 0.002).&quot;
      </p>

      <Callout variant="info" title="Related designs">
        If the same subjects are measured under every condition, or your
        replicates are not independent, you want a{" "}
        <Link href="/wiki/stats/repeated-measures">
          repeated-measures or nested design
        </Link>{" "}
        instead, which accounts for that structure rather than treating every
        point as a fresh independent sample.
      </Callout>

      <p>
        ResearchOS validates one-way and two-way ANOVA, the post-hoc families,
        Kruskal-Wallis, and Friedman against scipy, statsmodels, and R on the{" "}
        <Link href="/transparency">transparency page</Link>.
      </p>
    </WikiPage>
  );
}
