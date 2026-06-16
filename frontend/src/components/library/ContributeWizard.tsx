"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Kicker from "@/components/marketing/Kicker";
import { Icon } from "@/components/icons";
import {
  looksLikeSvg,
  ALLOWED_CONTRIBUTION_LICENSES,
} from "@/lib/library/asset-validate";
import { useLibraryActor, normalizeHandle } from "./use-library-actor";

/**
 * The community contribution wizard (Part 3a). Drag in one or many SVGs, set the
 * license + tags + citation (in bulk across a selection, or per icon), affirm the
 * rights, and submit. Accepted icons auto-publish flagged "unverified for
 * accuracy" until an independent reviewer vouches.
 *
 * Single-screen with a spreadsheet-style grid rather than a step wizard, because
 * the whole point is editing a SET at once. SVG previews render via a blob URL in
 * an <img> (never injected into the DOM) so an uploaded file cannot execute.
 *
 * Voice rules: no em-dashes, no emojis, no mid-sentence colons.
 */

const MAX_ITEMS = 50;
const MAX_SVG_BYTES = 256 * 1024;

interface StagedItem {
  id: string;
  fileName: string;
  svg: string;
  previewUrl: string;
  valid: boolean;
  error: string | null;
  title: string;
  license: string;
  creator: string;
  sourceUrl: string;
  category: string;
  tags: string;
  rightsAffirmed: boolean;
}

function titleFromFileName(name: string): string {
  return name.replace(/\.svg$/i, "").replace(/[_-]+/g, " ").trim();
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done"; count: number }
  | { kind: "error"; message: string };

export default function ContributeWizard() {
  const actor = useLibraryActor();
  const [items, setItems] = useState<StagedItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The contributor identity is the same persisted @handle used to review, so a
  // contribution and its later peer-review are attributed to one consistent actor.
  const [submittedBy, setSubmittedBy] = useState("");
  useEffect(() => {
    if (actor.handle) setSubmittedBy(actor.handle);
  }, [actor.handle]);
  const [bulk, setBulk] = useState({ license: "", creator: "", category: "", tags: "" });
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList) return;
      const incoming: StagedItem[] = [];
      for (const file of Array.from(fileList)) {
        if (items.length + incoming.length >= MAX_ITEMS) break;
        const svg = await file.text();
        const tooBig = new Blob([svg]).size > MAX_SVG_BYTES;
        const ok = !tooBig && looksLikeSvg(svg);
        incoming.push({
          id: crypto.randomUUID(),
          fileName: file.name,
          svg,
          previewUrl: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
          valid: ok,
          error: tooBig ? "Larger than 256 KB" : ok ? null : "Not a valid SVG",
          title: titleFromFileName(file.name),
          license: "",
          creator: "",
          sourceUrl: "",
          category: "",
          tags: "",
          rightsAffirmed: false,
        });
      }
      setItems((prev) => [...prev, ...incoming]);
    },
    [items.length],
  );

  const update = (id: string, patch: Partial<StagedItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const remove = (id: string) => {
    setItems((prev) => {
      const gone = prev.find((it) => it.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((it) => it.id !== id);
    });
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((it) => it.id)));

  const applyBulk = () => {
    if (selected.size === 0) return;
    setItems((prev) =>
      prev.map((it) =>
        selected.has(it.id)
          ? {
              ...it,
              ...(bulk.license ? { license: bulk.license } : {}),
              ...(bulk.creator ? { creator: bulk.creator } : {}),
              ...(bulk.category ? { category: bulk.category } : {}),
              ...(bulk.tags ? { tags: bulk.tags } : {}),
            }
          : it,
      ),
    );
  };

  const affirmSelected = () =>
    setItems((prev) =>
      prev.map((it) => (selected.has(it.id) ? { ...it, rightsAffirmed: true } : it)),
    );

  const readyCount = useMemo(
    () => items.filter((it) => it.valid && it.title.trim() && it.license && it.rightsAffirmed).length,
    [items],
  );
  const canSubmit = items.length > 0 && readyCount === items.length && submit.kind !== "submitting";

  const doSubmit = async () => {
    setSubmit({ kind: "submitting" });
    const me = normalizeHandle(submittedBy);
    if (me) actor.setHandle(me); // persist so the same handle reviews later
    try {
      const res = await fetch("/api/library/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submittedBy: me || null,
          items: items.map((it) => ({
            svg: it.svg,
            title: it.title.trim(),
            license: it.license,
            creator: it.creator.trim() || null,
            sourceUrl: it.sourceUrl.trim() || null,
            category: it.category.trim() || null,
            tags: it.tags.split(",").map((t) => t.trim()).filter(Boolean),
            rightsAffirmed: it.rightsAffirmed,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSubmit({ kind: "error", message: data?.error || `Request failed (${res.status})` });
        return;
      }
      items.forEach((it) => URL.revokeObjectURL(it.previewUrl));
      setItems([]);
      setSelected(new Set());
      setSubmit({ kind: "done", count: data.count });
    } catch (err) {
      setSubmit({ kind: "error", message: (err as Error).message });
    }
  };

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />
      {/* Persistent way back to the library, available the whole time you are
          staging icons (not just from the post-publish success screen). */}
      <div className="mx-auto max-w-6xl px-6 pt-4">
        <Link
          href="/library"
          className="inline-flex items-center gap-1.5 text-meta font-semibold text-foreground-muted transition hover:text-brand-action"
        >
          <Icon name="chevronLeft" className="h-4 w-4" /> Back to the library
        </Link>
      </div>
      <section className="relative overflow-hidden">
        <MarketingBackdrop tone="vivid" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 pb-8 pt-14 text-center sm:pt-20">
          <div className="flex justify-center">
            <Kicker>Contribute</Kicker>
          </div>
          <h1 className="mx-auto mt-4 max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Add your icons to the open library
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-foreground-muted">
            Upload one or many SVGs, license them openly, and tag and cite them in
            bulk. Icons go live flagged unverified for accuracy until an
            independent reviewer checks them.
          </p>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-10">
          {submit.kind === "done" ? (
            <div className="rounded-2xl border border-border bg-surface-raised/70 p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-action/10 text-brand-action">
                <Icon name="check" className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-xl font-bold">
                {submit.count} {submit.count === 1 ? "icon" : "icons"} published
              </h2>
              <p className="mx-auto mt-2 max-w-md text-foreground-muted">
                They are live now, flagged unverified for accuracy until an
                independent reviewer checks them. You cannot clear your own flag.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link
                  href="/library"
                  className="inline-flex items-center gap-2 rounded-full bg-brand-action px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
                >
                  Browse the library
                </Link>
                <button
                  type="button"
                  onClick={() => setSubmit({ kind: "idle" })}
                  className="inline-flex items-center gap-2 rounded-full border border-border-strong px-5 py-2.5 text-sm font-semibold hover:border-brand-action"
                >
                  Contribute more
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Drop zone. data-attach-target opts this surface into the
                  window-level GlobalDropGuard allow-list (and stopPropagation on
                  the drop keeps the guard's "not supported" toast from firing over
                  a zone that DOES handle the file), same as the task/note/method
                  attach surfaces. */}
              <div
                data-attach-target
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(false);
                  void addFiles(e.dataTransfer.files);
                }}
                className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
                  dragOver ? "border-brand-action bg-brand-action/5" : "border-border-strong"
                }`}
              >
                <Icon name="plus" className="h-8 w-8 text-foreground-faint" />
                <p className="mt-3 font-semibold">Drop SVG files here</p>
                <p className="mt-1 text-meta text-foreground-muted">
                  Up to {MAX_ITEMS} at once, 256 KB each. Vector SVG only.
                </p>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="mt-4 rounded-full border border-border-strong px-4 py-2 text-sm font-semibold hover:border-brand-action"
                >
                  Choose files
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".svg,image/svg+xml"
                  multiple
                  className="hidden"
                  onChange={(e) => void addFiles(e.target.files)}
                />
              </div>

              {items.length > 0 && (
                <>
                  {/* Bulk bar */}
                  <div className="mt-6 rounded-xl border border-border bg-surface-sunken p-3">
                    <div className="mb-2 flex items-center gap-2 text-meta font-semibold text-foreground-muted">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                      <span>
                        {selected.size > 0
                          ? `Apply to ${selected.size} selected`
                          : "Select rows to bulk-edit"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={bulk.license}
                        onChange={(e) => setBulk({ ...bulk, license: e.target.value })}
                        className="rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-meta"
                      >
                        <option value="">License...</option>
                        {ALLOWED_CONTRIBUTION_LICENSES.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                      <input
                        value={bulk.creator}
                        onChange={(e) => setBulk({ ...bulk, creator: e.target.value })}
                        placeholder="Creator"
                        className="w-32 rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-meta"
                      />
                      <input
                        value={bulk.category}
                        onChange={(e) => setBulk({ ...bulk, category: e.target.value })}
                        placeholder="Category"
                        className="w-32 rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-meta"
                      />
                      <input
                        value={bulk.tags}
                        onChange={(e) => setBulk({ ...bulk, tags: e.target.value })}
                        placeholder="Tags (comma separated)"
                        className="w-48 rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-meta"
                      />
                      <button
                        type="button"
                        onClick={applyBulk}
                        disabled={selected.size === 0}
                        className="rounded-full bg-brand-action px-3 py-1.5 text-meta font-semibold text-white disabled:opacity-40"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={affirmSelected}
                        disabled={selected.size === 0}
                        className="rounded-full border border-border-strong px-3 py-1.5 text-meta font-semibold disabled:opacity-40"
                      >
                        Affirm rights
                      </button>
                    </div>
                  </div>

                  {/* Grid */}
                  <div className="mt-4 space-y-2">
                    {items.map((it) => (
                      <div
                        key={it.id}
                        className={`flex flex-wrap items-start gap-3 rounded-xl border p-3 ${
                          it.valid ? "border-border" : "border-red-400"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(it.id)}
                          onChange={() => toggleSelect(it.id)}
                          className="mt-2"
                        />
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-sunken p-1.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={it.previewUrl} alt={it.title} className="h-full w-full object-contain" />
                        </div>
                        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
                          <input
                            value={it.title}
                            onChange={(e) => update(it.id, { title: e.target.value })}
                            placeholder="Title"
                            className="col-span-2 rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-meta sm:col-span-1"
                          />
                          <select
                            value={it.license}
                            onChange={(e) => update(it.id, { license: e.target.value })}
                            className={`rounded-lg border bg-surface px-2 py-1.5 text-meta ${it.license ? "border-border-strong" : "border-red-400"}`}
                          >
                            <option value="">License...</option>
                            {ALLOWED_CONTRIBUTION_LICENSES.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.id}
                              </option>
                            ))}
                          </select>
                          <input
                            value={it.category}
                            onChange={(e) => update(it.id, { category: e.target.value })}
                            placeholder="Category"
                            className="rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-meta"
                          />
                          <input
                            value={it.creator}
                            onChange={(e) => update(it.id, { creator: e.target.value })}
                            placeholder="Creator (for attribution)"
                            className="rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-meta"
                          />
                          <input
                            value={it.tags}
                            onChange={(e) => update(it.id, { tags: e.target.value })}
                            placeholder="Tags (comma separated)"
                            className="rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-meta"
                          />
                          <input
                            value={it.sourceUrl}
                            onChange={(e) => update(it.id, { sourceUrl: e.target.value })}
                            placeholder="Source URL (optional)"
                            className="rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-meta"
                          />
                          <label className="col-span-2 flex items-center gap-2 text-meta text-foreground-muted sm:col-span-3">
                            <input
                              type="checkbox"
                              checked={it.rightsAffirmed}
                              onChange={(e) => update(it.id, { rightsAffirmed: e.target.checked })}
                            />
                            I created this or hold the right to contribute it under an open license.
                          </label>
                          {it.error && <p className="col-span-2 text-meta text-red-600 sm:col-span-3">{it.error}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => remove(it.id)}
                          className="rounded-lg p-1 text-foreground-faint hover:text-red-600"
                          aria-label="Remove"
                        >
                          <Icon name="close" className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Submitter + submit */}
                  <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-surface-raised/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex-1">
                      <label className="text-meta font-semibold">Your @handle</label>
                      <input
                        value={submittedBy}
                        onChange={(e) => setSubmittedBy(e.target.value)}
                        onBlur={() => submittedBy.trim() && actor.setHandle(submittedBy)}
                        placeholder="So others can credit and verify your contribution"
                        className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-meta sm:max-w-xs"
                      />
                      <p className="mt-1 text-[11px] text-foreground-faint">
                        Used to credit you and to enforce independent review (you
                        cannot verify your own submission). The same handle is used
                        when you review.
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="mb-2 text-meta text-foreground-muted">
                        {readyCount} of {items.length} ready
                      </p>
                      <button
                        type="button"
                        onClick={doSubmit}
                        disabled={!canSubmit}
                        className="inline-flex items-center gap-2 rounded-full bg-brand-action px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        {submit.kind === "submitting"
                          ? "Publishing..."
                          : `Publish ${items.length} ${items.length === 1 ? "icon" : "icons"}`}
                      </button>
                    </div>
                  </div>
                  {submit.kind === "error" && (
                    <p className="mt-3 text-meta text-red-600">{submit.message}</p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
