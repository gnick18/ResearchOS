// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
/**
 * Returns a function, that, as long as it continues to be invoked, will not
 * be triggered. The function will be called after it stops being called for
 * N milliseconds. If `immediate` is passed, trigger the function on the
 * leading edge, instead of the trailing.
 *
 * from: https://davidwalsh.name/javascript-debounce-function
 */
export default (func, wait, immediate = true) => {
  let timeout;
  return function (...args) {
    const later = function () {
      timeout = null;
      if (!immediate) func.apply(this, args);
    };

    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) {
      func.apply(this, args);
    }
  };
};
