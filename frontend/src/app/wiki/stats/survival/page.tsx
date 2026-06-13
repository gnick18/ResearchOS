import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function SurvivalPage() {
  return (
    <WikiPage
      title="Survival curves and hazard ratios"
      intro="When your outcome is how long until something happens, time to relapse, time to death, time to a tumor reaching a size, you need methods built for time-to-event data. The reason ordinary tests fall short is that some subjects have not had the event yet when the study ends, and you cannot just drop them or pretend they never will. This page covers Kaplan-Meier curves, the log-rank test, and the Cox hazard ratio."
    >
      <h2>Why time-to-event data is special</h2>
      <p>
        The defining feature is <strong>censoring</strong>. A patient who is still
        alive at the last follow-up has not had the event, but you do not know
        when, or if, they will. That is real information, they survived at least
        this long, and survival methods use it rather than throwing it away.
        Averaging the times you happened to observe would be badly biased, because
        the longest survivors are exactly the ones still censored.
      </p>

      <h2>Kaplan-Meier curves</h2>
      <p>
        The <strong>Kaplan-Meier</strong> estimate is the survival curve itself, a
        stepped line showing the fraction of subjects still event-free over time.
        It steps down at each event and accounts for censored subjects by dropping
        them out of the at-risk pool without counting them as events. Reading it is
        intuitive, a curve that stays high means subjects are lasting longer, and
        the gap between two curves is the difference between groups.
      </p>
      <p>
        The Data Hub reports the curve plus the <strong>median survival</strong>
        for each group, the time by which half the subjects have had the event,
        with its confidence interval. Median survival is often the cleanest single
        summary, &quot;median time to relapse was 14 months in the treated arm
        versus 9 in the control.&quot;
      </p>

      <h2>The log-rank test</h2>
      <p>
        The <strong>log-rank test</strong> asks whether two (or more)
        Kaplan-Meier curves differ more than chance would explain. It compares the
        whole curves over the entire follow-up, not just a single timepoint, so it
        uses all the event timing. The result is a <strong>p-value</strong>. A
        small one means the survival experience genuinely differs between groups.
      </p>
      <Callout variant="tip" title="The log-rank says whether, not how much">
        Like an ANOVA p-value, the log-rank test flags a difference but does not
        size it. For the size of the effect, the gap in median survival and the
        hazard ratio below are what you report.
      </Callout>

      <h2 id="hazard-ratios">Hazard ratios and the Cox model</h2>
      <p>
        The <strong>hazard ratio</strong> is the effect size for survival data. The
        <strong> hazard</strong> is the instantaneous risk of the event at any
        moment among those still at risk. The <strong>Cox regression</strong>
        model estimates how a factor multiplies that risk, and reports it as a
        ratio.
      </p>
      <ul>
        <li>
          A hazard ratio of <strong>1</strong> means no difference in risk.
        </li>
        <li>
          <strong>Below 1</strong> means lower risk. A hazard ratio of 0.6 for the
          treatment means treated subjects had 60% the event risk of controls at
          any given moment, a protective effect.
        </li>
        <li>
          <strong>Above 1</strong> means higher risk. A hazard ratio of 1.8 means
          80% more risk.
        </li>
      </ul>
      <p>
        The result reports the <strong>hazard ratio</strong>, its{" "}
        <strong>95% confidence interval</strong>, and a <strong>p-value</strong>.
        Read the interval exactly as on the{" "}
        <Link href="/wiki/stats/effect-sizes">effect sizes</Link> page, if it does
        not include 1, the effect is statistically clear, and its width tells you
        how precisely you have pinned the risk change down. The Cox model can also
        adjust for other variables at once (age, stage), reporting a hazard ratio
        for each, much like multiple regression for survival.
      </p>

      <h2>A worked example</h2>
      <p>
        A trial reports median time to progression of 14 months on treatment
        versus 9 on control, a log-rank p = 0.004, and a Cox hazard ratio of 0.62
        (95% CI 0.45 to 0.85). You would write &quot;treatment extended median
        time to progression from 9 to 14 months and reduced the hazard of
        progression by 38% (hazard ratio 0.62, 95% CI 0.45 to 0.85, log-rank p =
        0.004).&quot; The 38% comes from 1 minus 0.62, and the interval not
        crossing 1 is what makes it clear.
      </p>

      <p>
        ResearchOS validates the Kaplan-Meier estimate, the log-rank test, and the
        Cox model against the lifelines package and R&apos;s survival library on
        the <Link href="/transparency">transparency page</Link>.
      </p>
    </WikiPage>
  );
}
