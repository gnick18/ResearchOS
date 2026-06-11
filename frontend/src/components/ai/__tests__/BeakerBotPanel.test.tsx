import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BeakerBotPanel from "../BeakerBotPanel";

// Render + agent-loop pin for the BeakerBot panel. The panel now drives the
// browser agent loop, which posts to the proxy with stream:false and reads the
// provider JSON. These tests mock fetch (the proxy) so no model and no key are
// involved. They assert the final answer renders, that a tool round-trip works end
// to end (the loop calls the proxy twice, runs the tool locally, then renders the
// final answer), the proxy error surfaces in the panel, assistant markdown renders
// as HTML elements (bold, lists), and user text is kept as plain text.

// The panel now mounts the navigation bridge (useNavigationBridge), which reads
// the App Router via next/navigation. There is no router provider in these unit
// renders, so mock next/navigation with inert stubs. The bridge only registers a
// handler here, it does not navigate during these tests.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The read tool reads from local-api. Mock it so the tool runs without a folder.
vi.mock("@/lib/local-api", () => ({
  fetchAllTasksIncludingShared: vi.fn(async () => [
    {
      id: 1,
      project_id: 10,
      name: "Run the PCR",
      start_date: "2026-06-01",
      end_date: "2999-01-01",
      duration_days: 1,
      is_complete: false,
      task_type: "experiment",
      method_ids: [],
      method_attachments: [],
      sub_tasks: null,
      tags: null,
      owner: "me",
      shared_with: [],
      weekend_override: null,
      deviation_log: null,
      experiment_color: null,
      is_high_level: false,
      sort_order: 0,
    },
  ]),
  projectsApi: {
    list: vi.fn(async () => [
      {
        id: 10,
        name: "PCR optimization",
        is_archived: false,
        owner: "me",
        shared_with: [],
        weekend_active: false,
        tags: null,
        color: null,
        created_at: "2026-06-01",
        sort_order: 0,
        archived_at: null,
      },
    ]),
  },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function finalAnswer(content: string) {
  return { choices: [{ message: { role: "assistant", content } }] };
}

function toolCall(name: string, args: object) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

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

  it("renders a direct answer from the loop (no tool call)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(finalAnswer("A Tm is a melting temperature.")),
      ),
    );

    render(<BeakerBotPanel />);
    fireEvent.change(screen.getByTestId("beakerbot-input"), {
      target: { value: "what is a Tm?" },
    });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    expect(await screen.findByText("what is a Tm?")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText("A Tm is a melting temperature."),
      ).toBeInTheDocument();
    });
  });

  it("runs a tool round-trip and answers from the tool result", async () => {
    // Turn 1, the model asks for get_my_tasks. Turn 2, after the tool result, it
    // answers. The panel renders the final answer.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(toolCall("get_my_tasks", {})))
      .mockResolvedValueOnce(
        jsonResponse(finalAnswer("You are working on Run the PCR.")),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<BeakerBotPanel />);
    fireEvent.change(screen.getByTestId("beakerbot-input"), {
      target: { value: "what am I working on today?" },
    });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    await waitFor(() => {
      expect(
        screen.getByText("You are working on Run the PCR."),
      ).toBeInTheDocument();
    });
    // The loop made two proxy calls (tool turn + final-answer turn).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders assistant markdown as HTML elements (bold, list items)", async () => {
    // The model returns markdown. The panel should convert it to real HTML.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          finalAnswer(
            "Here are two things:\n- **Run the PCR** today\n- Check your results",
          ),
        ),
      ),
    );

    render(<BeakerBotPanel />);
    fireEvent.change(screen.getByTestId("beakerbot-input"), {
      target: { value: "what should I do?" },
    });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    // A <strong> element means **bold** was parsed, not shown as raw asterisks.
    await waitFor(() => {
      const strong = document.querySelector(
        "[data-testid='beakerbot-message-assistant'] strong",
      );
      expect(strong).not.toBeNull();
      expect(strong?.textContent).toBe("Run the PCR");
    });

    // The list item should also be a real <li>, not raw text with a leading dash.
    const listItems = document.querySelectorAll(
      "[data-testid='beakerbot-message-assistant'] li",
    );
    expect(listItems.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps user message as plain text even when it contains markdown syntax", async () => {
    // User input must never be parsed as markdown. Asterisks and backticks
    // should appear literally in the bubble, not become bold or code elements.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(finalAnswer("ok"))),
    );

    render(<BeakerBotPanel />);
    const markdownInput = "**bold** and `code`";
    fireEvent.change(screen.getByTestId("beakerbot-input"), {
      target: { value: markdownInput },
    });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    // The user bubble should contain the raw string, not parsed HTML.
    const userBubble = await screen.findByTestId("beakerbot-message-user");
    expect(userBubble.textContent).toBe(markdownInput);
    // No <strong> or <code> injected into the user bubble.
    expect(userBubble.querySelector("strong")).toBeNull();
    expect(userBubble.querySelector("code")).toBeNull();
  });

  it("shows the proxy error message in the panel when the key is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error:
              "BeakerBot has no model key configured. Add AI_API_KEY to frontend/.env.local and restart the dev server.",
          },
          500,
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
