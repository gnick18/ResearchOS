// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
/**
 * Deep equality comparison between two objects
 *
 * copy-paste from StackOverflow: https://stackoverflow.com/a/25456134
 *
 */
export const isEqual = (x, y) => {
  if (x === y) {
    return true;
  } else if (typeof x === "object" && x !== null && typeof y === "object" && y !== null) {
    if (Object.keys(x).length !== Object.keys(y).length) return false;

    for (const prop in x) {
      if (Object.prototype.hasOwnProperty.call(y, prop)) {
        if (!isEqual(x[prop], y[prop])) return false;
      } else return false;
    }

    return true;
  }
  return false;
};
