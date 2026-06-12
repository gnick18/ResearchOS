import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NewAnalysisDialog from "../NewAnalysisDialog";

// NewAnalysisDialog "Help me choose" button (BeakerAI coordination, Data v2
// lane). When the AI assistant flag is on, the analysis chooser offers a
// hand-off to BeakerBot: clicking it closes the dialog, opens BeakerBot in Ask
// mode, and seeds the generic "help me choose" query (the bot resolves which
// table via its own context bridge). When the flag is off the button is absent.

const holder = vi.hoisted(() => ({ ai: true }));
const mockOpenBeakerBot = vi.hoisted(() => vi.fn());
const mockSendToBeakerBot = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/config", () => ({
  get AI_ASSISTANT_ENABLED() {
    return holder.ai;
  },
}));

vi.mock("@/components/beaker-search/BeakerSearchProvider", () => ({
  useBeakerSearch: () => ({ openBeakerBot: mockOpenBeakerBot }),
}));

vi.mock("@/components/ai/message-bridge", () => ({
  sendToBeakerBot: mockSendToBeakerBot,
}));

beforeEach(() => {
  holder.ai = true;
  mockOpenBeakerBot.mockClear();
  mockSendToBeakerBot.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("NewAnalysisDialog Help me choose", () => {
  it("hands off to BeakerBot and closes the dialog when clicked", () => {
    const onCancel = vi.fn();
    render(
      <NewAnalysisDialog
        open
        content={null}
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("datahub-help-me-choose"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockOpenBeakerBot).toHaveBeenCalledTimes(1);
    expect(mockSendToBeakerBot).toHaveBeenCalledWith(
      "help me choose an analysis for this table",
    );
  });

  it("hides the button when the AI assistant flag is off", () => {
    holder.ai = false;
    render(
      <NewAnalysisDialog
        open
        content={null}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("datahub-help-me-choose")).toBeNull();
  });
});
