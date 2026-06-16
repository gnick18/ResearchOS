"use client";

// Lab companion-site authoring dashboard (lab-domains Phase 3a, social lane).
//
// A deliberately MINIMAL author surface for the lab head: claim the lab slug
// (with availability + institution-aware suggestions on a conflict), list the
// lab's pages (draft/published), and edit a page (title + markdown body in a
// plain textarea) with save-draft and publish. The rich live-visualizer block
// editor is Phase 3b; this is functional + safe, not polished.
//
// All authorization is enforced SERVER-SIDE by /api/social/lab-site*: this UI
// only calls those endpoints and renders their verdicts (a 401/403/404 from the
// server collapses to a calm "not available" message). The route that mounts
// this component is itself flag-gated (NEXT_PUBLIC_LAB_SITES) so the surface is
// dark by default.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import { Icon } from "@/components/icons";

interface SiteSummary {
  slug: string;
  createdAt: string;
}

interface PageSummary {
  path: string;
  title: string;
  status: "draft" | "published";
  version: number;
  updatedAt: string;
}

type LoadState = "loading" | "ready" | "denied" | "error";

const HOME_PATH_LABEL = "Home";

function pathLabel(path: string): string {
  return path === "" ? HOME_PATH_LABEL : `/${path}`;
}

export default function LabSiteDashboard() {
  const [load, setLoad] = useState<LoadState>("loading");
  const [site, setSite] = useState<SiteSummary | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);

  // Slug-claim form state.
  const [slugInput, setSlugInput] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Editor state for the currently-open page (null = none open).
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editorTitle, setEditorTitle] = useState("");
  const [editorBody, setEditorBody] = useState("");
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorMsg, setEditorMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/social/lab-site", { method: "GET" });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        setLoad("denied");
        return;
      }
      if (!res.ok) {
        setLoad("error");
        return;
      }
      const data = (await res.json()) as {
        site: SiteSummary | null;
        pages: PageSummary[];
      };
      setSite(data.site);
      setPages(Array.isArray(data.pages) ? data.pages : []);
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const claimSlug = useCallback(async () => {
    setClaimBusy(true);
    setClaimError(null);
    setSuggestions([]);
    try {
      const res = await fetch("/api/social/lab-site", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: slugInput }),
      });
      if (res.status === 409) {
        const data = (await res.json()) as { suggestions?: string[] };
        setClaimError("That slug is taken. Try one of these.");
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
        return;
      }
      if (res.status === 400) {
        const data = (await res.json()) as { message?: string };
        setClaimError(data.message || "That slug is not valid.");
        return;
      }
      if (!res.ok) {
        setClaimError("Could not claim the slug right now.");
        return;
      }
      await refresh();
    } catch {
      setClaimError("Could not claim the slug right now.");
    } finally {
      setClaimBusy(false);
    }
  }, [slugInput, refresh]);

  const openEditor = useCallback((page: PageSummary | null) => {
    if (page) {
      setEditorPath(page.path);
      setEditorTitle(page.title);
      // The list does not carry the body; fetch the public render is not ideal
      // for drafts, so we open with the known title and let the author paste/edit
      // the body. A dedicated GET-page endpoint can hydrate this in 3b. For now a
      // re-save overwrites the body, so we start the body empty to avoid
      // clobbering with a stale value the list does not have.
      setEditorBody("");
    } else {
      setEditorPath("");
      setEditorTitle("");
      setEditorBody("");
    }
    setEditorMsg(null);
  }, []);

  const newPage = useCallback(() => {
    setEditorPath("__new__");
    setEditorTitle("");
    setEditorBody("");
    setEditorMsg(null);
  }, []);

  const saveDraft = useCallback(
    async (then?: "publish") => {
      if (editorPath === null) return;
      setEditorBusy(true);
      setEditorMsg(null);
      const path = editorPath === "__new__" ? "" : editorPath;
      try {
        const res = await fetch("/api/social/lab-site/page", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path,
            title: editorTitle,
            bodyMd: editorBody,
          }),
        });
        if (!res.ok) {
          setEditorMsg("Could not save the draft.");
          return;
        }
        const data = (await res.json()) as { page: PageSummary };
        const savedPath = data.page.path;
        setEditorPath(savedPath);

        if (then === "publish") {
          const pub = await fetch("/api/social/lab-site/page", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: savedPath }),
          });
          if (!pub.ok) {
            setEditorMsg("Saved the draft, but could not publish.");
            await refresh();
            return;
          }
          setEditorMsg("Published.");
        } else {
          setEditorMsg("Draft saved.");
        }
        await refresh();
      } catch {
        setEditorMsg("Could not save the draft.");
      } finally {
        setEditorBusy(false);
      }
    },
    [editorPath, editorTitle, editorBody, refresh],
  );

  return (
    <div className="relative min-h-screen">
      <MarketingBackdrop />
      <MarketingNav />
      <main className="mx-auto w-full max-w-3xl px-5 py-12">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Lab site</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your lab&apos;s public companion site. Claim a slug, write pages in
            markdown, and publish when ready.
          </p>
        </header>

        {load === "loading" && (
          <p className="text-sm text-muted-foreground">Loading.</p>
        )}

        {load === "denied" && (
          <div className="rounded-xl border border-border bg-surface-raised p-6">
            <p className="text-sm text-foreground">
              Lab sites are available on the paid lab plan. Sign in with your lab
              account to author your site.
            </p>
          </div>
        )}

        {load === "error" && (
          <div className="rounded-xl border border-border bg-surface-raised p-6">
            <p className="text-sm text-foreground">
              Could not load your lab site. Please try again.
            </p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="ros-btn-neutral mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
            >
              <Icon name="refresh" className="h-4 w-4" /> Retry
            </button>
          </div>
        )}

        {load === "ready" && !site && (
          <section className="rounded-xl border border-border bg-surface-raised p-6">
            <h2 className="text-lg font-medium text-foreground">
              Claim your lab slug
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your site will live at research-os.app/&lt;slug&gt;. Letters,
              numbers, and dashes, 3 to 30 characters.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                research-os.app/
              </span>
              <input
                type="text"
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value)}
                placeholder="smithlab"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                aria-label="Lab slug"
              />
              <button
                type="button"
                disabled={claimBusy || slugInput.trim().length === 0}
                onClick={() => void claimSlug()}
                className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {claimBusy ? "Claiming." : "Claim"}
              </button>
            </div>
            {claimError && (
              <p className="mt-3 text-sm text-destructive">{claimError}</p>
            )}
            {suggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSlugInput(s)}
                    className="ros-btn-neutral rounded-full px-3 py-1 text-xs"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {load === "ready" && site && (
          <section>
            <div className="mb-6 flex items-center justify-between rounded-xl border border-border bg-surface-raised p-4">
              <div>
                <p className="text-sm text-muted-foreground">Your site</p>
                <p className="text-base font-medium text-foreground">
                  research-os.app/{site.slug}
                </p>
              </div>
              <button
                type="button"
                onClick={newPage}
                className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
              >
                <Icon name="plus" className="h-4 w-4" /> New page
              </button>
            </div>

            <div className="mb-8">
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                Pages
              </h2>
              {pages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No pages yet. Create your home page to get started.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border bg-surface-raised">
                  {pages.map((p) => (
                    <li
                      key={p.path}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {p.title || pathLabel(p.path)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {pathLabel(p.path)} . {p.status}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditor(p)}
                        className="ros-btn-neutral rounded-lg px-3 py-1 text-xs"
                      >
                        Edit
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {editorPath !== null && (
              <section className="rounded-xl border border-border bg-surface-raised p-5">
                <h2 className="mb-3 text-lg font-medium text-foreground">
                  {editorPath === "__new__" || editorPath === ""
                    ? "Edit home page"
                    : `Edit ${pathLabel(editorPath)}`}
                </h2>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Title
                </label>
                <input
                  type="text"
                  value={editorTitle}
                  onChange={(e) => setEditorTitle(e.target.value)}
                  className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                  placeholder="Welcome to the Smith Lab"
                />
                <label className="mb-1 block text-xs text-muted-foreground">
                  Body (markdown)
                </label>
                <textarea
                  value={editorBody}
                  onChange={(e) => setEditorBody(e.target.value)}
                  rows={12}
                  className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                  placeholder="# Our research\n\nWrite your page in markdown."
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={editorBusy}
                    onClick={() => void saveDraft()}
                    className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    disabled={editorBusy}
                    onClick={() => void saveDraft("publish")}
                    className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    <Icon name="check" className="h-4 w-4" /> Save and publish
                  </button>
                  <button
                    type="button"
                    disabled={editorBusy}
                    onClick={() => setEditorPath(null)}
                    className="ros-btn-neutral rounded-lg px-3 py-1.5 text-sm"
                  >
                    Close
                  </button>
                  {editorMsg && (
                    <span className="text-xs text-muted-foreground">
                      {editorMsg}
                    </span>
                  )}
                </div>
              </section>
            )}
          </section>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}
