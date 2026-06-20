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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LAB_SITES_COM_ORIGIN_ENABLED } from "@/lib/social/config";
import FileDropzone from "@/components/ui/FileDropzone";
import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import PortalShell from "@/components/portal/PortalShell";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import ReferencePicker from "@/components/references/ReferencePicker";
import { isBlockEmbedMarkdown, parseObjectEmbed } from "@/lib/references";
import { bakeAllEmbeds, bakeOne, type BakedEmbed } from "@/lib/export/bake-embeds";
import { bundleFromBakedMap, serializeSnapshotBundle } from "@/lib/social/lab-site-snapshots";
import { LAB_BYO_SITES_ENABLED } from "@/lib/social/config";
import DemoSampleLabRibbon from "@/components/social/DemoSampleLabRibbon";
import { DEMO_LAB_SLUG, DEMO_NATIVE_PAGES } from "@/lib/social/demo-lab";
import { BADGES_ENABLED } from "@/lib/badges/config";
import BadgeEditor from "@/components/badges/BadgeEditor";
import { loadBadgeMetrics } from "@/lib/badges/metrics";
import {
  buildBadgeSnapshot,
  serializeBadgeSnapshot,
} from "@/lib/badges/snapshot";
import {
  DeployHistory,
  PublishDeployPanel,
  StatusPill,
  usePublishFlow,
  type DeployHistoryEntry,
} from "@/components/social/PublishDeployProgress";
import LabSiteCanvasEditor from "@/components/social/LabSiteCanvasEditor";
import { scanBlockEmbedHrefs } from "@/components/social/LabSiteBlockView";
import { parseLabSiteBlocks } from "@/lib/social/lab-site-blocks";

/** The note shown on every disabled write control in the demo walkthrough. */
const DEMO_EDIT_NOTE = "Sample lab, editing is disabled in the demo.";

/**
 * Lab badges card (badges phase 2). Lets the lab head choose which earned
 * badges to pin and publish them to the lab's public page. Gated on
 * BADGES_ENABLED so it is dark by default.
 *
 * Loads real metrics from the connected folder on mount (loadBadgeMetrics),
 * derives earned ids, and holds draft pins in local state. The "Publish badges"
 * button builds the snapshot, serializes it, and PUTs it to the badges endpoint.
 * All persistence is server-side; this component is purely a controlled form.
 */
function LabBadgesSection({ demoReadOnly }: { demoReadOnly?: boolean }) {
  const [earnedIds, setEarnedIds] = useState<string[]>([]);
  const [draftPinned, setDraftPinned] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Load real metrics from the folder on mount. Degrades to an empty earned
  // set (no badges available to pin) if the folder is not connected.
  useEffect(() => {
    void (async () => {
      try {
        const metrics = await loadBadgeMetrics();
        const snapshot = buildBadgeSnapshot(metrics, []);
        setEarnedIds(snapshot.earnedBadgeIds);
      } catch {
        // Folder not connected or read failed: leave at empty set.
      }
    })();
  }, []);

  const publishBadges = useCallback(async () => {
    if (demoReadOnly) {
      setMsg(DEMO_EDIT_NOTE);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const metrics = await loadBadgeMetrics();
      const snapshot = buildBadgeSnapshot(metrics, draftPinned);
      const badgeSnapshot = JSON.parse(serializeBadgeSnapshot(snapshot)) as unknown;
      const res = await fetch("/api/social/lab-site/badges", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ badgeSnapshot }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg(`Could not publish badges: ${data.error ?? "unknown error"}.`);
        return;
      }
      setMsg("Badges published. Visitors will see the updated snapshot on your public page.");
    } catch {
      setMsg("Could not publish badges right now.");
    } finally {
      setBusy(false);
    }
  }, [demoReadOnly, draftPinned]);

  return (
    <section className="mb-8 rounded-xl border border-border bg-surface-raised p-5">
      <h2 className="text-lg font-medium text-foreground">Lab badges</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pin up to four earned badges to feature on your public lab page. Badges
        are earned from real activity in ResearchOS.
      </p>
      <div className="mt-4">
        {earnedIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No badges earned yet. Connect your folder and record some experiments
            to start earning.
          </p>
        ) : (
          <BadgeEditor
            earnedBadgeIds={earnedIds}
            pinnedBadgeIds={draftPinned}
            onChange={setDraftPinned}
          />
        )}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={busy || demoReadOnly}
          title={demoReadOnly ? DEMO_EDIT_NOTE : undefined}
          onClick={() => void publishBadges()}
          className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
        >
          <Icon name="check" className="h-4 w-4" /> Publish badges
        </button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </section>
  );
}

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
  /** True when the page uses the blocks canvas model (blocks_json is non-null). */
  hasBlocks?: boolean;
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
    }
  }, []);

  return (
    <section className="mb-8 rounded-xl border border-border bg-surface-raised p-5">
      <h2 className="text-lg font-medium text-foreground">Upload a website (zip)</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Already have your own static site (HTML, CSS, JS)? Upload a zip with an
        index.html at its root and we will host it. It is served from a separate,
        sandboxed path ({slug}.research-os.com/_site/) so your site&apos;s code
        stays isolated from your account.
      </p>
      <div className="mt-4">
        <FileDropzone
          accept=".zip,application/zip"
          disabled={busy}
          label={busy ? "Uploading…" : "Drag and drop a zip file"}
          hint=".zip"
          icon="import"
          onFiles={(files) => void upload(files[0])}
        />
      </div>
      {msg && <p className="mt-3 text-sm text-foreground">{msg}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// GitHub connection state (Phase B: kind-aware)
// ---------------------------------------------------------------------------

/** A recorded "site" (BYO static-site) connection. */
interface SiteConnectionSummary {
  kind: "site";
  owner: string;
  repo: string;
  ref: string;
  subdir: string;
  lastSyncedSha: string | null;
  lastSyncedAt: string | null;
}

/** A recorded "tool" (software tool page) connection. */
interface ToolConnectionSummary {
  kind: "tool";
  owner: string;
  repo: string;
  repoName: string;
  htmlUrl: string;
  updatedAt: string;
}

type GithubConnectionSummary = SiteConnectionSummary | ToolConnectionSummary;

/**
 * BYO GitHub-connect subsection (lab-domains BYO GitHub-connect Slice A + Phase B).
 * Connect a PUBLIC GitHub repo as the site source. On connect the server auto-detects
 * whether the repo is a static SITE (has an index.html / GitHub Pages) or a software
 * TOOL (README-driven), then routes to the right path:
 *   site  -- pulls a zipball and hosts files from R2 (existing BYO flow).
 *   tool  -- ingests README + wiki pages as native lab pages (Phase B).
 * The result message and the connection badge reflect the detected kind.
 *
 * Sync is available for site connections only; a tool "re-sync" is a reconnect
 * (the ingest is idempotent and safe to repeat). Mounted only when
 * LAB_BYO_SITES_ENABLED, so it is dark by default.
 */
function ByoGithubSection({ slug }: { slug: string }) {
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
        if (data.connection.kind === "site") {
          setRef(data.connection.ref || "main");
          setSubdir(data.connection.subdir || "");
        }
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
          // Give the user a clear reason for each known failure code.
          if (reason === "repo-not-found") {
            setMsg("That repo was not found. Make sure it is public and the owner and name are correct.");
          } else {
            setMsg(`Could not connect that repo (${reason}). Check that it is public and try again.`);
          }
          return;
        }
        if (!res.ok) {
          setMsg("Could not connect the repo right now.");
          return;
        }
        // Phase B: the response now always carries a "kind" field.
        const data = (await res.json()) as {
          kind?: "site" | "tool";
          fileCount?: number;
          totalBytes?: number;
          resolvedRef?: string;
          repoName?: string;
          pageCount?: number;
          owner?: string;
          repo?: string;
        };
        if (data.kind === "tool") {
          setMsg(
            `Detected a software tool. Published as a tool page at ${slug}.research-os.com (${data.pageCount ?? 0} pages from README + wiki).`,
          );
        } else {
          // site path (or legacy response without kind).
          const kb = data.totalBytes ? Math.round(data.totalBytes / 1024) : 0;
          const sha = data.resolvedRef ? ` at ${data.resolvedRef.slice(0, 7)}` : "";
          setMsg(`Static site hosted (${data.fileCount ?? 0} files, ${kb} KB${sha}).`);
        }
        await loadConnection();
      } catch {
        setMsg("Could not connect the repo right now.");
      } finally {
        setBusy(false);
      }
    },
    [owner, repo, ref, subdir, slug, loadConnection],
  );

  // Build a human-readable connection badge for the current connection.
  function connectionBadge(c: GithubConnectionSummary): string {
    if (c.kind === "tool") {
      return `Tool page: ${c.owner}/${c.repo}`;
    }
    const refPart = c.ref || "main";
    const subdirPart = c.subdir ? `, /${c.subdir}` : "";
    const syncPart = c.lastSyncedSha
      ? ` . last synced ${c.lastSyncedSha.slice(0, 7)}`
      : " . not synced yet";
    return `Static site: ${c.owner}/${c.repo} (${refPart}${subdirPart})${syncPart}`;
  }

  // Both site and tool connections are served under the lab's subdomain.
  // The function is kept as a named helper for clarity; the parameter is intentionally
  // unused because both kinds share the same top-level URL (the render route handles
  // the kind-specific path internally).
  function publicUrl(_c: GithubConnectionSummary): string {
    return `${slug}.research-os.com`;
  }

  return (
    <section className="mb-8 rounded-xl border border-border bg-surface-raised p-5">
      <h2 className="text-lg font-medium text-foreground">Connect a GitHub repo</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Point us at a PUBLIC GitHub repo. We auto-detect whether it is a static
        site (index.html or GitHub Pages) or a software tool (README-driven), then
        publish it the right way. Private repos and automatic sync are coming later.
      </p>
      {conn && (
        <div className="mt-2 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-muted-foreground">
          <p>{connectionBadge(conn)}</p>
          <p className="mt-0.5">
            Live at{" "}
            <span className="font-medium text-foreground">{publicUrl(conn)}</span>
          </p>
        </div>
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
          placeholder="repo (e.g. companion-site or starfish)"
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
          placeholder="subfolder (optional, for site repos)"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          aria-label="Subfolder (optional, site repos only)"
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || owner.trim().length === 0 || repo.trim().length === 0}
          onClick={() => void runAction("connect")}
          className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
        >
          <Icon name="check" className="h-4 w-4" /> {conn ? "Reconnect" : "Connect and detect"}
        </button>
        {conn?.kind === "site" && (
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

// ---------------------------------------------------------------------------
// Slug rename section (Phase PI-slug-rename)
// ---------------------------------------------------------------------------

/**
 * Lets the lab head change their lab's public web address (slug) after the
 * initial claim. The old address keeps working as a permanent redirect so every
 * saved link, bookmark, and paper citation continues to resolve. The PI sees
 * the current slug, types a new one, and must confirm the change before it
 * applies (the action is public and immediate).
 */
function SlugRenameSection({
  currentSlug,
  disabled,
  onRenamed,
}: {
  currentSlug: string;
  disabled?: boolean;
  onRenamed: (newSlug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const reset = useCallback(() => {
    setOpen(false);
    setInput("");
    setConfirming(false);
    setBusy(false);
    setMsg(null);
    setSuggestions([]);
  }, []);

  const requestConfirm = useCallback(() => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) {
      setMsg("Enter a new web address first.");
      return;
    }
    if (trimmed === currentSlug) {
      setMsg("That is already your current address.");
      return;
    }
    setConfirming(true);
    setMsg(null);
    setSuggestions([]);
  }, [input, currentSlug]);

  const doRename = useCallback(async () => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed || !confirming) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/social/lab-site/rename-slug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ oldSlug: currentSlug, newSlug: trimmed }),
      });
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { suggestions?: string[] };
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
        setMsg("That address is already taken. Try one of the suggestions below.");
        setConfirming(false);
        return;
      }
      if (res.status === 400) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg(data.error === "oldSlug required" ? "Something went wrong. Refresh and try again." : "That address is not valid. Use 3 to 30 letters, numbers, or dashes.");
        setConfirming(false);
        return;
      }
      if (!res.ok) {
        setMsg("Could not change the address right now. Try again shortly.");
        setConfirming(false);
        return;
      }
      const data = (await res.json()) as { slug?: string };
      const newSlug = data.slug ?? trimmed;
      reset();
      onRenamed(newSlug);
    } catch {
      setMsg("Could not change the address right now. Try again shortly.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }, [input, currentSlug, confirming, reset, onRenamed]);

  const displayBase = LAB_SITES_COM_ORIGIN_ENABLED
    ? ".research-os.com"
    : "research-os.app/";
  const currentDisplay = LAB_SITES_COM_ORIGIN_ENABLED
    ? `${currentSlug}.research-os.com`
    : `research-os.app/${currentSlug}`;

  if (!open) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3">
        <Icon name="globe" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">Web address</p>
          <p className="truncate text-sm font-medium text-foreground">
            {currentDisplay}
          </p>
        </div>
        <Tooltip label="Change your lab web address">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen(true)}
            className="ros-btn-neutral inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
          >
            <Icon name="pencil" className="h-3.5 w-3.5" /> Change address
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface-raised p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Change lab web address</h3>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="ros-btn-neutral rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
        Your old address keeps working as a permanent redirect so every saved
        link, paper citation, and external bookmark continues to resolve. The new
        address goes live immediately.
      </p>

      <div className="flex items-center gap-2">
        {LAB_SITES_COM_ORIGIN_ENABLED ? null : (
          <span className="shrink-0 text-xs text-muted-foreground">research-os.app/</span>
        )}
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setConfirming(false);
            setMsg(null);
            setSuggestions([]);
          }}
          disabled={busy}
          placeholder={currentSlug}
          aria-label="New lab web address"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-50"
        />
        {LAB_SITES_COM_ORIGIN_ENABLED && (
          <span className="shrink-0 text-xs text-muted-foreground">.research-os.com</span>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setInput(s);
                setConfirming(false);
                setMsg(null);
              }}
              className="ros-btn-neutral rounded-full px-3 py-1 text-xs"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {confirming ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-xs text-foreground leading-relaxed">
            Change your address from{" "}
            <span className="font-medium">{currentDisplay}</span> to{" "}
            <span className="font-medium">
              {LAB_SITES_COM_ORIGIN_ENABLED
                ? `${input.trim().toLowerCase()}${displayBase}`
                : `${displayBase}${input.trim().toLowerCase()}`}
            </span>
            ? The old address will redirect here permanently.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void doRename()}
              className="btn-brand inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {busy ? "Changing." : "Yes, change address"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="ros-btn-neutral rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Go back
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy || !input.trim() || input.trim().toLowerCase() === currentSlug}
          onClick={requestConfirm}
          className="mt-3 btn-brand inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          Preview change
        </button>
      )}

      {msg && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {msg}
        </p>
      )}
    </div>
  );
}

export default function LabSiteDashboard({
  demoReadOnly = false,
}: {
  /**
   * Read-only demo walkthrough (demo-lab-network Phase 2). When true the dashboard
   * loads the seeded demo lab's site + pages from the pure DEMO content and NEVER
   * calls any write endpoint, so a demo visitor can tour the authoring wizard
   * without touching the shared demo lab's real rows. Every save/publish/claim
   * control is disabled with DEMO_EDIT_NOTE. Demo-slug-scoped by the route (only
   * `?demo=fakeyeast-lab` turns it on), so it can never affect a real lab.
   */
  demoReadOnly?: boolean;
}) {
  const [load, setLoad] = useState<LoadState>("loading");
  const [site, setSite] = useState<SiteSummary | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);

  // Slug-claim form state.
  const [slugInput, setSlugInput] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // The claim is irreversible (the slug is the lab's permanent web address, there
  // is no rename path), so the visitor must confirm they understand before the
  // Claim button enables. Grant decision (2026-06-19): the slug/domain is PERMANENT.
  const [confirmPermanent, setConfirmPermanent] = useState(false);

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

  // Canvas / blocks editor state. When editorIsBlocks is true the page uses
  // blocks_json; when false it uses body_md. editorBlocksJson is the live
  // serialized block array from the canvas (updated on every change via
  // LabSiteCanvasEditor.onChange) so the publish flow can bake its embeds.
  const [editorIsBlocks, setEditorIsBlocks] = useState(false);
  const [editorBlocksJson, setEditorBlocksJson] = useState<string | null>(null);
  // Initial blocks_json fetched when a blocks page is opened (null = empty new page).
  const [editorInitialBlocksJson, setEditorInitialBlocksJson] = useState<string | null>(null);

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

  // Demo walkthrough hydration: load the seeded site + pages from the pure DEMO
  // content WITHOUT any network call, so the wizard tour never reads or writes the
  // shared demo lab's real rows.
  const loadDemo = useCallback(() => {
    setSite({ slug: DEMO_LAB_SLUG, createdAt: new Date(0).toISOString() });
    setPages(
      DEMO_NATIVE_PAGES.map((p) => ({
        path: p.path,
        title: p.title,
        status: "published" as const,
        version: 2,
        updatedAt: new Date(0).toISOString(),
      })),
    );
    setLoad("ready");
  }, []);

  useEffect(() => {
    if (demoReadOnly) {
      loadDemo();
      return;
    }
    void refresh();
  }, [demoReadOnly, loadDemo, refresh]);

  const claimSlug = useCallback(async () => {
    if (demoReadOnly) {
      setClaimError(DEMO_EDIT_NOTE);
      return;
    }
    // The claim is permanent, so never fire it without the explicit confirm.
    if (!confirmPermanent) {
      setClaimError("Confirm you understand the address is permanent first.");
      return;
    }
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
  }, [slugInput, refresh, demoReadOnly, confirmPermanent]);

  const openEditor = useCallback(
    async (page: PageSummary | null, asBlocks = false) => {
    if (page) {
      setEditorPath(page.path);
      setEditorTitle(page.title);
      const isBlocks = page.hasBlocks ?? asBlocks;
      setEditorIsBlocks(isBlocks);
      setEditorInitialBlocksJson(null);
      setEditorBlocksJson(null);

      if (isBlocks && !demoReadOnly) {
        // Fetch the existing blocks_json for this page so the canvas is pre-populated.
        try {
          const res = await fetch(
            `/api/social/lab-site/page/blocks?path=${encodeURIComponent(page.path)}`,
          );
          if (res.ok) {
            const data = (await res.json()) as { blocksJson?: string | null };
            setEditorInitialBlocksJson(data.blocksJson ?? null);
          }
        } catch {
          // Best effort: canvas starts empty if the fetch fails.
        }
      }

      if (!isBlocks) {
        // In the demo we DO have the body (from the pure DEMO content).
        if (demoReadOnly) {
          const demoPage = DEMO_NATIVE_PAGES.find((p) => p.path === page.path);
          setEditorBody(demoPage?.bodyMd ?? "");
        } else {
          setEditorBody("");
        }
      }
    } else {
      setEditorPath("");
      setEditorTitle("");
      setEditorBody("");
      setEditorIsBlocks(asBlocks);
      setEditorInitialBlocksJson(null);
      setEditorBlocksJson(null);
    }
    setEditorMsg(null);
    },
    [demoReadOnly],
  );

  const newPage = useCallback((asBlocks = false) => {
    setEditorPath("__new__");
    setEditorTitle("");
    setEditorBody("");
    setEditorIsBlocks(asBlocks);
    setEditorInitialBlocksJson(null);
    setEditorBlocksJson(null);
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

  // The public URL for the current lab's site (used in the deploy panel + pill).
  const siteUrl = useMemo(() => {
    if (!site) return "";
    return LAB_SITES_COM_ORIGIN_ENABLED
      ? `${site.slug}.research-os.com`
      : `research-os.app/${site.slug}`;
  }, [site]);

  // ---------------------------------------------------------------------------
  // Publish flow (P4: status pill + staged deploy panel)
  //
  // The flow hook owns the deploy-progress state for the currently-open page.
  // When a new page is opened the panel is reset to hidden. The three real async
  // steps (save, freeze, publish) are wired to the flow so the panel shows
  // honest progress rather than a fake timer.
  // ---------------------------------------------------------------------------

  // Individual stable callbacks for the publish flow steps.
  // They capture the latest editor state in their deps rather than via refs.

  const flowOnSave = useCallback(async (): Promise<string> => {
    // Step 1: save the draft. Must throw on failure (flow will stop).
    const path =
      editorPath === "__new__" ? "" : (editorPath ?? "");

    if (editorIsBlocks) {
      // Blocks page: save via the canvas API route.
      const blocksJson = editorBlocksJson ?? "[]";
      const res = await fetch("/api/social/lab-site/page/blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, title: editorTitle, blocksJson }),
      });
      if (!res.ok) throw new Error("Could not save the draft.");
      const data = (await res.json()) as { path: string };
      setEditorPath(data.path);
      return data.path;
    }

    // Markdown page: original path.
    const res = await fetch("/api/social/lab-site/page", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path,
        title: editorTitle,
        bodyMd: editorBody,
      }),
    });
    if (!res.ok) throw new Error("Could not save the draft.");
    const data = (await res.json()) as { page: PageSummary };
    setEditorPath(data.page.path);
    return data.page.path;
  }, [editorPath, editorTitle, editorBody, editorIsBlocks, editorBlocksJson]);

  const flowOnFreeze = useCallback(async () => {
    // Step 2: freeze (bake) embeds. Returns count + snapshots.
    // Bake-on-publish (Phase 3b): block embeds read the author's LOCAL data,
    // and svgToPngDataUrl needs a real canvas, so baking MUST run here in
    // the browser (never on the server). The frozen snapshots are sent with
    // the publish request so the public page renders frozen versions.

    if (editorIsBlocks) {
      // Blocks page: scan data-block hrefs via scanBlockEmbedHrefs and bake each.
      const blocks = parseLabSiteBlocks(editorBlocksJson);
      const hrefs = scanBlockEmbedHrefs(blocks);
      if (hrefs.length === 0) return { count: 0 };
      const bakedMap = new Map<string, BakedEmbed>();
      await Promise.all(
        hrefs.map(async (href) => {
          const descriptor = parseObjectEmbed(href);
          if (!descriptor || !descriptor.isEmbed) return;
          try {
            const baked = await bakeOne(descriptor, "", null);
            bakedMap.set(href, baked);
          } catch {
            bakedMap.set(href, { kind: "missing", name: href, label: null });
          }
        }),
      );
      if (bakedMap.size === 0) return { count: 0 };
      const serialized = serializeSnapshotBundle(bundleFromBakedMap(bakedMap));
      if (!serialized) return { count: bakedMap.size };
      const snapshots = JSON.parse(serialized) as Record<string, unknown>;
      return { count: bakedMap.size, snapshots };
    }

    // Markdown page: original bake path.
    const baked = await bakeAllEmbeds([editorBody]);
    if (baked.size === 0) return { count: 0 };
    const serialized = serializeSnapshotBundle(bundleFromBakedMap(baked));
    if (!serialized) return { count: baked.size };
    const snapshots = JSON.parse(serialized) as Record<string, unknown>;
    return { count: baked.size, snapshots };
  }, [editorBody, editorIsBlocks, editorBlocksJson]);

  const flowOnPublish = useCallback(
    async (savedPath: string, snapshots: Record<string, unknown> | undefined) => {
      // Step 3: flip status to published on the server.
      // Blocks pages use the blocks PUT endpoint; markdown pages use the original.
      const endpoint = editorIsBlocks
        ? "/api/social/lab-site/page/blocks"
        : "/api/social/lab-site/page";
      const pub = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          snapshots ? { path: savedPath, snapshots } : { path: savedPath },
        ),
      });
      if (!pub.ok) throw new Error("Could not publish.");
    },
    [editorIsBlocks],
  );

  const flowOnCheck = useCallback(async () => {
    // Step 4: best-effort reachability check.
    if (!siteUrl) return true;
    try {
      const res = await fetch(`https://${siteUrl}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(4000),
      });
      return res.ok;
    } catch {
      return true; // Non-fatal: the site is still live even if unreachable now.
    }
  }, [siteUrl]);

  const flowOnDone = useCallback(() => {
    // Refresh the page list and clear editor busy flag after all steps complete.
    void refresh();
    setEditorBusy(false);
  }, [refresh]);

  const flow = usePublishFlow({
    pagePath: editorPath ?? "",
    siteUrl,
    onSave: flowOnSave,
    onFreeze: flowOnFreeze,
    onPublish: flowOnPublish,
    onCheck: flowOnCheck,
    onDone: flowOnDone,
  });

  // Reset the deploy panel when the editor opens a different page.
  useEffect(() => {
    flow.resetPanel();
    // We only want to reset when editorPath changes, not when flow changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorPath]);

  // ---------------------------------------------------------------------------
  // saveDraft: save-only path (no publish). The publish path goes through flow.
  // ---------------------------------------------------------------------------
  const saveDraft = useCallback(
    async (then?: "publish") => {
      if (editorPath === null) return;
      if (demoReadOnly) {
        setEditorMsg(DEMO_EDIT_NOTE);
        return;
      }

      // Publish path: delegate entirely to the deploy flow (status pill + panel).
      if (then === "publish") {
        setEditorBusy(true);
        setEditorMsg(null);
        const ok = await flow.publish();
        if (!ok) {
          setEditorMsg("Saved the draft, but could not publish.");
        } else {
          setEditorMsg(null);
        }
        // editorBusy is reset in onDone (called by flow after all steps).
        return;
      }

      // Save-only path.
      setEditorBusy(true);
      setEditorMsg(null);
      const path = editorPath === "__new__" ? "" : editorPath;
      try {
        if (editorIsBlocks) {
          // Blocks page save.
          const blocksJson = editorBlocksJson ?? "[]";
          const res = await fetch("/api/social/lab-site/page/blocks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path, title: editorTitle, blocksJson }),
          });
          if (!res.ok) {
            setEditorMsg("Could not save the draft.");
            return;
          }
          const data = (await res.json()) as { path: string };
          setEditorPath(data.path);
          setEditorMsg("Draft saved.");
        } else {
          // Markdown page save (original path).
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
          setEditorMsg("Draft saved.");
        }
        await refresh();
      } catch {
        setEditorMsg("Could not save the draft.");
      } finally {
        setEditorBusy(false);
      }
    },
    [editorPath, editorTitle, editorBody, refresh, demoReadOnly, flow, editorIsBlocks, editorBlocksJson],
  );

  // ---------------------------------------------------------------------------
  // Deploy history entries for the currently-open page.
  //
  // lab_site_pages has no versioned history table yet. We render the current
  // published page as the top entry and populate the list from PageSummary
  // data. A full version history requires a new additive table or a JSONB
  // history column.
  //
  // TODO(deploy-history): when the history table exists, fetch versioned
  // entries from GET /api/social/lab-site/page/history?path=<editorPath> and
  // render each version with its publishedAt timestamp, label (body preview or
  // commit message), and a Restore button wired to POST ...?action=restore.
  // ---------------------------------------------------------------------------
  const deployHistoryEntries = useMemo((): DeployHistoryEntry[] => {
    // editorPath null means no editor open; "__new__" means a page not yet saved.
    // editorPath "" is valid (the home page).
    if (editorPath === null || editorPath === "__new__") return [];
    const page = pages.find((p) => p.path === editorPath);
    if (!page || page.status !== "published") return [];
    return [
      {
        publishedAt: page.updatedAt,
        label: page.title || pathLabel(page.path) || "Home page",
        isCurrent: true,
      },
    ];
  }, [editorPath, pages]);

  const body = (
    <>
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Lab site</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your lab&apos;s public companion site. Claim a slug, write pages in
            markdown, and publish when ready.
          </p>
        </header>

        {demoReadOnly && (
          <div className="mb-6 rounded-xl border border-border bg-surface-sunken p-4">
            <div className="mb-2">
              <DemoSampleLabRibbon tone="card" />
            </div>
            <p className="text-sm text-foreground">
              This is a read-only tour of the lab-site authoring wizard for the
              sample lab. {DEMO_EDIT_NOTE} Open a page below to see the editor with
              the published markdown, the same view a lab head uses to write.
            </p>
          </div>
        )}

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
              Your site will live at{" "}
              {LAB_SITES_COM_ORIGIN_ENABLED
                ? "<slug>.research-os.com"
                : "research-os.app/<slug>"}
              . Letters, numbers, and dashes, 3 to 30 characters.
            </p>
            <div className="mt-4 flex items-center gap-2">
              {!LAB_SITES_COM_ORIGIN_ENABLED && (
                <span className="text-sm text-muted-foreground">
                  research-os.app/
                </span>
              )}
              <input
                type="text"
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value)}
                placeholder="smithlab"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                aria-label="Lab slug"
              />
              {LAB_SITES_COM_ORIGIN_ENABLED && (
                <span className="text-sm text-muted-foreground">
                  .research-os.com
                </span>
              )}
              <button
                type="button"
                disabled={
                  claimBusy ||
                  slugInput.trim().length === 0 ||
                  !confirmPermanent
                }
                onClick={() => void claimSlug()}
                className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {claimBusy ? "Claiming." : "Claim"}
              </button>
            </div>
            {/* Claim gate. The slug becomes the lab's primary web address. Renames
                are possible later (the old address keeps working as a redirect),
                but choosing a good slug from the start avoids any transition pain
                for early visitors and any links you share before a rename. */}
            <div className="mt-4 rounded-lg border border-border bg-surface-sunken p-3">
              <p className="text-sm text-foreground">
                This becomes your lab&apos;s web address. Choose a slug that fits
                your lab name. You can change it later and the old address will
                redirect, but links you share before a rename will go through a
                redirect rather than resolving directly.
              </p>
              <label className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={confirmPermanent}
                  onChange={(e) => setConfirmPermanent(e.target.checked)}
                  className="mt-0.5"
                  aria-label="Confirm the lab address claim"
                />
                <span>
                  I want to claim{" "}
                  <span className="font-medium text-foreground">
                    {(slugInput.trim().toLowerCase() || "<slug>") +
                      ".research-os.com"}
                  </span>{" "}
                  as my lab&apos;s web address.
                </span>
              </label>
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
            <div className="mb-4 flex items-center justify-between rounded-xl border border-border bg-surface-raised p-4">
              <div>
                <p className="text-sm text-muted-foreground">Your site</p>
                <p className="text-base font-medium text-foreground">
                  {LAB_SITES_COM_ORIGIN_ENABLED
                    ? `${site.slug}.research-os.com`
                    : `research-os.app/${site.slug}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => newPage(false)}
                  disabled={demoReadOnly}
                  title={demoReadOnly ? DEMO_EDIT_NOTE : undefined}
                  className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  <Icon name="plus" className="h-4 w-4" /> New page
                </button>
                <Tooltip label="A visual drag-and-drop canvas for data-rich companion pages (supplements, paper datasets)">
                  <button
                    type="button"
                    onClick={() => newPage(true)}
                    disabled={demoReadOnly}
                    title={demoReadOnly ? DEMO_EDIT_NOTE : undefined}
                    className="inline-flex items-center gap-2 rounded-lg border border-purple-300 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-300 dark:hover:bg-purple-900"
                  >
                    <Icon name="plus" className="h-4 w-4" /> Canvas page
                  </button>
                </Tooltip>
              </div>
            </div>

            {!demoReadOnly && (
              <SlugRenameSection
                currentSlug={site.slug}
                onRenamed={(newSlug) => {
                  setSite((prev) => prev ? { ...prev, slug: newSlug } : prev);
                }}
              />
            )}

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
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-foreground">
                            {p.title || pathLabel(p.path)}
                          </p>
                          {p.hasBlocks && (
                            <span className="shrink-0 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300">
                              Canvas
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {pathLabel(p.path)} . {p.status}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void openEditor(p)}
                        className="ros-btn-neutral rounded-lg px-3 py-1 text-xs"
                      >
                        Edit
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {LAB_BYO_SITES_ENABLED && !demoReadOnly && (
              <ByoUploadSection slug={site.slug} />
            )}
            {LAB_BYO_SITES_ENABLED && !demoReadOnly && <ByoGithubSection slug={site.slug} />}

            {/* Lab badges (badges phase 2, flag-gated). Lets the lab head pin
                earned badges and publish them to the public lab page. Inert
                when BADGES_ENABLED is false so the flag controls visibility. */}
            {BADGES_ENABLED && (
              <LabBadgesSection demoReadOnly={demoReadOnly} />
            )}

            {editorPath !== null && (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_280px] xl:items-start">
                {/* Editor card */}
                <section className="rounded-xl border border-border bg-surface-raised p-5">
                  {/* Header bar: title + mode badge + status pill */}
                  <div className="mb-3 flex items-center gap-3">
                    <h2 className="flex-1 text-lg font-medium text-foreground">
                      {editorPath === "__new__" || editorPath === ""
                        ? "Edit home page"
                        : `Edit ${pathLabel(editorPath)}`}
                    </h2>
                    {editorIsBlocks && (
                      <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300">
                        Canvas
                      </span>
                    )}
                    {!demoReadOnly && (
                      <StatusPill state={flow.publishState} />
                    )}
                  </div>

                  <label className="mb-1 block text-xs text-muted-foreground">
                    Title
                  </label>
                  <input
                    type="text"
                    value={editorTitle}
                    onChange={(e) => setEditorTitle(e.target.value)}
                    readOnly={demoReadOnly}
                    className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground read-only:opacity-70"
                    placeholder="Welcome to the Smith Lab"
                  />

                  {/* Canvas editor path (blocks page) */}
                  {editorIsBlocks ? (
                    <>
                      <p className="mb-3 text-xs text-foreground-muted">
                        Drag blocks from the palette onto the canvas. Click a block
                        to select it and edit its settings in the inspector on the
                        right. Data blocks (figure, table, dataset, chart) are live
                        while you edit and frozen for citation when you publish.
                      </p>
                      <div className="mb-4">
                        <LabSiteCanvasEditor
                          initialBlocksJson={editorInitialBlocksJson}
                          onChange={setEditorBlocksJson}
                          disabled={demoReadOnly}
                        />
                      </div>
                    </>
                  ) : (
                    /* Markdown editor path (legacy body_md page) */
                    <>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="block text-xs text-muted-foreground">
                          Body (markdown)
                        </label>
                        <button
                          type="button"
                          onClick={() => setPickerOpen(true)}
                          disabled={demoReadOnly}
                          title={demoReadOnly ? DEMO_EDIT_NOTE : undefined}
                          className="ros-btn-neutral inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
                        >
                          <Icon name="plus" className="h-3.5 w-3.5" /> Insert figure or table
                        </button>
                      </div>
                      <textarea
                        ref={bodyRef}
                        value={editorBody}
                        onChange={(e) => setEditorBody(e.target.value)}
                        readOnly={demoReadOnly}
                        rows={12}
                        className="mb-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground read-only:opacity-70"
                        placeholder="# Our research\n\nWrite your page in markdown."
                      />
                      <p className="mb-4 text-[11px] text-muted-foreground">
                        Inserted figures and tables are frozen (baked) when you publish,
                        so visitors see exactly what you published.
                      </p>
                      {pickerOpen && (
                        <ReferencePicker
                          onPick={(markdown) => insertReference(markdown)}
                          onClose={() => setPickerOpen(false)}
                        />
                      )}
                    </>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={editorBusy || demoReadOnly}
                      title={demoReadOnly ? DEMO_EDIT_NOTE : undefined}
                      onClick={() => void saveDraft()}
                      className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      Save draft
                    </button>
                    <button
                      type="button"
                      disabled={editorBusy || demoReadOnly}
                      title={demoReadOnly ? DEMO_EDIT_NOTE : undefined}
                      onClick={() => void saveDraft("publish")}
                      className="btn-brand inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                      <Icon name="check" className="h-4 w-4" /> Push live
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

                  {/* Deploy progress panel (hidden until publish is triggered). */}
                  {!demoReadOnly && (
                    <PublishDeployPanel flow={flow} siteUrl={siteUrl} />
                  )}
                </section>

                {/* Deploy history sidebar */}
                {!demoReadOnly && (
                  <DeployHistory
                    entries={deployHistoryEntries}
                    // TODO(deploy-history): wire onRestore once lab_site_pages has a
                    // versioned history table. The handler should POST to
                    // /api/social/lab-site/page/restore with { path, publishedAt } and
                    // load the returned body_md + snapshots_json into the editor as a
                    // new draft so the user can review before re-publishing.
                    onRestore={undefined}
                  />
                )}
              </div>
            )}
          </section>
        )}
    </>
  );

  // The demo walkthrough (?demo=fakeyeast-lab) is a public, read-only tour, so it
  // keeps the marketing chrome and stays viewable without a session. The real
  // authoring surface is a signed-in account page, so it renders in PortalShell,
  // the authed account shell shared with /account and the org portals. PortalShell
  // shows the signed-in account (email + sign-out) so the user always knows which
  // identity they are acting as, and gates a logged-out visitor with a sign-in
  // card instead of the public marketing nav and footer.
  if (demoReadOnly) {
    return (
      <div className="relative min-h-screen">
        <MarketingBackdrop />
        <MarketingNav />
        <main className="mx-auto w-full max-w-3xl px-5 py-12">{body}</main>
        <MarketingFooter />
      </div>
    );
  }

  return (
    <PortalShell
      title="Lab site"
      gateHeading="Sign in to manage your lab site"
      tagline="Claim your lab's slug, write companion-site pages in markdown, and publish when ready. Your account is the cloud part; your research data stays local on your own computer."
    >
      <div className="mx-auto w-full max-w-3xl">{body}</div>
    </PortalShell>
  );
}
