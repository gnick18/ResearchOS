// Round-trip + edge tests for the PlotColorPicker HSV helpers. The picker drives
// a saturation / value square plus a hue strip, so the hex <-> HSV conversion has
// to survive a round trip closely enough that dragging never visibly shifts the
// color. We allow a 1-step rounding tolerance on each channel.

import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex } from "./PlotColorPicker";

function channels(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function closeHex(a: string, b: string, tol = 1) {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  expect(Math.abs(ar - br)).toBeLessThanOrEqual(tol);
  expect(Math.abs(ag - bg)).toBeLessThanOrEqual(tol);
  expect(Math.abs(ab - bb)).toBeLessThanOrEqual(tol);
}

describe("PlotColorPicker hex <-> hsv", () => {
  const samples = [
    "#000000",
    "#ffffff",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#264653",
    "#2a9d8f",
    "#e9c46a",
    "#1aa0e6",
    "#7f7f7f",
    "#123456",
    "#abcdef",
  ];

  it("round-trips each sample within one rounding step", () => {
    for (const hex of samples) {
      closeHex(hsvToHex(hexToHsv(hex)), hex);
    }
  });

  it("normalizes short hex and a missing hash", () => {
    closeHex(hsvToHex(hexToHsv("#f00")), "#ff0000");
    closeHex(hsvToHex(hexToHsv("264653")), "#264653");
  });

  it("maps pure primaries to the expected hue", () => {
    expect(Math.round(hexToHsv("#ff0000").h)).toBe(0);
    expect(Math.round(hexToHsv("#00ff00").h)).toBe(120);
    expect(Math.round(hexToHsv("#0000ff").h)).toBe(240);
  });

  it("treats black and white as zero saturation", () => {
    expect(hexToHsv("#000000").s).toBe(0);
    expect(hexToHsv("#000000").v).toBe(0);
    expect(hexToHsv("#ffffff").s).toBe(0);
    expect(hexToHsv("#ffffff").v).toBe(1);
  });

  it("falls back to a neutral gray for garbage input", () => {
    // normalizeHex inside hexToHsv defaults invalid input to #888888.
    closeHex(hsvToHex(hexToHsv("not-a-color")), "#888888");
  });

  it("always emits a canonical #rrggbb", () => {
    expect(hsvToHex({ h: 200, s: 0.5, v: 0.5 })).toMatch(/^#[0-9a-f]{6}$/);
  });
});
