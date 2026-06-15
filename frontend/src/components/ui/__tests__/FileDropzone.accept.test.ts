import { describe, expect, it } from "vitest";
import { fileMatchesAccept } from "../FileDropzone";

function file(name: string, type = ""): File {
  return new File(["x"], name, { type });
}

describe("fileMatchesAccept", () => {
  it("accepts anything when accept is empty/undefined", () => {
    expect(fileMatchesAccept(file("a.weird"), undefined)).toBe(true);
    expect(fileMatchesAccept(file("a.weird"), "")).toBe(true);
  });

  it("matches by extension token", () => {
    expect(fileMatchesAccept(file("data.csv"), ".csv,.tsv")).toBe(true);
    expect(fileMatchesAccept(file("data.TSV"), ".csv,.tsv")).toBe(true);
    expect(fileMatchesAccept(file("data.xlsx"), ".csv,.tsv")).toBe(false);
  });

  it("matches by exact mime", () => {
    expect(fileMatchesAccept(file("a.pdf", "application/pdf"), "application/pdf")).toBe(true);
    expect(fileMatchesAccept(file("a.png", "image/png"), "application/pdf")).toBe(false);
  });

  it("matches a wildcard mime like image/*", () => {
    expect(fileMatchesAccept(file("a.png", "image/png"), "image/*")).toBe(true);
    expect(fileMatchesAccept(file("a.webp", "image/webp"), "image/*")).toBe(true);
    expect(fileMatchesAccept(file("a.pdf", "application/pdf"), "image/*")).toBe(false);
  });

  it("matches when any token in a mixed list matches", () => {
    const accept = "image/png,image/jpeg,.webp";
    expect(fileMatchesAccept(file("a.jpg", "image/jpeg"), accept)).toBe(true);
    expect(fileMatchesAccept(file("a.webp", ""), accept)).toBe(true);
    expect(fileMatchesAccept(file("a.gif", "image/gif"), accept)).toBe(false);
  });
});
