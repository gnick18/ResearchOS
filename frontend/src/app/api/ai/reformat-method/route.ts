// Method phone-projection reformatter endpoint (method phone projection
// reformatter, Phase 2, 2026-06-14).
//
// POST /api/ai/reformat-method
//
// Turns a researcher's own free-form protocol markdown into clean, bench-readable
// markdown (numbered steps, phase headings, reagent lists) that the phone's
// deterministic parser already renders well. This is the OPT-IN LLM layer of the
// reformatter: Phase 1 (the offline deterministic parse) always runs on the phone
// for free, and this endpoint is only invoked when the user explicitly asks for a
// nicer phone version (a laptop "Make phone-friendly" button or the just-in-time
// phone popup).
//
// Scope: this only re-STRUCTURES the user's own content. It draws no conclusions,
// invents no science, changes no value. The one hard guardrail (verbatim values)
// is enforced deterministically here AFTER the model answers: the output is run
// through validateReformat, and if it invents or changes any number or reagent we
// DISCARD it and tell the caller to fall back to the deterministic parse. So an
// unfaithful reformat can never reach the bench.
//
// Billing + key handling mirror /api/ai/chat exactly: the inference key is
// server-only (AI_API_KEY, never NEXT_PUBLIC), and when AI_BILLING_ENABLED is on
// we fail closed (require a signed-in account with a positive balance before the
// provider is called, and meter the turn after). This is a single non-streaming
// call, so there is no SSE plumbing.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { getOrGrantBalance, recordUsage } from "@/lib/billing/ai-ledger";
import {
  REFORMAT_SYSTEM_PROMPT,
  buildReformatUserMessage,
  cleanReformatOutput,
} from "@/lib/methods/reformat-prompt";
import { validateReformat } from "@/lib/methods/reformat-validate";

export const runtime = "nodejs";

const DEFAULT_BASE_URL = "https://api.fireworks.ai/inference/v1";
const DEFAULT_MODEL = "accounts/fireworks/models/gpt-oss-120b";
// Cap the source we will reformat. A protocol body is small; anything larger is
// almost certainly not a single method, and we refuse rather than burn tokens.
const MAX_BODY_CHARS = 24000;

/** Whether the AI billing enforcement switch is on. Fails closed. */
function isAiBillingEnabled(): boolean {
  const v = process.env.AI_BILLING_ENABLED;
  return v === "1" || v === "true";
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type ProviderUsage = { prompt_tokens?: number; completion_tokens?: number };

function readUsage(usage: unknown): { prompt: number; completion: number } {
  const u = (usage ?? {}) as ProviderUsage;
  return {
    prompt: typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
    completion: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
  };
}

/** Best-effort meter of a completed turn (never surfaces to the user). */
async function meter(
  ownerKey: string,
  taskId: string,
  prompt: number,
  completion: number,
): Promise<void> {
  try {
    await recordUsage(ownerKey, {
      taskId,
      promptTokens: prompt,
      completionTokens: completion,
    });
  } catch {
    console.error("Method reformat usage metering failed for a completed turn.");
  }
}

/** Pull the assistant's text out of a non-streaming OpenAI-compatible response. */
function readContent(json: unknown): string {
  const choices = (json as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const msg = (choices[0] as { message?: { content?: unknown } })?.message;
  return typeof msg?.content === "string" ? msg.content : "";
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return jsonError(
      500,
      "The reformatter has no model key configured. Add AI_API_KEY to frontend/.env.local and restart the dev server.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be JSON.");
  }

  const sourceBody = (body as { body?: unknown })?.body;
  if (typeof sourceBody !== "string" || sourceBody.trim().length === 0) {
    return jsonError(400, "Provide a non-empty method body to reformat.");
  }
  if (sourceBody.length > MAX_BODY_CHARS) {
    return jsonError(
      413,
      `Method body is too large to reformat (over ${MAX_BODY_CHARS} characters).`,
    );
  }

  // Optional grouping id for the ledger (one method reformat is one unit of work).
  const rawTaskId = (body as { task_id?: unknown })?.task_id;
  const taskId =
    typeof rawTaskId === "string" && rawTaskId.length > 0
      ? rawTaskId
      : `reformat_${crypto.randomUUID()}`;

  // BILLING GATE (fail closed), identical contract to /api/ai/chat.
  const billingOn = isAiBillingEnabled();
  let ownerKey: string | null = null;
  if (billingOn) {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) return jsonError(401, "signin_required");
    if (!process.env.DATABASE_URL) return jsonError(500, "billing_unconfigured");
    ownerKey = ownerKeyForEmail(email);
    let balance: number;
    try {
      balance = await getOrGrantBalance(ownerKey);
    } catch {
      return jsonError(500, "billing_unconfigured");
    }
    if (balance <= 0) {
      return new Response(JSON.stringify({ error: "out_of_credits", balance: 0 }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }
  }

  const baseUrl = (process.env.AI_PROXY_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  // A cheap structural task: prefer a dedicated smaller model when configured,
  // else the standard text model, else the default. Never the vision model.
  const model =
    process.env.AI_REFORMAT_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        // Low temperature: this is a faithful structural transform, not creative
        // writing. We want the same input to map to the same tidy output.
        temperature: 0,
        messages: [
          { role: "system", content: REFORMAT_SYSTEM_PROMPT },
          { role: "user", content: buildReformatUserMessage(sourceBody) },
        ],
      }),
    });
  } catch {
    return jsonError(502, "Could not reach the model provider.");
  }

  if (!upstream.ok) {
    return jsonError(
      502,
      `The model provider returned an error (status ${upstream.status}).`,
    );
  }

  let json: unknown;
  try {
    json = await upstream.json();
  } catch {
    return jsonError(502, "The model provider returned an unreadable response.");
  }

  // Read token usage once: meter the turn when billing is on (the tokens were
  // spent regardless of whether the output survives validation), and surface the
  // counts in the response so a caller (the phone job bubble) can show them.
  const { prompt, completion } = readUsage((json as { usage?: unknown }).usage);
  const usage = { prompt, completion, total: prompt + completion };
  if (billingOn && ownerKey) {
    await meter(ownerKey, taskId, prompt, completion);
  }

  const reformatted = cleanReformatOutput(readContent(json));
  if (!reformatted) {
    return jsonError(502, "The model returned no usable text.");
  }

  // THE GUARDRAIL. If the model invented or changed any value, we refuse the
  // output and the caller falls back to the deterministic parse / raw body.
  const verdict = validateReformat(sourceBody, reformatted);
  if (!verdict.ok) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason: "validation_failed",
        invented_numerics: verdict.inventedNumerics,
        invented_words: verdict.inventedWords,
        coverage: verdict.coverage,
        coverage_short: verdict.coverageShort,
        usage,
      }),
      { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, reformatted, coverage: verdict.coverage, usage }),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
