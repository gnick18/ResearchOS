import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function ContingencyPage() {
  return (
    <WikiPage
      title="Contingency tables, odds ratios, and relative risk"
      intro="When your data are counts in categories rather than measured numbers, responded or did not, mutant or wild type, survived or died, you compare proportions. A contingency table lays those counts out, and a handful of tests and effect sizes tell you whether the categories are linked and how strongly. This page covers chi-square versus Fisher exact, the odds ratio (the same one logistic regression reports), and relative risk."
    >
      <h2>What a contingency table is</h2>
      <p>
        A <strong>contingency table</strong> is a grid of counts. The simplest is
        two-by-two, two groups down the side, two outcomes across the top, with the
        number of subjects in each cell. The question is whether the outcome
        depends on the group, or whether the rows and columns are independent and
        any apparent pattern is just chance.
      </p>

      <h2 id="chi-square">Chi-square versus Fisher exact</h2>
      <p>
        Two tests answer that same question, and the only real choice between them
        is sample size.
      </p>
      <ul>
        <li>
          The <strong>chi-square test</strong> compares the counts you observed
          against the counts you would expect if the rows and columns were
          independent. It is fast and standard, and it is reliable when the
          expected count in every cell is reasonably large (a common rule of thumb
          is at least 5).
        </li>
        <li>
          <strong>Fisher&apos;s exact test</strong> computes the probability
          directly rather than approximating, so it stays accurate when counts are
          small. With any sparse cell, Fisher exact is the safe choice, and the
          Data Hub leans on it automatically for small tables.
        </li>
      </ul>
      <p>
        Both report a <strong>p-value</strong> for whether the categories are
        associated. As elsewhere, that tells you whether there is a link, not how
        strong it is. For strength, you want the effect sizes below.
      </p>

      <h2 id="odds-ratios">Odds ratios</h2>
      <p>
        The <strong>odds ratio</strong> is the workhorse effect size for
        two-by-two data. Odds are a count ratio, the number with the outcome
        divided by the number without it. The odds ratio compares the odds in one
        group against the odds in the other.
      </p>
      <ul>
        <li>
          An odds ratio of <strong>1</strong> means the outcome is equally likely
          in both groups, no association.
        </li>
        <li>
          <strong>Above 1</strong> means higher odds in the first group. An odds
          ratio of 3 means the exposed group had three times the odds of the
          outcome.
        </li>
        <li>
          <strong>Below 1</strong> means lower odds, a protective association.
        </li>
      </ul>
      <p>
        The Data Hub reports the <strong>odds ratio</strong> with its{" "}
        <strong>95% confidence interval</strong>. If the interval excludes 1, the
        association is statistically clear, the same call the test&apos;s p-value
        makes, and the interval&apos;s width tells you the precision.
      </p>

      <Screenshot
        src="/wiki/screenshots/datahub-stats-contingency.png"
        alt="A 2x2 contingency result in the Data Hub, reporting the Yates-corrected and uncorrected chi-square, Fisher's exact p-value, the relative risk, and the odds ratio with its interval, above the observed and expected count tables."
        caption="A 2x2 table. The Data Hub reports the chi-square (Yates-corrected and uncorrected), Fisher's exact p for small counts, the relative risk, and the odds ratio with its 95 percent confidence interval, then shows the observed counts against the counts you would expect if the two factors were unrelated."
      />

      <Callout variant="info" title="This is also what logistic regression reports">
        <strong>Logistic regression</strong> predicts a yes/no outcome from one or
        more predictors, and it reports each predictor&apos;s effect as an odds
        ratio, read exactly as above. The difference from a plain contingency
        table is that logistic regression can hold several predictors constant at
        once, so an odds ratio there means &quot;the change in odds per unit of
        this predictor, with the others fixed,&quot; just like a coefficient in{" "}
        <Link href="/wiki/stats/correlation-and-regression#multiple">
          multiple regression
        </Link>
        .
      </Callout>

      <h2>Relative risk, and when to use which</h2>
      <p>
        <strong>Relative risk</strong> compares the actual probability of the
        outcome between groups, not the odds. A relative risk of 2 means the
        outcome was twice as <em>likely</em> in one group. It is often the more
        intuitive number, and it is the right one when you sampled groups and then
        watched for outcomes (a cohort or a trial). The odds ratio is the natural
        choice for case-control designs and is what logistic regression produces.
        When the outcome is rare the two numbers nearly coincide; when it is common
        the odds ratio looks more extreme than the relative risk, so do not read an
        odds ratio as if it were a risk ratio.
      </p>

      <h2>A worked example</h2>
      <p>
        Of 50 treated patients, 10 relapsed; of 50 controls, 25 relapsed.
        Fisher&apos;s exact test gives p = 0.002. The odds ratio is 0.27 (95% CI
        0.11 to 0.64) and the relative risk is 0.40. You would write &quot;relapse
        was less frequent on treatment, 20% versus 50% (relative risk 0.40, odds
        ratio 0.27, 95% CI 0.11 to 0.64, Fisher exact p = 0.002).&quot; The
        interval not crossing 1 is what makes the association clear.
      </p>

      <p>
        ResearchOS validates the chi-square and Fisher exact tests, the odds
        ratio, and logistic regression against scipy and statsmodels on the{" "}
        <Link href="/transparency">transparency page</Link>.
      </p>
    </WikiPage>
  );
}
