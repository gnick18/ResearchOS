import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function RocAucPage() {
  return (
    <WikiPage
      title="ROC curves and AUC"
      intro="Suppose you have a continuous measurement, a biomarker level, an assay readout, and you want to use it to tell two groups apart, diseased from healthy, responder from non-responder. A ROC curve shows how well that single measurement separates the two groups across every possible threshold, and the AUC sums it up in one number. This page covers reading the curve, the AUC, and choosing a cut point."
    >
      <h2>The problem a ROC curve solves</h2>
      <p>
        A continuous marker rarely separates two groups perfectly, the
        distributions overlap. Wherever you set a threshold to call a sample
        positive, you make two kinds of mistake, and they trade off. Set the
        threshold low and you catch almost every true positive but also flag many
        negatives. Set it high and you avoid false alarms but miss real cases. A{" "}
        <strong>ROC curve</strong> (receiver operating characteristic) draws that
        whole tradeoff so you can see it at once.
      </p>

      <h2>Sensitivity and specificity</h2>
      <p>
        The two axes are the two things you are trading.
      </p>
      <ul>
        <li>
          <strong>Sensitivity</strong> is the fraction of true positives the test
          catches. High sensitivity means few missed cases. It is on the vertical
          axis.
        </li>
        <li>
          <strong>Specificity</strong> is the fraction of true negatives the test
          correctly clears. High specificity means few false alarms. The
          horizontal axis is one minus specificity, the false-positive rate.
        </li>
      </ul>
      <p>
        Each point on the ROC curve is one possible threshold, plotting the
        sensitivity and false-positive rate you would get if you drew the line
        there. A curve that bows up toward the top-left corner is a good separator,
        it is achieving high sensitivity without paying much in false positives. A
        curve along the diagonal is no better than a coin flip.
      </p>

      <h2>AUC, one number for separation</h2>
      <p>
        The <strong>AUC</strong> is the area under the ROC curve, a single number
        from 0.5 to 1. An AUC of 0.5 means the marker has no discriminating power,
        the diagonal. An AUC of 1.0 is perfect separation. A useful plain reading,
        the AUC is the probability that a randomly chosen positive scores higher
        than a randomly chosen negative. So an AUC of 0.85 means that 85% of the
        time the marker correctly ranks a true case above a true non-case.
      </p>
      <p>
        The Data Hub reports the <strong>AUC</strong> with its{" "}
        <strong>95% confidence interval</strong>. An interval whose lower end
        stays well above 0.5 means the marker genuinely separates the groups, and
        its width tells you how sure you are, read it as on the{" "}
        <Link href="/wiki/stats/effect-sizes">effect sizes</Link> page.
      </p>

      <Screenshot
        src="/wiki/screenshots/datahub-stats-roc-auc.png"
        alt="A ROC and AUC result in the Data Hub, reporting the AUC with an accuracy band and 95 percent confidence interval, the Youden optimal threshold with its sensitivity and specificity, and a table of the false-positive and true-positive rate at each cut."
        caption="The AUC comes with an accuracy band and its 95 percent confidence interval, and the Youden cut point reports the sensitivity and specificity you would get at that threshold. The table below is the curve itself, the true-positive rate against the false-positive rate at every cut."
      />

      <h2 id="youden">Choosing a cut point</h2>
      <p>
        The ROC curve shows every threshold, but eventually you have to pick one to
        actually use. A common, balanced choice is the <strong>Youden cut
        point</strong>, the threshold that maximizes sensitivity plus specificity
        minus one, which is the point on the curve sitting farthest above the
        diagonal. It is the threshold that does best at both jobs at once, and the
        Data Hub reports it along with the sensitivity and specificity you would
        get there.
      </p>
      <Callout variant="tip" title="The best cut point depends on the cost of each mistake">
        The Youden point treats a missed case and a false alarm as equally bad.
        Often they are not. A cheap confirmatory test downstream argues for high
        sensitivity even at the cost of false positives; an invasive or costly
        follow-up argues for high specificity. Use the Youden point as a sensible
        default, then move along the curve toward whichever error you most need to
        avoid.
      </Callout>

      <h2>A worked example</h2>
      <p>
        A blood marker separating responders from non-responders gives an AUC of
        0.82 (95% CI 0.74 to 0.90). The Youden cut point sits at 3.1 ng/mL, where
        sensitivity is 0.78 and specificity is 0.80. You would write &quot;the
        marker discriminated responders from non-responders with an AUC of 0.82
        (95% CI 0.74 to 0.90); at the Youden-optimal cut of 3.1 ng/mL, sensitivity
        was 78% and specificity 80%.&quot;
      </p>

      <p>
        ResearchOS validates the ROC curve, the AUC and its interval, and the cut
        point against scikit-learn and R&apos;s pROC package on the{" "}
        <Link href="/transparency">transparency page</Link>.
      </p>
    </WikiPage>
  );
}
