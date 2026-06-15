// BeakerBot proxy client (ai tools bot, 2026-06-10).
//
// The production ModelCaller, it POSTs the agent loop's messages and tool
// definitions to the local proxy at /api/ai/chat with stream:false and returns the
// parsed provider JSON. The proxy holds the inference key server-side, so this
// browser code never sees a key, it only sends per-turn context. The agent loop
// stays testable because it takes the caller by injection, this is the real one.
//
// Non-streaming on purpose, capturing tool_calls reliably needs the complete
// message, not SSE deltas (design doc section 6, the loop runs in the browser).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import type { ModelCaller, ModelResponse } from "./agent-loop";

const ENDPOINT = "/api/ai/chat";

// A clear error the panel can surface. The proxy returns { error } JSON on the
// missing-key and provider-error paths, we forward that text verbatim so a dev
// knows exactly what to fix.
export class ProxyError extends Error {}

/** Shared POST to the proxy. The optional taskId groups every turn of one
 *  BeakerBot task under a single id in the billing ledger (so a multi-turn task's
 *  cost reads as one task, not scattered per-request rows). Omitted when absent,
 *  in which case the proxy falls back to a per-request id. */
async function postChat(
  messages: Parameters<ModelCaller>[0],
  tools: Parameters<ModelCaller>[1],
  signal?: AbortSignal,
  taskId?: string,
): Promise<ModelResponse> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages,
      // Only send tools when there are some, an empty array is harmless but noise.
      tools: tools.length > 0 ? tools : undefined,
      stream: false,
      // Request the provider to include a usage block in the non-streaming
      // response so the status line can show a live token count. The proxy
      // passes this through to the upstream provider. Providers that do not
      // understand stream_options ignore the field harmlessly, and the status
      // line degrades gracefully when usage is absent.
      stream_options: { include_usage: true },
      // Stable per-task id so the ledger groups a task's turns. Undefined is
      // omitted by JSON.stringify, leaving the proxy's per-request fallback.
      task_id: taskId,
    }),
    signal,
  });

  if (!res.ok) {
    let message = `BeakerBot request failed (status ${res.status}).`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // Non-JSON error body, keep the status message.
    }
    throw new ProxyError(message);
  }

  return (await res.json()) as ModelResponse;
}

/** The proxy-backed model caller for production use. Sends { messages, tools,
 *  stream:false, stream_options.include_usage:true } and returns the provider
 *  JSON (which carries a usage block when the provider supports it). Throws
 *  ProxyError with the proxy's message on a non-OK response. */
export const callModelViaProxy: ModelCaller = (messages, tools, signal) =>
  postChat(messages, tools, signal);

/** A proxy caller bound to one task id, so every turn of that BeakerBot task is
 *  metered under the same task_id. The agent loop is one task, so the store mints
 *  an id per runAgentLoop call and uses this. */
export function proxyCallerForTask(taskId: string): ModelCaller {
  return (messages, tools, signal) => postChat(messages, tools, signal, taskId);
}
