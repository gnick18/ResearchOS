// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import * as React from "react";
import { Root, createRoot } from "react-dom/client";

import Circular from "./Circular/Circular";
import Linear from "./Linear/Linear";
import SeqViz, { SeqVizProps } from "./SeqViz";
import enzymes from "./enzymes";

/**
 * Export a React component directly for React-based development
 */
export { Circular, enzymes as Enzymes, Linear, SeqViz };

export default SeqViz;

export type { SeqVizProps } from "./SeqViz";

export type { CircularProps } from "./Circular/Circular";

export type { LinearProps } from "./Linear/Linear";

/**
 * Return a Viewer object with three properties:
 *  - `render` to an HTML element
 *  - `setState(options)` to update the viewer's internal state
 *  - `renderToString` to return an HTML representation of the Viewer
 */
const Viewer = (element: string | HTMLElement = "root", options: SeqVizProps) => {
  // used to keep track of whether to re-render after a "set" call
  let root: Root | null = null;
  // get the HTML element by ID or use as is if passed directly
  let domElement: HTMLElement | null;
  if (!document) return;

  if (typeof element === "string") {
    if (document.getElementById(element)) {
      domElement = document.getElementById(element);
    } else {
      throw new Error(`Failed to find an element with ID: ${element}`);
    }
  } else {
    domElement = element;
  }
  let viewer = React.createElement(SeqViz, options, null);

  /**
   * Render the Viewer to the element passed
   */
  const render = () => {
    if (!root && domElement) {
      root = createRoot(domElement);
    }
    root?.render(viewer);
    return viewer;
  };

  /**
   * Return an HTML string representation of the viewer.
   * seqviz spike bot: the upstream implementation used `require("react-dom/server")`.
   * We removed it to keep the vendored module free of server-only imports in the
   * client bundle. The React component (`SeqViz`) is the supported entry point for
   * this spike; the imperative Viewer.renderToString path is not used.
   */
  const renderToString = () => {
    throw new Error("seqviz spike: Viewer.renderToString is not available in the vendored build.");
  };

  /**
   * Update the viewer with new settings. Re-renders if render was already called.
   */
  const setState = (state: SeqVizProps) => {
    options = { ...options, ...state };
    viewer = React.createElement(SeqViz, options, null);

    if (root) {
      root.render(viewer);
    }
    return viewer;
  };

  return {
    render,
    renderToString,
    setState,
  };
};

export { Viewer };
