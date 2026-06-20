// BeakerBot AI billing, ledger logic tests (Phase 1).
//
// No live DATABASE_URL. We inject a mock of the Neon tagged-template that keeps a
// tiny in-memory ai_balances + ai_ledger and answers the few query shapes the
// ledger uses, so we can assert the LOGIC (grant once, deduct, topup idempotency)
// without a database.

import { beforeEach, describe, expect, it } from "vitest";

import { STARTER_GRANT_TOKENS } from "../ai-config";
import { __resetAiSchemaCacheForTests, type Sql } from "../ai-ledger-db";
import {
  creditTokens,
  getOrGrantBalance,
  getRecentTasks,
  recordUsage,
} from "../ai-ledger";
import { seedStarterGrant } from "../seed-grant";

interface LedgerRow {
  id: number;
  owner_key: string;
  kind: string;
  tokens_delta: number;
  task_id: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_tokens?: number | null;
  usd_micros: number | null;
  stripe_event_id: string | null;
  created_at: number;
}

/**
 * A mock Neon tagged-template. It joins the static SQL fragments into one string,
 * matches on the distinctive keyword for each query the ledger issues, and mutates
 * an in-memory store. Values arrive positionally in `values`, so each branch reads
 * them by index in the order they appear in the template.
 */
function makeMockSql() {
  const balances = new Map<
    string,
    { tokens_remaining: number; gift_granted: boolean }
  >();
  const ledger: LedgerRow[] = [];
  let nextId = 1;
  let clock = 1;

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");

    // Schema DDL (CREATE TABLE / CREATE INDEX / additive ALTER), no-op.
    if (/CREATE TABLE|CREATE UNIQUE INDEX|ALTER TABLE/i.test(text)) {
      return Promise.resolve([]);
    }

    // getOrGrantBalance: the grant CTE (INSERT ai_balances ... INSERT ai_ledger).
    if (/INSERT INTO ai_balances/i.test(text) && /INSERT INTO ai_ledger/i.test(text)) {
      const ownerKey = values[0] as string;
      const grantTokens = values[1] as number;
      if (!balances.has(ownerKey)) {
        balances.set(ownerKey, {
          tokens_remaining: grantTokens,
          gift_granted: true,
        });
        ledger.push({
          id: nextId++,
          owner_key: ownerKey,
          kind: "grant",
          tokens_delta: grantTokens,
          task_id: null,
          prompt_tokens: null,
          completion_tokens: null,
          usd_micros: (values[2] as number) ?? null,
          stripe_event_id: null,
          created_at: clock++,
        });
      }
      return Promise.resolve([]);
    }

    // recordUsage: the deduct CTE (UPDATE ai_balances ... INSERT ... 'usage').
    if (/UPDATE ai_balances/i.test(text) && /INSERT INTO ai_ledger/i.test(text)) {
      // Template value order: total (UPDATE), owner_key (WHERE), owner_key
      // (INSERT SELECT), -total (tokens_delta), taskId, prompt, completion,
      // cached, usd.
      const total = values[0] as number;
      const ownerKey = values[1] as string;
      const taskId = values[4] as string;
      const prompt = values[5] as number;
      const completion = values[6] as number;
      const cached = values[7] as number;
      const usd = values[8] as number;
      const row = balances.get(ownerKey);
      if (!row) return Promise.resolve([]);
      row.tokens_remaining -= total;
      ledger.push({
        id: nextId++,
        owner_key: ownerKey,
        kind: "usage",
        tokens_delta: -total,
        task_id: taskId,
        prompt_tokens: prompt,
        completion_tokens: completion,
        cached_tokens: cached,
        usd_micros: usd,
        stripe_event_id: null,
        created_at: clock++,
      });
      return Promise.resolve([{ tokens_remaining: row.tokens_remaining }]);
    }

    // creditTokens step 1: INSERT the topup ledger row, idempotent on event id.
    if (
      /INSERT INTO ai_ledger/i.test(text) &&
      /stripe_event_id/i.test(text) &&
      /ON CONFLICT \(stripe_event_id\)/i.test(text)
    ) {
      const ownerKey = values[0] as string;
      const add = values[1] as number;
      const usd = values[2] as number;
      const eventId = values[3] as string;
      const dup = ledger.some((r) => r.stripe_event_id === eventId);
      if (dup) return Promise.resolve([]);
      const id = nextId++;
      ledger.push({
        id,
        owner_key: ownerKey,
        kind: "topup",
        tokens_delta: add,
        task_id: null,
        prompt_tokens: null,
        completion_tokens: null,
        usd_micros: usd,
        stripe_event_id: eventId,
        created_at: clock++,
      });
      return Promise.resolve([{ id }]);
    }

    // creditTokens step 2: upsert the balance by the credited amount.
    if (
      /INSERT INTO ai_balances/i.test(text) &&
      /ON CONFLICT \(owner_key\) DO UPDATE/i.test(text)
    ) {
      const ownerKey = values[0] as string;
      const add = values[1] as number;
      const existing = balances.get(ownerKey);
      if (existing) {
        existing.tokens_remaining += add;
      } else {
        balances.set(ownerKey, {
          tokens_remaining: add,
          gift_granted: false,
        });
      }
      return Promise.resolve([
        { tokens_remaining: balances.get(ownerKey)!.tokens_remaining },
      ]);
    }

    // getRecentTasks: grouped usage rows.
    if (/GROUP BY task_id/i.test(text)) {
      const ownerKey = values[0] as string;
      const byTask = new Map<string, { tokens: number; last: number }>();
      for (const r of ledger) {
        if (r.owner_key !== ownerKey || r.kind !== "usage" || !r.task_id) continue;
        const cur = byTask.get(r.task_id) ?? { tokens: 0, last: 0 };
        cur.tokens += -r.tokens_delta;
        cur.last = Math.max(cur.last, r.created_at);
        byTask.set(r.task_id, cur);
      }
      const out = [...byTask.entries()]
        .sort((a, b) => b[1].last - a[1].last)
        .map(([task_id, v]) => ({ task_id, tokens: v.tokens }));
      return Promise.resolve(out);
    }

    // Plain balance read.
    if (/SELECT tokens_remaining FROM ai_balances/i.test(text)) {
      const ownerKey = values[0] as string;
      const row = balances.get(ownerKey);
      return Promise.resolve(
        row ? [{ tokens_remaining: row.tokens_remaining }] : [],
      );
    }

    throw new Error(`unmocked query: ${text}`);
  }) as unknown as Sql;

  return { sql, balances, ledger };
}

describe("ai-ledger getOrGrantBalance", () => {
  beforeEach(() => __resetAiSchemaCacheForTests());

  it("grants the one-time gift on first use, exactly once", async () => {
    const { sql, ledger } = makeMockSql();
    const first = await getOrGrantBalance("owner-a", sql);
    expect(first).toBe(STARTER_GRANT_TOKENS);

    const second = await getOrGrantBalance("owner-a", sql);
    expect(second).toBe(STARTER_GRANT_TOKENS);

    const grants = ledger.filter(
      (r) => r.owner_key === "owner-a" && r.kind === "grant",
    );
    expect(grants).toHaveLength(1);
  });

  it("grants separately per owner", async () => {
    const { sql, ledger } = makeMockSql();
    await getOrGrantBalance("owner-a", sql);
    await getOrGrantBalance("owner-b", sql);
    expect(ledger.filter((r) => r.kind === "grant")).toHaveLength(2);
  });
});

describe("seedStarterGrant (eager provision-time mint)", () => {
  beforeEach(() => __resetAiSchemaCacheForTests());

  it("mints the gift at provision so the balance is present immediately", async () => {
    const { sql, balances, ledger } = makeMockSql();

    // Before provision the owner has no balance row at all.
    expect(balances.has("owner-new")).toBe(false);

    // Provision seeds the gift eagerly.
    const seeded = await seedStarterGrant("owner-new", sql);
    expect(seeded).toBe(STARTER_GRANT_TOKENS);

    // The balance row now exists right after provision, before any AI turn, so
    // Settings and the chat header read the real balance on first fetch.
    expect(balances.get("owner-new")?.tokens_remaining).toBe(
      STARTER_GRANT_TOKENS,
    );
    expect(
      ledger.filter((r) => r.owner_key === "owner-new" && r.kind === "grant"),
    ).toHaveLength(1);
  });

  it("grants exactly once even if provision seeds twice (re-bind is a no-op)", async () => {
    const { sql, ledger } = makeMockSql();
    await seedStarterGrant("owner-new", sql);
    await seedStarterGrant("owner-new", sql);
    expect(
      ledger.filter((r) => r.owner_key === "owner-new" && r.kind === "grant"),
    ).toHaveLength(1);
  });

  it("does not double-grant when the lazy path later runs for the same owner", async () => {
    const { sql, ledger } = makeMockSql();
    // Eager seed at provision.
    const seeded = await seedStarterGrant("owner-new", sql);
    // The old lazy mint (first metered use / first ai-status read) still runs.
    const lazy = await getOrGrantBalance("owner-new", sql);
    expect(seeded).toBe(STARTER_GRANT_TOKENS);
    expect(lazy).toBe(STARTER_GRANT_TOKENS);
    expect(
      ledger.filter((r) => r.owner_key === "owner-new" && r.kind === "grant"),
    ).toHaveLength(1);
  });

  it("skips cleanly with no sql seam and no DATABASE_URL (lazy path still covers it)", async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const result = await seedStarterGrant("owner-no-db");
      expect(result).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});

describe("ai-ledger recordUsage", () => {
  beforeEach(() => __resetAiSchemaCacheForTests());

  it("deducts prompt + completion tokens and logs a usage row", async () => {
    const { sql, ledger } = makeMockSql();
    await getOrGrantBalance("owner-a", sql);
    const remaining = await recordUsage("owner-a", {
      taskId: "task-1",
      promptTokens: 1_000,
      completionTokens: 500,
    }, sql);
    expect(remaining).toBe(STARTER_GRANT_TOKENS - 1_500);
    const usage = ledger.filter((r) => r.kind === "usage");
    expect(usage).toHaveLength(1);
    expect(usage[0].tokens_delta).toBe(-1_500);
    expect(usage[0].task_id).toBe("task-1");
  });

  it("can dip negative on a single oversized turn (next turn is refused upstream)", async () => {
    const { sql } = makeMockSql();
    await getOrGrantBalance("owner-a", sql);
    const remaining = await recordUsage("owner-a", {
      taskId: "big",
      promptTokens: STARTER_GRANT_TOKENS,
      completionTokens: 5_000,
    }, sql);
    expect(remaining).toBeLessThan(0);
  });

  it("records cached_tokens for cost accounting without changing the deduction", async () => {
    const { sql, ledger } = makeMockSql();
    await getOrGrantBalance("owner-a", sql);
    const remaining = await recordUsage("owner-a", {
      taskId: "cached-turn",
      promptTokens: 1_000,
      completionTokens: 200,
      cachedTokens: 800,
    }, sql);
    // The deduction is still total tokens (prompt + completion), cache changes our
    // cost not the charge.
    expect(remaining).toBe(STARTER_GRANT_TOKENS - 1_200);
    const usage = ledger.filter((r) => r.kind === "usage");
    expect(usage[0].cached_tokens).toBe(800);
    expect(usage[0].prompt_tokens).toBe(1_000);
  });

  it("clamps cached_tokens to prompt_tokens (cached is a subset of input)", async () => {
    const { sql, ledger } = makeMockSql();
    await getOrGrantBalance("owner-a", sql);
    await recordUsage("owner-a", {
      taskId: "over",
      promptTokens: 500,
      completionTokens: 0,
      cachedTokens: 9_999,
    }, sql);
    const usage = ledger.filter((r) => r.kind === "usage");
    expect(usage[0].cached_tokens).toBe(500);
  });
});

describe("ai-ledger creditTokens idempotency", () => {
  beforeEach(() => __resetAiSchemaCacheForTests());

  it("credits a top-up once even if the Stripe event is redelivered", async () => {
    const { sql, ledger } = makeMockSql();
    await getOrGrantBalance("owner-a", sql);

    const after1 = await creditTokens("owner-a", 100_000, "evt_1", sql);
    expect(after1).toBe(STARTER_GRANT_TOKENS + 100_000);

    // Redelivery of the same event must NOT credit again.
    const after2 = await creditTokens("owner-a", 100_000, "evt_1", sql);
    expect(after2).toBe(STARTER_GRANT_TOKENS + 100_000);

    const topups = ledger.filter((r) => r.kind === "topup");
    expect(topups).toHaveLength(1);
  });

  it("a distinct event credits again", async () => {
    const { sql } = makeMockSql();
    await getOrGrantBalance("owner-a", sql);
    await creditTokens("owner-a", 100_000, "evt_1", sql);
    const after = await creditTokens("owner-a", 50_000, "evt_2", sql);
    expect(after).toBe(STARTER_GRANT_TOKENS + 150_000);
  });
});

describe("ai-ledger getRecentTasks", () => {
  beforeEach(() => __resetAiSchemaCacheForTests());

  it("groups usage by task, newest first, with summed positive tokens", async () => {
    const { sql } = makeMockSql();
    await getOrGrantBalance("owner-a", sql);
    await recordUsage("owner-a", { taskId: "t1", promptTokens: 100, completionTokens: 100 }, sql);
    await recordUsage("owner-a", { taskId: "t2", promptTokens: 300, completionTokens: 0 }, sql);
    await recordUsage("owner-a", { taskId: "t1", promptTokens: 50, completionTokens: 50 }, sql);

    const tasks = await getRecentTasks("owner-a", 10, sql);
    // t1 was touched last, so it leads.
    expect(tasks[0].taskId).toBe("t1");
    expect(tasks[0].tokens).toBe(300);
    expect(tasks.find((t) => t.taskId === "t2")?.tokens).toBe(300);
    expect(tasks.every((t) => t.kind === "usage")).toBe(true);
  });
});
