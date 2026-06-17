import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function WhyPagesLoadPage() {
  return (
    <WikiPage
      intro="A few of the science tools pause to load the first time you open them. Here is what is happening, why it is worth it, and why it only happens once."
    >
      <h2>What you are seeing</h2>
      <p>
        When you open a heavy tool for the first time (e.g., the chemistry
        structure editor or the smart icon search in the figure composer),
        BeakerBot pours a beaker while a progress bar fills. That bar is honest.
        It tracks the real work happening in your browser and finishes exactly
        when that work is done, so it is never a fake spinner.
      </p>

      <h2>Why there is a wait at all</h2>
      <p>
        ResearchOS runs with no server and never uploads your data. That means
        the heavy machinery these tools rely on (a chemistry engine, a search
        model, a spreadsheet reader) has to run on your own computer instead of
        on someone else&apos;s cloud. The first time you open one of these
        tools, your browser downloads and starts that machinery. That is the
        wait.
      </p>

      <Callout variant="info" title="The trade we are making for you">
        Loading in your browser is what keeps the app free, private, and
        offline-capable. Your structures, datasets, and figures never leave your
        device, so there is nothing to upload and no account required to do the
        real work. The short first-open wait buys you that.
      </Callout>

      <h2>It only happens once</h2>
      <p>
        After the first load, your browser caches the downloaded pieces. The
        next time you open the same tool, it is ready almost instantly. On
        repeat visits the loader can even estimate the time left from how long
        it took you last time, so you know what to expect.
      </p>

      <h2>If something goes wrong</h2>
      <p>
        If a load fails (e.g., you lost your connection partway through the first
        download), the loader shows a <strong>Try again</strong> button rather
        than leaving you stuck. Once the pieces are cached, a flaky connection no
        longer matters, because the work is already on your machine.
      </p>

      <Callout variant="tip" title="Want it ready before you need it?">
        Just opening the chemistry workbench is enough to start warming the
        editor in the background, so by the time you click New or Edit it is
        usually already loaded. The same idea applies across the heavier tools.
      </Callout>
    </WikiPage>
  );
}
