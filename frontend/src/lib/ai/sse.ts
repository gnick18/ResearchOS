// OpenAI-style SSE delta parsing (ai foundation bot, 2026-06-10).
//
// The model provider streams its reply as Server-Sent Events: a sequence of
// `data: { ... }` lines, each carrying a `choices[0].delta.content` fragment,
// terminated by a `data: [DONE]` line. This module is the pure, side-effect-free
// parser for that format, kept separate from the React panel so it can be
// unit-tested directly against sample chunks.
//
// Network reads arrive in arbitrary chunk boundaries (a single `data:` line can
// be split across two reads), so the parser is stateful: feed it raw decoded
// chunks in order and it buffers a partial trailing line until the next chunk
// completes it.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export type SseParseResult = {
  // The newly-decoded text fragments from this chunk, in order. Concatenate them
  // onto the running assistant message.
  deltas: string[];
  // True once the terminating [DONE] sentinel has been seen.
  done: boolean;
};

/** A stateful incremental parser. Create one per stream, feed it decoded chunks
 *  with `push`, and read the deltas it returns. */
export class SseDeltaParser {
  // Holds a partial trailing line that has not yet been terminated by a newline.
  private buffer = "";
  private finished = false;

  /** Feed one decoded chunk of the stream. Returns the new content deltas plus
   *  whether the stream is done. */
  push(chunk: string): SseParseResult {
    const deltas: string[] = [];
    if (this.finished) {
      return { deltas, done: true };
    }

    this.buffer += chunk;
    // Split on newlines, keeping the last (possibly partial) segment buffered.
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const delta = this.consumeLine(rawLine);
      if (delta === DONE) {
        this.finished = true;
        return { deltas, done: true };
      }
      if (delta) deltas.push(delta);
    }

    return { deltas, done: false };
  }

  /** Flush any complete line left in the buffer at end-of-stream (a final line
   *  with no trailing newline). Returns leftover deltas plus the done flag. */
  flush(): SseParseResult {
    const deltas: string[] = [];
    if (this.finished) return { deltas, done: true };
    const remainder = this.buffer;
    this.buffer = "";
    if (remainder.trim().length === 0) {
      return { deltas, done: this.finished };
    }
    const delta = this.consumeLine(remainder);
    if (delta === DONE) {
      this.finished = true;
      return { deltas, done: true };
    }
    if (delta) deltas.push(delta);
    return { deltas, done: this.finished };
  }

  get isDone(): boolean {
    return this.finished;
  }

  // Parse a single line. Returns a content string, the DONE sentinel, or null
  // for lines that carry no content (blank lines, comments, non-data fields,
  // unparseable JSON).
  private consumeLine(rawLine: string): string | typeof DONE | null {
    const line = rawLine.trimEnd();
    if (!line.startsWith("data:")) return null;
    const payload = line.slice("data:".length).trim();
    if (payload.length === 0) return null;
    if (payload === "[DONE]") return DONE;

    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: unknown } }>;
      };
      const content = parsed.choices?.[0]?.delta?.content;
      return typeof content === "string" && content.length > 0 ? content : null;
    } catch {
      // A malformed or partial JSON payload is ignored rather than throwing, so
      // one bad frame never aborts the stream.
      return null;
    }
  }
}

const DONE = Symbol("sse-done");

/** Convenience for tests and simple callers: parse a complete SSE string in one
 *  pass and return the fully-accumulated assistant text plus whether DONE was
 *  seen. */
export function accumulateSse(raw: string): { text: string; done: boolean } {
  const parser = new SseDeltaParser();
  const pushResult = parser.push(raw);
  const flushResult = parser.flush();
  const deltas = [...pushResult.deltas, ...flushResult.deltas];
  return { text: deltas.join(""), done: pushResult.done || flushResult.done };
}
