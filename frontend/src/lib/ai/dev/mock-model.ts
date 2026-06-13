// Mock model caller for the /dev/beakerbot play page.
//
// Replaces callModelViaProxy with a purely local fake that never touches the
// network. Behavior:
//   - Waits 1.5 to 4 seconds before resolving, so the elapsed timer and the
//     live status line are visible on screen.
//   - Returns a text-only response (no tool_calls), because executing real
//     tools requires a connected folder. The steps panel is exercised by real
//     tool turns, not by this mock.
//   - Reports a fake usage block (prompt_tokens + completion_tokens) in the
//     same field names the agent loop reads, so the status line shows a
//     believable token count.
//   - Rotates through a small set of lab-flavored replies, indexed by a simple
//     counter that is deterministic across a session (no Math.random flicker).
//
// Install with setModelCallerOverride(mockModelCaller) on mount and clear with
// setModelCallerOverride(null) on unmount. Production code never imports this
// file; it is dev-only.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import type { ModelCaller } from "@/lib/ai/agent-loop";

// Rotating scripted replies. Each references the shape of the user message
// content to feel somewhat responsive, but we keep it simple (a fixed roster
// plus one "echo" variant) so the mock stays deterministic.
const REPLIES: readonly string[] = [
  "This is the mock BeakerBot. Your message came through, but no real model is running here. Try typing something else to see the status line and token counter in action.",
  "Great question for a mock. In a real session BeakerBot would look at your open experiment, check the context, and give you a grounded answer. For now, watch the elapsed timer above.",
  "Mock reply three of ten. The live status line shows elapsed time while the turn is running and settles into a token summary once it finishes. No real credits spent here.",
  "The Regenerate button on the last reply and the Revert-to-here button on your messages are both live. Try them. They talk to the conversation store, not to a model, so they work in mock mode too.",
  "In production, BeakerBot can read your notes, list experiments, and operate the Data Hub. Here it can only narrate what it would normally do. Copy this message with the button below it.",
  "Another mock turn. The token count you see is fabricated to look realistic (roughly 8 to 40 thousand tokens per turn). The elapsed time is real wall-clock seconds, since the delay is genuine.",
  "You can also try typing while a turn is running. The composer will queue your next message and fire it automatically once this turn settles. That is the single-slot queue in action.",
  "Mock reply eight. The BeakerSearch palette morphs from a search bar into this centered chat surface. That morph is the live UI, not a demo. The model underneath it is the only thing that is fake.",
  "Hover the user messages in this thread to see the Revert-to-here button appear. Clicking it shows a confirmation dialog, then rewinds the transcript to that point without a real model call.",
  "Final reply in the rotation. We are cycling back to the beginning. All the affordances, the status line, the token summary, the copy button, and the regenerate button, are the real production components.",
];

// Simple turn counter. Increments on each mock call so the rotation is
// predictable across a session. Module-scoped so it survives re-renders.
let callCount = 0;

// Fake usage numbers that look realistic. Varied deterministically by the
// call index so consecutive replies do not look identical.
const FAKE_PROMPT_BASES = [8000, 12400, 9800, 15200, 11000, 18600, 7400, 22000, 13800, 9200];
const FAKE_COMPLETION_BASES = [800, 1200, 950, 1400, 1050, 1600, 700, 1800, 1100, 880];

// Delays in milliseconds. The range 1500 to 4000 ms lets the timer tick visibly
// without making the wait frustrating. Determined by call index, not random,
// so consecutive turns alternate between fast and slow to keep it interesting.
const DELAYS_MS = [1800, 2600, 1500, 3200, 2100, 3800, 1700, 2900, 2400, 3500];

/**
 * A text-only mock model caller for the /dev/beakerbot play page.
 * Satisfies the ModelCaller contract (same shape as callModelViaProxy).
 * Never makes a network request.
 */
export const mockModelCaller: ModelCaller = async (_messages, _tools, signal) => {
  const index = callCount % REPLIES.length;
  callCount += 1;

  const delayMs = DELAYS_MS[index] ?? 2000;
  const promptTokens = FAKE_PROMPT_BASES[index] ?? 10000;
  const completionTokens = FAKE_COMPLETION_BASES[index] ?? 1000;

  // Honour the AbortSignal so stop() works the same way it does with the
  // real caller.
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    }
  });

  const content = REPLIES[index] ?? REPLIES[0]!;

  return {
    choices: [
      {
        message: {
          role: "assistant",
          content,
        },
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
    },
  };
};
