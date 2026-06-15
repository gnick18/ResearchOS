import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function CorrelationRegressionPage() {
  return (
    <WikiPage
      title="Correlation and regression"
      intro="When both of your variables are measured numbers, you usually want to know whether they move together and whether you can predict one from the other. Correlation measures how tightly two things track. Regression fits an actual line you can read a slope off of and use to predict. Multiple regression extends that to several predictors at once. This page covers all three and the trap that sits underneath them."
    >
      <h2>What correlation measures</h2>
      <p>
        <strong>Correlation</strong> measures how consistently two variables rise
        and fall together. The common measure is <strong>Pearson&apos;s r</strong>,
        which runs from -1 to +1. An r near +1 means that when one goes up the
        other reliably goes up; near -1 means one goes up as the other goes down;
        near 0 means no straight-line relationship. The closer to the ends, the
        tighter the cloud of points hugs a line.
      </p>
      <p>
        The Data Hub reports <strong>r</strong>, its{" "}
        <strong>95% confidence interval</strong>, a <strong>p-value</strong> for
        whether the correlation differs from zero, and often{" "}
        <strong>r squared</strong>, the fraction of the variation in one variable
        that tracks with the other. An r of 0.7 gives an r squared of about 0.49,
        so roughly half the variation is shared.
      </p>
      <Callout variant="warning" title="Correlation is not causation, and r is only for straight lines">
        A strong r says two things track together, not that one causes the other,
        a lurking third variable can drive both. And Pearson&apos;s r only sees{" "}
        <em>straight-line</em> relationships. A perfect U-shaped curve can have an
        r near zero. Always look at the scatter plot, not just the number.
      </Callout>

      <h2 id="spearman">Spearman correlation</h2>
      <p>
        When your data are ranks, scores on an ordinal scale, or visibly
        non-normal, <strong>Spearman&apos;s rho</strong> is the nonparametric
        alternative. It works exactly like Pearson&apos;s r, but on the
        rank-transformed data rather than the raw values. The result is a
        coefficient that runs from -1 to +1 with the same meaning, and the Data
        Hub reports it with the same 95% confidence interval (Fisher z
        approximation on the ranks) and a p-value. Because Spearman captures any
        monotone relationship, not only straight lines, it is less sensitive to
        outliers and does not assume that the relationship between the two
        variables is linear.
      </p>

      <h2>Fitting a line with simple linear regression</h2>
      <p>
        Where correlation gives a single number for tightness,{" "}
        <strong>linear regression</strong> fits the actual line and hands you its
        equation. It is the right tool when one variable plausibly drives the
        other and you want to predict or quantify the relationship, the
        absorbance you expect at a given concentration, the signal per unit of
        input.
      </p>
      <p>
        The result reports the <strong>slope</strong> with its{" "}
        <strong>confidence interval</strong> and <strong>p-value</strong>, the{" "}
        <strong>intercept</strong>, and <strong>r squared</strong> for how well
        the line fits. The slope is the headline, it is how much the outcome
        changes for each one-unit change in the predictor, in real units. A slope
        whose confidence interval excludes zero is a relationship you can stand
        behind.
      </p>

      <Screenshot
        src="/wiki/screenshots/datahub-stats-linear-regression.png"
        alt="A simple linear regression result in the Data Hub, reporting the slope with its standard error and 95 percent confidence interval, the intercept with its interval, and the r-squared."
        caption="The slope is the headline, the change in the outcome for each one-unit change in the predictor, in real units. It comes with its standard error and 95 percent confidence interval, and the r-squared says how much of the variation the line accounts for."
      />

      <h2>A worked example</h2>
      <p>
        You plot fluorescence against protein concentration and fit a line. The
        slope is 1,250 units per microgram (95% CI 1,180 to 1,320, p {"<"}
        0.0001), with r squared = 0.98. You would write &quot;fluorescence rose
        1,250 units per microgram of protein (95% CI 1,180 to 1,320, p {"<"}
        0.0001), and the linear fit explained 98% of the variance (r squared =
        0.98).&quot; The tight interval and high r squared together say this is a
        clean, usable standard curve.
      </p>

      <h2 id="multiple">Multiple regression: several predictors at once</h2>
      <p>
        <strong>Multiple regression</strong> predicts one outcome from two or more
        predictors together. Its real value is that each predictor&apos;s effect
        is estimated <em>while holding the others constant</em>. If yield depends
        on both temperature and pH, multiple regression tells you the effect of
        temperature at a fixed pH, separating two influences that a one-at-a-time
        analysis would tangle together.
      </p>
      <p>
        The result reports, for each predictor, a <strong>coefficient</strong>
        with its <strong>confidence interval</strong> and <strong>p-value</strong>,
        plus an overall <strong>r squared</strong> and a model-level p-value. Read
        each coefficient as &quot;the change in the outcome per unit of this
        predictor, with the other predictors held fixed.&quot; A predictor that
        mattered on its own can fall to non-significance here, which usually means
        another predictor was carrying the signal all along.
      </p>

      <Screenshot
        src="/wiki/screenshots/datahub-stats-multiple-regression.png"
        alt="A multiple regression result in the Data Hub, with a coefficient table reporting the estimate, standard error, t, p-value, 95 percent confidence interval, standardized beta, and VIF for each predictor, plus overall r-squared, adjusted r-squared, and the model F test."
        caption="Each predictor gets its own coefficient, read as the change in the outcome per unit while the other predictors are held fixed. The standardized beta puts the slopes on a common scale, and the VIF column flags predictors that move together, where a value above about 5 to 10 means a coefficient is hard to trust."
      />

      <h2 id="vif">The VIF column and multicollinearity</h2>
      <p>
        The multiple-regression result includes a <strong>VIF</strong> (variance
        inflation factor) for each predictor. The VIF for a given predictor is
        computed by regressing that predictor on all the other predictors and
        taking 1 / (1 minus that r-squared). A VIF of 1 means the predictor is
        completely uncorrelated with the others, and its coefficient is as
        precisely estimated as the data allow. A VIF above roughly 5 to 10 is a
        flag that the predictor is redundant with something else in the model, and
        the coefficient&apos;s confidence interval is wider and less stable than
        it looks in isolation. When two predictors always move together in your
        setup, the model cannot separate their individual effects, and the
        coefficients for both get wide, shaky intervals. The fix is more varied
        data or dropping a redundant predictor, not trusting a narrow-looking
        coefficient.
      </p>

      <Callout variant="tip" title="Watch for predictors that move together">
        When two predictors are themselves strongly correlated (temperature and
        pressure that always rise together in your setup), the model struggles to
        credit the effect to one or the other, and their individual coefficients
        get wide, unstable intervals. The fix is more varied data or dropping a
        redundant predictor, not trusting a knife-edge coefficient.
      </Callout>

      <Callout variant="info" title="Related pages">
        If your outcome is a yes/no category rather than a number, you want
        logistic regression, a first-class analysis in the Data Hub. It predicts
        a binary outcome from a continuous predictor and reports an odds ratio
        with its interval. See the{" "}
        <Link href="/wiki/stats/contingency#odds-ratios">contingency page</Link>{" "}
        for how to read that odds ratio. If the relationship is a saturating curve
        rather than a line, see{" "}
        <Link href="/wiki/stats/dose-response">dose-response curves</Link>. The
        slope and its interval are read the same way as any other effect size, so{" "}
        <Link href="/wiki/stats/effect-sizes">that page</Link> is the foundation
        here too.
      </Callout>

      <p>
        ResearchOS validates Pearson and Spearman correlation, simple regression,
        and multiple regression (including VIF) against scipy and statsmodels on
        the <Link href="/transparency">transparency page</Link>.
      </p>
    </WikiPage>
  );
}
