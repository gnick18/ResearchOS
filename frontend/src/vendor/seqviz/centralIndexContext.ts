// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
import * as React from "react";

/** Default central index context object */
const defaultCentralIndex = {
  circular: 0,
  linear: 0,
  /** Incremented each time an explicit scroll-to-linear is requested, even if the position hasn't changed */
  linearScrollToken: 0,
  setCentralIndex: (_: "LINEAR" | "CIRCULAR", __: number) => {
    // do nothing
  },
};

/** The "central index" is used to scroll the linear or circular viewer when you click on an annotation */
const CentralIndexContext = React.createContext(defaultCentralIndex);
CentralIndexContext.displayName = "CentralIndexContext";

export default CentralIndexContext;
