import { describe, expect, it } from "vitest";

import {
  classifyRepo,
  detectReadmeFilename,
  type ClassifyRepoInput,
} from "@/lib/social/lab-repo-classify";

// ---------------------------------------------------------------------------
// classifyRepo
// ---------------------------------------------------------------------------

describe("classifyRepo -- site detection", () => {
  it("returns 'site' when root index.html is present", () => {
    const input: ClassifyRepoInput = {
      rootFileNames: ["README.md", "index.html", "assets"],
    };
    expect(classifyRepo(input)).toBe("site");
  });

  it("returns 'site' when root index.htm is present", () => {
    expect(
      classifyRepo({ rootFileNames: ["index.htm", "style.css"] }),
    ).toBe("site");
  });

  it("returns 'site' when pagesEnabled is true (no other markers)", () => {
    const input: ClassifyRepoInput = {
      rootFileNames: ["README.md", "lib", "src"],
      pagesEnabled: true,
    };
    expect(classifyRepo(input)).toBe("site");
  });

  it("returns 'site' for a Jekyll repo (_config.yml)", () => {
    expect(
      classifyRepo({ rootFileNames: ["_config.yml", "README.md", "_posts"] }),
    ).toBe("site");
  });

  it("returns 'site' for a Gatsby repo (gatsby-config.js)", () => {
    expect(
      classifyRepo({ rootFileNames: ["gatsby-config.js", "src", "README.md"] }),
    ).toBe("site");
  });

  it("returns 'site' for a Next.js repo (next.config.js)", () => {
    expect(
      classifyRepo({ rootFileNames: ["next.config.js", "pages", "README.md"] }),
    ).toBe("site");
  });

  it("returns 'site' for a repo with .nojekyll", () => {
    expect(
      classifyRepo({ rootFileNames: [".nojekyll", "index.html"] }),
    ).toBe("site");
  });

  it("returns 'site' for a repo with a CNAME file (GitHub Pages custom domain)", () => {
    expect(
      classifyRepo({ rootFileNames: ["CNAME", "assets", "README.md"] }),
    ).toBe("site");
  });

  it("is case-insensitive for site markers (INDEX.HTML)", () => {
    expect(
      classifyRepo({ rootFileNames: ["INDEX.HTML", "README.md"] }),
    ).toBe("site");
  });

  it("returns 'site' for a VitePress repo (vitepress.config.ts)", () => {
    expect(
      classifyRepo({ rootFileNames: ["vitepress.config.ts", "docs", "README.md"] }),
    ).toBe("site");
  });
});

describe("classifyRepo -- tool detection", () => {
  it("returns 'tool' for egluckthaler/starfish (Perl, README.md, no index.html)", () => {
    // Realistic root file list for a Perl bioinformatics tool.
    const input: ClassifyRepoInput = {
      rootFileNames: [
        "LICENSE",
        "README.md",
        "bin",
        "lib",
        "t",
        "assets",
        "Makefile.PL",
      ],
      pagesEnabled: false,
    };
    expect(classifyRepo(input)).toBe("tool");
  });

  it("returns 'tool' for egluckthaler/chtc (Shell, README)", () => {
    const input: ClassifyRepoInput = {
      rootFileNames: ["README.md", "submit.sh", "run.sh", "LICENSE"],
    };
    expect(classifyRepo(input)).toBe("tool");
  });

  it("returns 'tool' when pagesEnabled is false and no site markers exist", () => {
    expect(
      classifyRepo({
        rootFileNames: ["main.py", "requirements.txt", "README.md"],
        pagesEnabled: false,
      }),
    ).toBe("tool");
  });

  it("returns 'tool' even when README is absent (fallback)", () => {
    expect(
      classifyRepo({ rootFileNames: ["main.go", "go.mod"] }),
    ).toBe("tool");
  });

  it("returns 'tool' for an empty root file list", () => {
    expect(classifyRepo({ rootFileNames: [] })).toBe("tool");
  });

  it("does NOT misclassify config.toml alone as a tool (it is a site marker)", () => {
    // config.toml is a Hugo/Zola site marker; must be 'site' not 'tool'.
    expect(
      classifyRepo({ rootFileNames: ["config.toml", "content", "README.md"] }),
    ).toBe("site");
  });
});

describe("classifyRepo -- gnick18/FungalICS_Website regression", () => {
  it("correctly identifies a website repo as 'site'", () => {
    const input: ClassifyRepoInput = {
      // Represents a repo with a root index.html (the BYO static site).
      rootFileNames: ["index.html", "styles.css", "assets", "README.md"],
      pagesEnabled: false,
    };
    expect(classifyRepo(input)).toBe("site");
  });
});

// ---------------------------------------------------------------------------
// detectReadmeFilename
// ---------------------------------------------------------------------------

describe("detectReadmeFilename", () => {
  it("returns 'README.md' when present (exact case)", () => {
    expect(detectReadmeFilename(["LICENSE", "README.md", "src"])).toBe("README.md");
  });

  it("returns the original-case filename (README.MD uppercase)", () => {
    expect(detectReadmeFilename(["README.MD", "src"])).toBe("README.MD");
  });

  it("prefers README.md over README.rst when both are present", () => {
    expect(detectReadmeFilename(["README.rst", "README.md", "src"])).toBe("README.md");
  });

  it("returns README.rst when no .md exists", () => {
    expect(detectReadmeFilename(["README.rst", "src"])).toBe("README.rst");
  });

  it("returns README (no extension) as last resort", () => {
    expect(detectReadmeFilename(["README", "src"])).toBe("README");
  });

  it("returns null when no README is present", () => {
    expect(detectReadmeFilename(["main.py", "setup.py"])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(detectReadmeFilename([])).toBeNull();
  });
});
