import { describe, expect, it } from "vitest";
import { SseDeltaParser, accumulateSse } from "@/lib/ai/sse";

// Pins for the pure OpenAI-style SSE delta parser. The parser is the load-bearing
// piece of the streaming round-trip, so it is tested directly against sample
// frames, including the awkward cases: a [DONE] sentinel, chunk boundaries that
// split a single `data:` line, and a final line with no trailing newline.

function frame(content: string): string {
  return `data: ${JSON.stringify({
    choices: [{ delta: { content } }],
  })}\n`;
}

describe("SseDeltaParser", () => {
  it("accumulates content deltas across well-formed frames", () => {
    const parser = new SseDeltaParser();
    const r1 = parser.push(frame("Hello"));
    const r2 = parser.push(frame(", world"));
    expect(r1.deltas).toEqual(["Hello"]);
    expect(r2.deltas).toEqual([", world"]);
    expect(r1.done).toBe(false);
    expect([...r1.deltas, ...r2.deltas].join("")).toBe("Hello, world");
  });

  it("stops and reports done on the [DONE] sentinel", () => {
    const parser = new SseDeltaParser();
    parser.push(frame("Tm is "));
    const r = parser.push(frame("58 C") + "data: [DONE]\n");
    expect(r.deltas).toEqual(["58 C"]);
    expect(r.done).toBe(true);
    expect(parser.isDone).toBe(true);

    // Anything fed after DONE is ignored.
    const after = parser.push(frame("ignored"));
    expect(after.deltas).toEqual([]);
    expect(after.done).toBe(true);
  });

  it("reassembles a data line split across two chunks", () => {
    const parser = new SseDeltaParser();
    const full = frame("buffered");
    const cut = Math.floor(full.length / 2);
    const a = parser.push(full.slice(0, cut)); // partial line, no delta yet
    const b = parser.push(full.slice(cut)); // completes the line
    expect(a.deltas).toEqual([]);
    expect(b.deltas).toEqual(["buffered"]);
  });

  it("ignores blank lines, comments, and non-content frames", () => {
    const parser = new SseDeltaParser();
    const r = parser.push(
      "\n: keep-alive\n" +
        `data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n` +
        frame("real"),
    );
    expect(r.deltas).toEqual(["real"]);
  });

  it("ignores a malformed JSON frame instead of throwing", () => {
    const parser = new SseDeltaParser();
    const r = parser.push("data: {not valid json}\n" + frame("ok"));
    expect(r.deltas).toEqual(["ok"]);
  });

  it("flushes a final line that has no trailing newline", () => {
    const parser = new SseDeltaParser();
    const noNewline = frame("tail").replace(/\n$/, "");
    const pushed = parser.push(noNewline);
    expect(pushed.deltas).toEqual([]); // still buffered
    const flushed = parser.flush();
    expect(flushed.deltas).toEqual(["tail"]);
  });
});

describe("accumulateSse", () => {
  it("returns the full assistant text and done flag in one pass", () => {
    const raw =
      frame("The ") + frame("answer ") + frame("is 42.") + "data: [DONE]\n";
    const { text, done } = accumulateSse(raw);
    expect(text).toBe("The answer is 42.");
    expect(done).toBe(true);
  });

  it("returns done false when the stream has no DONE sentinel", () => {
    const { text, done } = accumulateSse(frame("partial"));
    expect(text).toBe("partial");
    expect(done).toBe(false);
  });
});
