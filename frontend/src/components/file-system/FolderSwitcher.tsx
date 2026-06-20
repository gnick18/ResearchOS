"use client";

// Folder switcher (Phase A, multi-folder). A small, calm dropdown that lists
// the folders the app remembers and lets the user switch the active lab/folder
// without the OS picker. Reachable from the app header (next to the workspace
// name) and offered on the connect screen.
//
// Behavior mirrors the app-wide header dropdown convention (see
// HeaderOverflowMenu / ProjectCardKebab): a trigger button, a role="menu"
// panel, Escape-to-close, and mousedown-outside-to-close. Never traps focus.
//
// Hard-gated by NEXT_PUBLIC_MULTI_FOLDER: when the flag is off the remembered
// set is always empty (the context never reads it), so this renders nothing and
// the header is byte-identical to today.
//
// Lab membership discovery (LAB_AS_FOLDER_ENABLED): when the feature flag is
// ON, this switcher also surfaces labs the relay knows about for the current
// account but that have no local member folder yet (joined on another device,
// joined before the flag, or after a folder-set reset). Those labs show as
// enterable rows; selecting one provisions the OPFS member folder via the
// existing checkAndEnterLab path. The discovery network call degrades
// gracefully (returns nothing) when the relay endpoint is not yet deployed.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons/Icon";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { MULTI_FOLDER_ENABLED } from "@/lib/file-system/multi-folder-config";
import {
  folderLabLabel,
  folderKindBadge,
  folderKindIcon,
  folderDisplayName,
  discoveredLabSublabel,
} from "@/lib/file-system/folder-lab-label";
import { LAB_AS_FOLDER_ENABLED } from "@/lib/lab/lab-as-folder-config";
import { CLASS_MODE_ENABLED } from "@/lib/lab/class-mode-config";
import CreateClassModal from "@/components/lab/CreateClassModal";
import { discoverMyLabMembershipsForIdentity } from "@/lib/lab/lab-membership-discovery";
import { checkAndEnterLab } from "@/lib/lab/lab-member-activation";
import { fetchLabProfile } from "@/lib/lab/lab-profile-client";
import { getCurrentUser } from "@/lib/file-system/indexeddb-store";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";

// Static pill classes per brand token (REFINEMENT 3 visual key). Tailwind v4
// only emits utilities it can see as whole strings, so the brand-token -> class
// pair is spelled out here rather than interpolated. Mirrors the existing Active
// pill (bg-accent/10 text-accent): a soft tint fill with the AA-legible token as
// the text color. folderKindBadge owns the role -> token mapping; this is just
// the lookup from that token to the two real classes.
const KIND_PILL_CLASS: Record<string, string> = {
  "brand-ink": "bg-brand-ink/10 text-brand-ink",
  "brand-action": "bg-brand-action/10 text-brand-action",
  "brand-purple": "bg-brand-purple/10 text-brand-purple",
  "brand-teach": "bg-brand-teach/10 text-brand-teach",
  "brand-teach-soft": "bg-brand-teach-soft/10 text-brand-teach-soft",
};

/** Format a lastOpenedAt timestamp as a short, calm relative string. */
function relativeOpened(ts: number): string {
  const diff = Date.now() - ts;
  if (!Number.isFinite(diff) || diff < 0) return "";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Opened just now";
  if (min < 60) return `Opened ${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Opened ${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `Opened ${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `Opened ${months} mo ago`;
}

export default function FolderSwitcher({
  /** When set, render as a full-width list (connect screen) instead of the
   *  compact header pill + dropdown. */
  variant = "header",
  /** Header tint state (passed from AppShell). When the header is colored
   *  (lab branding / colored header), the bare muted trigger washes out, so we
   *  render it as a white pill with dark text, mirroring the PillWrap the
   *  neighboring header controls use. We can't wrap this in PillWrap from
   *  AppShell because this component returns null when there is nothing to
   *  switch, which would leave an empty floating pill. */
  tinted = false,
  /** When true, the header variant does not hide itself for single-folder or
   *  zero-folder users. The pill still renders (showing the current folder name
   *  and the "Open another folder" row) so the control is permanently reachable
   *  from the header regardless of how many folders the user has remembered.
   *  Has no effect on the panel variant. */
  always = false,
}: {
  variant?: "header" | "panel";
  tinted?: boolean;
  always?: boolean;
}) {
  const {
    rememberedFolders,
    directoryName,
    switchFolder,
    forgetFolder,
    setFolderNickname,
    connect,
    listFolders,
  } = useFileSystem();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Id of the row currently being renamed inline (panel variant only), plus the
  // working text. Null means no row is in edit mode.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  // Class Mode (CM-P2A): the "Create a class" modal. Open state only; the modal
  // owns its own form/creating/warn/error phases. Flag-gated by CLASS_MODE_ENABLED
  // at the render site so when the flag is off the action never renders and this
  // never flips true.
  const [classModalOpen, setClassModalOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Lab membership discovery (LAB_AS_FOLDER_ENABLED only). Labs returned by the
  // relay that have no local member folder yet. These are labs the member joined
  // on another device or before the flag was on. Null = not yet fetched. [] =
  // fetched, nothing discovered (or flag off / relay not deployed yet).
  // labRole is the cached role for this lab when one is already known on a
  // remembered-folder meta (a folder forgotten then re-discovered). Class Mode
  // (CM-P2A) uses it so a class folder reads its true kind ("class"/"student")
  // instead of the generic "member". Absent for a genuinely new research-lab
  // membership, which falls back to the member label.
  type DiscoveredLab = {
    labId: string;
    labName?: string;
    labRole?: string;
  };
  const [discoveredLabs, setDiscoveredLabs] = useState<DiscoveredLab[] | null>(
    null,
  );
  // The labId currently being materialized (user clicked Enter on a discovered
  // lab). Only one at a time; the button disables others while this is set.
  const [materializingLabId, setMaterializingLabId] = useState<string | null>(
    null,
  );

  // Refresh the remembered set the first time the menu opens (or on mount for
  // the panel variant) so the list is current even if a different surface added
  // a folder since the last connect.
  useEffect(() => {
    if (!MULTI_FOLDER_ENABLED) return;
    if (variant === "panel" || open) {
      void listFolders();
    }
  }, [open, variant, listFolders]);

  // Run discovery when the menu opens (or on mount for the panel variant). Only
  // runs once per open session (null = unfetched; [] = fetched). Flag-gated: when
  // LAB_AS_FOLDER_ENABLED is off, this block is inert and discoveredLabs stays
  // null so the UI renders nothing extra (byte-identical to before the feature).
  useEffect(() => {
    if (!LAB_AS_FOLDER_ENABLED) return;
    if (!MULTI_FOLDER_ENABLED) return;
    if (discoveredLabs !== null) return; // already fetched this session
    if (variant !== "panel" && !open) return; // only fetch when visible

    let cancelled = false;

    async function runDiscovery() {
      const identity = getSessionIdentity();
      if (!identity) return;

      const labIds = await discoverMyLabMembershipsForIdentity(identity);
      if (cancelled) return;
      if (labIds.length === 0) {
        setDiscoveredLabs([]);
        return;
      }

      // Filter out labs that already have a local member folder so we only
      // surface genuinely missing memberships.
      const existingLabIds = new Set(
        rememberedFolders
          .filter((f) => f.labId !== undefined)
          .map((f) => f.labId as string),
      );
      const novel = labIds.filter((id) => !existingLabIds.has(id));
      if (cancelled || novel.length === 0) {
        setDiscoveredLabs([]);
        return;
      }

      // Fetch cosmetic names in parallel. Falls back to a shortened labId.
      const discovered: DiscoveredLab[] = await Promise.all(
        novel.map(async (labId) => {
          try {
            const profile = await fetchLabProfile(labId);
            return {
              labId,
              labName: profile?.labName || undefined,
            };
          } catch {
            return { labId };
          }
        }),
      );

      if (!cancelled) setDiscoveredLabs(discovered);
    }

    void runDiscovery();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variant, discoveredLabs, rememberedFolders.length]);

  // Enter a discovered lab: run the crypto proof (checkAndEnterLab) which also
  // provisions the OPFS member folder via recordMemberActivation when approved.
  // After activation the LabSignInGate mounts and kicks off the P2 pull
  // (useLabViewPull), so we do NOT call runLabViewPullForSession here directly.
  const onEnterDiscovered = useCallback(
    async (labId: string, labName?: string) => {
      if (busy || materializingLabId) return;
      const identity = getSessionIdentity();
      if (!identity) return;

      const username = await getCurrentUser();
      if (!username) return;

      setMaterializingLabId(labId);
      try {
        const result = await checkAndEnterLab({
          labId,
          username,
          identity,
          labName,
        });
        if (result.entered) {
          // Provisioning succeeded: remove this lab from the discovered list so
          // the row disappears and the freshly registered member folder will
          // appear in the remembered set on the next listFolders refresh.
          setDiscoveredLabs((prev) =>
            prev ? prev.filter((d) => d.labId !== labId) : prev,
          );
          void listFolders();
          setOpen(false);
        }
      } catch {
        // Provisioning error: leave the row so the user can retry.
      } finally {
        setMaterializingLabId(null);
      }
    },
    [busy, materializingLabId, listFolders],
  );

  useEscapeToClose(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Active folder is the one whose name matches the connected directory. Names
  // are not unique in general, but the connected directoryName is the live
  // signal we have in this component and is good enough to badge the row.
  const folders = useMemo(() => rememberedFolders, [rememberedFolders]);

  if (!MULTI_FOLDER_ENABLED) return null;

  // Header variant hides itself entirely when there is nothing to switch
  // between (zero or one folder and it is the active one). The "Open another
  // folder" action still lives in the connect screen and Settings, so the
  // header stays calm for solo single-folder users.
  // Exception: when `always` is true the pill stays visible regardless of how
  // many folders are remembered, so callers that want a permanent top-bar
  // control can opt in without changing the default behavior.
  if (variant === "header" && !always && folders.length <= 1) return null;

  async function onSwitch(id: string) {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    try {
      await switchFolder(id);
    } finally {
      setBusy(false);
    }
  }

  async function onForget(id: string, name: string) {
    if (busy) return;
    // Guard so a misplaced tap never silently drops a remembered folder. This
    // only removes the remembered handle, the on-disk data is untouched, and the
    // connect screen / picker stays one click away so the user is never trapped.
    const ok =
      typeof window === "undefined"
        ? true
        : window.confirm(
            `Forget "${name}"? This removes it from your remembered folders. Your files on disk are not changed and you can reconnect the folder later.`,
          );
    if (!ok) return;
    setBusy(true);
    try {
      await forgetFolder(id);
    } finally {
      setBusy(false);
    }
  }

  // REFINEMENT 3 nickname editing. Seeds the draft with the current nickname (not
  // the real name) so an existing nickname is edited in place and a blank field
  // means "no nickname yet". The real folder name is never touched.
  function startNickname(id: string, currentNickname: string) {
    if (busy) return;
    setEditingId(id);
    setDraftName(currentNickname);
  }

  function cancelNickname() {
    setEditingId(null);
    setDraftName("");
  }

  async function saveNickname(id: string) {
    // A blank draft is a valid save here: it CLEARS the nickname so the row falls
    // back to the real folder name. The writer trims and drops the key.
    const next = draftName;
    setBusy(true);
    try {
      await setFolderNickname(id, next);
    } finally {
      setBusy(false);
      cancelNickname();
    }
  }

  async function onOpenAnother() {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    try {
      await connect();
    } finally {
      setBusy(false);
    }
  }

  // Class Mode (CM-P2A): open the create-class modal. Close the dropdown first so
  // the modal owns the surface. The modal handles minting + switching itself.
  function onCreateClass() {
    if (busy) return;
    setOpen(false);
    setClassModalOpen(true);
  }

  function renderRows() {
    // Rename and the per-row controls are panel-only. The compact header
    // dropdown stays a quick switcher, the panel (connect screen / Settings) is
    // where folders are managed.
    const showManage = variant === "panel";
    return (
      <>
        {folders.map((f) => {
          const isActive = !!directoryName && f.name === directoryName;
          const isEditing = showManage && editingId === f.id;

          if (isEditing) {
            return (
              <div
                key={f.id}
                className="flex items-center gap-2 px-3 py-2"
              >
                <Icon
                  name={folderKindIcon(f)}
                  className="h-4 w-4 shrink-0 text-foreground-muted"
                />
                <input
                  type="text"
                  value={draftName}
                  autoFocus
                  disabled={busy}
                  placeholder={f.name}
                  aria-label={`Nickname for ${f.name}`}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveNickname(f.id);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelNickname();
                    }
                  }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground outline-none focus:border-accent"
                />
                <Tooltip label="Save nickname" placement="left">
                  <button
                    type="button"
                    aria-label="Save nickname"
                    disabled={busy}
                    onClick={() => void saveNickname(f.id)}
                    className="rounded-md p-1 text-foreground-muted transition hover:bg-surface-raised hover:text-foreground disabled:opacity-30"
                  >
                    <Icon name="check" className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
                <Tooltip label="Cancel" placement="left">
                  <button
                    type="button"
                    aria-label="Cancel nickname"
                    disabled={busy}
                    onClick={cancelNickname}
                    className="rounded-md p-1 text-foreground-muted transition hover:bg-surface-raised hover:text-foreground disabled:opacity-30"
                  >
                    <Icon name="close" className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>
            );
          }

          return (
            <div
              key={f.id}
              className="group flex items-center gap-2 px-3 py-2 hover:bg-surface-sunken"
            >
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => onSwitch(f.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-50"
              >
                <Icon
                  name={folderKindIcon(f)}
                  className="h-4 w-4 shrink-0 text-foreground-muted"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {folderDisplayName(f)}
                    </span>
                    {/* REFINEMENT 3 visual key. A short colored text pill per
                        folder KIND (solo / head / member / class / student), so a
                        profile holding several kinds can tell them apart at a
                        glance. Rides MULTI_FOLDER (this whole component is gated on
                        it), NOT class-gated, since it helps every multi-folder
                        user. No new glyph, the colored pill IS the key. */}
                    {(() => {
                      const badge = folderKindBadge(f);
                      const pill =
                        KIND_PILL_CLASS[badge.token] ??
                        KIND_PILL_CLASS["brand-ink"];
                      return (
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${pill}`}
                        >
                          {badge.label}
                        </span>
                      );
                    })()}
                    {isActive && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        <Icon name="check" className="h-3 w-3" />
                        Active
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-meta text-foreground-muted">
                    {/* Lab-as-folder (P1): when the feature is ON, show the
                        cached lab identity (Solo / "X - head" / "Y - member") so
                        the switcher reads as a lab switcher, followed by the
                        active / last-opened status. When the flag is OFF the line
                        is byte-identical to before the feature ("Active folder" /
                        relative time), so a pre-feature folder set is unchanged. */}
                    {LAB_AS_FOLDER_ENABLED ? (
                      <>
                        {folderLabLabel(f)} &middot;{" "}
                        {isActive ? "Active" : relativeOpened(f.lastOpenedAt)}
                      </>
                    ) : isActive ? (
                      "Active folder"
                    ) : (
                      relativeOpened(f.lastOpenedAt)
                    )}
                  </span>
                </span>
              </button>
              {showManage && (
                <Tooltip label="Nickname this folder" placement="left">
                  <button
                    type="button"
                    aria-label={`Nickname ${f.name}`}
                    disabled={busy}
                    onClick={() => startNickname(f.id, f.nickname ?? "")}
                    className="rounded-md p-1 text-foreground-muted opacity-0 transition hover:bg-surface-raised hover:text-foreground group-hover:opacity-100 disabled:opacity-30"
                  >
                    <Icon name="pencil" className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              )}
              <Tooltip label="Forget this folder" placement="left">
                <button
                  type="button"
                  aria-label={`Forget ${f.name}`}
                  disabled={busy}
                  onClick={() => onForget(f.id, f.name)}
                  className="rounded-md p-1 text-foreground-muted opacity-0 transition hover:bg-surface-raised hover:text-foreground group-hover:opacity-100 disabled:opacity-30"
                >
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
          );
        })}
        {/* Lab membership discovery (LAB_AS_FOLDER_ENABLED). Show labs from the
            relay that exist server-side but have no local member folder yet. A
            null discoveredLabs means the fetch has not run or the flag is off,
            in which case this block renders nothing (byte-identical to before).
            An empty array means the fetch ran and nothing new was found. */}
        {LAB_AS_FOLDER_ENABLED &&
          discoveredLabs !== null &&
          discoveredLabs.length > 0 && (
            <>
              <div className="border-t border-border px-3 pb-1 pt-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                  Available to join
                </span>
              </div>
              {discoveredLabs.map((d) => {
                const isMaterializing = materializingLabId === d.labId;
                const displayName = d.labName ?? `Lab ${d.labId.slice(0, 6)}`;
                return (
                  <div
                    key={d.labId}
                    className="group flex items-center gap-2 px-3 py-2 hover:bg-surface-sunken"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Icon
                        name={
                          d.labRole === "class" || d.labRole === "student"
                            ? "mortarboard"
                            : "users"
                        }
                        className="h-4 w-4 shrink-0 text-foreground-muted"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="truncate text-sm font-medium text-foreground">
                          {displayName}
                        </span>
                        <span className="block truncate text-meta text-foreground-muted">
                          {isMaterializing
                            ? "Connecting..."
                            : discoveredLabSublabel(d.labRole)}
                        </span>
                      </span>
                    </div>
                    <Tooltip label="Enter this lab" placement="left">
                      <button
                        type="button"
                        role="menuitem"
                        aria-label={`Enter ${displayName}`}
                        disabled={
                          busy ||
                          isMaterializing ||
                          materializingLabId !== null
                        }
                        onClick={() =>
                          void onEnterDiscovered(d.labId, d.labName)
                        }
                        className="shrink-0 rounded-md bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-40"
                      >
                        {isMaterializing ? (
                          <Icon name="hourglass" className="h-3.5 w-3.5" />
                        ) : (
                          "Enter"
                        )}
                      </button>
                    </Tooltip>
                  </div>
                );
              })}
            </>
          )}
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={onOpenAnother}
          className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-foreground-muted hover:bg-surface-sunken hover:text-foreground disabled:opacity-50"
        >
          <Icon name="plus" className="h-4 w-4 shrink-0" />
          <span>Open another folder</span>
        </button>
        {/* Class Mode (CM-P2A). Offered to ANY account (the multi-folder
            substrate is account-agnostic, so a solo user can hold a class folder
            exactly like a lab head). Gated ONLY on CLASS_MODE_ENABLED, so when the
            flag is off this row never renders and the panel is byte-identical to
            before the feature. The mortarboard glyph is the Grant-approved
            Class Mode glyph (a graduation cap). */}
        {CLASS_MODE_ENABLED && (
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={onCreateClass}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-foreground-muted hover:bg-surface-sunken hover:text-foreground disabled:opacity-50"
          >
            <Icon name="mortarboard" className="h-4 w-4 shrink-0" />
            <span>Create a class</span>
          </button>
        )}
      </>
    );
  }

  // Class Mode (CM-P2A): the create-class modal, mounted once and shared by both
  // variants. Inert (never opens) when CLASS_MODE_ENABLED is off because the only
  // affordance that flips classModalOpen is itself flag-gated.
  const classModal =
    CLASS_MODE_ENABLED && classModalOpen ? (
      <CreateClassModal
        onClose={() => setClassModalOpen(false)}
        onCreated={() => {
          void listFolders();
        }}
      />
    ) : null;

  if (variant === "panel") {
    return (
      <>
        <div className="rounded-xl border border-border bg-surface-raised py-1">
          {renderRows()}
        </div>
        {classModal}
      </>
    );
  }

  // Header variant: a compact pill that shows the active folder name and opens
  // a dropdown of the remembered set.
  const label = directoryName || "Switch folder";
  // The collapsed trigger shows the ACTIVE folder's kind glyph (crown / users /
  // mortarboard / user) so the current context reads at a glance, matching the
  // rows. Falls back to the neutral folder icon when nothing is connected.
  const activeFolderKindIcon = (() => {
    const active = folders.find((f) => f.name === directoryName);
    return active ? folderKindIcon(active) : "folder";
  })();
  return (
    <div ref={wrapRef} className="relative inline-flex">
      <Tooltip label="Switch folder" placement="bottom">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="folder-switcher-trigger"
          onClick={() => setOpen((v) => !v)}
          className={
            tinted
              ? // On the colored header the pill is forced bg-white in BOTH
                // themes, so the text must be a theme-invariant dark (text-gray-900),
                // matching the active nav-tab pill. text-foreground would be light
                // in dark mode = invisible on white.
                "flex max-w-[180px] items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm font-medium text-gray-900 shadow-sm transition-colors hover:bg-white/90"
              : "flex max-w-[180px] items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          }
        >
          <Icon name={activeFolderKindIcon} className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
          <Icon name="chevronDown" className="h-3.5 w-3.5 shrink-0" />
        </button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-50 mt-1 w-64 max-w-[80vw] overflow-hidden rounded-xl border border-border bg-surface-raised py-1 shadow-lg"
        >
          {renderRows()}
        </div>
      )}
      {classModal}
    </div>
  );
}
