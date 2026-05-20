// Global setup for jsdom project (component tests, src/**/*.test.tsx).
// Loaded once per worker before each test file. Node-project tests don't
// hit this file.

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetVirtualFileSystem } from "./__mocks__/file-system-access";

// jsdom 27 does not implement Blob.prototype.text() / arrayBuffer(). Our app
// reads File contents with `file.text()` (see file-service.ts), so polyfill
// them once at the top of every jsdom test run.
if (typeof Blob !== "undefined" && typeof Blob.prototype.text !== "function") {
  Blob.prototype.text = function text(): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
if (typeof Blob !== "undefined" && typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  resetVirtualFileSystem();
});
