// Client-side fetcher + types for the AI usage section (BeakerAI billing Phase
// 4). A thin wrapper over GET /api/billing/ai-status so the Settings component
// stays declarative. Mirrors billing/client.ts.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** One recent BeakerBot task's summed token cost (name-less, the UI labels it). */
export interface AiRecentTask {
  taskId: string;
  kind: string;
  tokens: number;
}

export interface AiStatus {
  /** Whether AI billing enforcement is on (the live ledger). When false the
   *  balance is inert and the UI shows the beta "AI is free" framing. */
  enabled: boolean;
  signedIn?: boolean;
  /** Tokens remaining in the prepaid pool. */
  balance?: number;
  recentTasks?: AiRecentTask[];
}

/** Reads the signed-in account's AI token balance + recent tasks, or null on a
 *  network error so the component can fall back to its loading or empty state. */
export async function fetchAiStatus(): Promise<AiStatus | null> {
  try {
    const res = await fetch("/api/billing/ai-status");
    if (!res.ok) return null;
    return (await res.json()) as AiStatus;
  } catch {
    return null;
  }
}
