// sequence Phase 1 bot — minimal local shim for the small subset of `lodash-es`
// used by the vendored bio-parsers GenBank/FASTA path. We vendor the parser
// source no-install (mirroring the SeqViz spike's `react-resize-detector`
// shim), so its `lodash-es` imports resolve here instead of pulling the npm
// package into the bundle. Only the functions actually imported across the
// genbank+fasta closure are implemented:
//   get, cloneDeep, map, each, forEach, filter, some, isObject, flatMap,
//   upperFirst, keyBy, debounce, uniq, isFunction
// Semantics match lodash for the inputs the parsers pass (plain objects /
// arrays / strings). Not a general-purpose lodash replacement.

export function get(obj, path, defaultValue) {
  if (obj == null) return defaultValue;
  const parts = Array.isArray(path) ? path : String(path).split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return defaultValue;
    cur = cur[part];
  }
  return cur === undefined ? defaultValue : cur;
}

export function cloneDeep(value) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map((v) => cloneDeep(v));
  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = cloneDeep(value[key]);
  }
  return out;
}

function iterate(collection, iteratee) {
  if (collection == null) return;
  if (Array.isArray(collection)) {
    for (let i = 0; i < collection.length; i++) iteratee(collection[i], i, collection);
  } else if (typeof collection === "object") {
    for (const key of Object.keys(collection)) iteratee(collection[key], key, collection);
  }
}

export function each(collection, iteratee) {
  iterate(collection, iteratee);
  return collection;
}

export const forEach = each;

export function map(collection, iteratee) {
  const out = [];
  if (collection == null) return out;
  // lodash `map(undefined)` -> []; `map(value)` with no iteratee -> identity
  const fn = typeof iteratee === "function" ? iteratee : (v) => v;
  iterate(collection, (value, key, coll) => {
    out.push(fn(value, key, coll));
  });
  return out;
}

export function filter(collection, predicate) {
  const out = [];
  const fn = typeof predicate === "function" ? predicate : (v) => v;
  iterate(collection, (value, key, coll) => {
    if (fn(value, key, coll)) out.push(value);
  });
  return out;
}

export function some(collection, predicate) {
  let found = false;
  const fn = typeof predicate === "function" ? predicate : (v) => v;
  if (collection == null) return false;
  if (Array.isArray(collection)) {
    for (let i = 0; i < collection.length; i++) {
      if (fn(collection[i], i, collection)) return true;
    }
    return false;
  }
  iterate(collection, (value, key, coll) => {
    if (!found && fn(value, key, coll)) found = true;
  });
  return found;
}

export function isObject(value) {
  const type = typeof value;
  return value != null && (type === "object" || type === "function");
}

export function flatMap(collection, iteratee) {
  const fn = typeof iteratee === "function" ? iteratee : (v) => v;
  const out = [];
  iterate(collection, (value, key, coll) => {
    const res = fn(value, key, coll);
    if (Array.isArray(res)) {
      for (const r of res) out.push(r);
    } else {
      out.push(res);
    }
  });
  return out;
}

export function upperFirst(str) {
  if (!str) return "";
  const s = String(str);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function keyBy(collection, iteratee) {
  const out = {};
  const fn =
    typeof iteratee === "function" ? iteratee : (v) => (v == null ? v : v[iteratee]);
  iterate(collection, (value) => {
    out[fn(value)] = value;
  });
  return out;
}

export function uniq(array) {
  if (!Array.isArray(array)) return [];
  return Array.from(new Set(array));
}

export function isFunction(value) {
  return typeof value === "function";
}

export function debounce(fn, wait = 0) {
  // The only consumer in the vendored path is `filterSequenceString`'s
  // toast-warning batcher, which calls `.cancel()` then re-invokes. Provide a
  // real trailing-edge debounce with a `.cancel()` method so that call shape
  // works. Toasts depend on `window.toastr`, which the app doesn't define, so
  // this is effectively inert here but kept faithful.
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}

export default {
  get,
  cloneDeep,
  map,
  each,
  forEach,
  filter,
  some,
  isObject,
  flatMap,
  upperFirst,
  keyBy,
  uniq,
  isFunction,
  debounce,
};
