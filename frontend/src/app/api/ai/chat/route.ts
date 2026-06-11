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
// House style: no em-dashes, no emojis, no mid-sentence colons.

export const runtime = "nodejs";

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
type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
type ChatMessage = {
  role: string;
  content: string | null;
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
  // tools), so we keep a message when it has a valid role AND either a string
  // content or tool_calls.
  const cleanMessages: ChatMessage[] = messages
    .filter(
      (m): m is Record<string, unknown> =>
        typeof m === "object" && m !== null && typeof (m as { role?: unknown }).role === "string",
    )
    .map((m) => {
      const out: ChatMessage = {
        role: m.role as string,
        content:
          typeof m.content === "string"
            ? (m.content as string)
            : m.content === null
              ? null
              : "",
      };
      if (Array.isArray(m.tool_calls)) out.tool_calls = m.tool_calls as ToolCall[];
      if (typeof m.tool_call_id === "string") out.tool_call_id = m.tool_call_id;
      if (typeof m.name === "string") out.name = m.name;
      return out;
    })
    .filter((m) => typeof m.content === "string" || Array.isArray(m.tool_calls));

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

  const baseUrl = (process.env.AI_PROXY_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
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
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  // Proxy the SSE stream straight through to the browser. The body is already a
  // ReadableStream of the provider's OpenAI-style `data:` lines, so the panel
  // parses deltas client-side. This pass-through keeps the proxy thin.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
