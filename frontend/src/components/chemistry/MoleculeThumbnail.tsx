"use client";

// 2D structure thumbnail for the chemistry library grid, the project Molecules
// section, and inline note blocks (chemistry-workbench Phase 1).
//
// Renders a structure (SMILES or Molfile) to an SVG with RDKit.js, fully in the
// browser. RDKit is browser-only and the wasm loads once then caches, so the
// first thumbnail on a page pays the load and the rest are instant. The SVG
// string RDKit returns is its own depiction (colored atoms), injected via
// dangerouslySetInnerHTML, the same pattern the mockup proved.

import { useEffect, useRef, useState } from "react";

import { renderSvg } from "@/lib/chemistry/rdkit";

// Module-level cache keyed by `${structure}@${w}x${h}`, so a molecule that shows
// in both the grid and a project section renders its wasm depiction once. Bounded
// (simple FIFO) so paging a large library does not grow it without limit, and we
// never cache an empty result so a transient RDKit load failure can retry.
const svgCache = new Map<string, string>();
const SVG_CACHE_MAX = 300;

function cacheSvg(key: string, svg: string) {
  if (!svg) return;
  if (svgCache.size >= SVG_CACHE_MAX) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }
  svgCache.set(key, svg);
}

export function MoleculeThumbnail({
  structure,
  width = 190,
  height = 134,
  className,
}: {
  /** A SMILES string or an MDL Molfile. */
  structure: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const cacheKey = `${structure}@${width}x${height}`;
  const [svg, setSvg] = useState<string>(() => svgCache.get(cacheKey) ?? "");
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const cached = svgCache.get(cacheKey);
    if (cached) {
      setSvg(cached);
      return;
    }
    if (!structure) {
      setSvg("");
      return;
    }
    let cancelled = false;
    renderSvg(structure, width, height)
      .then((out) => {
        if (cancelled || !aliveRef.current) return;
        cacheSvg(cacheKey, out);
        setSvg(out);
      })
      .catch(() => {
        if (!cancelled && aliveRef.current) setSvg("");
      });
    return () => {
      cancelled = true;
    };
  }, [structure, width, height, cacheKey]);

  if (!svg) {
    // Calm placeholder while the wasm depiction renders (or if it cannot parse).
    return (
      <div
        className={className}
        style={{ width, height }}
        aria-hidden
        data-molecule-thumb="pending"
      />
    );
  }

  return (
    <div
      className={className}
      style={{ width, height }}
      // RDKit emits a self-contained SVG element; we trust it (same-origin wasm).
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
