"use client";

// OperatorShell (operator-console build, 2026-06-14). The unified left-rail +
// scrollable content pane that merges the two operator surfaces into one:
//   - /admin       (AdminMetrics): user metrics, capacity, feature usage
//   - /business    (BusinessTracker): LLC finances, the price-modeling tool
//
// It is a RE-COMPOSITION, not a rewrite. The data fetching and every panel come
// straight from the two existing components via the shared hooks/exports
// (useAdminMetrics, useBusinessData, and the named section pieces), so the
// ledger writes, the Actuals/Simulation toggle, and all behavior are unchanged.
//
// Layout mirrors the approved mockup docs/mockups/2026-06-14-operator-shell-
// unified.html and the rail pattern of SettingsShell.tsx. Unlike SettingsShell,
// every section renders in one scrolling pane; the rail highlights the section
// in view (IntersectionObserver) and smooth-scrolls to a section on click.
//
// Operator-only and light-mode-pinned by the page that mounts it. The data
// endpoints 404 for non-operators, so the shell handles loading/denied/error
// exactly as the standalone pages did.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import Link from "next/link";

import { Icon, type IconName } from "@/components/icons";
import AppFooter from "@/components/AppFooter";

import AccountsPanel from "@/components/admin/AccountsPanel";
import BeakerBotGreeting from "@/components/admin/BeakerBotGreeting";
import BroadcastPanel from "@/components/admin/BroadcastPanel";
import CostBreakerPanel from "@/components/admin/CostBreakerPanel";
import GiftPoolsPanel from "@/components/admin/GiftPoolsPanel";
import SpendByCategoryPanel from "@/components/admin/SpendByCategoryPanel";
import { MarginExplorerTab } from "@/components/admin/PriceModelingModal";
import {
  CapacitySection,
  FeatureUsageSection,
  InstitutionsSection,
  OperatorDeniedPanel,
  OperatorErrorPanel,
  SignupsSection,
  StatCard,
  humanBytes,
  useAdminMetrics,
  type MetricsState,
} from "@/components/admin/AdminMetrics";
import {
  Checklist,
  Correspondence,
  DeadlineStrip,
  DevAccountantPanel,
  EntityCard,
  InfraCostPanel,
  InfraTiersPanel,
  Ledger,
  PaymentMethods,
  RecurringSubscriptions,
  ReimbursementPanel,
  SalesTaxBanner,
  TaxSummaryPanel,
  WhereThingsStandStats,
  useBusinessData,
  type BusinessActions,
  type BusinessState,
} from "@/components/admin/BusinessTracker";
import {
  capacityStatus,
  pctUsed,
  type CapacityStatus,
} from "@/lib/sharing/capacity-shared";
import {
  formatUSD,
  monthlyBurnCents,
  subscriptionDeadlines,
  vercelOssApplicationDeadline,
  type Deadline,
} from "@/lib/business/calc";
import { INFRA_TIERS_CHECKED } from "@/lib/business/infra-tiers";

// ── Rail model ──────────────────────────────────────────────────────────────

interface RailSection {
  id: string;
  group: string;
  /** Rail label + the in-pane section title. */
  title: string;
  icon: IconName;
  /** Optional one-line description shown under the section title. */
  desc?: string;
  /** Extra search terms so the rail filter can find a section by its rows. */
  keywords?: string;
}

interface RailGroup {
  label: string;
  sections: RailSection[];
}

const GROUPS: RailGroup[] = [
  {
    label: "Overview",
    sections: [
      {
        id: "dashboard",
        group: "Overview",
        title: "Dashboard",
        icon: "gauge",
        desc: "At-a-glance pulse across both the user metrics and the LLC finances. Click any rail section for the full detail.",
        keywords: "overview pulse summary at a glance",
      },
    ],
  },
  {
    label: "Metrics",
    sections: [
      {
        id: "signups",
        group: "Metrics",
        title: "Signups by month",
        icon: "growth",
        desc: "New registered identities per calendar month. Aggregate only, no per-user data.",
        keywords: "registrations new users growth identities",
      },
      {
        id: "institutions",
        group: "Metrics",
        title: "Profiles by institution",
        icon: "library",
        desc: "Published profiles grouped by verified email domain.",
        keywords: "domains universities affiliation orcid",
      },
      {
        id: "capacity",
        group: "Metrics",
        title: "Infrastructure capacity",
        icon: "database",
        desc: "Free-tier usage vs ceilings. The R2, Neon collab, and Resend ceilings are survival-critical.",
        keywords: "neon r2 upstash resend storage limits ceilings",
      },
      {
        id: "feature-usage",
        group: "Metrics",
        title: "Feature usage",
        icon: "chart",
        desc: "Anonymous aggregate counts over the last 30 days. Totals only, never per-user.",
        keywords: "shares profiles events analytics",
      },
    ],
  },
  {
    label: "Accounts",
    sections: [
      {
        id: "accounts-roster",
        group: "Accounts",
        title: "Accounts roster",
        icon: "users",
        desc: "Every registered solo user, lab, and department or institution, each with a guarded full-account wipe. Destructive and operator-only. Local files on a user's own computer are never touched.",
        keywords: "users labs departments institutions wipe delete account roster stripe card",
      },
    ],
  },
  {
    label: "Finances",
    sections: [
      {
        id: "where-things-stand",
        group: "Finances",
        title: "Where things stand",
        icon: "scale",
        desc: "Money in, money out, net, tax reserve, and safe-to-draw, the numbers that matter for a solo LLC.",
        keywords: "money net reserve safe to draw cash income expenses",
      },
      {
        id: "cost-breaker",
        group: "Finances",
        title: "Cost breaker",
        icon: "bolt",
        desc: "Runaway-bill guard. When spend exceeds the budget, cloud writes pause and local-first keeps working.",
        keywords: "budget circuit breaker ai spend threshold",
      },
      {
        id: "gift-pools",
        group: "Finances",
        title: "Gift pools",
        icon: "heart",
        desc: "Funded allocations for grants, donations, and gifted tokens.",
        keywords: "grants donations tokens comp",
      },
      {
        id: "spend-category",
        group: "Finances",
        title: "Spend by category",
        icon: "table",
        desc: "The monthly money flow, income vs expenses by category.",
        keywords: "ledger categories tax schedule c csv",
      },
      {
        id: "deadlines",
        group: "Finances",
        title: "Deadlines",
        icon: "alarmClock",
        desc: "Compliance and renewal dates, soonest first.",
        keywords: "wisconsin annual report apple renewal vercel oss",
      },
      {
        id: "setup-checklist",
        group: "Finances",
        title: "Setup checklist",
        icon: "check",
        desc: "The open setup and compliance steps, mirrored from the ResearchOS_LLC document folder.",
        keywords: "tasks todo compliance llc setup",
      },
      {
        id: "infra-cost",
        group: "Finances",
        title: "Infrastructure cost",
        icon: "cloud",
        desc: "Estimated monthly infra cost at the current usage, plus the free-ceiling tiers.",
        keywords: "workers vercel durable objects r2 estimate tiers",
      },
      {
        id: "entity-facts",
        group: "Finances",
        title: "Entity facts",
        icon: "shield",
        desc: "The LLC legal facts, sales-tax status, and the tax reserve percentage.",
        keywords: "ein duns apple google play sales tax registered agent",
      },
      {
        id: "payment-methods",
        group: "Finances",
        title: "Payment methods",
        icon: "receipt",
        desc: "The LLC cards and accounts, plus any personal card you fronted a purchase on.",
        keywords: "cards llc personal last four",
      },
      {
        id: "ledger",
        group: "Finances",
        title: "Ledger",
        icon: "list",
        desc: "Every income and expense, with the tax-summary CSV for Schedule C self-filing.",
        keywords: "entries income expense tax csv reimbursement",
      },
      {
        id: "subscriptions",
        group: "Finances",
        title: "Subscriptions",
        icon: "refresh",
        desc: "The recurring charges and the blended monthly burn.",
        keywords: "recurring claude max tello renewal burn",
      },
      {
        id: "correspondence",
        group: "Finances",
        title: "Correspondence",
        icon: "mail",
        desc: "Business emails the site sent, kept as LLC records.",
        keywords: "emails records archive deadline reminders",
      },
    ],
  },
  {
    label: "Modeling",
    sections: [
      {
        id: "price-modeling",
        group: "Modeling",
        title: "Price modeling",
        icon: "calculator",
        desc: "Model A margin explorer. Pick a tier and usage, see revenue vs cost vs net margin, live.",
        keywords: "pricing economics margin tiers model a relay usage solo lab dept",
      },
    ],
  },
  {
    label: "Comms",
    sections: [
      {
        id: "broadcast-email",
        group: "Comms",
        title: "Broadcast email",
        icon: "bell",
        desc: "Send a one-off message to all registered users. Grant-only, uses Resend and counts against the monthly email budget.",
        keywords: "email blast announcement resend outreach",
      },
    ],
  },
];

const ALL_SECTIONS = GROUPS.flatMap((g) => g.sections);

// ── Small helpers ─────────────────────────────────────────────────────────

function matches(lower: string, ...fields: (string | undefined)[]): boolean {
  if (!lower) return true;
  return fields.some((f) => f && f.toLowerCase().includes(lower));
}

const STATUS_TEXT: Record<CapacityStatus, string> = {
  ok: "text-emerald-700",
  watch: "text-amber-700",
  critical: "text-rose-600",
};

const STATUS_BOX: Record<CapacityStatus, string> = {
  ok: "border-emerald-200 bg-emerald-50",
  watch: "border-amber-200 bg-amber-50",
  critical: "border-rose-200 bg-rose-50",
};

/** Section wrapper: anchored heading + body, the same kicker/title/desc rhythm
 *  as the mockup. The id is the IntersectionObserver + scroll-anchor target. */
function Section({
  section,
  children,
}: {
  section: RailSection;
  children: ReactNode;
}) {
  return (
    <section
      id={`op-${section.id}`}
      data-op-section={section.id}
      className="scroll-mt-6"
    >
      <p className="text-meta font-bold uppercase tracking-wide text-foreground-muted">
        {section.group}
      </p>
      <h2 className="mt-0.5 text-heading font-bold tracking-tight text-foreground">
        {section.title}
      </h2>
      {section.desc ? (
        <p className="mb-5 mt-1 max-w-2xl text-body text-foreground-muted leading-relaxed">
          {section.desc}
        </p>
      ) : (
        <div className="mb-5" />
      )}
      {children}
    </section>
  );
}

// ── Dashboard composite (pulls from BOTH data sources) ──────────────────────

function DashboardSection({
  metrics,
  business,
  lastUpdated,
  onRefresh,
  refreshing,
}: {
  metrics: MetricsState;
  business: BusinessState;
  lastUpdated: Date | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const m = metrics.phase === "ready" ? metrics.data : null;
  const b = business.phase === "ready" ? business.data : null;

  // Capacity banner mirrors AdminMetrics' SurvivalRisk headline, condensed.
  let capacityLine: { status: CapacityStatus; text: string } | null = null;
  if (m?.capacity) {
    const c = m.capacity;
    const signals: { available: boolean; pct: number }[] = [
      { available: c.r2.usedBytes !== null, pct: pctUsed(c.r2.usedBytes ?? 0, c.r2.limitBytes) },
      {
        available: c.neon.collabBytes !== null,
        pct: pctUsed(c.neon.collabBytes ?? 0, c.neon.collabBudgetBytes),
      },
      {
        available: c.resend.sentLast30Days !== null,
        pct: pctUsed(c.resend.sentLast30Days ?? 0, c.resend.perMonthLimit),
      },
    ];
    const worst = signals
      .filter((s) => s.available)
      .reduce<CapacityStatus>((acc, s) => {
        const st = capacityStatus(s.pct);
        if (acc === "critical" || st === "critical") return "critical";
        if (acc === "watch" || st === "watch") return "watch";
        return "ok";
      }, "ok");
    const r2 = c.r2.usedBytes !== null ? pctUsed(c.r2.usedBytes, c.r2.limitBytes) : null;
    const collab =
      c.neon.collabBytes !== null
        ? pctUsed(c.neon.collabBytes, c.neon.collabBudgetBytes)
        : null;
    const resend =
      c.resend.sentLast30Days !== null
        ? pctUsed(c.resend.sentLast30Days, c.resend.perMonthLimit)
        : null;
    const fmtPct = (p: number | null) =>
      p === null ? "n/a" : p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
    capacityLine = {
      status: worst,
      text: `R2 storage ${fmtPct(r2)} . Neon collab ${fmtPct(collab)} . Resend email ${fmtPct(resend)}`,
    };
  }

  const burn = b ? monthlyBurnCents(b.subscriptions) : 0;
  const deadlines = b
    ? [
        ...b.deadlines,
        vercelOssApplicationDeadline(),
        ...subscriptionDeadlines(b.subscriptions),
      ]
        .filter((d): d is Deadline => d !== null)
        .sort((a, b2) => a.dueDate.localeCompare(b2.dueDate))
        .slice(0, 4)
    : [];

  return (
    <Section section={GROUPS[0].sections[0]}>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3.5 py-2 text-body font-semibold text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
        >
          <Icon name="refresh" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
        <span className="text-meta text-foreground-muted">
          {lastUpdated
            ? `Last updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Not loaded yet"}
        </span>
      </div>

      {capacityLine && (
        <div className={`mb-4 rounded-2xl border p-4 ${STATUS_BOX[capacityLine.status]}`}>
          <p className={`text-body font-semibold ${STATUS_TEXT[capacityLine.status]}`}>
            {capacityLine.status === "critical"
              ? "A survival-critical capacity ceiling is close to its limit."
              : capacityLine.status === "watch"
                ? "A survival-critical capacity ceiling is worth watching."
                : "All survival-critical capacity ceilings are healthy."}
          </p>
          <p className="mt-1 text-meta text-foreground-muted">{capacityLine.text}</p>
        </div>
      )}

      <h3 className="mb-3 text-title font-semibold text-foreground">Users &amp; sharing</h3>
      {m ? (
        <div className="mb-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Registered identities" value={m.directory.totalIdentities} />
          <StatCard label="Published profiles" value={m.directory.totalProfiles} />
          <StatCard label="ORCID linked" value={m.directory.orcidLinks} />
          <StatCard label="Shares ever sent" value={m.relay.totalEverSent} />
          <StatCard label="Pending shares" value={m.relay.pendingShares} />
          <StatCard label="Pending storage" value={humanBytes(m.relay.pendingBytes)} />
        </div>
      ) : (
        <p className="mb-2 text-body text-foreground-muted">
          {metrics.phase === "loading" ? "Loading metrics..." : "Metrics unavailable."}
        </p>
      )}

      <h3 className="mb-3 mt-6 text-title font-semibold text-foreground">
        LLC finances snapshot
      </h3>
      {b ? (
        <div className="mb-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Money in" value={formatUSD(b.summary.moneyInCents)} />
          <StatCard label="Money out" value={formatUSD(b.summary.moneyOutCents)} />
          <StatCard label="Net" value={formatUSD(b.summary.netCents)} />
          <StatCard
            label={`Tax reserve (${b.entity.reservePct}%)`}
            value={formatUSD(b.summary.reserveCents)}
          />
          <StatCard label="Safe to draw" value={formatUSD(b.summary.safeToDrawCents)} />
          <StatCard label="Monthly burn" value={`${formatUSD(burn)}/mo`} />
        </div>
      ) : (
        <p className="mb-2 text-body text-foreground-muted">
          {business.phase === "loading" ? "Loading finances..." : "Finances unavailable."}
        </p>
      )}

      {deadlines.length > 0 && (
        <>
          <h3 className="mb-3 mt-6 text-title font-semibold text-foreground">
            Upcoming deadlines
          </h3>
          <DeadlineStrip deadlines={deadlines} />
        </>
      )}
    </Section>
  );
}

// ── Finance sections (reuse the BusinessTracker exports + actions) ──────────

function FinanceSections({
  business,
  actions,
}: {
  business: BusinessState;
  actions: BusinessActions;
}) {
  if (business.phase !== "ready") {
    return (
      <>
        <Section section={byId("where-things-stand")}>
          {business.phase === "loading" ? (
            <p className="text-body text-foreground-muted">Loading finances...</p>
          ) : business.phase === "denied" ? (
            <OperatorDeniedPanel />
          ) : (
            <OperatorErrorPanel />
          )}
        </Section>
      </>
    );
  }

  const {
    entity,
    ledger,
    tasks,
    emails,
    paymentMethods,
    subscriptions,
    summary,
    deadlines,
    infraEstimate,
  } = business.data;

  const allDeadlines = [
    ...deadlines,
    vercelOssApplicationDeadline(),
    ...subscriptionDeadlines(subscriptions),
  ]
    .filter((d): d is Deadline => d !== null)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <>
      <Section section={byId("where-things-stand")}>
        <div className="mb-5">
          <SalesTaxBanner status={entity.salesTaxStatus} note={entity.salesTaxNote} />
        </div>
        <WhereThingsStandStats summary={summary} reservePct={entity.reservePct} />
      </Section>

      <Section section={byId("cost-breaker")}>
        <CostBreakerPanel />
      </Section>

      <Section section={byId("gift-pools")}>
        <GiftPoolsPanel />
      </Section>

      <Section section={byId("spend-category")}>
        <SpendByCategoryPanel />
      </Section>

      <Section section={byId("deadlines")}>
        <DeadlineStrip deadlines={allDeadlines} />
      </Section>

      <Section section={byId("setup-checklist")}>
        <Checklist
          tasks={tasks}
          onAdd={actions.addTask}
          onToggle={actions.toggleTask}
          onDelete={actions.deleteTask}
        />
      </Section>

      <Section section={byId("infra-cost")}>
        <InfraCostPanel infraEstimate={infraEstimate} onRecord={actions.recordInfra} />
        <p className="mb-3 mt-8 text-meta text-foreground-muted leading-relaxed">
          Free ceiling and the next paid step for each service, so scaling is
          planned not a surprise. Verify current pricing; checked {INFRA_TIERS_CHECKED}.
        </p>
        <InfraTiersPanel />
      </Section>

      <Section section={byId("entity-facts")}>
        <EntityCard entity={entity} onSave={actions.saveEntity} />
      </Section>

      <Section section={byId("payment-methods")}>
        <PaymentMethods
          methods={paymentMethods}
          onAdd={actions.addPaymentMethod}
          onUpdate={actions.updatePaymentMethod}
          onDelete={actions.deletePaymentMethod}
        />
      </Section>

      <Section section={byId("ledger")}>
        <Ledger
          ledger={ledger}
          methods={paymentMethods}
          onAdd={actions.addEntry}
          onDelete={actions.deleteEntry}
          onUpdateTax={actions.updateEntryTax}
          onSetPaidWith={actions.setEntryPaidWith}
        />
        <div className="mt-6">
          <TaxSummaryPanel ledger={ledger} />
        </div>
        <div className="mt-8">
          <p className="mb-3 text-meta text-foreground-muted leading-relaxed">
            What the LLC owes you back for purchases fronted on a personal card.
          </p>
          <ReimbursementPanel
            ledger={ledger}
            methods={paymentMethods}
            onRecord={actions.recordReimbursement}
          />
        </div>
        <DevAccountantPanel />
      </Section>

      <Section section={byId("subscriptions")}>
        <RecurringSubscriptions
          subscriptions={subscriptions}
          methods={paymentMethods}
          onAdd={actions.addSubscription}
          onUpdate={actions.updateSubscription}
          onDelete={actions.deleteSubscription}
        />
      </Section>

      <Section section={byId("correspondence")}>
        <Correspondence emails={emails} entityName={entity.legalName} />
      </Section>
    </>
  );
}

function byId(id: string): RailSection {
  const s = ALL_SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown operator section ${id}`);
  return s;
}

// ── The shell ───────────────────────────────────────────────────────────────

export default function OperatorShell() {
  const metrics = useAdminMetrics();
  const { state: business, actions } = useBusinessData();

  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>(ALL_SECTIONS[0].id);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const paneRef = useRef<HTMLDivElement>(null);

  const lower = query.trim().toLowerCase();

  // Stamp "last updated" the first render after both data sources settle, using
  // the adjust-state-during-render pattern (no effect, no cascading-render
  // lint). The manual Refresh button re-stamps it below.
  if (
    !lastUpdated &&
    metrics.phase !== "loading" &&
    business.phase !== "loading"
  ) {
    setLastUpdated(new Date());
  }

  // Manual refresh: re-pull BOTH sources (the business ledger and the operator
  // metrics) in parallel, then re-stamp "last updated". The dashboard composites
  // both, so a half-refresh would read inconsistently.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([actions.reload(), metrics.reload()]);
    } finally {
      setLastUpdated(new Date());
      setRefreshing(false);
    }
  }, [actions, metrics.reload]);

  // Scroll-spy: highlight the section nearest the top of the pane.
  useEffect(() => {
    const root = paneRef.current;
    if (!root) return;
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>("[data-op-section]"),
    );
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry highest on screen that is intersecting.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const id = visible[0].target.getAttribute("data-op-section");
          if (id) setActiveId(id);
        }
      },
      { root, rootMargin: "0px 0px -65% 0px", threshold: 0 },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
    // Re-bind when the rendered section set changes (data phases settling).
  }, [metrics.phase, business.phase]);

  const scrollTo = useCallback((id: string) => {
    setActiveId(id);
    const el = paneRef.current?.querySelector<HTMLElement>(
      `[data-op-section="${id}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Honor a `#group` or `#section-id` hash on first load (e.g. the old
  // /business and /admin/business links redirect to /admin#finances). A group
  // name jumps to that group's first section; a section id jumps straight to it.
  const didHash = useRef(false);
  useEffect(() => {
    if (didHash.current) return;
    if (metrics.phase === "loading" && business.phase === "loading") return;
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!hash) {
      didHash.current = true;
      return;
    }
    const group = GROUPS.find((g) => g.label.toLowerCase() === hash.toLowerCase());
    const targetId = group
      ? group.sections[0]?.id
      : ALL_SECTIONS.find((s) => s.id === hash)?.id;
    if (targetId) {
      didHash.current = true;
      // Defer a frame so the sections are mounted and laid out.
      requestAnimationFrame(() => scrollTo(targetId));
    }
  }, [metrics.phase, business.phase, scrollTo]);

  const visibleGroups = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        sections: g.sections.filter((s) =>
          matches(lower, s.title, s.keywords, s.group),
        ),
      })).filter((g) => g.sections.length > 0),
    [lower],
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken text-foreground">
      {/* Slim top bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-raised px-5 py-2.5">
        <span className="text-body font-bold tracking-tight text-foreground">
          ResearchOS
        </span>
        <span className="text-border">/</span>
        <span className="text-meta text-foreground-muted">
          {byId(activeId).title}
        </span>
        <Link
          href="/"
          className="ml-auto text-body font-medium text-sky-700 underline-offset-2 hover:underline"
        >
          Back to the app
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Rail ── */}
        <nav
          aria-label="Operator sections"
          className="flex w-64 shrink-0 flex-col border-r border-border bg-surface-raised"
        >
          <div className="flex-1 overflow-y-auto p-2.5">
            {/* Rail search */}
            <div className="px-1 pb-2.5 pt-1">
              <div className="relative">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search sections..."
                  autoComplete="off"
                  className="w-full rounded-lg border border-border bg-surface-sunken py-1.5 pl-8 pr-2.5 text-body text-foreground outline-none focus:border-brand-action"
                />
              </div>
            </div>

            {/* Rail identity header */}
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-200 to-violet-200 text-meta font-bold text-indigo-700"
                aria-hidden
              >
                RO
              </span>
              <div className="min-w-0 leading-tight">
                <p className="truncate text-body font-bold text-foreground">
                  ResearchOS LLC
                </p>
                <p className="truncate text-meta text-foreground-muted">Operator</p>
              </div>
            </div>

            {visibleGroups.map((group) => (
              <div key={group.label} className="mt-3">
                <p className="px-2 pb-1.5 text-meta font-bold uppercase tracking-wide text-foreground-muted">
                  {group.label}
                </p>
                {group.sections.map((section) => {
                  const isActive = section.id === activeId;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      aria-current={isActive ? "true" : undefined}
                      onClick={() => scrollTo(section.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-body font-medium transition-colors ${
                        isActive
                          ? "bg-blue-100 text-blue-700"
                          : "text-foreground hover:bg-surface-sunken"
                      }`}
                    >
                      <Icon
                        name={section.icon}
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isActive ? "text-blue-600" : "text-foreground-muted"
                        }`}
                      />
                      <span className="flex-1 truncate">{section.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="shrink-0 border-t border-border p-3 text-meta leading-relaxed text-foreground-muted">
            Operator console. Not a legal or tax advisor.
          </div>
        </nav>

        {/* ── Content pane: one long scroll, all sections anchored ── */}
        <div ref={paneRef} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-14 px-6 py-8 pb-24 sm:px-8">
            {/* Operator greeting, mirrors the metrics page header. */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-display font-bold tracking-tight text-foreground">
                  Operator console
                </h1>
                <p className="mt-1 max-w-2xl text-body text-foreground-muted leading-relaxed">
                  User metrics and LLC finances in one place. Aggregate and
                  operator-only, never shown to any user.
                </p>
              </div>
              {metrics.phase === "ready" && (
                <div className="shrink-0 pt-1">
                  <BeakerBotGreeting metrics={metrics.data} />
                </div>
              )}
            </div>

            {/* OVERVIEW */}
            <DashboardSection
              metrics={metrics}
              business={business}
              lastUpdated={lastUpdated}
              onRefresh={refresh}
              refreshing={refreshing}
            />

            {/* METRICS */}
            <Section section={byId("signups")}>
              {metrics.phase === "ready" ? (
                <SignupsSection data={metrics.data} />
              ) : (
                <MetricsPhasePlaceholder phase={metrics.phase} />
              )}
            </Section>
            <Section section={byId("institutions")}>
              {metrics.phase === "ready" ? (
                <InstitutionsSection data={metrics.data} />
              ) : (
                <MetricsPhasePlaceholder phase={metrics.phase} />
              )}
            </Section>
            <Section section={byId("capacity")}>
              {metrics.phase === "ready" ? (
                metrics.data.capacity ? (
                  <CapacitySection data={metrics.data} />
                ) : (
                  <p className="text-body text-foreground-muted">
                    Capacity measurement is not configured on this deployment.
                  </p>
                )
              ) : (
                <MetricsPhasePlaceholder phase={metrics.phase} />
              )}
            </Section>
            <Section section={byId("feature-usage")}>
              {metrics.phase === "ready" ? (
                metrics.data.events ? (
                  <FeatureUsageSection data={metrics.data} />
                ) : (
                  <p className="text-body text-foreground-muted">
                    No feature-usage events recorded yet.
                  </p>
                )
              ) : (
                <MetricsPhasePlaceholder phase={metrics.phase} />
              )}
            </Section>

            {/* ACCOUNTS */}
            <Section section={byId("accounts-roster")}>
              <AccountsPanel />
            </Section>

            {/* FINANCES */}
            <FinanceSections business={business} actions={actions} />

            {/* MODELING: Model A margin explorer. */}
            <Section section={byId("price-modeling")}>
              <MarginExplorerTab />
            </Section>

            {/* COMMS */}
            <Section section={byId("broadcast-email")}>
              <BroadcastPanel />
            </Section>

            <p className="rounded-xl border border-border bg-surface-sunken px-4 py-3 text-meta text-foreground-muted leading-relaxed">
              This console is an organizer, not a legal or tax service. It is not
              the LLC&apos;s registered agent, and it does not prepare or file
              taxes. Use it to stay on top of dates and cash, and have an
              accountant set the reserve percentage and handle the filings.
            </p>

            <AppFooter />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricsPhasePlaceholder({
  phase,
}: {
  phase: "loading" | "denied" | "error";
}) {
  if (phase === "loading") {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-sky-500" />
      </div>
    );
  }
  if (phase === "denied") return <OperatorDeniedPanel />;
  return <OperatorErrorPanel />;
}
