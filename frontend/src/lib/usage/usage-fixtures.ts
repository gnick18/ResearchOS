// Illustrative usage + billing fixtures for the Settings "Usage & billing"
// dashboard (settings-build bot, 2026-06-11). These numbers are placeholders so
// the AI-usage and Cloud-storage sections can render their real layout before
// metered billing ships. Real data wires up when AI billing lands (token ledger
// + the billing status endpoint the CloudStorageLauncher already reads), at
// which point these constants are replaced by live reads.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** AI token balance fixtures, the prepaid pool for BeakerBot. Consistent with
 *  the /pricing token economy, a full analysis is about 30,000 tokens and a
 *  quick question about 7,500, and the free sign-up gift is about 750,000. */
export const AI_USAGE_FIXTURE = {
  /** Tokens left in the prepaid pool. About 18 analyses at ~30k each. */
  tokensLeft: 540_000,
  /** Plain-value translation of the balance, kept honest with a "depends" hedge. */
  balanceTranslation:
    "about 18 full analyses or 70-plus quick questions, depending on how big each question is",
  /** Whether the one-time sign-up gift tokens are still part of this balance. */
  includesSignupTrial: true,
  /** Whether the AI is free during the beta (it is, today). */
  freeDuringBeta: true,
} as const;

/** A single recent AI task with its token cost, newest first. */
export interface RecentAiTask {
  name: string;
  kind: "analysis" | "figure" | "question" | "write-up";
  tokens: number;
}

export const RECENT_AI_TASKS_FIXTURE: RecentAiTask[] = [
  { name: "t-test on growth data", kind: "analysis", tokens: 31_200 },
  { name: "Bar plot with error bars", kind: "figure", tokens: 26_800 },
  { name: "Which PCR runs failed last month", kind: "question", tokens: 7_100 },
  { name: "Summarize and write up the result", kind: "write-up", tokens: 34_500 },
];

/** A prepaid top-up the user can buy. The estimates are rough and match the
 *  /pricing framing, near our cost a full analysis is about a penny, so a $10
 *  block is hundreds of analyses. */
export interface TokenBlock {
  /** Dollar price, shown verbatim. */
  price: string;
  /** Rough number of analyses the block covers. */
  tasks: string;
  /** Whether this is the suggested / pre-selected block. */
  recommended?: boolean;
}

export const TOKEN_BLOCKS_FIXTURE: TokenBlock[] = [
  { price: "$10", tasks: "about 700 analyses" },
  { price: "$25", tasks: "about 1,800 analyses", recommended: true },
  { price: "$50", tasks: "about 3,600 analyses" },
];

/** Cloud storage fixtures, the optional synced copy. */
export const STORAGE_USAGE_FIXTURE = {
  /** Used cloud storage, in GB. */
  usedGb: 0.4,
  /** Plan cap, in GB. */
  capGb: 5,
  /** Inbox shares others have sent you. */
  inboxUsed: 3,
  /** Inbox share cap. */
  inboxCap: 10,
  /** Current plan label. */
  planLabel: "Free",
  /** Whether everything is free during the beta (it is, today). */
  freeDuringBeta: true,
} as const;
