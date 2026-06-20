// BeakerBot local dev proxy (ai foundation bot, 2026-06-10).
//
// POST /api/ai/chat
//
// The keystone of the AI assistant's hosting architecture (design doc section
// 6). A pure browser client cannot hold an inference key, so a thin token-minting
// proxy holds the key server-side and forwards the per-turn context. This route
// is the LOCAL prototype of that proxy. Production swaps it for a dedicated AI
// proxy, but because everything provider-specific is read from env, that swap is
// config only, not a rewrite. This handler stays deliberately thin (a
// pass-through), so the production proxy can reuse the same shape.
//
// Why server-only env: the inference key must NEVER reach the browser. It is read
// from AI_API_KEY (no NEXT_PUBLIC_ prefix, so Next never inlines it into client
// bundles), the key is never logged, never echoed, and never sent to the client.
//
// It accepts { messages, tools?, tool_choice?, stream? } from the browser and
// calls the provider's OpenAI-compatible POST {base}/chat/completions. Two modes,
// both pass-through:
//   - stream: true  (the default, the foundation chat panel) proxies the SSE body
//     straight back, so the panel parses deltas client-side.
//   - stream: false (the agent loop, ai tools bot 2026-06-10) returns the provider
//     JSON straight back, so the browser loop can read tool_calls reliably. The
//     loop runs in the browser, so the proxy stays a thin per-turn relay.
//
// The proxy is the only place that can cap what the browser smuggles upstream, so
// it forwards ONLY known fields (messages, tools, tool_choice, stream). The tool
// EXECUTE functions live in the browser, only tool DEFINITIONS (name, description,
// JSON Schema) ever cross this proxy, never a key.
//
// Billing enforcement (BeakerAI billing Phase 2, 2026-06-12). The whole AI
// feature is dark in prod, and even locally this proxy stays a pure pass-through
// UNLESS the server env AI_BILLING_ENABLED is on. That env is the go-live
// enforcement switch (NOT NEXT_PUBLIC, it never reaches the browser):
//   off (default, current dev state): behave exactly as before, no session, no
//     DB, byte-identical, so local dogfooding keeps working.
//   on (go-live): fail CLOSED. We require a signed-in account, a configured
//     billing DB, and a positive token balance BEFORE the provider is called,
//     and we record the turn's token usage AFTER. A free or unbilled model call
//     can never happen with the switch on.
//
// Vision router (BeakerBot vision, 2026-06-13). Turns that contain an image_url
// content block are routed to a separate vision model (AI_VISION_MODEL). Text-only
// turns continue to use the text model (AI_MODEL). When AI_VISION_MODEL is unset,
// the router falls back to AI_MODEL so the feature is inert until Grant sets the
// env, and no image is ever sent to a model that has not been configured.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { getOrGrantBalance, recordUsage } from "@/lib/billing/ai-ledger";
import { hasImageContent, selectModel } from "./vision-router";

// Re-export so the existing route tests (which import directly from route) can
// continue to test the helpers without change.
export { hasImageContent, selectModel };

export const runtime = "nodejs";

/** Whether the AI billing enforcement switch is on. Fails closed (any value
 *  other than "1"/"true" leaves the proxy in its original pass-through mode). */
function isAiBillingEnabled(): boolean {
  const v = process.env.AI_BILLING_ENABLED;
  return v === "1" || v === "true";
}

// Provider-agnostic defaults. Any OpenAI-compatible base URL works, so the
// default points at Fireworks (the locked default host, design doc section 10)
// but every value is env-overridable. Do NOT hardcode Fireworks anywhere except
// this default.
const DEFAULT_BASE_URL = "https://api.fireworks.ai/inference/v1";
// gpt-oss-120b, the locked default (design doc section 10). OpenAI's open-weight
// Apache-2.0 model, US-origin, on the Fireworks serverless catalog. Llama is NOT
// on Fireworks serverless (dedicated-deployment-only), so it is reachable only by
// swapping the provider via AI_PROXY_BASE_URL. Override the model with AI_MODEL.
const DEFAULT_MODEL = "accounts/fireworks/models/gpt-oss-120b";

// A forwarded message. Beyond the foundation slice's { role, content }, the agent
// loop needs tool plumbing, an assistant message that only calls tools carries
// content:null plus tool_calls, and a tool result carries tool_call_id + name.
// Content may also be a block array for multimodal user turns (image_url blocks
// are forwarded verbatim to the provider in the OpenAI vision format).
type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
// A single block in a multimodal content array. Only the two known shapes are
// forwarded; the proxy rejects unknown block types by dropping them in the
// cleaning step so the browser cannot smuggle unexpected provider parameters.
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatMessage = {
  role: string;
  content: string | ContentBlock[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

// A provider-facing tool definition (OpenAI-compatible). Only name, description,
// and the JSON Schema, never an execute function, that stays in the browser.
type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
};

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The token counts an OpenAI-compatible response reports in its `usage` block.
 *  prompt_tokens_details.cached_tokens is the OpenAI-compatible field Fireworks
 *  uses to report how many input tokens were served from its prompt cache. */
type ProviderUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
};

/** Pulls prompt/completion/cached token counts out of an unknown `usage` value,
 *  0 when absent or malformed, so a missing usage block never throws on the hot
 *  path. cached is a SUBSET of prompt (input tokens served from the prompt cache),
 *  recorded for cost accounting only, it never changes what the user is charged. */
function readUsage(usage: unknown): {
  prompt: number;
  completion: number;
  cached: number;
} {
  const u = (usage ?? {}) as ProviderUsage;
  const prompt = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
  const completion =
    typeof u.completion_tokens === "number" ? u.completion_tokens : 0;
  const cachedRaw = u.prompt_tokens_details?.cached_tokens;
  const cached = typeof cachedRaw === "number" ? cachedRaw : 0;
  return { prompt, completion, cached };
}

/**
 * Records a turn's token usage to the ledger, best effort. We never let a metering
 * failure surface to the user (the model already answered), but the deduction is
 * the whole point of enforcement, so a real failure is at least logged server-side.
 * The taskId groups a multi-turn BeakerBot task, the deduction is post-call because
 * token counts are only known once the model answers.
 */
async function meter(
  ownerKey: string,
  taskId: string,
  prompt: number,
  completion: number,
  cached: number,
): Promise<void> {
  try {
    await recordUsage(ownerKey, {
      taskId,
      promptTokens: prompt,
      completionTokens: completion,
      cachedTokens: cached,
    });
  } catch {
    // Swallowed on purpose, the response is already on its way to the browser.
    // The next turn still re-reads the balance and refuses if it went non-positive.
    console.error("BeakerBot usage metering failed for a completed turn.");
  }
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    // Inert, not crashing, when no key is configured. The panel surfaces this
    // message so a dev knows exactly what to do.
    return jsonError(
      500,
      "BeakerBot has no model key configured. Add AI_API_KEY to frontend/.env.local and restart the dev server.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be JSON.");
  }

  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(400, "Provide a non-empty messages array.");
  }

  // Keep only known message fields, so the browser cannot smuggle extra provider
  // parameters through the proxy. We allow the tool plumbing fields (tool_calls,
  // tool_call_id, name) because the agent loop needs them, but nothing else.
  // role is required, content may be null (an assistant message that only calls
  // tools), or a ContentBlock array for multimodal user turns. A message is kept
  // when it has a valid role AND (a string content, a block-array content, or
  // tool_calls). Unknown shapes are dropped.
  const cleanMessages: ChatMessage[] = messages
    .filter(
      (m): m is Record<string, unknown> =>
        typeof m === "object" && m !== null && typeof (m as { role?: unknown }).role === "string",
    )
    .map((m) => {
      // Sanitise a content block array so the browser cannot forward arbitrary
      // block shapes. Only text and image_url blocks are forwarded; any other
      // type is silently dropped. An image_url block is only forwarded when its
      // url field is a non-empty string (the base64 data URL the client sends).
      let content: string | ContentBlock[] | null;
      if (typeof m.content === "string") {
        content = m.content;
      } else if (m.content === null) {
        content = null;
      } else if (Array.isArray(m.content)) {
        const blocks: ContentBlock[] = [];
        for (const b of m.content as unknown[]) {
          if (typeof b !== "object" || b === null) continue;
          const block = b as Record<string, unknown>;
          if (block.type === "text" && typeof block.text === "string") {
            blocks.push({ type: "text", text: block.text });
          } else if (
            block.type === "image_url" &&
            typeof block.image_url === "object" &&
            block.image_url !== null &&
            typeof (block.image_url as Record<string, unknown>).url === "string" &&
            ((block.image_url as Record<string, unknown>).url as string).length > 0
          ) {
            blocks.push({
              type: "image_url",
              image_url: { url: (block.image_url as Record<string, unknown>).url as string },
            });
          }
          // Unknown block types are silently dropped.
        }
        content = blocks.length > 0 ? blocks : null;
      } else {
        // Any other shape (number, boolean, object) is treated as empty.
        content = null;
      }

      const out: ChatMessage = { role: m.role as string, content };
      if (Array.isArray(m.tool_calls)) out.tool_calls = m.tool_calls as ToolCall[];
      if (typeof m.tool_call_id === "string") out.tool_call_id = m.tool_call_id;
      if (typeof m.name === "string") out.name = m.name;
      return out;
    })
    .filter(
      (m) =>
        typeof m.content === "string" ||
        Array.isArray(m.content) ||
        Array.isArray(m.tool_calls),
    );

  if (cleanMessages.length === 0) {
    return jsonError(400, "No valid messages were provided.");
  }

  // Forward tool DEFINITIONS only, capped to name + description + parameters. The
  // execute functions never leave the browser, so they can never reach here.
  const rawTools = (body as { tools?: unknown })?.tools;
  let cleanTools: ToolDefinition[] | undefined;
  if (Array.isArray(rawTools) && rawTools.length > 0) {
    cleanTools = rawTools
      .filter(
        (t): t is Record<string, unknown> =>
          typeof t === "object" &&
          t !== null &&
          typeof (t as { function?: { name?: unknown } }).function === "object",
      )
      .map((t) => {
        const fn = t.function as Record<string, unknown>;
        return {
          type: "function" as const,
          function: {
            name: String(fn.name ?? ""),
            description:
              typeof fn.description === "string" ? fn.description : undefined,
            parameters: fn.parameters,
          },
        };
      })
      .filter((t) => t.function.name.length > 0);
    if (cleanTools.length === 0) cleanTools = undefined;
  }

  // Optional tool_choice, only the known string forms pass through.
  const rawToolChoice = (body as { tool_choice?: unknown })?.tool_choice;
  const toolChoice =
    typeof rawToolChoice === "string" ? rawToolChoice : undefined;

  // Stream defaults to true (the foundation chat panel). The agent loop sends
  // stream:false so it can read tool_calls from one complete response.
  const stream = (body as { stream?: unknown })?.stream !== false;

  // Optional per-task id the browser passes (one BeakerBot task spans many turns,
  // so the ledger groups a task's cost under it). Absent (or with enforcement off)
  // we fall back to a per-request id, used only when we actually record usage.
  const rawTaskId = (body as { task_id?: unknown })?.task_id;
  const taskId =
    typeof rawTaskId === "string" && rawTaskId.length > 0
      ? rawTaskId
      : `req_${crypto.randomUUID()}`;

  // BILLING GATE (fail closed). Only runs when AI_BILLING_ENABLED is on, so the
  // default path below is byte-identical to before. Order matters, each check
  // refuses BEFORE the provider is ever called, so an unbilled call is impossible.
  const billingOn = isAiBillingEnabled();
  let ownerKey: string | null = null;
  if (billingOn) {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      // No verified account, never call the provider on an anonymous request.
      return jsonError(401, "signin_required");
    }
    if (!process.env.DATABASE_URL) {
      // The ledger is unreachable, refuse rather than silently serve a free call.
      return jsonError(500, "billing_unconfigured");
    }
    ownerKey = ownerKeyForEmail(email);
    let balance: number;
    try {
      balance = await getOrGrantBalance(ownerKey);
    } catch {
      // A ledger read failure must fail closed, never an unbilled call.
      return jsonError(500, "billing_unconfigured");
    }
    if (balance <= 0) {
      return new Response(
        JSON.stringify({ error: "out_of_credits", balance: 0 }),
        { status: 402, headers: { "content-type": "application/json" } },
      );
    }
  }

  const baseUrl = (process.env.AI_PROXY_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  // Vision router. selectModel inspects cleanMessages and picks the vision model
  // when at least one image_url block is present, falling back to the text model
  // when AI_VISION_MODEL is unset. Until Grant sets AI_VISION_MODEL, this is
  // identical to the original single-model path.
  const textModel = process.env.AI_MODEL || DEFAULT_MODEL;
  const visionModel = process.env.AI_VISION_MODEL || undefined;
  const model = selectModel(cleanMessages, { textModel, visionModel });
  const endpoint = `${baseUrl}/chat/completions`;

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The key is attached here, server-side only, and never returned.
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: cleanMessages,
        stream,
        // stream_options is ONLY valid when stream:true. OpenAI-compatible
        // providers (Fireworks) hard-reject it with a 400 on a non-streaming
        // request, which broke every agent-loop turn (the loop runs
        // stream:false to read tool_calls from one complete response). The
        // non-streaming path does not need it anyway: the completion JSON
        // carries a `usage` block natively, so the status line still gets its
        // token count. Include stream_options only when streaming AND billing
        // is on (the metering branch reads the final cumulative usage chunk).
        // Streaming without billing stays byte-identical to the original path.
        ...(stream && billingOn
          ? { stream_options: { include_usage: true } }
          : {}),
        ...(cleanTools ? { tools: cleanTools } : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
      }),
    });
  } catch {
    // Never include the error detail verbatim, so a misconfigured key can never
    // leak through an upstream exception message.
    return jsonError(502, "Could not reach the model provider.");
  }

  if (!upstream.ok || !upstream.body) {
    // Surface the status without echoing any provider response that could carry
    // sensitive detail.
    return jsonError(
      502,
      `The model provider returned an error (status ${upstream.status}).`,
    );
  }

  // Non-streaming mode (the agent loop), return the provider JSON straight back so
  // the browser loop reads tool_calls from one complete message. Still a
  // pass-through, the key never appears in the body.
  if (!stream) {
    // Enforcement off: stream the body straight through, byte-identical to before.
    if (!billingOn || !ownerKey) {
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    // Enforcement on: read the full JSON to meter the turn, then return the SAME
    // text unchanged. We send the exact bytes the provider returned, so tool_calls
    // and every other field pass through untouched.
    const text = await upstream.text();
    let usage: unknown;
    try {
      usage = (JSON.parse(text) as { usage?: unknown }).usage;
    } catch {
      usage = undefined;
    }
    const { prompt, completion, cached } = readUsage(usage);
    await meter(ownerKey, taskId, prompt, completion, cached);
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  // Streaming mode. Enforcement off: proxy the SSE body straight through to the
  // browser, byte-identical to before. The body is already a ReadableStream of the
  // provider's OpenAI-style `data:` lines, so the panel parses deltas client-side.
  if (!billingOn || !ownerKey) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }

  // Enforcement on: TEE the stream. One branch is returned to the browser exactly
  // as received (we never alter the bytes), the other branch is drained here to
  // find the final usage chunk (include_usage adds it as the last data line) so we
  // can meter the turn after it completes.
  const [toClient, toMeter] = upstream.body.tee();
  const meterOwnerKey = ownerKey;
  void (async () => {
    const reader = toMeter.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let prompt = 0;
    let completion = 0;
    let cached = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line. Parse each complete `data:`
        // line for a usage block, keeping the trailing partial in the buffer.
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (payload && payload !== "[DONE]") {
              try {
                const obj = JSON.parse(payload) as { usage?: unknown };
                if (obj.usage) {
                  const u = readUsage(obj.usage);
                  // The provider sends cumulative usage in its final chunk, so the
                  // last seen values are the turn's totals.
                  prompt = u.prompt;
                  completion = u.completion;
                  cached = u.cached;
                }
              } catch {
                // A non-JSON or partial data line, ignore and keep scanning.
              }
            }
          }
          nl = buffer.indexOf("\n");
        }
      }
    } catch {
      // A drain failure must not affect the client stream, which is independent.
    } finally {
      reader.releaseLock();
      await meter(meterOwnerKey, taskId, prompt, completion, cached);
    }
  })();

  return new Response(toClient, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
