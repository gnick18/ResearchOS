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
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import Link from "next/link";

import { Icon, type IconName } from "@/components/icons";
import AppFooter from "@/components/AppFooter";

import AccountsPanel from "@/components/admin/AccountsPanel";
import BeakerBotGreeting from "@/components/admin/BeakerBotGreeting";
import BroadcastPanel from "@/components/admin/BroadcastPanel";
import StorageInventorySection from "@/components/admin/StorageInventorySection";
import CostBreakerPanel from "@/components/admin/CostBreakerPanel";
import GiftPoolsPanel from "@/components/admin/GiftPoolsPanel";
import SpendByCategoryPanel from "@/components/admin/SpendByCategoryPanel";
import { MarginExplorerTab } from "@/components/admin/PriceModelingModal";
import LockedPricingPanel from "@/components/admin/LockedPricingPanel";
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
  researchosAppDropWatch,
  researchosAppEmailSendAsWatch,
  subscriptionDeadlines,
  vercelOssApplicationDeadline,
  type Deadline,
} from "@/lib/business/calc";
import { INFRA_TIERS_CHECKED } from "@/lib/business/infra-tiers";
import { useOperatorBeakerSource } from "@/components/admin/useOperatorBeakerSource";

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
  /** Finances only. The sub-group header this section renders under within the
   *  Finances tab, one of FINANCE_SUBGROUPS. Twelve finance sections is too many
   *  for a flat list, so they are bucketed under three headers (admin IA
   *  redesign, 2026-06-19). Absent on every non-Finances section. */
  subgroup?: string;
}

interface RailGroup {
  label: string;
  /** The tab icon, shown on the area-tab bar. */
  icon: IconName;
  sections: RailSection[];
}

// The three Finances sub-group headers, in render order. Each finance section
// carries a `subgroup` naming one of these; the Finances tab prints the sections
// under these headers in this order (admin IA redesign, 2026-06-19).
const FINANCE_SUBGROUPS = [
  "Money in/out",
  "Accounting",
  "Vendors & infra",
] as const;

const GROUPS: RailGroup[] = [
  {
    label: "Overview",
    icon: "gauge",
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
    icon: "chart",
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
        id: "storage-inventory",
        group: "Metrics",
        title: "Storage inventory",
        icon: "database",
        desc: "What is stored on R2 right now, by bucket (icon library vs app data) and by prefix (each lab's site, the relay).",
        keywords: "r2 storage buckets assets icon library lab sites relay objects size inventory",
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
    icon: "users",
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
    icon: "scale",
    sections: [
      {
        id: "where-things-stand",
        group: "Finances",
        subgroup: "Money in/out",
        title: "Where things stand",
        icon: "scale",
        desc: "Money in, money out, net, tax reserve, and safe-to-draw, the numbers that matter for a solo LLC.",
        keywords: "money net reserve safe to draw cash income expenses",
      },
      {
        id: "cost-breaker",
        group: "Finances",
        subgroup: "Money in/out",
        title: "Cost breaker",
        icon: "bolt",
        desc: "Runaway-bill guard. When spend exceeds the budget, cloud writes pause and local-first keeps working.",
        keywords: "budget circuit breaker ai spend threshold",
      },
      {
        id: "gift-pools",
        group: "Finances",
        subgroup: "Money in/out",
        title: "Gift pools",
        icon: "heart",
        desc: "Funded allocations for grants, donations, and gifted tokens.",
        keywords: "grants donations tokens comp",
      },
      {
        id: "spend-category",
        group: "Finances",
        subgroup: "Money in/out",
        title: "Spend by category",
        icon: "table",
        desc: "The monthly money flow, income vs expenses by category.",
        keywords: "ledger categories tax schedule c csv",
      },
      {
        id: "ledger",
        group: "Finances",
        subgroup: "Accounting",
        title: "Ledger",
        icon: "list",
        desc: "Every income and expense, with the tax-summary CSV for Schedule C self-filing.",
        keywords: "entries income expense tax csv reimbursement",
      },
      {
        id: "entity-facts",
        group: "Finances",
        subgroup: "Accounting",
        title: "Entity facts",
        icon: "shield",
        desc: "The LLC legal facts, sales-tax status, and the tax reserve percentage.",
        keywords: "ein duns apple google play sales tax registered agent",
      },
      {
        id: "payment-methods",
        group: "Finances",
        subgroup: "Accounting",
        title: "Payment methods",
        icon: "receipt",
        desc: "The LLC cards and accounts, plus any personal card you fronted a purchase on.",
        keywords: "cards llc personal last four",
      },
      {
        id: "deadlines",
        group: "Finances",
        subgroup: "Accounting",
        title: "Deadlines",
        icon: "alarmClock",
        desc: "Compliance and renewal dates, soonest first.",
        keywords: "wisconsin annual report apple renewal vercel oss",
      },
      {
        id: "setup-checklist",
        group: "Finances",
        subgroup: "Accounting",
        title: "Setup checklist",
        icon: "check",
        desc: "The open setup and compliance steps, mirrored from the ResearchOS_LLC document folder.",
        keywords: "tasks todo compliance llc setup",
      },
      {
        id: "correspondence",
        group: "Finances",
        subgroup: "Accounting",
        title: "Correspondence",
        icon: "mail",
        desc: "Business emails the site sent, kept as LLC records.",
        keywords: "emails records archive deadline reminders",
      },
      {
        id: "infra-cost",
        group: "Finances",
        subgroup: "Vendors & infra",
        title: "Infrastructure cost",
        icon: "cloud",
        desc: "Estimated monthly infra cost at the current usage, plus the free-ceiling tiers.",
        keywords: "workers vercel durable objects r2 estimate tiers",
      },
      {
        id: "subscriptions",
        group: "Finances",
        subgroup: "Vendors & infra",
        title: "Subscriptions",
        icon: "refresh",
        desc: "The recurring charges and the blended monthly burn.",
        keywords: "recurring claude max tello renewal burn",
      },
    ],
  },
  {
    label: "Modeling",
    icon: "calculator",
    sections: [
      {
        id: "locked-pricing",
        group: "Modeling",
        title: "Locked pricing",
        icon: "shield",
        desc: "The final, settled Model A prices, read live from the pricing engine. Just the numbers, nothing modeled.",
        keywords: "pricing final locked numbers tiers solo lab dept storage ai packs emile sign-off",
      },
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
    icon: "bell",
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
        researchosAppDropWatch(),
        researchosAppEmailSendAsWatch(),
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
    researchosAppDropWatch(),
    researchosAppEmailSendAsWatch(),
    ...subscriptionDeadlines(subscriptions),
  ]
    .filter((d): d is Deadline => d !== null)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // Each finance section's body, keyed by id. The render loop below pulls these
  // under their sub-group headers in GROUPS order, so the twelve sections read as
  // three labelled clusters (Money in/out, Accounting, Vendors & infra) instead
  // of one flat list. The Section wrappers (anchor id + title + desc) are
  // unchanged, only the order + the inserted sub-group headers are new.
  const bodies: Record<string, ReactNode> = {
    "where-things-stand": (
      <>
        <div className="mb-5">
          <SalesTaxBanner status={entity.salesTaxStatus} note={entity.salesTaxNote} />
        </div>
        <WhereThingsStandStats summary={summary} reservePct={entity.reservePct} />
      </>
    ),
    "cost-breaker": <CostBreakerPanel />,
    "gift-pools": <GiftPoolsPanel />,
    "spend-category": <SpendByCategoryPanel />,
    deadlines: <DeadlineStrip deadlines={allDeadlines} />,
    "setup-checklist": (
      <Checklist
        tasks={tasks}
        onAdd={actions.addTask}
        onToggle={actions.toggleTask}
        onDelete={actions.deleteTask}
      />
    ),
    "infra-cost": (
      <>
        <InfraCostPanel infraEstimate={infraEstimate} onRecord={actions.recordInfra} />
        <p className="mb-3 mt-8 text-meta text-foreground-muted leading-relaxed">
          Free ceiling and the next paid step for each service, so scaling is
          planned not a surprise. Verify current pricing; checked {INFRA_TIERS_CHECKED}.
        </p>
        <InfraTiersPanel />
      </>
    ),
    "entity-facts": <EntityCard entity={entity} onSave={actions.saveEntity} />,
    "payment-methods": (
      <PaymentMethods
        methods={paymentMethods}
        onAdd={actions.addPaymentMethod}
        onUpdate={actions.updatePaymentMethod}
        onDelete={actions.deletePaymentMethod}
      />
    ),
    ledger: (
      <>
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
      </>
    ),
    subscriptions: (
      <RecurringSubscriptions
        subscriptions={subscriptions}
        methods={paymentMethods}
        onAdd={actions.addSubscription}
        onUpdate={actions.updateSubscription}
        onDelete={actions.deleteSubscription}
      />
    ),
    correspondence: (
      <Correspondence emails={emails} entityName={entity.legalName} />
    ),
  };

  const financeSections = GROUPS.find((g) => g.label === "Finances")!.sections;

  return (
    <div className="space-y-14">
      {FINANCE_SUBGROUPS.map((subgroup) => {
        const inGroup = financeSections.filter((s) => s.subgroup === subgroup);
        if (inGroup.length === 0) return null;
        return (
          <div key={subgroup} className="space-y-14">
            <p
              className="border-b border-border pb-2 text-title font-bold tracking-tight text-foreground"
              data-op-subgroup={subgroup}
            >
              {subgroup}
            </p>
            {inGroup.map((s) => (
              <Section key={s.id} section={s}>
                {bodies[s.id]}
              </Section>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function byId(id: string): RailSection {
  const s = ALL_SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown operator section ${id}`);
  return s;
}

// ── Per-tab content ─────────────────────────────────────────────────────────
// Each non-Overview, non-Finances tab's sections, extracted so only the ACTIVE
// tab renders (the redesign drops the single all-sections mega-scroll). The
// section renders, props, data hooks, and data-testids are unchanged, only which
// ones mount at a time is new.

function MetricsTab({ metrics }: { metrics: MetricsState }) {
  return (
    <>
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
      <Section section={byId("storage-inventory")}>
        <StorageInventorySection />
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
    </>
  );
}

function ModelingTab() {
  return (
    <>
      {/* The locked final prices first, then the live explorer. */}
      <Section section={byId("locked-pricing")}>
        <LockedPricingPanel />
      </Section>
      <Section section={byId("price-modeling")}>
        <MarginExplorerTab />
      </Section>
    </>
  );
}

// ── The shell ───────────────────────────────────────────────────────────────

/** The seven groups are the top-level area TABS. Only the active tab's sections
 *  render at a time. The active tab is persisted in the URL (?tab=finances) so a
 *  refresh or a Cmd-K jump can target it. */
const DEFAULT_TAB = GROUPS[0].label;

/** Resolve a `?tab=` value (or a legacy #hash group / section) to a tab label,
 *  defaulting to Overview. A section id resolves to the tab that section sits in. */
function tabFromToken(token: string | null | undefined): string {
  if (!token) return DEFAULT_TAB;
  const t = token.toLowerCase();
  const group = GROUPS.find((g) => g.label.toLowerCase() === t);
  if (group) return group.label;
  const section = ALL_SECTIONS.find((s) => s.id.toLowerCase() === t);
  if (section) return section.group;
  return DEFAULT_TAB;
}

export default function OperatorShell() {
  const metrics = useAdminMetrics();
  const { state: business, actions } = useBusinessData();

  // The active area tab (a group label). Initialized from the URL (?tab=) or a
  // legacy #group / #section hash so a refresh or a deep link lands on the right
  // tab. Read synchronously from window on first render so there is no flash.
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_TAB;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (tabParam) return tabFromToken(tabParam);
    const hash = window.location.hash.slice(1);
    return tabFromToken(hash);
  });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const paneRef = useRef<HTMLDivElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);

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

  // Switch tabs and write the choice into the URL (?tab=) without a navigation,
  // so a refresh stays on the same tab and a Cmd-K jump can target it.
  const selectTab = useCallback((label: string) => {
    setActiveTab(label);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", label.toLowerCase());
    url.hash = "";
    window.history.replaceState(null, "", url.toString());
  }, []);

  // Jump to any section by id, the move BeakerSearch (Cmd-K) and the legacy
  // #hash deep link both call. It flips to the section's tab, then scrolls that
  // section into view once it has mounted under the active panel.
  const goToSection = useCallback(
    (id: string) => {
      const section = ALL_SECTIONS.find((s) => s.id === id);
      if (!section) return;
      selectTab(section.group);
      // Defer a frame so the section's tab panel has mounted before scrolling.
      requestAnimationFrame(() => {
        const el = paneRef.current?.querySelector<HTMLElement>(
          `[data-op-section="${id}"]`,
        );
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [selectTab],
  );

  // Wire every admin section into the global BeakerSearch palette so Cmd-K jumps
  // straight to one. ALL_SECTIONS is module-constant so the array is stable; the
  // hook only registers while this operator-only shell is mounted.
  useOperatorBeakerSource(ALL_SECTIONS, goToSection);

  // Honor a legacy `#group` or `#section-id` hash on first load (e.g. the old
  // /business and /admin/business links redirect to /admin#finances). The tab is
  // already resolved from it in the initial state; here we also scroll to the
  // exact section when the hash named one, once the data settles.
  const didHash = useRef(false);
  useEffect(() => {
    if (didHash.current) return;
    if (metrics.phase === "loading" && business.phase === "loading") return;
    didHash.current = true;
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!hash) return;
    const section = ALL_SECTIONS.find((s) => s.id.toLowerCase() === hash.toLowerCase());
    if (section) requestAnimationFrame(() => goToSection(section.id));
  }, [metrics.phase, business.phase, goToSection]);

  // Roving arrow-key nav across the tabs (accessibility, role="tablist").
  const onTabKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const idx = GROUPS.findIndex((g) => g.label === activeTab);
      if (idx < 0) return;
      let next = idx;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % GROUPS.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
        next = (idx - 1 + GROUPS.length) % GROUPS.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = GROUPS.length - 1;
      else return;
      e.preventDefault();
      const label = GROUPS[next].label;
      selectTab(label);
      // Move focus to the newly selected tab so the keyboard stays on the bar.
      const btn = tablistRef.current?.querySelector<HTMLButtonElement>(
        `[data-op-tab="${label}"]`,
      );
      btn?.focus();
    },
    [activeTab, selectTab],
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken text-foreground">
      {/* Slim top bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-raised px-5 py-2.5">
        <span className="text-body font-bold tracking-tight text-foreground">
          ResearchOS
        </span>
        <span className="text-border">/</span>
        <span className="text-meta text-foreground-muted">{activeTab}</span>
        <Link
          href="/"
          className="ml-auto text-body font-medium text-sky-700 underline-offset-2 hover:underline"
        >
          Back to the app
        </Link>
      </header>

      {/* ── Area tabs (the primary nav) ── */}
      <div className="shrink-0 border-b border-border bg-surface-raised px-4 sm:px-6">
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="Operator areas"
          onKeyDown={onTabKeyDown}
          className="-mb-px flex flex-wrap gap-1"
        >
          {GROUPS.map((group) => {
            const isActive = group.label === activeTab;
            return (
              <button
                key={group.label}
                type="button"
                role="tab"
                id={`op-tab-${group.label}`}
                data-op-tab={group.label}
                aria-selected={isActive}
                aria-controls={`op-tabpanel-${group.label}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectTab(group.label)}
                className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-body font-semibold transition-colors ${
                  isActive
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-foreground-muted hover:text-foreground"
                }`}
              >
                <Icon
                  name={group.icon}
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? "text-blue-600" : "text-foreground-muted"
                  }`}
                />
                {group.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content pane: only the active tab's sections render ── */}
      <div ref={paneRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          role="tabpanel"
          id={`op-tabpanel-${activeTab}`}
          aria-labelledby={`op-tab-${activeTab}`}
          tabIndex={0}
          className="mx-auto max-w-screen-2xl space-y-14 px-6 py-8 pb-24 sm:px-8"
        >
          {/* Operator greeting, mirrors the metrics page header. Shown on every
              tab so the console keeps its header + the BeakerBot greeting. */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-display font-bold tracking-tight text-foreground">
                Operator console
              </h1>
              <p className="mt-1 max-w-2xl text-body text-foreground-muted leading-relaxed">
                User metrics and LLC finances in one place. Aggregate and
                operator-only, never shown to any user. Press Cmd-K to jump to any
                section.
              </p>
            </div>
            {metrics.phase === "ready" && (
              <div className="shrink-0 pt-1">
                <BeakerBotGreeting metrics={metrics.data} />
              </div>
            )}
          </div>

          {activeTab === "Overview" && (
            <DashboardSection
              metrics={metrics}
              business={business}
              lastUpdated={lastUpdated}
              onRefresh={refresh}
              refreshing={refreshing}
            />
          )}

          {activeTab === "Metrics" && <MetricsTab metrics={metrics} />}

          {activeTab === "Accounts" && (
            <Section section={byId("accounts-roster")}>
              <AccountsPanel />
            </Section>
          )}

          {activeTab === "Finances" && (
            <FinanceSections business={business} actions={actions} />
          )}

          {activeTab === "Modeling" && <ModelingTab />}

          {activeTab === "Comms" && (
            <Section section={byId("broadcast-email")}>
              <BroadcastPanel />
            </Section>
          )}

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
