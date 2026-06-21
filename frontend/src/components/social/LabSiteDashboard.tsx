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
import Link from "next/link";

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
import LabSiteHomepageEditor from "@/components/social/LabSiteHomepageEditor";
import LabSiteUsagePanel from "@/components/social/LabSiteUsagePanel";
import { scanBlockEmbedHrefs } from "@/components/social/LabSiteBlockView";
import { parseLabSiteBlocks } from "@/lib/social/lab-site-blocks";

/** The note shown on every disabled write control in the demo walkthrough. */
const DEMO_EDIT_NOTE = "Sample lab, editing is disabled in the demo.";

// ---------------------------------------------------------------------------
// SiteEditorsPanel: "Who can edit this site" (lab owner only)
// ---------------------------------------------------------------------------

interface EditorEntry {
  memberKey: string;
  label: string | null;
  grantedAt: string;
}

interface MemberEntry {
  memberKey: string;
  label: string | null;
}

/**
 * Panel visible ONLY to the lab owner. Lists members who have been granted
 * editor access to this site, with a revoke control per member, and an "Add
 * editor" picker showing the lab's active billing members.
 *
 * Fetches GET /api/social/lab-site/editors?path= on mount. The owner key is
 * never passed from the client (the server derives it from the session). All
 * write actions (POST grant, DELETE revoke) are owner-only server-side.
 */
function SiteEditorsPanel({ slug }: { slug: string }) {
  const [editors, setEditors] = useState<EditorEntry[]>([]);
  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // The path for a whole-site grant is always "".
  const SITE_PATH = "";

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/social/lab-site/editors?path=${encodeURIComponent(SITE_PATH)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        editors: EditorEntry[];
        members: MemberEntry[];
      };
      setEditors(Array.isArray(data.editors) ? data.editors : []);
      setMembers(Array.isArray(data.members) ? data.members : []);
    } catch {
      // Non-fatal: panel renders empty on error.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grant = useCallback(
    async (memberKey: string) => {
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch("/api/social/lab-site/editors", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: SITE_PATH, memberKey }),
        });
        if (!res.ok) {
          setMsg("Could not grant access right now.");
          return;
        }
        setPickerOpen(false);
        await load();
      } catch {
        setMsg("Could not grant access right now.");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const revoke = useCallback(
    async (memberKey: string) => {
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch("/api/social/lab-site/editors", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: SITE_PATH, memberKey }),
        });
        if (!res.ok) {
          setMsg("Could not revoke access right now.");
          return;
        }
        await load();
      } catch {
        setMsg("Could not revoke access right now.");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  // Members not already granted (the picker should not show existing editors).
  const editorKeys = useMemo(() => new Set(editors.map((e) => e.memberKey)), [editors]);
  const availableMembers = useMemo(
    () => members.filter((m) => !editorKeys.has(m.memberKey)),
    [members, editorKeys],
  );

  // Display label: use the stored email label when available, otherwise shorten
  // the owner key for readability.
  function memberLabel(entry: { memberKey: string; label: string | null }): string {
    if (entry.label) return entry.label;
    return entry.memberKey.length > 16
      ? `${entry.memberKey.slice(0, 8)}…`
      : entry.memberKey;
  }

  return (
    <section className="mb-6 rounded-xl border border-border bg-surface-raised p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="users" className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">
            Who can edit this site
          </h2>
        </div>
        <Tooltip label="Grant a lab member full create, edit, and publish access to this site">
          <button
            type="button"
            disabled={busy || availableMembers.length === 0}
            onClick={() => setPickerOpen((v) => !v)}
            className="ros-btn-neutral inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
          >
            <Icon name="plus" className="h-3.5 w-3.5" /> Add editor
          </button>
        </Tooltip>
      </div>

      <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
        Granted members can create, edit, and publish pages on{" "}
        <span className="font-medium">{slug}.research-os.com</span> without
        needing lab-wide Lab Manager access. Only you can add or remove editors.
      </p>

      {editors.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No editors yet. Add a lab member to let them manage this site.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {editors.map((e) => (
            <li
              key={e.memberKey}
              className="flex items-center justify-between px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{memberLabel(e)}</p>
                <p className="text-[11px] text-muted-foreground">
                  Granted{" "}
                  {new Date(e.grantedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              <Tooltip label="Remove this editor's access to the site">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revoke(e.memberKey)}
                  className="ros-btn-neutral inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Icon name="trash" className="h-3.5 w-3.5" /> Revoke
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}

      {pickerOpen && availableMembers.length > 0 && (
        <div className="mt-3 rounded-lg border border-border bg-surface-sunken p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Select a lab member to grant editor access:
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border bg-background">
            {availableMembers.map((m) => (
              <li key={m.memberKey}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void grant(m.memberKey)}
                  className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-raised disabled:opacity-50"
                >
                  {memberLabel(m)}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setPickerOpen(false)}
            className="mt-2 text-xs text-muted-foreground underline"
          >
            Cancel
          </button>
        </div>
      )}

      {members.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          No active lab members to add. Invite members from Lab settings first.
        </p>
      )}

      {msg && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {msg}
        </p>
      )}
    </section>
  );
}

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
  /**
   * True when the page is the home page ("" path) and its blocks_json contains
   * section blocks (section-hero, section-about, etc.). The homepage structured
   * editor is used for this page instead of the canvas editor.
   *
   * The server does not need to set this field; the client derives it from
   * hasBlocks + path being "".  It is included here for clarity.
   */
  hasSections?: boolean;
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

// ---------------------------------------------------------------------------
// GrantedSitesSection: "Sites you can edit" (visible to granted editors only)
// ---------------------------------------------------------------------------

interface GrantedSiteEntry {
  labOwnerKey: string;
  path: string;
  labSlug: string;
}

/**
 * Fetches GET /api/social/lab-site/editable on mount and renders a list of
 * companion sites the signed-in member has been granted editor access to.
 * Each entry links to the dashboard pre-scoped to that site (sets the
 * siteOwnerKey URL param so the dashboard loads the PI's site, not the
 * caller's own). Renders nothing when the caller has no grants.
 *
 * Security: the server derives the caller from the session and only returns
 * sites they are genuinely granted. No owner key is passed from the client.
 *
 * @param currentSiteOwnerKey  When the dashboard is already scoped to a
 *   granted site, pass that owner key so the section can highlight it.
 */
function GrantedSitesSection({
  currentSiteOwnerKey,
}: {
  currentSiteOwnerKey?: string;
}) {
  const [sites, setSites] = useState<GrantedSiteEntry[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/social/lab-site/editable");
        if (!res.ok) return;
        const data = (await res.json()) as { sites: GrantedSiteEntry[] };
        setSites(Array.isArray(data.sites) ? data.sites : []);
      } catch {
        // Non-fatal: if the request fails the section simply stays hidden.
      }
    })();
  }, []);

  if (sites.length === 0) return null;

  return (
    <section className="mb-6 rounded-xl border border-border bg-surface-raised p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon name="users" className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">
          Sites you can edit
        </h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
        Lab owners have granted you editor access to these companion sites. You
        can create, edit, and publish pages on each one.
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {sites.map((s) => {
          const isActive = currentSiteOwnerKey === s.labOwnerKey;
          return (
            <li
              key={`${s.labOwnerKey}-${s.path}`}
              className="flex items-center justify-between px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {s.labSlug}.research-os.com
                </p>
                {isActive && (
                  <p className="text-[11px] text-brand-600 dark:text-brand-400">
                    Currently editing
                  </p>
                )}
              </div>
              {isActive ? (
                <span className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground">
                  Open
                </span>
              ) : (
                <Tooltip label={`Open the builder for ${s.labSlug}.research-os.com`}>
                  <Link
                    href={`/account/lab-site?siteOwnerKey=${encodeURIComponent(s.labOwnerKey)}`}
                    className="ros-btn-neutral inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs"
                  >
                    <Icon name="pencil" className="h-3.5 w-3.5" /> Edit
                  </Link>
                </Tooltip>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function LabSiteDashboard({
  demoReadOnly = false,
  siteOwnerKey: siteOwnerKeyProp,
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
  /**
   * When a granted editor opens a PI's site, the route passes the site owner key
   * here (resolved from the ?siteOwnerKey= URL param). The dashboard then loads
   * THAT lab's site and pages instead of the caller's own, and threads the owner
   * key through every save and publish request so the write routes apply their
   * isSiteEditor check server-side.
   *
   * When undefined the dashboard behaves exactly as before (loads the caller's own
   * site, no siteOwnerKey in any request body). The PI's own dashboard never
   * receives this prop.
   */
  siteOwnerKey?: string;
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

  // Homepage structured-section editor state (P3). When editorIsSection is true
  // the home page ("" path) uses the LabSiteHomepageEditor instead of the canvas
  // or the markdown textarea. It shares editorBlocksJson + editorInitialBlocksJson
  // (the same blocks_json column) and the same publish flow as the canvas editor.
  // editorIsSection implies editorIsBlocks (the section editor writes blocks_json).
  const [editorIsSection, setEditorIsSection] = useState(false);

  // Pre-minted ?roEdit= token for the "View public site" link (token-handoff lane).
  // The server mints it in the GET response (server-side node:crypto). When present
  // the "View public site" link appends it so the .com public page can show the
  // prominent "Edit this site" bridge bar to the verified owner/editor.
  // Null when AUTH_SECRET is absent (token feature disabled, bridge degrades to
  // the static "Manage this site" hint). Token TTL = 10 min. After 10 min of
  // inactivity the owner would get the static hint, which is acceptable.
  const [editToken, setEditToken] = useState<string | null>(null);
  // True when the caller IS this site's owner. A siteOwnerKey in the URL equal to
  // the caller's own key resolves to owner mode server-side, so this guards the
  // granted-editor banner from showing on the owner's OWN site.
  const [isOwner, setIsOwner] = useState(false);

  const refresh = useCallback(async () => {
    try {
      // When the dashboard is scoped to a granted site, add the siteOwnerKey query
      // param so the server loads that PI's pages (the server re-checks isSiteEditor).
      const url = siteOwnerKeyProp
        ? `/api/social/lab-site?siteOwnerKey=${encodeURIComponent(siteOwnerKeyProp)}`
        : "/api/social/lab-site";
      const res = await fetch(url, { method: "GET" });
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
        ownerKey?: string;
        editToken?: string | null;
        isOwner?: boolean;
      };
      setSite(data.site);
      setPages(Array.isArray(data.pages) ? data.pages : []);
      setEditToken(data.editToken ?? null);
      setIsOwner(data.isOwner === true);
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }, [siteOwnerKeyProp]);

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
      // Section editor: the home page ("" path) always opens in the structured
      // section editor when it has blocks (or is being opened fresh). Non-home
      // pages always use the canvas editor even if their path happens to start
      // with "".
      const isSection = page.path === "" && isBlocks;
      setEditorIsSection(isSection);

      if (isBlocks && !demoReadOnly) {
        // Fetch the existing blocks_json for this page so the canvas/section
        // editor is pre-populated.
        // When a granted editor is editing a PI's site, include siteOwnerKey so
        // the server authorizes via isSiteEditor and returns that PI's blocks.
        // The server re-checks the grant on every fetch.
        try {
          const blocksParams = new URLSearchParams({ path: page.path });
          if (siteOwnerKeyProp) blocksParams.set("siteOwnerKey", siteOwnerKeyProp);
          const res = await fetch(
            `/api/social/lab-site/page/blocks?${blocksParams.toString()}`,
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
      setEditorIsSection(false);
      setEditorInitialBlocksJson(null);
      setEditorBlocksJson(null);
    }
    setEditorMsg(null);
    },
    [demoReadOnly, siteOwnerKeyProp],
  );

  const newPage = useCallback((asBlocks = false) => {
    setEditorPath("__new__");
    setEditorTitle("");
    setEditorBody("");
    setEditorIsBlocks(asBlocks);
    // New pages via this button are always non-home pages so the section editor
    // is never used here. The section editor is only wired for the "" home path.
    setEditorIsSection(false);
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
      // Blocks page: save via the canvas API route. Include siteOwnerKey when
      // editing a PI's site as a granted editor (server re-checks isSiteEditor).
      const blocksJson = editorBlocksJson ?? "[]";
      const res = await fetch("/api/social/lab-site/page/blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path,
          title: editorTitle,
          blocksJson,
          ...(siteOwnerKeyProp ? { siteOwnerKey: siteOwnerKeyProp } : {}),
        }),
      });
      if (!res.ok) throw new Error("Could not save the draft.");
      const data = (await res.json()) as { path: string };
      setEditorPath(data.path);
      return data.path;
    }

    // Markdown page: original path. Include siteOwnerKey for editor-grant path.
    const res = await fetch("/api/social/lab-site/page", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path,
        title: editorTitle,
        bodyMd: editorBody,
        ...(siteOwnerKeyProp ? { siteOwnerKey: siteOwnerKeyProp } : {}),
      }),
    });
    if (!res.ok) throw new Error("Could not save the draft.");
    const data = (await res.json()) as { page: PageSummary };
    setEditorPath(data.page.path);
    return data.page.path;
  }, [editorPath, editorTitle, editorBody, editorIsBlocks, editorBlocksJson, siteOwnerKeyProp]);

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
      // Include siteOwnerKey when publishing as a granted editor (server re-checks
      // isSiteEditor before the publish write).
      const endpoint = editorIsBlocks
        ? "/api/social/lab-site/page/blocks"
        : "/api/social/lab-site/page";
      const pub = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: savedPath,
          ...(snapshots ? { snapshots } : {}),
          ...(siteOwnerKeyProp ? { siteOwnerKey: siteOwnerKeyProp } : {}),
        }),
      });
      if (!pub.ok) throw new Error("Could not publish.");
    },
    [editorIsBlocks, siteOwnerKeyProp],
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
          // Blocks page save. Include siteOwnerKey for the editor-grant path.
          const blocksJson = editorBlocksJson ?? "[]";
          const res = await fetch("/api/social/lab-site/page/blocks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              path,
              title: editorTitle,
              blocksJson,
              ...(siteOwnerKeyProp ? { siteOwnerKey: siteOwnerKeyProp } : {}),
            }),
          });
          if (!res.ok) {
            setEditorMsg("Could not save the draft.");
            return;
          }
          const data = (await res.json()) as { path: string };
          setEditorPath(data.path);
          setEditorMsg("Draft saved.");
        } else {
          // Markdown page save (original path). Include siteOwnerKey for editor-grant path.
          const res = await fetch("/api/social/lab-site/page", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              path,
              title: editorTitle,
              bodyMd: editorBody,
              ...(siteOwnerKeyProp ? { siteOwnerKey: siteOwnerKeyProp } : {}),
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
    [editorPath, editorTitle, editorBody, refresh, demoReadOnly, flow, editorIsBlocks, editorBlocksJson, siteOwnerKeyProp],
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

        {/* Granted-editor context banner: shown when the dashboard is scoped to
            another PI's site. Lets the editor know they are acting as a granted
            editor, not the site owner, and provides a link back to their own
            dashboard. Hidden in demo mode (siteOwnerKeyProp is never set in demo)
            and when the caller is actually the owner (an own-key siteOwnerKey in
            the URL resolves to owner mode server-side, isOwner true). */}
        {siteOwnerKeyProp && !isOwner && !demoReadOnly && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-border bg-surface-sunken p-4">
            <Icon name="users" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                Editing as a granted editor
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You are managing this companion site on behalf of its owner. You
                can create, edit, and publish pages. Only the site owner can grant
                or revoke editor access.
              </p>
            </div>
            <Tooltip label="Go back to your own lab site dashboard">
              <Link
                href="/account/lab-site"
                className="ros-btn-neutral inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs"
              >
                My site
              </Link>
            </Tooltip>
          </div>
        )}

        {/* "Sites you can edit" section: shown when the caller is on their OWN
            dashboard (no siteOwnerKeyProp) and has at least one editor grant.
            Hidden in demo mode. Fetches lazily so it never blocks the main load. */}
        {!siteOwnerKeyProp && !demoReadOnly && (
          <GrantedSitesSection currentSiteOwnerKey={siteOwnerKeyProp} />
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
                {/* View public site: opens the live .com page in a new tab.
                    Token-handoff lane: when LAB_SITES_COM_ORIGIN_ENABLED and an
                    editToken is available (minted server-side in the GET response),
                    append ?roEdit=<token> so the .com page can detect the signed-in
                    owner/editor and show the "Edit this site" bridge bar instead of
                    the generic "Manage this site" hint. The token is short-lived
                    (10 min) and validated server-side on .com; no session or cookie
                    crosses origins. When the token is absent the link still works,
                    the public page just shows the static hint. */}
                <Tooltip label="Open your live public site to see what visitors see">
                  <a
                    href={(() => {
                      const base = LAB_SITES_COM_ORIGIN_ENABLED
                        ? `https://${site.slug}.research-os.com`
                        : `https://research-os.app/${site.slug}`;
                      return LAB_SITES_COM_ORIGIN_ENABLED && editToken
                        ? `${base}?roEdit=${encodeURIComponent(editToken)}`
                        : base;
                    })()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
                  >
                    <Icon name="globe" className="h-4 w-4" /> View public site
                  </a>
                </Tooltip>
                {/* Homepage section builder: open the home page ("" path) in the
                    structured editor. If the home page already exists, open it;
                    otherwise initialize a new one with the filled template. The
                    home page always gets the section editor, not the canvas. */}
                <Tooltip label="Build your lab homepage from structured sections (hero, about, team, publications, contact)">
                  <button
                    type="button"
                    onClick={() => {
                      const homePage = pages.find((p) => p.path === "");
                      if (homePage) {
                        // Existing home page: open it. Force isBlocks = true so
                        // the section editor path is taken even if hasBlocks is
                        // absent from the summary (server will populate from DB).
                        void openEditor({ ...homePage, hasBlocks: true });
                      } else {
                        // No home page yet: create a new one with section editor.
                        setEditorPath("__new__");
                        setEditorTitle("");
                        setEditorBody("");
                        setEditorIsBlocks(true);
                        setEditorIsSection(true);
                        setEditorInitialBlocksJson(null);
                        setEditorBlocksJson(null);
                        setEditorMsg(null);
                      }
                    }}
                    disabled={demoReadOnly}
                    title={demoReadOnly ? DEMO_EDIT_NOTE : undefined}
                    className="inline-flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 dark:border-green-700 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900"
                  >
                    <Icon name="globe" className="h-4 w-4" />{" "}
                    {pages.find((p) => p.path === "") ? "Edit home page" : "Build home page"}
                  </button>
                </Tooltip>
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

            {/* Slug rename and site-editor grants are PI-only controls. A granted
                editor (siteOwnerKeyProp set) has no authority to rename the slug
                or manage grants, so both panels are hidden in editor mode. */}
            {!demoReadOnly && !siteOwnerKeyProp && (
              <SlugRenameSection
                currentSlug={site.slug}
                onRenamed={(newSlug) => {
                  setSite((prev) => prev ? { ...prev, slug: newSlug } : prev);
                }}
              />
            )}

            {/* Site editor grants panel: PI only, hidden in demo mode and in
                granted-editor mode. */}
            {!demoReadOnly && !siteOwnerKeyProp && <SiteEditorsPanel slug={site.slug} />}

            {/* Storage and analytics panel: shown to the owner and to granted
                editors viewing the owner's site. Hidden in demo mode (no real
                metering data). The route gates by session + entitlement / editor
                grant server-side; the panel just renders what it receives. */}
            {!demoReadOnly && (
              <LabSiteUsagePanel siteOwnerKey={siteOwnerKeyProp} />
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
                          {p.hasBlocks && p.path !== "" && (
                            <span className="shrink-0 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300">
                              Canvas
                            </span>
                          )}
                          {p.path === "" && p.hasBlocks && (
                            <span className="shrink-0 rounded-full border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
                              Sections
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

            {/* BYO upload and GitHub-connect are PI-only (they manage the lab's
                static-site source, not page content). Hidden in demo mode and
                in granted-editor mode. */}
            {LAB_BYO_SITES_ENABLED && !demoReadOnly && !siteOwnerKeyProp && (
              <ByoUploadSection slug={site.slug} />
            )}
            {LAB_BYO_SITES_ENABLED && !demoReadOnly && !siteOwnerKeyProp && (
              <ByoGithubSection slug={site.slug} />
            )}

            {/* Lab badges (badges phase 2, flag-gated). Lets the lab head pin
                earned badges and publish them to the public lab page. PI-only,
                hidden in demo mode and in granted-editor mode. */}
            {BADGES_ENABLED && !siteOwnerKeyProp && (
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
                    {editorIsSection && (
                      <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
                        Sections
                      </span>
                    )}
                    {editorIsBlocks && !editorIsSection && (
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

                  {/* Homepage structured-section editor path (P3).
                      Used when editorIsSection is true (home page, "" path).
                      Renders a vertical list of typed section blocks (hero,
                      about, team, publications, contact) via simple forms.
                      Shares the same editorBlocksJson + publish flow as the
                      canvas editor (both write to blocks_json). */}
                  {editorIsSection ? (
                    <div className="mb-4">
                      <LabSiteHomepageEditor
                        initialBlocksJson={editorInitialBlocksJson}
                        labSlug={site?.slug}
                        onChange={setEditorBlocksJson}
                        disabled={demoReadOnly}
                      />
                    </div>
                  ) : editorIsBlocks ? (
                    /* Canvas editor path (blocks page, non-home) */
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
