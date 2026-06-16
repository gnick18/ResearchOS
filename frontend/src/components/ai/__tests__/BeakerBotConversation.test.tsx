import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BeakerBotConversation from "../BeakerBotConversation";
import {
  resetConversationModule,
  useConversationStore,
} from "@/lib/ai/conversation-store";

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

  it("opens a write_note draft in Canvas (pointer line, not a read-only card) and writes on Save", async () => {
    // Turn 1, the model drafts a note and calls write_note. The chat shows a
    // compact "Drafted in Canvas" pointer line (NOT a read-only Approve / Reject
    // card), and the Canvas panel docks with the draft. Save is the consent,
    // tapping it writes the note and the loop produces the answer.
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

    // The chat shows the Canvas pointer line, and the docked Canvas panel opens
    // with the draft title and a Save button. The OLD read-only draft card and
    // its Approve / Reject buttons are gone.
    await screen.findByTestId("beakerbot-canvas-pointer");
    expect(screen.queryByTestId("beakerbot-approval-draft")).toBeNull();
    expect(screen.queryByTestId("beakerbot-draft-approve")).toBeNull();
    const canvas = screen.getByTestId("beakerbot-canvas");
    expect(canvas).toHaveTextContent("qPCR summary");
    expect(screen.getByTestId("beakerbot-canvas-save")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-canvas-discard")).toBeInTheDocument();

    // Save is the consent, it writes the note and the loop continues.
    fireEvent.click(screen.getByTestId("beakerbot-canvas-save"));
    await waitFor(() => {
      expect(
        screen.getByText("Added the summary to a new note."),
      ).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("discards a Canvas draft gracefully without writing", async () => {
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

    // The Canvas panel docks. Discard asks for a confirm (a draft can hold real
    // edits), then throws the draft away and the loop continues.
    await screen.findByTestId("beakerbot-canvas");
    fireEvent.click(screen.getByTestId("beakerbot-canvas-discard"));
    fireEvent.click(screen.getByTestId("beakerbot-canvas-discard-confirm-btn"));
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

// ---- Composer: submit while a turn is streaming -----------------------------
//
// Regression for the silent-clear bug: pressing Enter to submit a message while
// the assistant is still streaming a previous turn used to clear the composer
// without sending or queuing the text, so the typed message was lost. The store
// already single-slot-queues a send issued mid-stream; these tests pin the
// composer wiring that reaches it. The preferred behavior is to queue the text
// (it shows in the "Queued" chip and auto-fires once the running turn settles),
// never to drop it.
describe("composer submit while a turn is in flight", () => {
  it("queues a message typed mid-stream and never silently clears the text", async () => {
    // A controllable in-flight turn: the first proxy call hangs (a pending
    // promise) so sending stays true. Later calls answer immediately.
    let releaseFirst!: (r: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValue(jsonResponse(finalAnswer("reply to the queued one")));
    vi.stubGlobal("fetch", fetchMock);

    render(<BeakerBotConversation />);
    const input = screen.getByTestId("beakerbot-input") as HTMLTextAreaElement;

    // Send the first message; it stays in flight while fetch hangs.
    fireEvent.change(input, { target: { value: "first message" } });
    fireEvent.click(screen.getByTestId("beakerbot-send"));

    // The turn is streaming once the Stop button replaces Send.
    await screen.findByTestId("beakerbot-stop");
    // The composer stays usable while streaming (no longer disabled), so a
    // follow-up can be typed and queued.
    expect(input.disabled).toBe(false);

    // Type a second message and press Enter WHILE the first is still streaming.
    fireEvent.change(input, { target: { value: "second message" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    // The composer clears (text is not left dangling) AND the text is preserved
    // in the queued chip, so nothing the user typed is silently lost.
    expect(input.value).toBe("");
    const queued = await screen.findByTestId("beakerbot-queued");
    expect(queued.textContent).toContain("second message");

    // The queued message must NOT be in the transcript yet (still waiting).
    expect(
      screen
        .queryAllByTestId("beakerbot-message-user")
        .map((el) => el.textContent),
    ).not.toContain("second message");

    // Release the in-flight turn; the queued message must auto-fire and land in
    // the transcript, and the queued chip clears.
    releaseFirst(jsonResponse(finalAnswer("reply to the first one")));
    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("beakerbot-message-user")
          .map((el) => el.textContent),
      ).toContain("second message");
    });
    await waitFor(() => {
      expect(screen.queryByTestId("beakerbot-queued")).toBeNull();
    });
  });

  it("does not clear the composer when Enter is pressed on empty input mid-stream", async () => {
    let releaseFirst!: (r: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValue(jsonResponse(finalAnswer("done")));
    vi.stubGlobal("fetch", fetchMock);

    render(<BeakerBotConversation />);
    const input = screen.getByTestId("beakerbot-input") as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "first message" } });
    fireEvent.click(screen.getByTestId("beakerbot-send"));
    await screen.findByTestId("beakerbot-stop");

    // An Enter with no typed text must be a no-op: nothing queued, nothing
    // cleared, no stray queued chip.
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(input.value).toBe("");
    expect(screen.queryByTestId("beakerbot-queued")).toBeNull();

    releaseFirst(jsonResponse(finalAnswer("done")));
    await waitFor(() => {
      expect(useConversationStore.getState().sending).toBe(false);
    });
  });
});
