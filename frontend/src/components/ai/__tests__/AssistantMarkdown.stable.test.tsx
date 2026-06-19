// Regression guard for the inline-embed scroll-flicker bug (BeakerAI lane,
// 2026-06-14). AssistantMarkdown's react-markdown `components` map MUST keep a
// stable identity (module scope) and the component MUST be memoized, so an inline
// ObjectEmbed (e.g. a phylo tree card) stays MOUNTED across parent re-renders
// instead of remounting and flashing back to its "loading" state. A remount on
// every parent re-render (token counter ticks, hover, status) was what made the
// tree embed cycle loading / fitted / oversized and yank the chat scroll.

import { describe, it, expect, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, act } from "@testing-library/react";

const mountSpy = vi.fn();
vi.mock("@/components/embeds/ObjectEmbed", () => {
  // Named with an uppercase identifier so it reads as a React component (the
  // rules-of-hooks lint requires the useEffect below to live in a component or
  // a custom hook, not an anonymous `default` arrow).
  function MockObjectEmbed() {
    useEffect(() => {
      mountSpy();
    }, []);
    return <div data-testid="emb" />;
  }
  return { default: MockObjectEmbed };
});

import { AssistantMarkdown } from "../BeakerBotConversation";

describe("AssistantMarkdown embed stability", () => {
  it("keeps an inline embed mounted across parent re-renders (no loading flash)", () => {
    mountSpy.mockClear();
    let force: () => void = () => {};
    function Parent() {
      const [, setN] = useState(0);
      force = () => setN((x) => x + 1);
      return (
        <div>
          <AssistantMarkdown content={"Here is your tree.\n\n[Tree](/phylo?doc=1#ros=studio)"} />
        </div>
      );
    }
    render(<Parent />);
    expect(screen.getByTestId("emb")).toBeTruthy();
    expect(mountSpy).toHaveBeenCalledTimes(1);

    // The parent re-renders several times with UNCHANGED embed content (the
    // real-world churn: a token counter, hover, status). The embed must not
    // remount. Before the fix (inline components, no memo) this was 4.
    act(() => {
      force();
      force();
      force();
    });
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });
});
