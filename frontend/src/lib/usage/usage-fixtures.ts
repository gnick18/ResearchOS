// Illustrative usage + billing fixtures for the Settings "Usage & billing"
// dashboard (settings-build bot, 2026-06-11). These numbers are placeholders so
// the AI-usage and Cloud-storage sections can render their real layout before
// metered billing ships. Real data wires up when AI billing lands (token ledger
// + the billing status endpoint the CloudStorageLauncher already reads), at
// which point these constants are replaced by live reads.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** AI token balance fixtures, the prepaid pool for BeakerBot. Consistent with
 *  the /pricing token economy (measured 2026-06-14), a full task is about 110,000
 *  tokens and a quick question about 50,000, and the free sign-up gift is about
 *  1,600,000. Tasks run big because the system prompt and tools are resent on
 *  every agent-loop turn, so input is ~99% of the cost. */
export const AI_USAGE_FIXTURE = {
  /** Tokens left in the prepaid pool. About 12 tasks at ~110k each. */
  tokensLeft: 1_320_000,
  /** Plain-value translation of the balance, kept honest with a "depends" hedge. */
  balanceTranslation:
    "about 12 full tasks or 26-plus quick questions, depending on how big each question is",
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
  { name: "t-test on growth data", kind: "analysis", tokens: 98_400 },
  { name: "Bar plot with error bars", kind: "figure", tokens: 84_600 },
  { name: "Which PCR runs failed last month", kind: "question", tokens: 50_900 },
  { name: "Summarize and write up the result", kind: "write-up", tokens: 152_700 },
];

/** A prepaid top-up the user can buy. The estimates are rough and match the
 *  /pricing framing, near our cost a full task is about two cents, so a $10
 *  block is a few hundred tasks. */
export interface TokenBlock {
  /** Dollar price, shown verbatim. */
  price: string;
  /** Rough number of tasks the block covers. */
  tasks: string;
  /** Whether this is the suggested / pre-selected block. */
  recommended?: boolean;
}

export const TOKEN_BLOCKS_FIXTURE: TokenBlock[] = [
  { price: "$10", tasks: "about 300 tasks" },
  { price: "$25", tasks: "about 800 tasks", recommended: true },
  { price: "$50", tasks: "about 1,600 tasks" },
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
