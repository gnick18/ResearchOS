import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function OutliersPage() {
  return (
    <WikiPage
      title="Outlier tests"
      intro="Now and then a data point sits far from the rest and you wonder whether it is a genuine result or a mistake, a mispipette, a bubble, a transcription slip. An outlier test gives you a principled way to flag a point as statistically extreme. But flagging is the easy part. The honest and harder part is that statistical extremeness alone is never a good enough reason to delete data, and this page is as much about that caution as about the test."
    >
      <h2>What an outlier test does</h2>
      <p>
        An <strong>outlier test</strong> asks whether the most extreme point in
        your sample is farther from the others than you would expect from the
        normal spread of the data. The common one is the <strong>Grubbs
        test</strong>, which takes the single most extreme value, measures how many
        standard deviations it sits from the mean, and computes a p-value for
        whether a spread that large would arise by chance from a normal
        distribution. A small p-value flags that point as a statistical outlier.
      </p>

      <h2>When a lab reaches for it</h2>
      <p>
        You run an assay in triplicate and one well reads wildly off from the other
        two. Before you average, you want a defensible way to ask whether that well
        is an aberration rather than real biology. The Grubbs test is built for
        exactly this, a single suspected outlier in an otherwise roughly normal
        small sample.
      </p>

      <h2>How to read the result</h2>
      <p>
        The Data Hub reports, for each pass of the sweep, the{" "}
        <strong>suspected value</strong>, the <strong>Grubbs G statistic</strong>{" "}
        (how many standard deviations it lies from the mean of the remaining
        sample), the <strong>critical G</strong> for the sample size and alpha,
        and whether the value is flagged. The engine runs{" "}
        <strong>iteratively by default</strong>: after flagging and removing the
        most extreme point, it recomputes the mean and standard deviation on what
        remains and tests again, repeating until no point is flagged or the sample
        drops below 3. Each pass is shown in the result table in order, so you
        can see which values were removed and which pass cleared the bar. This
        iterative sweep is the standard approach for removing more than one
        potential outlier, and it uses Bonferroni-corrected critical values so
        that testing multiple points does not inflate the false-flagging rate.
        A cluster of extreme points that all flag may mean the data simply are not
        normally distributed rather than that several replicates are errors.
      </p>

      <Screenshot
        src="/wiki/screenshots/datahub-stats-outliers.png"
        alt="A Grubbs outlier result in the Data Hub, with a table reporting the most extreme value, its Grubbs G statistic, the critical G for the sample size and alpha, and whether the value is flagged as an outlier."
        caption="Grubbs runs an iterative sweep by default. The table shows each pass: the most extreme value in that pass, its G statistic, and whether G exceeded the Bonferroni-corrected critical value. The sweep stops when a pass clears or the sample is too small to test."
      />

      <Callout variant="danger" title="A flag is not a license to delete">
        Statistical extremeness tells you a point is unusual. It cannot tell you{" "}
        <em>why</em>. Removing a point because it is inconvenient, with no
        independent reason, is how real effects get erased and how noise gets
        polished into a false result. A flagged point is a prompt to investigate,
        not a verdict.
      </Callout>

      <h2>The honest rule for removing data</h2>
      <p>
        The defensible reason to drop a point is a documented problem with that
        measurement, not its value. A note that the well had a visible bubble, an
        instrument error logged at that timestamp, a sample you know was
        compromised. That reason should exist independently of how the number came
        out, and it should be recorded. The right habit is to decide your handling
        rule before you see the data where you can, report that you removed a
        point and why, and ideally show the result both with and without it so a
        reader can judge. A genuinely surprising point can be the most important
        thing in the dataset.
      </p>

      <h2>A worked example</h2>
      <p>
        Triplicate readings come back as 4.9, 5.1, and 9.8. Grubbs flags 9.8 (G =
        1.15, p = 0.03). On its own that is not permission to delete it. You check
        the run log, find that well was flagged for a pipetting error, and on that
        documented basis you exclude it, reporting &quot;one of three replicates
        was excluded due to a logged pipetting error (Grubbs p = 0.03); results
        are shown for the remaining two.&quot; Without that logged reason, you
        would keep the point and report the spread honestly.
      </p>

      <Callout variant="info" title="Related reading">
        If your spread is wide because the data are genuinely variable rather than
        because of an error, the better path is to report the variation honestly
        with a <Link href="/wiki/stats/effect-sizes">confidence interval</Link>,
        which already accounts for how noisy the measurement is.
      </Callout>

      <p>
        ResearchOS validates the Grubbs test against scipy and R on the{" "}
        <Link href="/transparency">transparency page</Link>.
      </p>
    </WikiPage>
  );
}
