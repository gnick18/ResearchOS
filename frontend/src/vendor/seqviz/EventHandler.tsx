// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import * as React from "react";

import CentralIndexContext from "./centralIndexContext";
import debounce from "./debounce";
import { Selection } from "./selectionContext";

// sequence Phase 2a bot — an edit intent emitted by the EventHandler when the
// viewer is `editable` and the user types/deletes at the caret or selection.
// The host (ResearchOS edit view) owns the document and applies these.
export type SeqEdit =
  | { type: "insert"; at: number; text: string }
  | { type: "delete"; from: number; count: number }
  | { type: "replace"; from: number; to: number; text: string };

export interface EventsHandlerProps {
  bpsPerBlock: number;
  children: React.ReactNode;
  copyEvent: (e: React.KeyboardEvent<HTMLElement>) => boolean;
  handleMouseEvent: (e: any) => void;
  selectAllEvent: (e: React.KeyboardEvent<HTMLElement>) => boolean;
  selection: Selection;
  seq: string;
  setSelection: (selection: Selection) => void;
  /** sequence Phase 2a bot — when true, printable keys / Backspace / Delete
   *  produce edits via `onEdit` instead of falling through. */
  editable?: boolean;
  /** sequence Phase 2a bot. Host callback fired with an edit intent. The host
   *  may filter the edit (e.g. drop invalid bases) and returns the number of
   *  characters it actually applied, so the caret advances by the accepted
   *  count rather than the raw keystroke length. Returning void/undefined means
   *  "applied as-is" (legacy behavior). */
  onEdit?: (edit: SeqEdit) => number | void;
}

/**
 * EventHandler handles the routing of all events, including keypresses, mouse clicks, etc.
 */
export class EventHandler extends React.PureComponent<EventsHandlerProps> {
  static contextType = CentralIndexContext;
  static context: React.ContextType<typeof CentralIndexContext>;
  declare context: React.ContextType<typeof CentralIndexContext>;

  clickedOnce: EventTarget | null = null;
  clickedTwice: EventTarget | null = null;

  /**
   * action handler for a keyboard keypresses.
   */
  handleKeyPress = (e: React.KeyboardEvent<HTMLElement>) => {
    // sequence Phase 2a bot — in editable mode, handle the keys that upstream
    // SeqViz lets fall through: printable bases (insert/replace) and Backspace/
    // Delete. Copy/SelectAll/arrows still route through keypressMap below, so
    // existing selection + navigation behavior is unchanged.
    if (this.props.editable && this.handleEditKey(e)) {
      return;
    }

    const keyType = this.keypressMap(e);
    if (!keyType) {
      return; // not recognized key
    }
    e.preventDefault();
    this.handleSeqInteraction(keyType);
  };

  /**
   * sequence Phase 2a bot — edit-mode key handling. Returns true if the key was
   * consumed as an edit. Emits an edit intent through `onEdit`; the host applies
   * it to the document and feeds the new `seq`/`annotations` back as props.
   */
  handleEditKey = (e: React.KeyboardEvent<HTMLElement>): boolean => {
    const { onEdit, selection, setSelection } = this.props;
    if (!onEdit) return false;

    // Never swallow modifier combos (copy, select-all, paste, undo, etc.).
    if (e.metaKey || e.ctrlKey || e.altKey) return false;

    const start = typeof selection.start === "number" ? selection.start : 0;
    const end = typeof selection.end === "number" ? selection.end : start;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const hasRange = hi > lo;

    // Collapse the internal selection to a caret at a given index. Keeps the
    // caret tracking the edit so the next keystroke lands in the right place.
    const placeCaret = (pos: number) => {
      setSelection({ clockwise: true, end: pos, start: pos, type: "SEQ" });
    };

    if (e.key === "Backspace") {
      e.preventDefault();
      if (hasRange) {
        onEdit({ type: "delete", from: lo, count: hi - lo });
        placeCaret(lo);
      } else if (lo > 0) {
        // delete the base BEFORE the caret
        onEdit({ type: "delete", from: lo - 1, count: 1 });
        placeCaret(lo - 1);
      }
      return true;
    }

    if (e.key === "Delete") {
      e.preventDefault();
      if (hasRange) {
        onEdit({ type: "delete", from: lo, count: hi - lo });
        placeCaret(lo);
      } else if (lo < this.props.seq.length) {
        // delete the base AT the caret (forward delete); caret stays put
        onEdit({ type: "delete", from: lo, count: 1 });
        placeCaret(lo);
      }
      return true;
    }

    // Printable single character: a base to type. Reject anything that isn't a
    // lone printable key (e.g. "Enter", "Tab", "ArrowLeft" have length > 1).
    if (e.key.length === 1 && !/\s/.test(e.key)) {
      e.preventDefault();
      if (hasRange) {
        const accepted = onEdit({ type: "replace", from: lo, to: hi, text: e.key });
        const n = typeof accepted === "number" ? accepted : e.key.length;
        // Only collapse the selection when the host actually replaced it; an
        // invalid key (n === 0) is a no-op and must leave the selection intact.
        if (n > 0) placeCaret(lo + n);
      } else {
        const accepted = onEdit({ type: "insert", at: lo, text: e.key });
        const n = typeof accepted === "number" ? accepted : e.key.length;
        // n === 0 means the key was dropped; caret stays put (placeCaret(lo)).
        placeCaret(lo + n);
      }
      return true;
    }

    return false;
  };

  /**
   * maps a keypress to an interaction (String)
   *
   * ["All", "Copy", "Up", "Right", "Down", "Left"]
   */
  keypressMap = (e: React.KeyboardEvent<HTMLElement>) => {
    const { copyEvent, selectAllEvent } = this.props;

    if (copyEvent && copyEvent(e)) {
      return "Copy";
    }

    if (selectAllEvent && selectAllEvent(e)) {
      return "SelectAll";
    }

    const { key, shiftKey } = e;
    switch (key) {
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        return shiftKey ? `Shift${key}` : key;
      default:
        return null;
    }
  };

  /**
   * Respond to any of:
   * 	All: cmd + A, select all
   * 	Copy: cmd + C, copy
   * 	Up, Right, Down, Left: some directional movement of the cursor
   */
  handleSeqInteraction = async type => {
    const { seq } = this.props;
    const seqLength = seq.length;
    const bpsPerBlock = this.props.bpsPerBlock || 1;

    switch (type) {
      case "SelectAll": {
        this.selectAllHotkey();
        break;
      }
      case "Copy": {
        this.handleCopy();
        break;
      }
      case "ArrowUp":
      case "ArrowRight":
      case "ArrowDown":
      case "ArrowLeft":
      case "ShiftArrowUp":
      case "ShiftArrowRight":
      case "ShiftArrowDown":
      case "ShiftArrowLeft": {
        const { selection, setSelection } = this.props;
        const { end, start } = selection;

        if (typeof start === "undefined" || typeof end === "undefined") {
          return;
        }

        let { clockwise } = selection;
        let newPos = end;
        if (type === "ArrowUp" || type === "ShiftArrowUp") {
          // if there are multiple blocks or just one. If one, just inc by one
          if (seqLength / bpsPerBlock > 1) {
            newPos -= bpsPerBlock;
          } else {
            newPos -= 1;
          }
        } else if (type === "ArrowRight" || type === "ShiftArrowRight") {
          newPos += 1;
        } else if (type === "ArrowDown" || type === "ShiftArrowDown") {
          // if there are multiple blocks or just one. If one, just inc by one
          if (seqLength / bpsPerBlock > 1) {
            newPos += bpsPerBlock;
          } else {
            newPos += 1;
          }
        } else if (type === "ArrowLeft" || type === "ShiftArrowLeft") {
          newPos -= 1;
        }

        if (newPos <= -1) {
          newPos = seqLength + newPos;
        }
        if (newPos >= seqLength + 1) {
          newPos -= seqLength;
        }
        const selLength = Math.abs(start - end);
        clockwise =
          selLength === 0
            ? type === "ArrowRight" || type === "ShiftArrowRight" || type === "ArrowDown" || type === "ShiftArrowDown"
            : clockwise;
        if (newPos !== start && !type.startsWith("Shift")) {
          setSelection({
            clockwise: true,
            end: newPos,
            start: newPos,
            type: "SEQ",
          });
        } else if (type.startsWith("Shift")) {
          setSelection({
            clockwise: clockwise,
            end: newPos,
            start: start,
            type: "SEQ",
          });
        }
        break;
      }
      default: {
        break;
      }
    }
  };

  /**
   * Copy the current sequence selection to the user's clipboard
   */
  handleCopy = () => {
    const {
      selection: { end, ref, start },
      seq,
    } = this.props;

    if (!document) return;

    const formerFocus = document.activeElement;
    const tempNode = document.createElement("textarea");
    if (ref === "ALL") {
      tempNode.innerText = seq;
    } else {
      tempNode.innerText = seq.substring(start || 0, end);
    }
    if (document.body) {
      document.body.appendChild(tempNode);
    }
    tempNode.select();
    document.execCommand("copy");
    tempNode.remove();
    if (formerFocus) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'focus' does not exist on type 'Element'.
      formerFocus.focus();
    }
  };

  /**
   * select all of the sequence
   */
  selectAllHotkey = () => {
    const { selection, seq, setSelection } = this.props;

    const newSelection = {
      ...selection,
      clockwise: true,
      end: seq.length,
      start: 0,
    };

    setSelection(newSelection);
  };

  handleTripleClick = () => {
    this.selectAllHotkey();
  };

  resetClicked = debounce(() => {
    this.clickedOnce = null;
    this.clickedTwice = null;
  }, 250);

  /**
   * if the contextMenu button is clicked, check whether it was clicked
   * over a noteworthy element, for which db mutations have been written.
   *
   * if it is, mutate the contextMenu to account for those potential interactions
   * and pass on the click. Otherwise, do nothing
   *
   * if it is a regular click, pass on as normal
   */
  handleMouseEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const { handleMouseEvent } = this.props;

    if (e.type === "mouseup") {
      this.resetClicked();
      if (this.clickedOnce === e.target && this.clickedTwice === e.target) {
        this.handleTripleClick();
        this.resetClicked();
      } else if (this.clickedOnce === e.target && this.clickedTwice === null) {
        this.clickedOnce = e.target;
        this.clickedTwice = e.target;
        this.resetClicked();
      } else {
        this.clickedOnce = e.target;
        this.resetClicked();
      }
    }
    const { button, ctrlKey, type } = e;
    const ctxMenuClick = type === "mousedown" && button === 0 && ctrlKey;

    if (e.button === 0 && !ctxMenuClick) {
      // it's a mouse drag event or an element was clicked
      handleMouseEvent(e);
    }
  };

  render = () => (
    <div
      className="la-vz-viewer-event-router"
      id="la-vz-event-router"
      role="presentation"
      style={{
        display: "flex",
        flexDirection: "row",
        height: "100%",
        outline: "none",
        position: "absolute",
        width: "100%",
      }}
      tabIndex={-1}
      onKeyDown={this.handleKeyPress}
      onMouseDown={this.handleMouseEvent}
      onMouseMove={this.props.handleMouseEvent}
      onMouseUp={this.handleMouseEvent}
    >
      {this.props.children}
    </div>
  );
}
