import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function BeakerBotFeaturePage() {
  return (
    <WikiPage
      title="BeakerBot"
      intro="BeakerBot is the AI assistant built into ResearchOS. It operates the app for you, expands and summarizes your own content, and runs deterministic computations through the same engines the rest of the app uses. It never interprets your results, draws scientific conclusions, or invents data."
    >
      <Screenshot
        src="/wiki/screenshots/beakerbot-composer.png"
        alt="The BeakerBot chat panel open alongside the Data Hub, with an @mention picker above the composer showing a filtered list of sequences and notes, and a reply visible in the thread above."
        caption="The BeakerBot panel. The composer accepts free text, @object references, and /slash-commands. Replies render inline with rich object chips and data embeds."
      />

      <TryInDemo href="/datahub">Open BeakerBot</TryInDemo>

      <Callout variant="info" title="Feature flag and metering">
        BeakerBot is enabled by the <code>AI_ASSISTANT_ENABLED</code> flag. When
        the assistant is on, every turn consumes tokens from your AI usage meter.
        See{" "}
        <Link href="/wiki/features/cloud-and-plans">Cloud accounts and plans</Link>{" "}
        for the meter and the tier limits. Conversation text is forwarded to an
        external inference provider; see the{" "}
        <Link href="/wiki/security">Security and privacy</Link> page for the full
        data-flow description.
      </Callout>

      <h2>What BeakerBot is and what it will not do</h2>
      <p>
        BeakerBot has one job on purpose: help you use the software and work with
        your own content more efficiently. Its generative scope is narrow and
        deliberate. It rewrites, expands, and polishes text you already wrote,
        summarizes content already in your folder, relays tool outputs exactly as
        the engines return them, and operates the app by navigating pages and
        clicking controls for you. It can run every statistical test in the Data
        Hub, every computation in the sequence workbench, every cloning assembly,
        and every summary query against your records, and relay the results as
        facts.
      </p>
      <p>
        What it will not do, regardless of how you ask: interpret your experimental
        results, draw a scientific conclusion from your data, generate a hypothesis,
        suggest a next experiment, or write a discussion section from nothing. If you
        ask BeakerBot what your data means, it declines in one sentence and offers
        what it can do instead, such as running the relevant analysis, expanding a
        draft interpretation you wrote, or summarizing the data structurally. This
        boundary is encoded in the system prompt and applies to every turn.
      </p>
      <p>
        When a paper figure is attached, the same scope applies to images. BeakerBot
        describes what is visibly in the figure and gives presentation feedback on
        color, axis labels, font sizes, and legend placement. It does not interpret
        the scientific trend or conclude anything from the data shown.
      </p>
      <Callout variant="tip" title="Textbook science is always fine">
        General scientific knowledge, how PCR works, what a Tm is, the assumptions
        behind a t-test, standard methodology explanations, is not blocked. The
        hard rule applies only to claims specific to your own experimental work and
        results.
      </Callout>

      <h2>The chat composer</h2>
      <p>
        The composer is a text area at the bottom of the BeakerBot panel. You type
        your request there and press Enter or the send button to begin a turn.
        Beyond free text, the composer supports two structured input affordances
        that let you attach context without copying and pasting content.
      </p>

      <h3>@object references</h3>
      <p>
        Typing <strong>@</strong> opens an inline picker above the composer. The
        picker draws from the same cross-type global object index that powers
        BeakerSearch, so it covers every record type in your folder: experiments,
        projects, methods, sequences, notes, Data Hub tables, molecules, purchases,
        inventory items, and phylogenetic trees. As you type after the @, the list
        filters by prefix and substring match over names, sorted by recency. Selecting
        a row stages the object as an attached reference that travels with your
        message. BeakerBot reads the attached reference and can call the matching
        read tool to fetch the object&apos;s content, so you can write "Summarize
        @my qPCR method" or "Make a bar chart from @glucose growth table" and the
        assistant resolves to the real object without ambiguity. Keyboard navigation
        (up and down arrows, Enter to select, Escape to close) keeps focus in the
        composer while you arrow through results.
      </p>

      <h3>/slash-commands</h3>
      <p>
        Typing <strong>/</strong> opens a command menu above the composer. The menu
        has two sections. The first section is a curated set of six commands, each
        of which pre-fills the composer with an intent phrase that maps to a real
        BeakerBot capability.
      </p>
      <ul>
        <li>
          <strong>/summarize</strong> prefills "Summarize " and is the entry point
          for structural roll-ups of experiments, notes, purchases, projects, or
          inventory.
        </li>
        <li>
          <strong>/plot</strong> prefills "Make a chart from " for generating a
          Data Hub figure from a table.
        </li>
        <li>
          <strong>/cite</strong> prefills "Generate a citation for " to format a
          reference for a method, note, or sequence.
        </li>
        <li>
          <strong>/digest</strong> prefills "Give me a lab digest for " for the
          cross-type week-in-review across experiments, notes, and purchases.
        </li>
        <li>
          <strong>/setup</strong> prefills "Set up an experiment from " to create an
          experiment, attach a method, and scaffold tasks in one approved action.
        </li>
        <li>
          <strong>/draft</strong> prefills "Draft a note about " for a gated
          write-to-note flow.
        </li>
      </ul>
      <p>
        The second section of the menu lists your saved workflow macros. Selecting
        a macro from the menu does not pre-fill the composer, it stages the macro
        for replay directly. See the Workflow macros section below.
      </p>

      <h2>Voice input</h2>
      <p>
        A microphone button in the composer toolbar activates voice dictation using
        the browser Web Speech API. While the session is active, the button is lit
        and the assistant records continuously, so a bench scientist can keep their
        hands on the experiment and narrate a note or command out loud. Each final
        transcript fragment is appended to the existing composer draft, joined by a
        space, so you can mix typed and spoken text in one message. The mic button
        is hidden on browsers where the Web Speech API is unavailable (Firefox,
        Brave, some older Safari versions). On supported browsers, pressing the
        button again or sending the message stops the recording session.
      </p>

      <h2>How BeakerBot acts</h2>
      <p>
        Most reads are immediate. BeakerBot calls a tool, gets the result, and
        writes its reply, no confirmation needed. For actions that change your
        data, the flow is different.
      </p>

      <h3>Read tools</h3>
      <p>
        Read tools run straight away: looking at the current page, searching your
        work, listing records, running statistical analyses, computing a Tm,
        running a cloning assembly, searching PubChem, searching the literature.
        None of these prompt for approval because none change your files. Statistical
        analyses do create a stored result in the Data Hub, but the result is
        version-controlled and reversible, and the act of asking plus picking the
        groups constitutes the consent.
      </p>

      <h3>Gated write tools</h3>
      <p>
        Any tool that creates, modifies, or deletes a record shows an approval card
        in the chat before executing. The card shows exactly what will be written,
        the name, the content, the affected record. You click Approve or Reject. On
        Approve the tool runs; on Reject nothing happens and BeakerBot acknowledges
        the choice. This is the standard pattern for all CRUD operations, note
        writes, macro runs, and experiment creation.
      </p>

      <h3>Plans (propose_plan)</h3>
      <p>
        When a request involves more than one step, BeakerBot proposes a plan before
        it navigates or clicks anything. The plan card lists the steps as short
        human sentences and presents a single Approve or Cancel. On Approve,
        BeakerBot executes the steps in order, reading the page before each click so
        element references are always fresh. A genuinely destructive or outward-facing
        step (delete, send, share) still shows its own confirm at the moment it
        runs, even inside an already-approved plan.
      </p>
      <p>
        BeakerBot never writes out a numbered list of steps in its prose reply text
        for something it is about to do. A prose list has no Approve button and
        cannot be stopped or resumed. The only way BeakerBot presents a plan is
        through the plan card.
      </p>
      <Callout variant="tip" title="Step-by-step vs. whole-plan review mode">
        A toggle in the chat header switches between two review modes. In
        step-by-step mode (the default) each write tool shows its own card at the
        moment it is about to run. In whole-plan mode BeakerBot collects the full
        pipeline into one propose_plan call and runs every step after a single
        approval. Both modes still require a separate confirm for destructive
        actions.
      </Callout>

      <h2>Creating and editing records (CRUD)</h2>
      <p>
        BeakerBot can create, update, edit the content of, and delete every core
        object type in your folder. Every write goes through a gated approval card
        before anything changes. Every delete is a soft delete that moves the object
        to the{" "}
        <Link href="/wiki/features/trash">Trash</Link> with a 30-day recovery window,
        never an immediate erase.
      </p>

      <h3>Create tools</h3>
      <ul>
        <li>
          <strong>Methods:</strong> <code>create_method</code> authors a new markdown
          protocol in your Method library. BeakerBot formats and tidies the protocol
          text you provide, never invents steps you did not give it. If you ask it
          to create a method without giving the steps, it asks rather than
          fabricating.
        </li>
        <li>
          <strong>Projects:</strong> <code>create_project</code> makes a new project
          container with a name and optional tags.
        </li>
        <li>
          <strong>Notes:</strong> <code>write_note</code> in create mode drafts a
          note from the conversation or from tool outputs and shows you the draft
          for approval before writing.
        </li>
        <li>
          <strong>Sequences:</strong> <code>create_sequence</code> saves a sequence
          you provided (BeakerBot never fabricates bases).
        </li>
        <li>
          <strong>Molecules:</strong> <code>create_molecule</code> saves a molecule
          from a SMILES string you supply, with formula and molecular weight derived
          by the on-device RDKit engine. <code>import_molecule</code> pulls a
          compound from PubChem by CID.
        </li>
        <li>
          <strong>Purchases:</strong> <code>create_purchase</code> logs an order
          with item, quantity, vendor, and optional project.
        </li>
        <li>
          <strong>Experiments and tasks:</strong> <code>create_experiment</code>
          schedules a new experiment, <code>create_experiment_chain</code> links a
          sequence with finish-to-start dependencies, and{" "}
          <code>setup_experiment</code> creates an experiment, attaches methods,
          creates prep tasks, and scaffolds the Results file in one approved action.
        </li>
      </ul>

      <h3>Update and metadata tools</h3>
      <ul>
        <li>
          <code>update_method</code> renames a method, sets its tags, or moves it
          to another folder (metadata only, not the protocol body).
        </li>
        <li>
          <code>update_project</code> renames a project, sets its tags, or archives
          and unarchives it.
        </li>
        <li>
          <code>update_task</code> renames, marks complete, or moves a task.
        </li>
        <li>
          <code>update_sequence</code> renames a library sequence.
        </li>
        <li>
          <code>update_molecule</code> renames a molecule.
        </li>
        <li>
          <code>update_note</code> renames a note.
        </li>
        <li>
          <code>update_purchase</code> changes an order&apos;s item name, quantity,
          vendor, price, or status (needs ordering, ordered, received).
        </li>
      </ul>

      <h3>Content-edit tools</h3>
      <p>
        These tools change the body of a record, not just its metadata.
      </p>
      <ul>
        <li>
          <code>edit_method</code> changes the protocol body of a markdown method,
          either appending a section or replacing the whole body. BeakerBot reads
          the current body first so it can preserve what is already there.
        </li>
        <li>
          <code>edit_note</code> replaces an entry&apos;s content in a running-log
          note, or updates the note&apos;s top-level description.
        </li>
        <li>
          <code>edit_sequence</code> replaces the base string of a stored sequence
          with bases you provide.
        </li>
        <li>
          <code>edit_molecule_structure</code> replaces the SMILES of a stored
          molecule with a SMILES you supply, with the on-device RDKit engine
          re-deriving the formula and weight.
        </li>
      </ul>

      <h3>Delete tools</h3>
      <p>
        BeakerBot can delete methods, projects, tasks and experiments, notes,
        sequences, molecules, and purchases. Every delete tool shows a destructive
        confirm card before running and moves the object to Trash rather than
        erasing it immediately. BeakerBot only calls a delete tool when you clearly
        ask to remove a specific object, never speculatively.
      </p>

      <Screenshot
        src="/wiki/screenshots/beakerbot-crud-confirm.png"
        alt="The BeakerBot chat panel showing an action approval card with a preview of a new method titled 'Colony PCR protocol', its markdown body, and an Approve or Reject button pair."
        caption="The gated approval card. Every write shows the exact content before anything is created or changed. Approve to proceed, Reject to cancel."
      />

      <h2>Workflow macros</h2>
      <p>
        A workflow macro is a saved, named sequence of BeakerBot steps you replay
        with one /command. Where a plan is reasoned out on the spot for a single
        request, a macro is a plan you kept so a recurring routine becomes
        repeatable without retyping it every time.
      </p>
      <p>
        Macros are captured from a finished BeakerBot run. After a multi-step plan
        completes, a Save as macro button opens the macro editor, where you can give
        the macro a name (which becomes its /token in the slash menu), write a
        description, reorder steps, toggle individual steps off (kept but skipped at
        run time), or remove steps entirely. A step whose args captured a date at
        recording time shows a "fixed date" marker so deterministic replay is
        transparent rather than invisible.
      </p>
      <p>
        Macros are also authorable from scratch in the editor. You open the macro
        editor, add steps from the tool picker (every tool in the registry minus
        navigation noise is available), give each step a label, and save. At run
        time, selecting the macro from the /slash menu replays the steps in order
        using the same gated approval path as a normal plan. Destructive steps still
        show a hard-stop confirm before executing.
      </p>
      <p>
        Macros are stored per user in your data folder
        (<code>users/&lt;handle&gt;/beakerbot_macros/</code>) and are personal by
        default. When no folder is connected, macros live in memory for the session.
      </p>

      <h2>Inline record-set results browser</h2>
      <p>
        When a turn resolves two or more records (from a search, a list, a summary,
        or a lab digest), a record-set browser renders below the assistant reply.
        You do not invoke it; it appears automatically when the tool returns a set.
        The browser has a searchable, type-filterable rail on the left and a rich
        preview pane on the right. Clicking a row swaps the preview in place without
        a popup, and an Open full button opens the object through the standard popup
        or navigation path. The preview reuses the same embed pipeline as the rest
        of the app, so a note previews as a note card, a sequence as its map ribbon,
        a molecule as its 2D structure, and so on. In narrow panels the two columns
        collapse to a single column with a list and detail toggle.
      </p>
      <p>
        For two to four records the widget shows a compact tabbed view. For five or
        more it shows the full searchable rail. A single returned record renders as
        an inline chip in BeakerBot&apos;s reply text rather than a widget.
        BeakerBot&apos;s reply for a multi-record result gives only the count and a
        one-line headline; it never lists the names in prose, because the widget
        already shows them.
      </p>

      <h2>Context awareness</h2>
      <p>
        Each page in ResearchOS publishes a context snapshot to BeakerBot describing
        what the user currently has open and, when relevant, what is selected, for
        example the Data Hub analysis the user is looking at or the phylogenetic
        tree they have open in the Studio. BeakerBot reads this snapshot at the
        start of every turn. When you say "this" or "the t-test" or "this result",
        BeakerBot resolves to the selected item directly from the context rather than
        asking for clarification. If no context matches your request, it falls back
        to asking through button choices rather than guessing.
      </p>

      <h2>Summary suite</h2>
      <p>
        BeakerBot can produce structural roll-ups across every record type without
        counting or tallying anything itself. The engine owns every count, every
        date grouping, and every total. BeakerBot relays what the tool returned and
        narrates it in one tight paragraph. It never counts records in its own
        reasoning or derive a status verdict.
      </p>
      <ul>
        <li>
          <strong>Experiments</strong> (<code>summarize_experiments</code>): runs,
          finished, overdue, and finishing this week, filtered by period, owner, or
          project.
        </li>
        <li>
          <strong>Notes</strong> (<code>summarize_notes</code>): counts, by-owner
          and by-month tallies, entry total, and recent notes with their first entry
          heading. Structural only, BeakerBot will not summarize what your notes
          found or concluded.
        </li>
        <li>
          <strong>Projects</strong> (<code>summarize_projects</code>): task counts
          by status, percent complete, next due date, blocked and overdue flags.
        </li>
        <li>
          <strong>Purchases</strong> (<code>summarize_purchases</code>): total
          spend, vendor breakdown, pending orders. Every dollar figure is echoed
          verbatim from the tool&apos;s pre-formatted display string, never
          re-summed or reformatted.
        </li>
        <li>
          <strong>Inventory</strong> (<code>summarize_inventory</code>): what is
          low, what is out, what is expiring, what is expired, recently touched
          stocks.
        </li>
        <li>
          <strong>Lab digest</strong> (<code>lab_digest</code>): a cross-type
          week-in-review composing the per-type aggregates into one digest covering
          experiments, notes, purchases, and what is scheduled next.
        </li>
      </ul>
      <p>
        After a summary, BeakerBot can offer to save it as a note. On your
        confirmation, it drafts a structured note from the aggregate (counts and
        dates only, no invented findings) and shows you the draft for approval before
        writing.
      </p>
      <p>
        Period filters use a token ("this_week", "last_month", "this_quarter") that
        the engine resolves to exact dates. Owner and project filters accept plain
        names; the engine tolerates case differences and small typos. You never have
        to look up a user ID or a project ID.
      </p>

      <h2>Data Hub analysis tools</h2>
      <p>
        BeakerBot can run the full statistical analysis suite available in the{" "}
        <Link href="/wiki/features/datahub">Data Hub</Link> directly from the chat.
        It identifies the right table from your words, asks you to pick groups when
        needed (through button choices, not free-text re-entry), calls the engine,
        and returns one short verdict line plus a live embed of the result. Every
        number comes from the engine. BeakerBot never computes a statistic, a
        p-value, a coefficient, or a test result itself.
      </p>
      <p>
        Available from the chat: unpaired and paired t-tests, one-way ANOVA with
        Tukey comparisons, Mann-Whitney U and Wilcoxon signed-rank, Kruskal-Wallis,
        repeated-measures ANOVA with sphericity corrections, random-intercept mixed
        model, multiple linear regression, simple logistic regression, ROC and AUC,
        dose-response curve fitting (4PL and 5PL), global fitting across several
        curves, Cox proportional-hazards regression, Grubbs outlier screening,
        chi-square and Fisher exact tests, nested t-test and nested ANOVA, two-way
        ANOVA, and Kaplan-Meier survival with log-rank and Gehan-Breslow-Wilcoxon.
        BeakerBot can also create a Data Hub table from data you paste or describe,
        apply any of the five deterministic transforms, and run multi-step wrangling
        recipes (joins, group-by, pivot, filter, and more). It can also make bar and
        dot-plot figures for any table.
      </p>
      <p>
        BeakerBot can help you choose the right test through a guided wizard if you
        ask. It walks through a short button sequence (what are you comparing, how
        many groups, paired or independent) and then recommends and runs the test,
        delegating the actual assumption checks and test selection to the engine.
      </p>

      <h2>Sequence and cloning tools</h2>
      <p>
        BeakerBot can compute the melting temperature of an oligo, translate a
        sequence, take a reverse complement, find open reading frames, and design
        primer candidates, using the same nearest-neighbor Tm model and Primer3
        parameter windows the Sequences workbench uses. It can fetch a gene or
        accession from NCBI, extract a feature from a stored sequence by name or
        coordinates, run a Gibson or NEBuilder HiFi overlap assembly over two or
        more fragments, and run a restriction-enzyme digest and ligation, assembling
        the correct product from the computed junctions. It can also assemble a
        multi-FASTA file from sequences in your library for download and use in an
        external tree-building pipeline.
      </p>
      <p>
        Every biological operation is run by the engine. BeakerBot never computes a
        base, a junction, an overhang, a Tm, or an assembled product. If you ask it
        to translate a codon table from memory, it refuses and calls the translation
        tool instead.
      </p>

      <h2>PDF paper-reproduce analysis</h2>
      <p>
        Attaching a PDF to the chat triggers the paper-reproduce flow. BeakerBot
        extracts the paper text and proactively offers four outputs.
      </p>
      <ul>
        <li>
          <strong>Summary to a note</strong> (<code>draft_paper_summary</code>): a
          faithful, structural summary of what the paper studied, what was done, and
          what was reported, drafted as a note for your approval. It states only what
          the paper says, never interprets or judges the findings.
        </li>
        <li>
          <strong>Methods verbatim to catalog</strong> (
          <code>extract_paper_method</code>): the paper&apos;s methods section pulled
          into your Method library as a markdown protocol, with every number, temperature,
          cycle count, tool name, and version quoted verbatim from the source and the
          exact source passage included so you can verify against the paper.
        </li>
        <li>
          <strong>Tree-building pipeline</strong> (<code>generate_tree</code>): when
          the paper describes a phylogenetic pipeline, a runnable recipe covering
          alignment, trimming, model selection, and tree inference, for you to run on
          your own sequences. The recipe is generated by the catalog engine, not
          invented by BeakerBot.
        </li>
        <li>
          <strong>Figure style match</strong> (<code>match_figure_style</code>): when
          you crop a figure from the attached PDF using the Pick figure button, the
          cropped image reaches BeakerBot as a vision attachment. BeakerBot reads the
          visual style of the figure (layout, branch-length rendering, color palette,
          aligned tracks) and applies that style to your own saved tree in the{" "}
          <Link href="/wiki/features/phylo">Phylogenetics Tree Studio</Link>.
        </li>
      </ul>
      <Callout variant="info" title="The hard transcription rule">
        The paper-reproduce flow is the single highest-hallucination-risk thing
        BeakerBot does. It is a transcriber, not an analyst. Every drafted value
        must come from the paper text. BeakerBot never paraphrases a number,
        invents a parameter, or adds content not present in the text.
      </Callout>

      <h2>Resumable plan card</h2>
      <p>
        When the <code>NEXT_PUBLIC_BEAKERBOT_PLAN_STEPS</code> flag is on, approved
        plans run one step at a time and render a live card in the chat thread. The
        card ticks each step as done, running, or queued. If a plan stops mid-run,
        the card shows the stopped step and offers Resume (continue from that step)
        or Cancel (drop the remaining steps). This lets you correct a problem and
        pick up where the plan left off rather than restarting from the beginning.
        When the flag is off, plans free-run from start to finish as a single turn
        without the per-step card.
      </p>

      <Screenshot
        src="/wiki/screenshots/beakerbot-plan-card.png"
        alt="The BeakerBot plan card in the chat thread showing four steps, the first two marked done with green check icons, the third marked running with a spinning icon, and the fourth queued in muted text."
        caption="The resumable plan card (flag-gated). Each step ticks as done, running, or queued. A stopped plan shows Resume and Cancel buttons."
      />

      <Callout variant="info" title="Flag-gated feature">
        The resumable plan card requires the{" "}
        <code>NEXT_PUBLIC_BEAKERBOT_PLAN_STEPS</code> environment variable set to{" "}
        <code>true</code> or <code>1</code>. Without the flag, plans execute
        normally without the per-step card.
      </Callout>

      <h2>Smart Data Binding (chat door)</h2>
      <p>
        When you ask BeakerBot about adding metadata or annotations to a
        phylogenetic tree (for example "what data can I overlay on this tree" or
        "annotate this tree with the location column"), BeakerBot calls{" "}
        <code>suggest_tree_overlays</code>. This tool ranks the Data Hub tables in
        your folder by how many of the tree&apos;s tip labels they can join, and
        opens the Smart Data Binding wizard inline below the reply. The wizard lets
        you pick columns and chart types and apply them to the tree, without leaving
        the chat. BeakerBot relays the ranked tables and join rates as facts from
        the tool. If no table joins the tree&apos;s tips, it says so plainly rather
        than pretending the wizard appeared. The wizard and the Tree Studio it
        connects to are described in detail on the{" "}
        <Link href="/wiki/features/phylo">Phylogenetics</Link> page.
      </p>

      <h2>Finding your work</h2>
      <p>
        BeakerBot has two ways to locate a record you refer to by name. The first
        is <code>search_my_work</code>, which searches all record types concurrently
        by title, heading, and metadata and returns a ranked list of matches. When
        a match is found, BeakerBot calls the appropriate read tool to fetch the
        body before answering. The second is <code>search_full_text</code>, which
        deep-searches the full body of every note and method protocol for a string
        or regular expression. BeakerBot confirms the exact search term with you
        before running the body scan.
      </p>
      <p>
        When a tool returns a found artifact, BeakerBot ends its reply with a
        reference chip so you can open the object in place with one click. Notes,
        tasks, and experiments open their popup without leaving the chat; other
        types navigate to the page.
      </p>

      <h2>Chemistry and literature tools</h2>
      <p>
        BeakerBot can search PubChem for a compound by name, formula, or CID, list
        matching results with the CID and molecular weight, and then import the
        compound into your molecule library. It can also search Europe PMC for
        papers by topic or keyword, list the most relevant results with DOIs, and
        offer to add them to a note. It never invents a paper, a DOI, an author,
        or a year. Only what the search returns is cited.
      </p>

      <h2>User preferences</h2>
      <p>
        You can tell BeakerBot standing preferences it should apply by default:
        "remember that I always use Phusion polymerase" or "my default buffer is
        10x CutSmart". BeakerBot stores these with <code>remember_preference</code>
        and applies them without being reminded on subsequent turns. You can retract
        a preference with "forget that" or "stop remembering X". Only preferences
        you explicitly state are stored; BeakerBot never infers or invents one.
      </p>

      <h2>Inline object embeds in replies</h2>
      <p>
        BeakerBot replies can include live visual embeds of objects in your folder.
        A link on its own line renders as a block embed, a rich in-place card: a
        Data Hub analysis result with its verdict and statistics, a figure SVG, a
        molecule 2D structure, a sequence feature ribbon, or a data table preview.
        A link mid-sentence renders as a compact clickable chip. BeakerBot only
        emits an embed when it has a real ID from a tool result, never a fabricated
        one. The embed reflects the current computed state of the object, so the
        figure or result you see is always live, not a screenshot.
      </p>

      <h2>Connection to the rest of the app</h2>
      <p>
        BeakerBot can navigate to any page in ResearchOS, read the interactive
        elements on that page, and spotlight a control with a highlight bubble. This
        means you can ask "where do I add a method?" and BeakerBot scrolls to and
        highlights the New Method button rather than describing where it is in
        prose. When a control you want is on a different page, BeakerBot navigates
        first and then highlights. It reads the live page rather than guessing from
        a static map.
      </p>
      <p>
        BeakerBot also works across the{" "}
        <Link href="/wiki/features/sequences">Sequences workbench</Link>,{" "}
        <Link href="/wiki/features/datahub">Data Hub</Link>,{" "}
        <Link href="/wiki/features/phylo">Phylogenetics Tree Studio</Link>,{" "}
        <Link href="/wiki/features/methods">Methods library</Link>, and the
        experiment and project surfaces, using the same engines those surfaces use
        rather than reimplementing anything separately.
      </p>
    </WikiPage>
  );
}
