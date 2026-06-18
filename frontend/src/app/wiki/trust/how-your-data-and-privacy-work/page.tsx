import Callout from "@/components/wiki/Callout";
import WikiPage from "@/components/wiki/WikiPage";
import DataFlowExplainer from "@/components/data-flow/DataFlowExplainer";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";

/**
 * How your data and privacy work.
 *
 * The full house-style port of the data-and-privacy explainer series
 * (docs/mockups/2026-06-18-how-your-data-works.html). Thirteen sections, in
 * the mockup's order, written concept-first in our wiki voice. The clickable
 * DataFlowExplainer carries the local-vs-cloud beat; the rest are clean
 * sections with small CSS-only diagrams where a picture earns its place.
 *
 * House-style hard rules honored here:
 *   - Every glyph is an <Icon> from the verified registry. No inline vector
 *     markup anywhere in this file, so the icon-guard ratchet passes.
 *   - Diagram motion is CSS transform/opacity only, declared in a scoped
 *     <style> block and frozen under prefers-reduced-motion.
 *   - No em-dashes, no mid-sentence colons, no emojis.
 *
 * Honesty constraints (vetted against the architecture proposal, do not soften):
 *   - One-time SEND is end-to-end. LIVE COLLAB, in-lab or external, is NOT.
 *   - Receiving is free; sending a copy and hosting live collaboration are paid.
 *   - The AI provider receives only what the AI reads; we claim no HIPAA or BAA.
 *   - Lab-head search ships dark behind the lab tier (framed as a lab capability).
 *   - Lab sites and the no-code builder are "coming with lab sites", not live.
 */
export default function HowYourDataAndPrivacyWorkPage() {
  return (
    <WikiPage
      intro="Where your research actually lives, what touches our servers and when, how shared work is protected, what the cloud costs and why, and what a lab can publish. The plain-English version, honest throughout, including the parts where our server can read something."
    >
      <style>{DIAGRAM_KEYFRAMES}</style>

      {/* 1. LOCAL BY DEFAULT */}
      <h2>Local by default</h2>
      <p>
        Your research lives in a folder on your own computer. ResearchOS reads
        and writes that folder directly through your browser, and there is no
        database we control holding your work. A free ResearchOS account is your
        identity, the way other researchers find you and you find them. It is
        not where your data is stored, not even on a paid lab plan.
      </p>
      <p>
        Almost everything you do never leaves your laptop. The cloud is a thin
        path you open only when you ask. Click through the four steps below to
        see it.
      </p>

      <DataFlowExplainer />

      <Callout variant="tip" title="The short version">
        Your folder never uploads, the app works offline, and there is no
        ResearchOS server holding your research. Want a backup? Copy the folder.
        Want to leave? Delete it. The full, verifiable version of this claim
        lives on the <a href="/wiki/security">Security</a> page.
      </Callout>

      {/* 2. THE THREE CLOUD TOUCHES */}
      <h2>The only three things that leave</h2>
      <p>
        Local-first does not mean isolated. Three actions open the thin path,
        and we are honest about which ones our server can read. Each one moves
        only what you choose, never the whole folder.
      </p>
      <div className="not-prose my-4 overflow-hidden rounded-xl border border-slate-200">
        <TouchRow
          icon="mail"
          title="Send to a researcher"
          sub="a sealed copy of one item"
          read="We cannot read it"
          tone="ok"
        />
        <TouchRow
          icon="users"
          title="Co-edit live"
          sub="real-time sync with your lab"
          read="We merge it, so we read it"
          tone="warn"
        />
        <TouchRow
          icon="ask"
          title="Ask BeakerBot"
          sub="the AI assistant"
          read="The AI provider reads it"
          tone="warn"
        />
      </div>

      {/* 3. LIVE COLLABORATION */}
      <h2>Co-edit live, just the one doc</h2>
      <p>
        When two people edit the same note live, only that one shared document
        streams to our relay so each change reaches the other person right away.
        Everyone has their own named cursor, and the rest of your folder never
        moves.
      </p>
      <div className="not-prose my-4 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <CursorChip name="Maya" className="bg-emerald-100 text-emerald-800" />
          <CursorChip name="Sam" className="bg-orange-100 text-orange-800" />
          <CursorChip name="Lee" className="bg-violet-100 text-violet-800" />
          <span className="ml-auto text-meta text-slate-500">
            one shared document
          </span>
        </div>
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <div className="h-2 w-2/3 rounded bg-slate-200" />
          <div className="flex items-center gap-1">
            <div className="dgm-typing h-2 rounded bg-emerald-300" />
            <span className="dgm-caret h-4 w-0.5 bg-emerald-600" />
          </div>
          <div className="h-2 w-4/5 rounded bg-slate-200" />
          <div className="h-2 w-3/5 rounded bg-slate-200" />
        </div>
      </div>
      <Callout variant="warning" title="Live collaboration is not end-to-end">
        This is the honest exception. To merge two people&apos;s edits into one
        document in real time, our relay has to read the shared document in
        readable form, so we can see what you co-edit there. It is encrypted in
        transit and at rest, but not end-to-end. A one-time send is end-to-end;
        live collaboration is not. Anything you do not put into a live shared
        document stays on your machine. Hosting live collaboration is a paid
        feature.
      </Callout>

      {/* 4. THE AI QUESTION */}
      <h2>Ask the AI, and only what it reads goes</h2>
      <p>
        BeakerBot runs on your machine. When you ask it to work with your data,
        only the note or table it reads travels through our server to the AI
        provider, and the answer returns. Nothing else from your folder goes
        along for the ride.
      </p>
      <div className="not-prose my-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FlowNode icon="ask" label="BeakerBot, on your machine" />
        <FlowNode
          icon="lock"
          label="Our server"
          sub="the model key stays here"
          accent
        />
        <FlowNode icon="cloud" label="AI provider" sub="no retention by default" />
      </div>
      <Callout variant="info" title="What we do not claim">
        Our model key never reaches your browser, and the provider&apos;s default
        is no retention and no training on your data. We do not claim HIPAA
        compliance or a Business Associate Agreement. If your work is regulated
        that way, keep it out of the AI helper. The summary tools are also built
        to count and structure your own content rather than interpret it.
      </Callout>

      {/* 5. THREE WAYS TO SHARE */}
      <h2>Three ways to share</h2>
      <p>
        There are three sharing modes, not two. Receiving anything is always
        free. Sending a copy or hosting live collaboration is a paid feature,
        and only the one-time copy is end-to-end encrypted.
      </p>
      <div className="not-prose my-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <ShareCard
          title="Inside your lab"
          badge="Lab"
          badgeTone="lab"
          lines={[
            "Live co-editing among members",
            "Only the shared doc syncs",
            "PI oversight, audit-logged",
          ]}
        />
        <ShareCard
          title="Outside, live"
          badge="Paid"
          badgeTone="paid"
          lines={[
            "Live co-editing with an outside user",
            "Their copy stays in sync, revocable",
            "Encrypted in transit and at rest, relay merges",
          ]}
        />
        <ShareCard
          title="Outside, one-time"
          badge="Paid to send"
          badgeTone="paid"
          lines={[
            "A one-time copy to anyone",
            "Free to receive, paid to send",
            "End-to-end, we cannot read it",
          ]}
        />
      </div>
      <Callout variant="tip" title="The unifying rule">
        Receiving is always free. Every outbound action, sending a copy or
        hosting live collaboration, is paid. Only the one-time copy is
        end-to-end encrypted; any live editing, in your lab or outside it, is
        encrypted in transit and at rest but merged by our server, because a
        live shared document needs the server to read it and a one-time handoff
        does not.
      </Callout>

      {/* 6. HOT, COLD, LOCAL STORAGE */}
      <h2>Hot, cold, and local storage</h2>
      <p>
        The document you co-edit right now sits in a fast store that costs more.
        Backups and published files sit in a cheap durable store. Everything
        else is free, on your own disk.
      </p>
      <div className="not-prose my-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StorageCard
          tag="hot, fast"
          tagClass="text-orange-700"
          title="Live store"
          desc="the document you are co-editing right now"
          price="$0.20"
          unit="per GB-month"
        />
        <StorageCard
          tag="cold, cheap"
          tagClass="text-sky-700"
          title="Durable store"
          desc="backups and anything you publish"
          price="$0.015"
          unit="per GB-month"
        />
        <StorageCard
          tag="local, yours"
          tagClass="text-emerald-700"
          title="Your own disk"
          desc="everything else, which is almost everything"
          price="free"
          unit="never reaches us"
        />
      </div>
      <p>
        That is roughly a thirteenfold price gap between the hot and cold tiers.
        Live collaboration needs the fast store, so that is the part a paid plan
        pays for. Almost everything else is free or has no marginal cost.
      </p>

      {/* 7. REDUNDANCY THROUGH YOUR INSTITUTION */}
      <h2>A free second copy from your university</h2>
      <p>
        Most universities already pay for Google Drive, OneDrive, or Box.
        Because a ResearchOS folder is just plain files, you can keep it inside
        that sync drive for an automatic second copy of your raw data at no
        extra cost to you or to us. The whole lab can even work out of the same
        synced folder.
      </p>
      <p>
        Your version history rides along, because it is just files in the
        folder. ResearchOS writes the history into a per-record log inside your
        own folder, so it works offline, it is backed up with the rest of the
        folder, and none of it lands on a ResearchOS server.
      </p>
      <Callout variant="tip" title="Redundancy you already have">
        A folder inside your university&apos;s existing cloud drive is a free,
        familiar second copy. ResearchOS does not need to run a backup service,
        because your institution already runs one. The on-disk format is written
        to be sync-friendly with atomic writes, so a sync mid-write can never
        corrupt it. The{" "}
        <a href="/wiki/shared-lab-accounts">Shared Lab Accounts</a> guides walk
        through setting each provider to keep files on the device.
      </Callout>

      {/* 8. WHY IT STAYS AFFORDABLE */}
      <h2>Why it stays affordable</h2>
      <p>
        Both the low cost and the strong privacy come from the same place.
        Because your data is local, free accounts cost us almost nothing, and we
        never charge to store research we do not hold.
      </p>
      <div className="not-prose my-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PlanCard plan="Free" price="$0" desc="work locally, receive shares" />
        <PlanCard plan="Solo" price="$3" unit="/ mo" desc="one researcher" />
        <PlanCard
          plan="Lab"
          price="$40"
          unit="/ mo"
          desc="the PI pays, the lab shares it"
        />
        <PlanCard
          plan="Department"
          price="$35"
          unit="/ lab"
          desc="institution pays, cheaper per lab"
        />
      </div>
      <p>
        You mainly pay for live collaboration, the one part with a real per-use
        cost. Storage is sold at roughly what it costs us, not as a markup to
        profit from. We do not make money holding your data. The honest, full
        breakdown of the model is on{" "}
        <a href="/wiki/trust/how-we-fund-it">How it stays free</a>.
      </p>

      {/* 9. THE SPENDING BRAKE */}
      <h2>A spending brake</h2>
      <p>
        Cloud usage has a built-in safety valve. If cloud cost ever nears the
        budget set for an account, a brake pauses cloud writes until we lift it
        by hand, so spending never silently resumes. Your local work keeps
        running and nothing is lost.
      </p>
      <Callout variant="tip" title="The worst case is paused sync, never lost work">
        The brake only pauses cloud writes. Edits keep flowing between people,
        your local data is untouched, and sync resumes when we lift it. Editing,
        saving, and reading your local folder continue exactly as before,
        because that part was never going through our servers in the first
        place.
      </Callout>

      {/* 10. LAB-HEAD SEARCH (dark behind lab tier) */}
      <h2>
        Lab-head search, without moving the data{" "}
        <ComingTag>lab tier</ComingTag>
      </h2>
      <p>
        On the lab tier, a lab head can search the whole lab without
        bulk-copying everyone&apos;s data. Each member&apos;s sync writes one
        tiny, lab-key-encrypted index of titles and previews, so a lab head can
        search the whole lab instantly. The lab head reads only those tiny
        encrypted indexes, never everyone&apos;s files.
      </p>
      <p>
        Big files stay with their owner. A large data table or sequence is not
        pushed to the index. The lab head sees that it exists, then requests it,
        the owning member approves, and only then does the full content upload.
        The request is visible to the member, there is no silent decline, and
        every lab-head read is audit-logged to the member&apos;s own log.
      </p>
      <Callout variant="info" title="A lab capability, not a back door">
        Search is role-gated to the lab-head role, and the index files are
        server-blind ciphertext sealed under the lab key, so the relay never
        reads them. Searching the lab means reading a few tiny encrypted
        indexes, not downloading everyone&apos;s data, which is part of why the
        lab tier stays cheap and fast. This ships with the lab tier.
      </Callout>

      {/* 11. LOCAL VS PUBLISHED */}
      <h2>Local workspace, published page</h2>
      <p>
        Your private workspace stays local. The one place where ResearchOS
        deliberately puts something in the cloud is when you choose to publish.
        A public web address has to live online, so a page or dataset you
        publish is hosted in the cloud on purpose.
      </p>
      <div className="not-prose my-4 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-xl border border-emerald-200 bg-white p-4">
          <div className="mb-2 flex items-center gap-2 text-emerald-700">
            <Icon name="lock" className="h-4 w-4" />
            <span className="text-body font-semibold text-slate-900">
              your private workspace
            </span>
          </div>
          <div className="mb-2 flex gap-1.5">
            <FileBar />
            <FileBar />
            <FileBar />
            <FileBar />
          </div>
          <div className="text-meta text-slate-500">
            local, on your disk, never uploaded
          </div>
        </div>
        <div className="flex items-center justify-center text-slate-400">
          <Icon name="chevronRight" className="h-6 w-6" />
        </div>
        <div className="overflow-hidden rounded-xl border border-sky-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-meta text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
            research-os.app/your-lab
          </div>
          <div className="dgm-pub p-4">
            <div className="mb-2 flex items-center gap-2 text-sky-700">
              <Icon name="cloud" className="h-4 w-4" />
              <span className="text-body text-slate-900">
                hosted in the cloud, on purpose
              </span>
            </div>
            <div className="mb-1.5 h-2 w-4/5 rounded bg-slate-200" />
            <div className="h-2 w-3/5 rounded bg-slate-200" />
          </div>
        </div>
      </div>
      <Callout variant="info" title="Private by default, public only on purpose">
        Your workspace stays local and private. Only the page you choose to
        publish is hosted, because a public web address has to be. We do not blur
        this with the local-first workspace; publishing is the one deliberately
        cloud-hosted surface, and everything else never leaves your disk.
      </Callout>

      {/* 12. LAB SITES (coming) */}
      <h2>
        Your lab&apos;s own web home <ComingTag>coming with lab sites</ComingTag>
      </h2>
      <p>
        A lab is getting a public page at research-os.app/your-lab, with a
        custom domain as a later add-on. The headline use is a companion page
        for a paper, a citable landing page that can carry the paper&apos;s
        figures and a live, interactive dataset viewer, frozen on publish so the
        link never changes under a reader. There will be three ways to build it,
        so it fits any comfort level.
      </p>
      <div className="not-prose my-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <BuildWayCard
          icon="bolt"
          title="Built-in builder"
          desc="no code, the recommended default"
        />
        <BuildWayCard
          icon="merge"
          title="Connect a repo"
          desc="point us at your own GitHub site"
        />
        <BuildWayCard
          icon="import"
          title="Upload HTML"
          desc="bring a hand-built custom site"
        />
      </div>
      <Callout variant="info" title="Coming with lab sites">
        Lab sites and the builder are upcoming, not available today. The
        bring-your-own paths are served from an isolated sandbox origin so
        untrusted lab code can never touch app sessions. We are framing this as
        coming with lab sites until the visual editor and the public-site
        address land.
      </Callout>

      {/* 13. THE NO-CODE BUILDER (coming) */}
      <h2>
        A no-code builder for data, omics, and genomes{" "}
        <ComingTag>coming with lab sites</ComingTag>
      </h2>
      <p>
        The built-in builder is the recommended default for most labs. The
        direction is a drop-in widget canvas, a data table, an omics heatmap,
        and a genome browser whose chromosomes open on the sequence pages, so a
        supplement page can carry live, interactive figures rather than flat
        images.
      </p>
      <div className="not-prose my-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <WidgetCard icon="table" label="data table" />
        <WidgetCard icon="growth" label="omics heatmap" />
        <WidgetCard icon="sequence" label="genome browser" />
      </div>
      <Callout variant="info" title="Real in direction, not yet in full">
        Today the built-in authoring is markdown pages plus baked-on-publish
        figure and dataset snapshots. The richer visual block editor is a later
        phase, so the no-code builder is real in direction but not yet the full
        drag-and-drop experience the word builder implies. We present it as
        coming with lab sites.
      </Callout>

      {/* WHERE TO GO NEXT */}
      <h2>Where to go next</h2>
      <p>
        For the audit-grade version of the local-first claim, including how to
        watch the network yourself in DevTools, read the{" "}
        <a href="/wiki/security">Security</a> page. For the account tiers and
        what each one unlocks, see{" "}
        <a href="/wiki/getting-started/accounts">Account tiers</a>. For the
        funding model in full, see{" "}
        <a href="/wiki/trust/how-we-fund-it">How it stays free</a>.
      </p>
    </WikiPage>
  );
}

/* ----------------------------------------------------------------------- */
/* Small presentational helpers. Icons from the verified registry only,    */
/* no inline SVG, so the icon-guard ratchet passes.                        */
/* ----------------------------------------------------------------------- */

function ComingTag({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1 align-middle rounded-full bg-amber-100 px-2 py-0.5 text-meta font-semibold uppercase tracking-wide text-amber-700">
      {children}
    </span>
  );
}

function TouchRow({
  icon,
  title,
  sub,
  read,
  tone,
}: {
  icon: IconName;
  title: string;
  sub: string;
  read: string;
  tone: "ok" | "warn";
}) {
  return (
    <div className="flex items-center gap-3 border-t border-slate-200 px-4 py-3 first:border-t-0">
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-slate-100 text-slate-600">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-body font-semibold text-slate-900">{title}</div>
        <div className="text-meta text-slate-500">{sub}</div>
      </div>
      <span
        className={[
          "flex-none rounded-full px-2.5 py-1 text-meta font-semibold",
          tone === "ok"
            ? "bg-emerald-100 text-emerald-800"
            : "bg-amber-100 text-amber-800",
        ].join(" ")}
      >
        {read}
      </span>
    </div>
  );
}

function CursorChip({
  name,
  className,
}: {
  name: string;
  className: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-meta font-semibold ${className}`}
    >
      <Icon name="pin" className="h-3 w-3" />
      {name}
    </span>
  );
}

function FlowNode({
  icon,
  label,
  sub,
  accent,
}: {
  icon: IconName;
  label: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center gap-2 rounded-xl border p-4 text-center",
        accent ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-10 w-10 items-center justify-center rounded-lg",
          accent ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600",
        ].join(" ")}
      >
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className="text-body font-semibold text-slate-900">{label}</span>
      {sub ? <span className="text-meta text-slate-500">{sub}</span> : null}
    </div>
  );
}

function ShareCard({
  title,
  badge,
  badgeTone,
  lines,
}: {
  title: string;
  badge: string;
  badgeTone: "lab" | "paid";
  lines: string[];
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-body font-bold text-slate-900">{title}</span>
        <span
          className={[
            "rounded-full px-2 py-0.5 text-meta font-semibold",
            badgeTone === "lab"
              ? "bg-violet-100 text-violet-800"
              : "bg-amber-100 text-amber-800",
          ].join(" ")}
        >
          {badge}
        </span>
      </div>
      <ul className="space-y-1.5 text-meta text-slate-600">
        {lines.map((l) => (
          <li key={l} className="flex items-start gap-2">
            <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-sky-400" />
            <span>{l}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StorageCard({
  tag,
  tagClass,
  title,
  desc,
  price,
  unit,
}: {
  tag: string;
  tagClass: string;
  title: string;
  desc: string;
  price: string;
  unit: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div
        className={`text-meta font-bold uppercase tracking-wide ${tagClass}`}
      >
        {tag}
      </div>
      <div className="mt-1 text-body font-semibold text-slate-900">{title}</div>
      <div className="mt-0.5 text-meta text-slate-500">{desc}</div>
      <div className="mt-3 text-title font-bold text-slate-900">
        {price}{" "}
        <span className="text-meta font-medium text-slate-500">{unit}</span>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  price,
  unit,
  desc,
}: {
  plan: string;
  price: string;
  unit?: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-meta font-semibold text-slate-500">{plan}</div>
      <div className="text-title font-bold text-slate-900">
        {price}
        {unit ? (
          <span className="text-meta font-medium text-slate-500"> {unit}</span>
        ) : null}
      </div>
      <div className="mt-1 text-meta text-slate-500">{desc}</div>
    </div>
  );
}

function BuildWayCard({
  icon,
  title,
  desc,
}: {
  icon: IconName;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <div className="mt-2 text-body font-semibold text-slate-900">{title}</div>
      <div className="mt-0.5 text-meta text-slate-500">{desc}</div>
    </div>
  );
}

function WidgetCard({ icon, label }: { icon: IconName; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-slate-100 text-slate-600">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className="text-body font-medium text-slate-900">{label}</span>
    </div>
  );
}

function FileBar() {
  return <span className="h-8 w-6 rounded bg-emerald-300" />;
}

/**
 * Diagram keyframes. transform / opacity only, frozen under
 * prefers-reduced-motion so the typing line and published-page reveal hold
 * still for users who ask for less motion.
 */
const DIAGRAM_KEYFRAMES = `
@keyframes dgm-type { 0% { width: 1rem; } 45% { width: 7rem; } 60% { width: 7rem; } 100% { width: 1rem; } }
@keyframes dgm-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes dgm-pub { 0%, 25% { opacity: 0.4; } 50%, 100% { opacity: 1; } }
.dgm-typing { width: 1rem; animation: dgm-type 6s ease-in-out infinite; }
.dgm-caret { animation: dgm-blink 1.1s steps(1) infinite; }
.dgm-pub { animation: dgm-pub 5s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .dgm-typing { width: 7rem; animation: none; }
  .dgm-caret { animation: none; opacity: 1; }
  .dgm-pub { animation: none; opacity: 1; }
}
`;
