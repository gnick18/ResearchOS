import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabCalculatorsFeaturePage() {
  return (
    <WikiPage
      title="Lab calculators"
      intro="A floating beaker button opens a set of everyday bench calculators. Every one computes live in your browser, and nothing you type is saved."
    >
      <h2>What the lab calculators are</h2>
      <p>
        Bench work is full of small calculations. How much powder to weigh out for a
        stock, how much to add for a dilution, what the melting temperature of a
        primer is, how many picomoles are in a microgram of DNA. The lab calculators
        gather the common ones into a single floating modal so you can do the math
        without leaving ResearchOS and without reaching for a separate tool.
      </p>
      <p>
        The calculators live behind a small floating beaker button that sits in the
        corner of the app. Clicking it opens the calculators modal over whatever you
        are working on; closing it returns you exactly where you were. The modal is a
        scratchpad, not a record. It does not write to your data folder, it is not
        attached to an experiment, and it keeps no history. As the footer of the modal
        says, this is quick bench math computed live in your browser, and nothing here
        is saved.
      </p>

      <Screenshot
        src="/wiki/screenshots/lab-calculators-modal.png"
        alt="The Lab calculators modal open over the app, showing a row of tabs (Scientific, Molarity, Dilution, Serial dilution, Primer Tm, DNA / RNA, Protein properties, Buffer recipe) and the Molarity calculator's input fields and result card below."
        caption="The Lab calculators modal. Tabs across the top switch calculators; results update live as you type. Nothing here is saved."
      />

      <h2>The calculators</h2>
      <p>
        The modal carries one tab per calculator. Each tab is self-contained, so you
        fill in the fields it needs and the result appears below, updating on every
        keystroke. Most tabs accept values with a unit selector (nM, uM, mM, M for
        concentration; uL, mL, L for volume; ng, ug, mg, g for mass), and the result
        is shown in whatever unit reads most naturally for the number.
      </p>

      <h3>Scientific</h3>
      <p>
        A general-purpose scientific calculator for the arithmetic that does not fit
        the other tabs. Type an expression directly or use the on-screen keypad. It
        handles the usual operators plus sine, cosine, tangent and their inverses, the
        natural log and log base 10, square root, powers, factorial, and the constants
        pi and e. A degree or radian toggle sets the angle mode, and a small memory
        (M, with recall and add) holds a running value. Enter sets the last answer so
        you can chain calculations.
      </p>

      <h3>Molarity</h3>
      <p>
        The weigh-out calculator. Enter a molecular weight, a target concentration,
        and a volume, and it gives the mass to weigh out, using n = m / MW and C = n /
        V. Enter a mass instead and it goes the other way, giving the moles and the
        resulting concentration. This is the everyday make-a-stock calculation.
      </p>

      <h3>Dilution</h3>
      <p>
        The C1 V1 = C2 V2 calculator. Enter your stock concentration, the final
        concentration you want, and the final volume, and it solves for how much
        stock to add and how much diluent to top up with. It flags the case where the
        final concentration is higher than the stock, which usually means an input
        slipped.
      </p>

      <h3>Serial dilution</h3>
      <p>
        Builds a serial-dilution table. Give a starting concentration, a fold factor
        per step, a number of steps, and a per-tube final volume, and it lays out each
        tube with the concentration at that step, the volume of sample to carry over
        from the previous tube, and the volume of diluent to add. Each tube takes a fixed
        transfer of the previous one and tops up to the per-tube volume, giving an
        equal fold dilution per step.
      </p>

      <h3>Primer Tm</h3>
      <p>
        The primer melting-temperature calculator. Paste a DNA or RNA sequence and it
        reports the length, the GC content, and the melting temperature using a
        nearest-neighbor model (the SantaLucia parameters that IDT OligoAnalyzer,
        Primer3, NEB, Benchling, and SnapGene use). Only the sequence is required, standard
        reaction conditions are assumed, and an Advanced section lets you enter your
        actual salt, Mg2+, dNTP, and oligo concentrations for a sharper value. For
        very short oligos it also shows the Wallace 2-4 rule, where the rule of thumb
        still helps. This is the same Tm engine that powers the live selection readout
        and the primer-design dialog in the{" "}
        <Link href="/wiki/features/sequences">Sequences</Link> editor, so a Tm you
        compute here agrees with one you compute there.
      </p>

      <h3>DNA / RNA</h3>
      <p>
        Two nucleic-acid conversions in one tab. The mass-to-moles section turns a
        mass and a length into an amount, choosing the right average molecular weight
        for double-stranded DNA, single-stranded DNA, or RNA. The A260 section turns a
        spectrophotometer reading and a dilution factor into a concentration in ng/uL,
        using the conventional ng-per-A260 factor for each nucleic-acid kind.
      </p>

      <h3>Protein properties</h3>
      <p>
        Paste an amino-acid sequence and it reports the same physico-chemical properties
        the ExPASy ProtParam tool reports, including the average molecular weight, the
        isoelectric point (pI), the molar extinction coefficient at 280 nm and the
        corresponding absorbance of a 0.1 percent solution, the amino-acid
        composition, the instability index, the GRAVY hydropathy, the aromaticity, and
        the aliphatic index. The readout is the same one the editor&apos;s Analyze
        menu shows, so the calculator and the editor agree.
      </p>

      <h3>Buffer recipe</h3>
      <p>
        Build a multi-component buffer. Set the total volume, then add a row per
        component with its final concentration and its stock concentration. For each
        component it gives the volume of stock to add, using volume = (final
        concentration x total volume) / stock concentration, and it reports the
        diluent to top up with. It flags the case where the stock volumes alone
        overflow the total volume.
      </p>

      <Callout variant="info" title="Nothing here is saved">
        The calculators are a scratchpad. They run entirely in your browser, they do
        not touch your data folder, and they keep no history. When you close the
        modal, the values are gone. If you want a number on the record, copy it into a
        note, an experiment, or a method protocol.
      </Callout>

      <Callout variant="tip" title="The math is validated, not approximated">
        The bench calculators are checked against exact algebra and cited reference
        constants, so the numbers are not estimates. The Primer Tm tab is a faithful
        port of Biopython&apos;s nearest-neighbor model (validated against Biopython
        directly), and the Protein properties tab is a faithful port of
        Biopython&apos;s ProtParam algorithms with every constant transcribed
        verbatim. Those comparisons run as part of the test suite. The full
        side-by-side is published openly on the{" "}
        <Link href="/transparency">Transparency page</Link>, with the method-by-method
        write-up on the{" "}
        <Link href="/wiki/trust/method-validation">Method validation</Link> page.
      </Callout>

      <h2>Build your own calculator</h2>
      <p>
        The calculators above are fixed, and the math you do in them is scratch.
        Plenty of bench math is too specific to ship for everyone, though. A spore
        suspension from five hemocytometer counts, a master mix scaled to your reaction
        count, a dosing volume from an animal&apos;s weight. So you can build your own
        calculator for the math your lab actually does. Unlike the built-in tabs, a
        calculator you build is saved, as its own item in your folder, and you can
        share it and use it on your phone.
      </p>
      <p>
        Open the Lab calculators modal and, alongside the built-in tabs, you will find
        your own calculators, a Build your own button, and a template library. A
        calculator you build is just inputs and a formula. You name the things you
        measure, you write the answer as a formula using those names, and the result
        computes live as you fill it in, exactly like the built-in tabs.
      </p>

      <h3>How you build one</h3>
      <p>
        The first time, a short wizard walks you through it one plain question at a
        time. What does this work out, what do you measure, what is the formula, any
        warnings to add, and what is the answer called. It assembles the calculator for
        you, with the answer updating live on the formula step so you can see it working
        before you save.
      </p>
      <Screenshot
        src="/wiki/screenshots/calc-builder-wizard.png"
        alt="The build-your-own calculator wizard asking one plain-language question, with a live answer shown below the formula field."
        caption="First time through, a wizard asks one plain question at a time and assembles the calculator for you."
      />
      <p>
        Once you have built one, Build your own opens a single form instead, with the
        same pieces laid out together. You can switch between the wizard and the form at
        any time, and your work carries across. The form keeps the simple case simple,
        the optional pieces (intermediate steps and guidance warnings) sit behind an
        Advanced section, so a basic calculator is just inputs and a result.
      </p>
      <Screenshot
        src="/wiki/screenshots/calc-builder-form.png"
        alt="The build-your-own calculator form, with named inputs, clickable variable chips above the result formula, a live result, and an Advanced section for steps and guidance."
        caption="The form view. Name your inputs, write the result formula (the chips above it drop a variable in), and the result computes live."
      />

      <h3>Start from a template</h3>
      <p>
        You rarely need to start from a blank page. The template library carries
        ready-made calculators grouped by field, including spore concentration, CFU per
        mL from plate counts, OD600 to cell density, qPCR amplification efficiency, and
        doubling time. Open the closest one, change the parts that differ for your lab,
        and save it as your own. Cloning and tweaking a real example is faster than
        building from scratch, so it is how most calculators start.
      </p>
      <Screenshot
        src="/wiki/screenshots/calc-template-library.png"
        alt="The calculator template library, a gallery of ready-made calculators grouped by field with a Use this action on each card."
        caption="The template library. Start from a proven calculator and make it yours."
      />

      <h3>Inputs, formulas, and guidance</h3>
      <p>
        An input is a box you type a measurement into. You name it in plain words and
        the builder gives it a short name to use in formulas, so labelling one Average
        spore count lets you reference it as avgCount. An input can be a single number,
        a dropdown of choices, or a replicate list (several values you average, like
        five squares on a hemocytometer). The result is a formula written with those
        names, and helpers like mean, sum, and standard deviation are there for the
        replicate case.
      </p>
      <p>
        Guidance is the optional safety net. You write a condition and a message, and
        the message only appears when the condition is true. A spore calculator can warn
        you when the count is too low to be reliable, a qPCR calculator can flag an
        efficiency outside the accepted range. The warning stays quiet until something
        is actually off. Each answer can also be shown the way you read it, a plain
        number, scientific notation, or a fixed number of decimals.
      </p>

      <h3>Sharing and your phone</h3>
      <p>
        A calculator you build is yours until you share it. Share it with your lab and
        everyone in your lab folder can run it as a live reference, so they always see
        your latest and you stay the only editor. Share it with someone outside your
        folder and a copy travels to them over the encrypted transfer relay. And when
        your phone is paired to your laptop, your calculators sync to it automatically,
        so the math you built at the bench is on the bench with you. The companion app
        ships with the built-in calculators and pulls your custom ones in once it is
        paired.
      </p>
      <Callout variant="tip" title="Built once, available everywhere">
        Build a calculator on your laptop and it is in your folder, on your paired
        phone, and (if you share it) in your labmates&apos; libraries, with no extra
        steps. Fix a formula once and the fix reaches everyone who has the lab-shared
        version, because they read your copy rather than holding their own.
      </Callout>

      <h3>Submitting to the public library</h3>
      <p>
        If you build a calculator others would find useful, you can submit it to the
        public template library. It opens a pre-filled submission on our GitHub for a
        maintainer to review, and accepted calculators ship in a later release for
        everyone to start from. It is reviewed rather than instant, so the shared
        library stays trustworthy.
      </p>

      <Callout variant="info" title="The same validated engine">
        Your calculators run on the same expression engine the built-in tabs use, so
        the math is the hardened, tested layer rather than a loose evaluator. The
        engine, and how our calculations reproduce reference values and published
        results, is shown on the{" "}
        <Link href="/transparency">Transparency page</Link>.
      </Callout>
    </WikiPage>
  );
}
