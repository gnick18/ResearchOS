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

import { useCallback, useEffect, useRef, useState } from "react";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import { Icon } from "@/components/icons";
import ReferencePicker from "@/components/references/ReferencePicker";
import { isBlockEmbedMarkdown } from "@/lib/references";
import { bakeAllEmbeds } from "@/lib/export/bake-embeds";
import { bundleFromBakedMap, serializeSnapshotBundle } from "@/lib/social/lab-site-snapshots";
import { LAB_BYO_SITES_ENABLED } from "@/lib/social/config";

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

/**
 * BYO ("bring your own") static-site upload subsection (lab-domains BYO Slice 1).
 * Deliberately minimal: pick a .zip of a static site, POST it to the gated upload
 * endpoint, and render the verdict. All authorization + validation is server-side;
 * this only renders the result. Mounted only when LAB_BYO_SITES_ENABLED (a strict
 * subset of the lab-sites surface), so it is dark by default.
 */
function ByoUploadSection({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/social/lab-site/byo", {
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: file,
      });
      if (res.status === 422) {
        const data = (await res.json().catch(() => ({}))) as { reason?: string };
        const reason = data.reason ?? "invalid";
        setMsg(`That site could not be accepted (${reason}). Upload a zip of a static site with an index.html at its root.`);
        return;
      }
      if (!res.ok) {
        setMsg("Could not upload the site right now.");
        return;
      }
      const data = (await res.json()) as { fileCount: number; totalBytes: number };
      setMsg(`Uploaded ${data.fileCount} files (${Math.round(data.totalBytes / 1024)} KB).`);
    } catch {
      setMsg("Could not upload the site right now.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, []);

  return (
    <section className="mb-8 rounded-xl border border-border bg-surface-raised p-5">
      <h2 className="text-lg font-medium text-foreground">Upload a website (zip)</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Already have your own static site (HTML, CSS, JS)? Upload a zip with an
        index.html at its root and we will host it. It is served from a separate,
        sandboxed domain ({slug}.research-os.com) so your site&apos;s code stays
        isolated from your account.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
          className="text-sm text-foreground"
          aria-label="Static site zip"
        />
        {busy && <span className="text-xs text-muted-foreground">Uploading.</span>}
      </div>
      {msg && <p className="mt-3 text-sm text-foreground">{msg}</p>}
    </section>
  );
}

interface GithubConnectionSummary {
  owner: string;
  repo: string;
  ref: string;
  subdir: string;
  lastSyncedSha: string | null;
  lastSyncedAt: string | null;
}

/**
 * BYO GitHub-connect subsection (lab-domains BYO GitHub-connect Slice A). Connect a
 * PUBLIC GitHub repo as the site source (owner/repo + branch + optional subdir),
 * then re-pull on demand with "Sync now". Mirrors the zip-upload section: all authz
 * + validation is server-side; this only renders the verdict. Mounted only when
 * LAB_BYO_SITES_ENABLED, so it is dark by default.
 */
function ByoGithubSection() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [conn, setConn] = useState<GithubConnectionSummary | null>(null);

  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("main");
  const [subdir, setSubdir] = useState("");

  const loadConnection = useCallback(async () => {
    try {
      const res = await fetch("/api/social/lab-site/byo/github", { method: "GET" });
      if (!res.ok) return;
      const data = (await res.json()) as { connection: GithubConnectionSummary | null };
      if (data.connection) {
        setConn(data.connection);
        setOwner(data.connection.owner);
        setRepo(data.connection.repo);
        setRef(data.connection.ref || "main");
        setSubdir(data.connection.subdir || "");
      }
    } catch {
      // Best effort: a load failure just leaves the form blank.
    }
  }, []);

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  const runAction = useCallback(
    async (action: "connect" | "sync" | "disconnect") => {
      setBusy(true);
      setMsg(null);
      try {
        const body =
          action === "connect"
            ? { action, owner: owner.trim(), repo: repo.trim(), ref: ref.trim() || "main", subdir: subdir.trim() }
            : { action };
        const res = await fetch("/api/social/lab-site/byo/github", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (action === "disconnect") {
          if (res.ok) {
            setConn(null);
            setMsg("Disconnected. Your already-published files stay live until you replace them.");
          } else {
            setMsg("Could not disconnect right now.");
          }
          return;
        }
        if (res.status === 422 || res.status === 502) {
          const data = (await res.json().catch(() => ({}))) as { reason?: string };
          const reason = data.reason ?? "invalid";
          setMsg(`Could not pull that repo (${reason}). Use a PUBLIC repo with an index.html at its (sub)root.`);
          return;
        }
        if (!res.ok) {
          setMsg("Could not sync the repo right now.");
          return;
        }
        const data = (await res.json()) as { fileCount: number; totalBytes: number; resolvedRef?: string };
        setMsg(`Synced ${data.fileCount} files (${Math.round(data.totalBytes / 1024)} KB)${data.resolvedRef ? ` at ${data.resolvedRef.slice(0, 7)}` : ""}.`);
        await loadConnection();
      } catch {
        setMsg("Could not sync the repo right now.");
      } finally {
        setBusy(false);
      }
    },
    [owner, repo, ref, subdir, loadConnection],
  );

  return (
    <section className="mb-8 rounded-xl border border-border bg-surface-raised p-5">
      <h2 className="text-lg font-medium text-foreground">Connect a GitHub repo</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Point us at a PUBLIC GitHub repo with an index.html (your paper-companion
        repo). We pull its files and host them. Use Sync now to re-pull after you
        push changes. Private repos and automatic sync are coming later.
      </p>
      {conn && (
        <p className="mt-2 text-xs text-muted-foreground">
          Connected to {conn.owner}/{conn.repo} ({conn.ref || "main"}
          {conn.subdir ? `, /${conn.subdir}` : ""})
          {conn.lastSyncedSha ? ` . last synced ${conn.lastSyncedSha.slice(0, 7)}` : " . not synced yet"}
        </p>
      )}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          type="text"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          disabled={busy}
          placeholder="owner (e.g. smithlab)"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          aria-label="GitHub owner"
        />
        <input
          type="text"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          disabled={busy}
          placeholder="repo (e.g. companion-site)"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          aria-label="GitHub repo"
        />
        <input
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          disabled={busy}
          placeholder="branch / tag (e.g. main)"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          aria-label="Branch or tag"
        />
        <input
          type="text"
          value={subdir}
          onChange={(e) => setSubdir(e.target.value)}
          disabled={busy}
          placeholder="subfolder (optional, e.g. site)"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          aria-label="Subfolder (optional)"
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || owner.trim().length === 0 || repo.trim().length === 0}
          onClick={() => void runAction("connect")}
          className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
        >
          <Icon name="check" className="h-4 w-4" /> {conn ? "Reconnect" : "Connect and pull"}
        </button>
        {conn && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runAction("sync")}
            className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          >
            <Icon name="refresh" className="h-4 w-4" /> Sync now
          </button>
        )}
        {conn && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runAction("disconnect")}
            className="ros-btn-neutral rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Disconnect
          </button>
        )}
        {busy && <span className="text-xs text-muted-foreground">Working.</span>}
      </div>
      {msg && <p className="mt-3 text-sm text-foreground">{msg}</p>}
    </section>
  );
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
  // The "/" insert picker (reused from the note/method editors). Inserts the
  // picked reference markdown at the cursor in the body textarea.
  const [pickerOpen, setPickerOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

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

  // Insert picked reference markdown at the cursor. A BLOCK embed must sit alone
  // on its own line (the lone-paragraph rule in RenderedMarkdown), so it is padded
  // with surrounding blank lines; an inline mention is inserted as-is. After the
  // insert the textarea is refocused with the caret placed after the inserted text.
  const insertReference = useCallback(
    (markdown: string) => {
      const el = bodyRef.current;
      const isBlock = isBlockEmbedMarkdown(markdown);
      setEditorBody((prev) => {
        const start = el ? el.selectionStart : prev.length;
        const end = el ? el.selectionEnd : prev.length;
        const before = prev.slice(0, start);
        const after = prev.slice(end);
        const insert = isBlock
          ? `${before.endsWith("\n") || before === "" ? "" : "\n"}\n${markdown}\n\n`
          : markdown;
        const next = before + insert + after;
        // Restore focus + caret after React commits the new value.
        const caret = before.length + insert.length;
        requestAnimationFrame(() => {
          if (el) {
            el.focus();
            el.setSelectionRange(caret, caret);
          }
        });
        return next;
      });
    },
    [],
  );

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
          // Bake-on-publish (Phase 3b): block embeds read the author's LOCAL data,
          // and svgToPngDataUrl needs a real canvas, so baking MUST run here in the
          // browser (never on the server). The frozen snapshots are sent with the
          // publish request and stored with the page version; the public page
          // renders these frozen, since a public reader has no local workspace.
          let snapshots: Record<string, unknown> | undefined;
          try {
            const baked = await bakeAllEmbeds([editorBody]);
            if (baked.size > 0) {
              const serialized = serializeSnapshotBundle(bundleFromBakedMap(baked));
              // serialized is null only when over the byte cap; then publish with
              // no snapshots and the public page shows the unavailable card.
              if (serialized) snapshots = JSON.parse(serialized);
            }
          } catch {
            // Baking is best-effort: a bake failure must not block publishing the
            // text. The page still publishes; unbaked embeds show the calm card.
            snapshots = undefined;
          }
          const pub = await fetch("/api/social/lab-site/page", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              snapshots ? { path: savedPath, snapshots } : { path: savedPath },
            ),
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

            {LAB_BYO_SITES_ENABLED && <ByoUploadSection slug={site.slug} />}
            {LAB_BYO_SITES_ENABLED && <ByoGithubSection />}

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
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs text-muted-foreground">
                    Body (markdown)
                  </label>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="ros-btn-neutral inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs"
                  >
                    <Icon name="plus" className="h-3.5 w-3.5" /> Insert figure or table
                  </button>
                </div>
                <textarea
                  ref={bodyRef}
                  value={editorBody}
                  onChange={(e) => setEditorBody(e.target.value)}
                  rows={12}
                  className="mb-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                  placeholder="# Our research\n\nWrite your page in markdown."
                />
                <p className="mb-4 text-[11px] text-muted-foreground">
                  Inserted figures and tables are frozen (baked) when you publish,
                  so visitors see exactly what you published.
                </p>
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

                {pickerOpen && (
                  <ReferencePicker
                    onPick={(markdown) => insertReference(markdown)}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </section>
            )}
          </section>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}
