import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BeakerBotConversation from "../BeakerBotConversation";
import { resetConversationModule } from "@/lib/ai/conversation-store";

// Render + agent-loop pin for the BeakerBot conversation body. This is the live
// component the BeakerSearch palette renders in Ask mode (the docked
// BeakerBotPanel was retired in Phase 4). It drives the browser agent loop,
// which posts to the proxy with stream:false and reads the provider JSON. These
// tests mock fetch (the proxy) so no model and no key are involved. They assert
// the final answer renders, that a tool round-trip works end to end (the loop
// calls the proxy twice, runs the tool locally, then renders the final answer),
// the proxy error surfaces in the body, assistant markdown renders as HTML
// elements (bold, lists), and user text is kept as plain text.
//
// Isolation note (ai convo-store bot, 2026-06-11): the conversation state is
// now module-level (Zustand store). Each test must reset it via
// resetConversationModule() so state from one test never leaks into the next.

// The conversation body reads the App Router via next/navigation (through the
// bridges and chip rendering). There is no router provider in these unit
// renders, so mock next/navigation with inert stubs.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The read tool reads from local-api. Mock it so the tool runs without a folder.
vi.mock("@/lib/ai/pdf-extract", () => ({
  extractPdfText: vi.fn(async () => ({ text: "", pageCount: 0, truncated: false })),
}));
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
  // write_note tools read + write through notesApi. Mock the three methods the
  // tools touch so the draft round-trip runs with no folder.
  notesApi: {
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: 42, title: "qPCR summary", entries: [] })),
    addEntry: vi.fn(async () => ({ id: 1, title: "qPCR optimization", entries: [] })),
  },
  // experiment-tools imports method-catalog (for method-template auto-attach),
  // whose DEFAULT_DEPS references these api objects at module load. The mocked
  // module must define them or vitest throws on the missing-export access. They
  // are only touched lazily inside tools the conversation test does not invoke,
  // so empty stubs (methodsApi gets a list for completeness) are enough.
  methodsApi: { list: vi.fn(async () => []) },
  pcrApi: {},
  lcGradientApi: {},
  plateApi: {},
  cellCultureApi: {},
  massSpecApi: {},
  filesApi: {},
  tasksApi: {},
  dependenciesApi: {},
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
  // Reset the module-level conversation store so each test starts with a clean
  // slate. Without this, a completed conversation from test N leaks messages
  // into test N+1 because the store is module-scoped, not component-scoped.
  resetConversationModule();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConversationModule();
});

describe("BeakerBotConversation", () => {
  it("renders the input and send button", () => {
    render(<BeakerBotConversation />);
    expect(screen.getByTestId("beakerbot-input")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-send")).toBeInTheDocument();
    // The "BeakerBot" heading lives in the retired panel chrome, not the
    // conversation body, so it is no longer asserted here.
  });

  it("renders a direct answer from the loop (no tool call)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(finalAnswer("A Tm is a melting temperature.")),
      ),
    );

    render(<BeakerBotConversation />);
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

    render(<BeakerBotConversation />);
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

    render(<BeakerBotConversation />);
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

    render(<BeakerBotConversation />);
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

  it("renders a plan proposal with Approve / Cancel and its steps", async () => {
    // Turn 1, the model proposes a plan. The panel should show the steps with an
    // Approve and a Cancel button (the plan shape), NOT the single-action Allow /
    // Skip.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          toolCall("propose_plan", {
            steps: ["Go to the Methods page", "Click the New Method button"],
            summary: "Open the new method form",
          }),
        ),
      )
      // The loop will pause on the plan approval, so no second proxy call happens
      // until the user answers. Provide a follow-up answer for after approve.
      .mockResolvedValueOnce(jsonResponse(finalAnswer("Opened the form.")));
    vi.stubGlobal("fetch", fetchMock);

    render(<BeakerBotConversation />);
    fireEvent.change(screen.getByTestId("beakerbot-input"), {
      target: { value: "open the new method form for me" },
    });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    // The plan prompt appears with both steps and the Approve / Cancel controls.
    const plan = await screen.findByTestId("beakerbot-approval-plan");
    expect(plan).toHaveTextContent("Go to the Methods page");
    expect(plan).toHaveTextContent("Click the New Method button");
    expect(screen.getByTestId("beakerbot-approval-approve")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-approval-cancel")).toBeInTheDocument();
    // The single-action prompt is NOT shown for a plan.
    expect(screen.queryByTestId("beakerbot-approval")).toBeNull();
  });

  it("renders an ask_user choice as buttons and resolves single-select on a tap", async () => {
    // Turn 1, the model asks the user to pick a table. The panel renders a button
    // per option. Tapping one resolves the choice (no Confirm step for single
    // select), the loop continues, and the final answer renders.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          toolCall("ask_user", {
            question: "Which table would you like to analyze?",
            options: ["qPCR table", "Growth assay"],
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(finalAnswer("Analyzing the Growth assay.")),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<BeakerBotConversation />);
    fireEvent.change(screen.getByTestId("beakerbot-input"), {
      target: { value: "analyze my data" },
    });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    // The choice prompt appears with the question and a button per option.
    const choice = await screen.findByTestId("beakerbot-choice");
    expect(choice).toHaveTextContent("Which table would you like to analyze?");
    const buttons = screen.getAllByTestId("beakerbot-choice-option");
    expect(buttons).toHaveLength(2);
    // Single-select has no Confirm button.
    expect(screen.queryByTestId("beakerbot-choice-confirm")).toBeNull();

    // Tapping one option resolves the choice and the loop produces the answer.
    fireEvent.click(buttons[1]);
    await waitFor(() => {
      expect(
        screen.getByText("Analyzing the Growth assay."),
      ).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders a multi-select ask_user, enables Confirm only at the exact count, and resolves with the array", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          toolCall("ask_user", {
            question: "Which two groups would you like to compare?",
            options: ["Control", "Drug A", "Drug B"],
            select: "multiple",
            count: 2,
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(finalAnswer("Comparing Control and Drug B.")),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<BeakerBotConversation />);
    fireEvent.change(screen.getByTestId("beakerbot-input"), {
      target: { value: "run a t-test" },
    });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    const choice = await screen.findByTestId("beakerbot-choice");
    expect(choice).toHaveTextContent(
      "Which two groups would you like to compare?",
    );
    const options = screen.getAllByTestId("beakerbot-choice-option");
    expect(options).toHaveLength(3);

    const confirm = screen.getByTestId(
      "beakerbot-choice-confirm",
    ) as HTMLButtonElement;
    // Confirm starts disabled (zero picked, need exactly two).
    expect(confirm.disabled).toBe(true);

    // One pick, still disabled (need exactly two).
    fireEvent.click(options[0]);
    expect(confirm.disabled).toBe(true);

    // Two picks, now enabled.
    fireEvent.click(options[2]);
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);
    await waitFor(() => {
      expect(
        screen.getByText("Comparing Control and Drug B."),
      ).toBeInTheDocument();
    });
  });

  it("resolves an ask_user choice gracefully when the user cancels", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          toolCall("ask_user", {
            question: "Which group?",
            options: ["Control", "Drug"],
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(finalAnswer("No problem, tell me when you decide.")),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<BeakerBotConversation />);
    fireEvent.change(screen.getByTestId("beakerbot-input"), {
      target: { value: "compare groups" },
    });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    await screen.findByTestId("beakerbot-choice");
    fireEvent.click(screen.getByTestId("beakerbot-choice-cancel"));
    await waitFor(() => {
      expect(
        screen.getByText("No problem, tell me when you decide."),
      ).toBeInTheDocument();
    });
  });

  it("renders a write_note draft preview with Approve / Reject and writes on Approve", async () => {
    // Turn 1, the model drafts a note and calls write_note. The panel pauses on a
    // DRAFT preview, the proposed content rendered as markdown, with Approve and
    // Reject. Tapping Approve writes the note and the loop produces the answer.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          toolCall("write_note", {
            target: "new",
            title: "qPCR summary",
            content: "## Results\n**Significant** difference between groups.",
            mode: "create",
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(finalAnswer("Added the summary to a new note.")),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<BeakerBotConversation />);
    fireEvent.change(screen.getByTestId("beakerbot-input"), {
      target: { value: "summarize the result into a new note called qPCR summary" },
    });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    // The draft preview appears with the proposed content rendered as real HTML
    // (a <strong> means the markdown was parsed, not shown raw), plus the
    // Approve / Reject controls. The one-line action confirm is NOT shown.
    const draft = await screen.findByTestId("beakerbot-approval-draft");
    expect(draft).toHaveTextContent("Significant");
    const preview = screen.getByTestId("beakerbot-draft-preview");
    expect(preview.querySelector("strong")?.textContent).toBe("Significant");
    expect(screen.getByTestId("beakerbot-draft-approve")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-draft-reject")).toBeInTheDocument();
    expect(screen.queryByTestId("beakerbot-approval")).toBeNull();

    // Approving writes the note and the loop continues to the final answer.
    fireEvent.click(screen.getByTestId("beakerbot-draft-approve"));
    await waitFor(() => {
      expect(
        screen.getByText("Added the summary to a new note."),
      ).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a write_note draft gracefully without writing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          toolCall("write_note", {
            target: "new",
            title: "draft",
            content: "Some drafted content.",
            mode: "create",
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(finalAnswer("No problem, I will not write it.")),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<BeakerBotConversation />);
    fireEvent.change(screen.getByTestId("beakerbot-input"), {
      target: { value: "draft a note" },
    });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    await screen.findByTestId("beakerbot-approval-draft");
    fireEvent.click(screen.getByTestId("beakerbot-draft-reject"));
    await waitFor(() => {
      expect(
        screen.getByText("No problem, I will not write it."),
      ).toBeInTheDocument();
    });
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

    render(<BeakerBotConversation />);
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
