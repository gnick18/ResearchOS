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
// It accepts { messages: [{ role, content }] } from the browser, calls the
// provider's OpenAI-compatible POST {base}/chat/completions with stream: true,
// and proxies the SSE stream straight back to the browser.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export const runtime = "nodejs";

// Provider-agnostic defaults. Any OpenAI-compatible base URL works, so the
// default points at Fireworks (the locked default host, design doc section 10)
// but every value is env-overridable. Do NOT hardcode Fireworks anywhere except
// this default.
const DEFAULT_BASE_URL = "https://api.fireworks.ai/inference/v1";
const DEFAULT_MODEL = "accounts/fireworks/models/llama-v3p3-70b-instruct";

type ChatMessage = { role: string; content: string };

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

  // Keep only the role + content fields, so the browser cannot smuggle extra
  // provider parameters through the proxy.
  const cleanMessages: ChatMessage[] = messages
    .filter(
      (m): m is ChatMessage =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as ChatMessage).role === "string" &&
        typeof (m as ChatMessage).content === "string",
    )
    .map((m) => ({ role: m.role, content: m.content }));

  if (cleanMessages.length === 0) {
    return jsonError(400, "No valid { role, content } messages were provided.");
  }

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
        stream: true,
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
