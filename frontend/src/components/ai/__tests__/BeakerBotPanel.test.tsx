import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BeakerBotPanel from "../BeakerBotPanel";

// Render + streaming pin for the foundation BeakerBot panel. The panel mounts
// with an input and a send button, and on send it streams the assistant reply
// token-by-token from the (mocked) proxy. A separate case pins the graceful
// error path (the missing-key JSON error renders in the panel).

function streamingResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(new TextEncoder().encode(c));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function frame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BeakerBotPanel", () => {
  it("renders the input and send button", () => {
    render(<BeakerBotPanel />);
    expect(screen.getByTestId("beakerbot-input")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-send")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "BeakerBot" }),
    ).toBeInTheDocument();
  });

  it("streams the assistant reply into a bubble on send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamingResponse([frame("Tm is "), frame("58 C"), "data: [DONE]\n"]),
      ),
    );

    render(<BeakerBotPanel />);
    const input = screen.getByTestId("beakerbot-input");
    fireEvent.change(input, { target: { value: "what is the Tm?" } });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    // The user bubble appears immediately.
    expect(await screen.findByText("what is the Tm?")).toBeInTheDocument();

    // The streamed assistant reply accumulates.
    await waitFor(() => {
      expect(screen.getByText("Tm is 58 C")).toBeInTheDocument();
    });
  });

  it("shows the proxy error message in the panel when the key is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error:
              "BeakerBot has no model key configured. Add AI_API_KEY to frontend/.env.local and restart the dev server.",
          }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(<BeakerBotPanel />);
    fireEvent.change(screen.getByTestId("beakerbot-input"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    await waitFor(() => {
      expect(screen.getByTestId("beakerbot-error")).toHaveTextContent(
        /AI_API_KEY/,
      );
    });
  });
});
