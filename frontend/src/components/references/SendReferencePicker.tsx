"use client";

// Seamless export, the "push" direction (2026-06-11). Opened from an object
// (a sequence, a molecule) by a "Send to..." action. Lists the user's notes,
// experiments, and markdown methods as destinations; picking one appends the
// object's reference chip straight into that document via sendReferenceToTarget,
// no copy-paste.
//
// The shell + keyboard model mirror ReferencePicker (the pull-direction picker)
// so the two read as one feature: auto-focused search, Arrow Up/Down to move,
// Enter to send, Tab to switch destination type. Experiments expose two docs, so
// a Results / Lab Notes toggle on that tab chooses which one the chip lands in.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  notesApi,
  methodsApi,
  fetchAllTasksIncludingShared,
  buildCurrentViewer,
} from "@/lib/local-api";
import { canWrite } from "@/lib/sharing/unified";
import {
  sendReferenceToTarget,
  type SendTarget,
} from "@/lib/references/send-to-target";
import type { Note, Task, Method } from "@/lib/types";

type Tab = "notes" | "experiments" | "methods";
type ExpSurface = "results" | "labnotes";

interface PickerItem {
  key: string;
  label: string;
  sublabel?: string;
  target: SendTarget;
}

interface SendReferencePickerProps {
  /** The objectReferenceMarkdown(...) string to push into the chosen target. */
  referenceMarkdown: string;
  /** The source object's name, shown in the header for context. */
  sourceLabel: string;
  onClose: () => void;
  /** Reports the outcome so the caller can toast. ok=false on a failed send. */
  onResult?: (message: string, ok: boolean) => void;
}

async function loadTargets(): Promise<{
  notes: Note[];
  experiments: Task[];
  methods: Method[];
}> {
  const [viewer, notes, tasks, methods] = await Promise.all([
    buildCurrentViewer(),
    notesApi.list().catch(() => [] as Note[]),
    fetchAllTasksIncludingShared().catch(() => [] as Task[]),
    methodsApi.list().catch(() => [] as Method[]),
  ]);
  // Only offer targets the viewer can actually write to, so a send to a
  // view-only shared note / experiment / method never fails after the fact.
  // Notes route by `username` (their owner-folder field), tasks + methods by
  // `owner`; both carry `shared_with` for the edit-share check.
  return {
    notes: notes.filter((n) =>
      canWrite({ owner: n.username, shared_with: n.shared_with ?? [] }, viewer),
    ),
    experiments: tasks.filter(
      (t) =>
        t.task_type === "experiment" &&
        canWrite({ owner: t.owner, shared_with: t.shared_with ?? [] }, viewer),
    ),
    // A chip can only be appended to a markdown method's body, and only if the
    // viewer can write it.
    methods: methods.filter(
      (m) =>
        m.method_type === "markdown" &&
        m.source_path &&
        canWrite({ owner: m.owner, shared_with: m.shared_with ?? [] }, viewer),
    ),
  };
}

function Row({
  item,
  highlighted,
  onPick,
  onHover,
}: {
  item: PickerItem;
  highlighted: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      data-highlighted={highlighted ? "1" : undefined}
      onClick={onPick}
      onMouseMove={onHover}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
        highlighted ? "bg-accent-soft" : "hover:bg-accent-soft"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-foreground truncate">{item.label}</p>
        {item.sublabel && (
          <p className="text-meta text-foreground-muted truncate">{item.sublabel}</p>
        )}
      </div>
    </button>
  );
}

export default function SendReferencePicker({
  referenceMarkdown,
  sourceLabel,
  onClose,
  onResult,
}: SendReferencePickerProps) {
  const [tab, setTab] = useState<Tab>("notes");
  const [expSurface, setExpSurface] = useState<ExpSurface>("results");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [experiments, setExperiments] = useState<Task[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadTargets()
      .then((d) => {
        if (cancelled) return;
        setNotes(d.notes);
        setExperiments(d.experiments);
        setMethods(d.methods);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const q = query.trim().toLowerCase();

  const noteItems = useMemo<PickerItem[]>(
    () =>
      notes
        .filter((n) => !q || (n.title ?? "").toLowerCase().includes(q))
        .map((n) => ({
          key: `note-${n.id}-${n.username}`,
          label: n.title || `Note ${n.id}`,
          sublabel: "Note",
          target: {
            kind: "note",
            id: n.id,
            owner: n.username,
            name: n.title || `Note ${n.id}`,
          },
        })),
    [notes, q],
  );

  const experimentItems = useMemo<PickerItem[]>(
    () =>
      experiments
        .filter((t) => !q || (t.name ?? "").toLowerCase().includes(q))
        .map((t) => ({
          key: `exp-${t.id}-${t.owner}`,
          label: t.name,
          sublabel:
            (expSurface === "results" ? "Results" : "Lab Notes") +
            (t.start_date ? ` · ${t.start_date}` : ""),
          target: {
            kind: expSurface === "results" ? "experiment-results" : "experiment-labnotes",
            id: t.id,
            owner: t.owner,
            name: t.name,
          },
        })),
    [experiments, q, expSurface],
  );

  const methodItems = useMemo<PickerItem[]>(
    () =>
      methods
        .filter((m) => !q || (m.name ?? "").toLowerCase().includes(q))
        .map((m) => ({
          key: `method-${m.id}-${m.owner}`,
          label: m.name,
          sublabel: "Method",
          target: {
            kind: "method",
            id: m.id,
            owner: m.owner,
            name: m.name,
            sourcePath: m.source_path,
          },
        })),
    [methods, q],
  );

  const itemsByTab: Record<Tab, PickerItem[]> = {
    notes: noteItems,
    experiments: experimentItems,
    methods: methodItems,
  };
  const items = itemsByTab[tab];

  const tabMeta: Record<Tab, string> = {
    notes: "Notes",
    experiments: "Experiments",
    methods: "Methods",
  };
  const availableTabs: Tab[] = ["notes", "experiments", "methods"];

  useEffect(() => {
    setHighlighted(0);
  }, [tab, q, expSurface]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-highlighted="1"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [highlighted, items]);

  const send = useCallback(
    async (item: PickerItem) => {
      if (sending) return;
      setSending(true);
      try {
        await sendReferenceToTarget(item.target, referenceMarkdown);
        onResult?.(`Added to "${item.target.name}".`, true);
        onClose();
      } catch {
        onResult?.(`Could not add to "${item.target.name}".`, false);
        setSending(false);
      }
    },
    [sending, referenceMarkdown, onResult, onClose],
  );

  const cycleTab = useCallback(
    (dir: 1 | -1) => {
      const idx = availableTabs.indexOf(tab);
      const next = (idx + dir + availableTabs.length) % availableTabs.length;
      setTab(availableTabs[next]);
    },
    // availableTabs is a stable literal
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab],
  );

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, Math.max(0, items.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[highlighted];
        if (item) void send(item);
      } else if (e.key === "Tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
      }
    },
    [items, highlighted, send, cycleTab],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Send reference"
        className="w-full max-w-md bg-surface-raised border border-border rounded-xl shadow-2xl flex flex-col max-h-[70vh]"
      >
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-border shrink-0">
          <Icon name="export" className="w-4 h-4 text-foreground-muted" />
          <span className="text-body font-semibold text-foreground flex-1 min-w-0 truncate">
            Send {sourceLabel} to…
          </span>
          <Tooltip label="Close" placement="left">
            <button
              type="button"
              aria-label="Close send picker"
              onClick={onClose}
              className="p-1 rounded hover:bg-accent-soft text-foreground-muted hover:text-foreground transition-colors"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        <div className="px-4 py-2 shrink-0">
          <div className="relative">
            <Icon
              name="search"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted pointer-events-none"
            />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search, then Arrow keys and Enter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              className="w-full pl-8 pr-3 py-1.5 text-body text-foreground bg-surface border border-border rounded-lg outline-none focus:border-brand-action placeholder:text-foreground-muted"
            />
          </div>
        </div>

        <div className="flex items-center gap-1 px-4 pb-2 shrink-0">
          {availableTabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-meta rounded-md transition-colors font-medium ${
                tab === t
                  ? "bg-brand-action text-white"
                  : "text-foreground-muted hover:bg-accent-soft hover:text-foreground"
              }`}
            >
              {tabMeta[t]}
              {!loading && (
                <span className="ml-1.5 text-[11px] opacity-70">
                  {itemsByTab[t].length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Experiments expose two docs, so choose which one the chip lands in. */}
        {tab === "experiments" && (
          <div className="px-4 pb-2 shrink-0">
            <div
              role="group"
              aria-label="Destination doc"
              className="inline-flex rounded-lg border border-border p-0.5 bg-surface-sunken ros-seg-track"
            >
              <button
                type="button"
                aria-pressed={expSurface === "results"}
                onClick={() => setExpSurface("results")}
                className={`px-3 py-1 text-meta font-medium rounded-md transition-colors ${
                  expSurface === "results"
                    ? "bg-surface-raised text-foreground ros-seg-active"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                Results
              </button>
              <button
                type="button"
                aria-pressed={expSurface === "labnotes"}
                onClick={() => setExpSurface("labnotes")}
                className={`px-3 py-1 text-meta font-medium rounded-md transition-colors ${
                  expSurface === "labnotes"
                    ? "bg-surface-raised text-foreground ros-seg-active"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                Lab Notes
              </button>
            </div>
          </div>
        )}

        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
          {loading ? (
            <p className="text-meta text-foreground-muted py-4 text-center">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-meta text-foreground-muted py-4 text-center">
              {q
                ? `No ${tabMeta[tab].toLowerCase()} match that search.`
                : `No ${tabMeta[tab].toLowerCase()} yet.`}
            </p>
          ) : (
            <div className="space-y-0.5">
              {items.map((item, i) => (
                <Row
                  key={item.key}
                  item={item}
                  highlighted={i === highlighted}
                  onPick={() => void send(item)}
                  onHover={() => setHighlighted(i)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border shrink-0 text-[11px] text-foreground-muted flex items-center gap-3">
          {sending ? (
            <span>Sending…</span>
          ) : (
            <>
              <span>Arrow keys to move</span>
              <span>Enter to send</span>
              <span>Tab to switch type</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
