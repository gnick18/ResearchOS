import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function DoseResponsePage() {
  return (
    <WikiPage
      title="Dose-response curves"
      intro="A lot of biology is a saturating S-curve, not a straight line. A drug has little effect at low doses, a steep response through the middle, and a plateau once the system is maxed out. A dose-response fit captures that shape and boils it down to a few numbers you can compare across drugs, days, and labs. This page covers the EC50 and IC50, the sigmoid models that produce them, the Hill slope, and how to compare or share fits."
    >
      <h2>What a dose-response curve is</h2>
      <p>
        You plot response against dose, almost always with dose on a{" "}
        <strong>log scale</strong>, and fit a smooth S-shaped curve through the
        points. The curve summarizes the whole experiment with a handful of
        parameters, the bottom plateau, the top plateau, the dose at the halfway
        point, and how steeply the response climbs.
      </p>

      <h2>EC50 and IC50, the halfway dose</h2>
      <p>
        The single most-used number is the dose that produces a half-maximal
        response. When the response goes up with dose, that is the{" "}
        <strong>EC50</strong> (half-maximal effective concentration). When the
        response goes down, an inhibition, it is the <strong>IC50</strong>
        (half-maximal inhibitory concentration). A lower IC50 means a more potent
        inhibitor, it takes less drug to get halfway to full effect. This is the
        number you compare between compounds.
      </p>
      <Callout variant="tip" title="Report the EC50 with its interval, on the log scale">
        Because dose is fitted on a log scale, the EC50&apos;s uncertainty is not
        symmetric in plain units. The Data Hub reports its confidence interval,
        and that interval is what tells you whether two compounds genuinely
        differ in potency, as on the{" "}
        <Link href="/wiki/stats/effect-sizes">effect sizes</Link> page.
      </Callout>

      <h2>The Hill slope and the models</h2>
      <p>
        The <strong>Hill slope</strong> describes how steep the climb is through
        the middle of the curve. A slope near 1 is the standard simple case; a
        steeper slope means the response switches on over a narrow dose range,
        which can hint at cooperative binding. The Data Hub reports it as a fitted
        parameter with its own uncertainty.
      </p>
      <p>
        The shape comes from a model. The <strong>4PL</strong> (four-parameter
        logistic) fits the bottom plateau, the top plateau, the EC50, and the Hill
        slope, and is the default for a symmetric S-curve. The{" "}
        <strong>5PL</strong> adds a fifth parameter for asymmetry, for curves that
        approach their two plateaus at different rates. The result reports each
        fitted parameter with its confidence interval, plus a goodness-of-fit
        summary (r squared and the residual spread) so you can see how well the
        curve tracks the points.
      </p>

      <h2 id="model-comparison">Comparing models</h2>
      <p>
        Should you use the simpler 4PL or the more flexible 5PL? A more complex
        model will always fit your particular points at least slightly better,
        just by having an extra knob to turn, so a bare improvement in fit is not
        a good reason to prefer it. <strong>Model comparison</strong> asks the
        sharper question, is the improvement big enough to justify the extra
        parameter, or is the simpler model good enough?
      </p>
      <p>
        The Data Hub reports a comparison (an F test or an information criterion
        such as AIC) that weighs the gain in fit against the added complexity, and
        states which model is preferred. The honest default is the simpler model
        unless the data clearly call for more. A multi-effect comparison like this
        has no single number to act on, so read the verdict, which names the
        winning model and why.
      </p>

      <h2 id="global-fits">Global fits: sharing parameters across datasets</h2>
      <p>
        Often several curves should share something. Three compounds tested the
        same day plausibly share the same top and bottom plateau, they differ only
        in potency. A <strong>global fit</strong> fits all the curves at once with
        some parameters <em>shared</em> and others left free per curve. Sharing
        the plateaus pins them down using every point from every curve, which
        makes the per-curve EC50s more precise and lets you compare potency on a
        fair footing.
      </p>
      <p>
        The result reports the shared parameters once, the free parameters per
        dataset, and the confidence intervals throughout. The headline is usually
        the ratio of EC50s between curves, with its interval, which answers
        &quot;is compound A genuinely more potent than compound B?&quot;
      </p>

      <h2>A worked example</h2>
      <p>
        You fit an inhibition curve and get an IC50 of 120 nM (95% CI 95 to 150),
        a Hill slope of 1.1, and r squared = 0.99. A second compound gives an
        IC50 of 480 nM (95% CI 410 to 560). The intervals do not overlap, so you
        would write &quot;compound A was about four-fold more potent than compound
        B (IC50 120 nM, 95% CI 95 to 150, vs 480 nM, 95% CI 410 to 560).&quot;
      </p>

      <p>
        ResearchOS validates the 4PL and 5PL fits, the EC50 and IC50 estimates,
        and the model comparisons against scipy and R on the{" "}
        <Link href="/transparency">transparency page</Link>.
      </p>
    </WikiPage>
  );
}
