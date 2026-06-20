"use client";

// Lab homepage structured-section editor (P3 homepage builder, social lane).
//
// A vertical list of SECTION blocks (hero, about, team, publications, contact)
// that the PI fills via simple forms. Distinct from the freeform canvas editor
// (LabSiteCanvasEditor.tsx) which is for companion data-site pages.
//
// Design rules:
//   - Sections are reordered via up/down buttons, not drag-and-drop. The list
//     is linear; canvas-style pixel placement is not the goal here.
//   - Each section is collapsed to a title bar by default and expands in place
//     when the PI clicks "Edit". Only one section is expanded at a time so the
//     overall page structure remains visible.
//   - The editor calls onChange after every field change so the parent can
//     persist via setEditorBlocksJson without an extra save step.
//   - Starts from makeHomepageSectionTemplate when blocks_json is absent (first
//     open of a new home page).
//   - Uses the SAME parseLabSiteBlocks / serializeLabSiteBlocks as the canvas
//     editor so the blocks_json format is identical on disk.
//   - Section block kinds: "section-hero", "section-about", "section-team",
//     "section-publications", "section-contact". All other kinds in a blocks_json
//     are preserved in position (kept as unknown, not shown in this editor, not
//     dropped) so a PI who mixed section + canvas blocks does not lose data.
//     In practice the home page editor only emits section blocks.
//
// Gate: rendered only for the home page ("" path) when editorIsSection is true.
// The caller (LabSiteDashboard) sets that flag based on path.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  type SectionBlock,
  type HeroSectionBlock,
  type AboutSectionBlock,
  type TeamSectionBlock,
  type PublicationsSectionBlock,
  type ContactSectionBlock,
  type TeamMember,
  type PublicationEntry,
  type LabSiteBlock,
  isSectionBlockKind,
  parseLabSiteBlocks,
  serializeLabSiteBlocks,
  makeHomepageSectionTemplate,
} from "@/lib/social/lab-site-blocks";

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `s${Math.random().toString(36).slice(2, 10)}`;
}

function generateMemberId(): string {
  return `m${Math.random().toString(36).slice(2, 10)}`;
}

function generatePubId(): string {
  return `p${Math.random().toString(36).slice(2, 10)}`;
}

/** Humanize a section kind for display. */
function sectionLabel(kind: SectionBlock["kind"]): string {
  switch (kind) {
    case "section-hero":
      return "Hero";
    case "section-about":
      return "About";
    case "section-team":
      return "Team";
    case "section-publications":
      return "Publications";
    case "section-contact":
      return "Contact";
  }
}

/** Short description shown in the collapsed bar. */
function sectionSummary(block: SectionBlock): string {
  switch (block.kind) {
    case "section-hero":
      return block.props.labName || "Lab name not set";
    case "section-about":
      return block.props.heading || "About";
    case "section-team": {
      const count = block.props.members.length;
      return `${count} member${count === 1 ? "" : "s"}`;
    }
    case "section-publications": {
      const count = block.props.publications.length;
      return `${count} publication${count === 1 ? "" : "s"}`;
    }
    case "section-contact":
      return block.props.email || block.props.heading || "Contact";
  }
}

// ---------------------------------------------------------------------------
// Per-section form components
// ---------------------------------------------------------------------------

interface HeroFormProps {
  block: HeroSectionBlock;
  onChange: (updated: HeroSectionBlock) => void;
  disabled?: boolean;
}

function HeroForm({ block, onChange, disabled }: HeroFormProps) {
  function set<K extends keyof HeroSectionBlock["props"]>(
    key: K,
    value: HeroSectionBlock["props"][K],
  ) {
    onChange({ ...block, props: { ...block.props, [key]: value } });
  }
  return (
    <div className="grid gap-3">
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Lab name</span>
        <input
          type="text"
          value={block.props.labName}
          onChange={(e) => set("labName", e.target.value)}
          disabled={disabled}
          placeholder="Smith Lab"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Tagline</span>
        <input
          type="text"
          value={block.props.tagline}
          onChange={(e) => set("tagline", e.target.value)}
          disabled={disabled}
          placeholder="One sentence that describes your lab's mission."
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Cover image URL (optional)</span>
        <input
          type="url"
          value={block.props.coverImageUrl}
          onChange={(e) => set("coverImageUrl", e.target.value)}
          disabled={disabled}
          placeholder="https://..."
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">CTA label (optional)</span>
          <input
            type="text"
            value={block.props.ctaLabel}
            onChange={(e) => set("ctaLabel", e.target.value)}
            disabled={disabled}
            placeholder="Join the lab"
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">CTA URL (optional)</span>
          <input
            type="url"
            value={block.props.ctaUrl}
            onChange={(e) => set("ctaUrl", e.target.value)}
            disabled={disabled}
            placeholder="https://..."
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
          />
        </label>
      </div>
    </div>
  );
}

interface AboutFormProps {
  block: AboutSectionBlock;
  onChange: (updated: AboutSectionBlock) => void;
  disabled?: boolean;
}

function AboutForm({ block, onChange, disabled }: AboutFormProps) {
  function set<K extends keyof AboutSectionBlock["props"]>(
    key: K,
    value: AboutSectionBlock["props"][K],
  ) {
    onChange({ ...block, props: { ...block.props, [key]: value } });
  }
  return (
    <div className="grid gap-3">
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Section heading</span>
        <input
          type="text"
          value={block.props.heading}
          onChange={(e) => set("heading", e.target.value)}
          disabled={disabled}
          placeholder="About the lab"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Body</span>
        <textarea
          value={block.props.body}
          onChange={(e) => set("body", e.target.value)}
          disabled={disabled}
          rows={5}
          placeholder="Describe your lab, its focus, and what makes your research unique."
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Image URL (optional)</span>
          <input
            type="url"
            value={block.props.imageUrl}
            onChange={(e) => set("imageUrl", e.target.value)}
            disabled={disabled}
            placeholder="https://..."
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Image alt text</span>
          <input
            type="text"
            value={block.props.imageAlt}
            onChange={(e) => set("imageAlt", e.target.value)}
            disabled={disabled}
            placeholder="Lab group photo"
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
          />
        </label>
      </div>
    </div>
  );
}

interface TeamFormProps {
  block: TeamSectionBlock;
  onChange: (updated: TeamSectionBlock) => void;
  disabled?: boolean;
}

function TeamForm({ block, onChange, disabled }: TeamFormProps) {
  function setHeading(heading: string) {
    onChange({ ...block, props: { ...block.props, heading } });
  }

  function setMember(index: number, member: TeamMember) {
    const members = [...block.props.members];
    members[index] = member;
    onChange({ ...block, props: { ...block.props, members } });
  }

  function addMember() {
    const members = [
      ...block.props.members,
      { id: generateMemberId(), name: "", role: "", photoUrl: "", bio: "" },
    ];
    onChange({ ...block, props: { ...block.props, members } });
  }

  function removeMember(index: number) {
    const members = block.props.members.filter((_, i) => i !== index);
    onChange({ ...block, props: { ...block.props, members } });
  }

  return (
    <div className="grid gap-4">
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Section heading</span>
        <input
          type="text"
          value={block.props.heading}
          onChange={(e) => setHeading(e.target.value)}
          disabled={disabled}
          placeholder="Our team"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>

      {block.props.members.map((member, i) => (
        <div
          key={member.id}
          className="rounded-xl border border-border bg-surface-sunken p-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Member {i + 1}
            </span>
            <Tooltip label="Remove this team member">
              <button
                type="button"
                onClick={() => removeMember(i)}
                disabled={disabled}
                className="ros-btn-neutral inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Icon name="trash" className="h-3.5 w-3.5" /> Remove
              </button>
            </Tooltip>
          </div>
          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">Name</span>
                <input
                  type="text"
                  value={member.name}
                  onChange={(e) => setMember(i, { ...member, name: e.target.value })}
                  disabled={disabled}
                  placeholder="Dr. Jane Smith"
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">Role</span>
                <input
                  type="text"
                  value={member.role}
                  onChange={(e) => setMember(i, { ...member, role: e.target.value })}
                  disabled={disabled}
                  placeholder="Postdoctoral researcher"
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
                />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Photo URL (optional)</span>
              <input
                type="url"
                value={member.photoUrl}
                onChange={(e) => setMember(i, { ...member, photoUrl: e.target.value })}
                disabled={disabled}
                placeholder="https://..."
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Short bio (optional)</span>
              <textarea
                value={member.bio}
                onChange={(e) => setMember(i, { ...member, bio: e.target.value })}
                disabled={disabled}
                rows={2}
                placeholder="Research interests and background."
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
              />
            </label>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addMember}
        disabled={disabled}
        className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
      >
        <Icon name="plus" className="h-4 w-4" /> Add team member
      </button>
    </div>
  );
}

interface PublicationsFormProps {
  block: PublicationsSectionBlock;
  onChange: (updated: PublicationsSectionBlock) => void;
  disabled?: boolean;
}

function PublicationsForm({ block, onChange, disabled }: PublicationsFormProps) {
  function setHeading(heading: string) {
    onChange({ ...block, props: { ...block.props, heading } });
  }

  function setPub(index: number, pub: PublicationEntry) {
    const publications = [...block.props.publications];
    publications[index] = pub;
    onChange({ ...block, props: { ...block.props, publications } });
  }

  function addPub() {
    const publications = [
      ...block.props.publications,
      { id: generatePubId(), citation: "", url: "", badge: "" },
    ];
    onChange({ ...block, props: { ...block.props, publications } });
  }

  function removePub(index: number) {
    const publications = block.props.publications.filter((_, i) => i !== index);
    onChange({ ...block, props: { ...block.props, publications } });
  }

  return (
    <div className="grid gap-4">
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Section heading</span>
        <input
          type="text"
          value={block.props.heading}
          onChange={(e) => setHeading(e.target.value)}
          disabled={disabled}
          placeholder="Selected publications"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>

      {block.props.publications.map((pub, i) => (
        <div
          key={pub.id}
          className="rounded-xl border border-border bg-surface-sunken p-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Publication {i + 1}
            </span>
            <Tooltip label="Remove this publication">
              <button
                type="button"
                onClick={() => removePub(i)}
                disabled={disabled}
                className="ros-btn-neutral inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Icon name="trash" className="h-3.5 w-3.5" /> Remove
              </button>
            </Tooltip>
          </div>
          <div className="grid gap-2">
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Citation</span>
              <textarea
                value={pub.citation}
                onChange={(e) => setPub(i, { ...pub, citation: e.target.value })}
                disabled={disabled}
                rows={2}
                placeholder="Author et al. (Year). Title. Journal, Volume(Issue), Pages."
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">DOI or URL (optional)</span>
                <input
                  type="url"
                  value={pub.url}
                  onChange={(e) => setPub(i, { ...pub, url: e.target.value })}
                  disabled={disabled}
                  placeholder="https://doi.org/..."
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">Badge (optional)</span>
                <input
                  type="text"
                  value={pub.badge}
                  onChange={(e) => setPub(i, { ...pub, badge: e.target.value })}
                  disabled={disabled}
                  placeholder="New, Preprint, ..."
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
                />
              </label>
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addPub}
        disabled={disabled}
        className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
      >
        <Icon name="plus" className="h-4 w-4" /> Add publication
      </button>
    </div>
  );
}

interface ContactFormProps {
  block: ContactSectionBlock;
  onChange: (updated: ContactSectionBlock) => void;
  disabled?: boolean;
}

function ContactForm({ block, onChange, disabled }: ContactFormProps) {
  function set<K extends keyof ContactSectionBlock["props"]>(
    key: K,
    value: ContactSectionBlock["props"][K],
  ) {
    onChange({ ...block, props: { ...block.props, [key]: value } });
  }
  return (
    <div className="grid gap-3">
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Section heading</span>
        <input
          type="text"
          value={block.props.heading}
          onChange={(e) => set("heading", e.target.value)}
          disabled={disabled}
          placeholder="Contact"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Address (optional)</span>
        <textarea
          value={block.props.address}
          onChange={(e) => set("address", e.target.value)}
          disabled={disabled}
          rows={3}
          placeholder={"Department of Biology\nUniversity of Wisconsin-Madison\nMadison, WI 53706"}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Email (optional)</span>
        <input
          type="email"
          value={block.props.email}
          onChange={(e) => set("email", e.target.value)}
          disabled={disabled}
          placeholder="pi@lab.edu"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Link label (optional)</span>
          <input
            type="text"
            value={block.props.linkLabel}
            onChange={(e) => set("linkLabel", e.target.value)}
            disabled={disabled}
            placeholder="Apply to join"
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Link URL (optional)</span>
          <input
            type="url"
            value={block.props.linkUrl}
            onChange={(e) => set("linkUrl", e.target.value)}
            disabled={disabled}
            placeholder="https://..."
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
          />
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section row: the collapsed/expanded card for one section
// ---------------------------------------------------------------------------

interface SectionRowProps {
  block: SectionBlock;
  index: number;
  total: number;
  isExpanded: boolean;
  onToggle: () => void;
  onChange: (updated: SectionBlock) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  disabled?: boolean;
}

function SectionRow({
  block,
  index,
  total,
  isExpanded,
  onToggle,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  disabled,
}: SectionRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Scroll the expanded section into view so the user can see it.
  useEffect(() => {
    if (isExpanded && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isExpanded]);

  function renderForm() {
    switch (block.kind) {
      case "section-hero":
        return (
          <HeroForm
            block={block}
            onChange={(u) => onChange(u)}
            disabled={disabled}
          />
        );
      case "section-about":
        return (
          <AboutForm
            block={block}
            onChange={(u) => onChange(u)}
            disabled={disabled}
          />
        );
      case "section-team":
        return (
          <TeamForm
            block={block}
            onChange={(u) => onChange(u)}
            disabled={disabled}
          />
        );
      case "section-publications":
        return (
          <PublicationsForm
            block={block}
            onChange={(u) => onChange(u)}
            disabled={disabled}
          />
        );
      case "section-contact":
        return (
          <ContactForm
            block={block}
            onChange={(u) => onChange(u)}
            disabled={disabled}
          />
        );
    }
  }

  return (
    <div
      ref={rowRef}
      className="rounded-xl border border-border bg-surface-raised overflow-hidden"
    >
      {/* Collapsed header bar */}
      <div className="flex items-center gap-2 px-4 py-3">
        {/* Reorder controls */}
        <div className="flex shrink-0 flex-col gap-0.5">
          <Tooltip label="Move section up">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={disabled || index === 0}
              aria-label="Move section up"
              className="ros-btn-neutral inline-flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <Icon name="caret" className="h-3.5 w-3.5 -rotate-180" />
            </button>
          </Tooltip>
          <Tooltip label="Move section down">
            <button
              type="button"
              onClick={onMoveDown}
              disabled={disabled || index === total - 1}
              aria-label="Move section down"
              className="ros-btn-neutral inline-flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <Icon name="caret" className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>

        {/* Kind label + summary */}
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={isExpanded}
        >
          <span className="shrink-0 rounded-md border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {sectionLabel(block.kind)}
          </span>
          <span className="truncate text-sm font-medium text-foreground">
            {sectionSummary(block)}
          </span>
          <Icon
            name="caret"
            className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "-rotate-180" : ""}`}
          />
        </button>

        {/* Remove */}
        <Tooltip label="Remove this section">
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label="Remove section"
            className="ros-btn-neutral ml-1 inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Icon name="trash" className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* Expanded form */}
      {isExpanded && (
        <div className="border-t border-border bg-background px-4 py-4">
          {renderForm()}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onToggle}
              className="ros-btn-neutral rounded-lg px-3 py-1.5 text-sm"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section picker: add a new section from a menu
// ---------------------------------------------------------------------------

const ADDABLE_SECTION_KINDS: Array<{
  kind: SectionBlock["kind"];
  label: string;
  description: string;
}> = [
  {
    kind: "section-hero",
    label: "Hero",
    description: "Lab name, tagline, and optional cover image.",
  },
  {
    kind: "section-about",
    label: "About",
    description: "Who you are and what you study.",
  },
  {
    kind: "section-team",
    label: "Team",
    description: "A roster of lab members with photos and roles.",
  },
  {
    kind: "section-publications",
    label: "Publications",
    description: "Curated list of papers and preprints.",
  },
  {
    kind: "section-contact",
    label: "Contact",
    description: "Address, email, and a join-the-lab link.",
  },
];

function makeDefaultSection(kind: SectionBlock["kind"]): SectionBlock {
  const id = generateId();
  switch (kind) {
    case "section-hero":
      return {
        id,
        kind: "section-hero",
        props: { labName: "", tagline: "", coverImageUrl: "", ctaLabel: "", ctaUrl: "" },
      };
    case "section-about":
      return {
        id,
        kind: "section-about",
        props: { heading: "About the lab", body: "", imageUrl: "", imageAlt: "" },
      };
    case "section-team":
      return {
        id,
        kind: "section-team",
        props: {
          heading: "Our team",
          members: [{ id: generateMemberId(), name: "", role: "", photoUrl: "", bio: "" }],
        },
      };
    case "section-publications":
      return {
        id,
        kind: "section-publications",
        props: {
          heading: "Selected publications",
          publications: [{ id: generatePubId(), citation: "", url: "", badge: "" }],
        },
      };
    case "section-contact":
      return {
        id,
        kind: "section-contact",
        props: { heading: "Contact", address: "", email: "", linkLabel: "", linkUrl: "" },
      };
  }
}

interface SectionPickerProps {
  onAdd: (block: SectionBlock) => void;
  onClose: () => void;
  disabled?: boolean;
}

function SectionPicker({ onAdd, onClose, disabled }: SectionPickerProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Add a section</p>
        <button
          type="button"
          onClick={onClose}
          className="ros-btn-neutral rounded-lg p-1"
          aria-label="Close"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      <ul className="grid gap-1">
        {ADDABLE_SECTION_KINDS.map(({ kind, label, description }) => (
          <li key={kind}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onAdd(makeDefaultSection(kind));
                onClose();
              }}
              className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-surface-sunken disabled:opacity-50"
            >
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export interface LabSiteHomepageEditorProps {
  /**
   * The initial blocks_json string for the home page. When null or empty the
   * editor populates itself from the filled template so the page is never blank.
   * This is initialBlocksJson from the dashboard (fetched from the server on
   * page open, null for a brand-new home page).
   */
  initialBlocksJson: string | null;
  /**
   * Slug of the lab (used to pre-fill the hero lab-name placeholder). Does not
   * affect serialized output once the user edits the field.
   */
  labSlug?: string;
  /**
   * Called on every change with the new serialized blocks_json. The parent
   * stores this value and passes it to the save/publish flow unchanged.
   */
  onChange: (blocksJson: string) => void;
  /** When true, all controls are read-only (demo walkthrough mode). */
  disabled?: boolean;
}

/**
 * Structured section editor for the lab homepage. Renders a vertical list of
 * section blocks (hero, about, team, publications, contact) that the PI fills
 * via simple forms. Each section can be reordered, removed, or expanded for
 * editing. New sections are added from a picker.
 *
 * The editor operates on a PARALLEL array that contains ONLY section blocks.
 * Non-section blocks from a mixed page (theoretically possible if the PI used
 * both editors) are preserved in the output JSON but not shown here: the editor
 * prepends section blocks and appends any non-section blocks it found in the
 * initial JSON. In practice the home page editor only emits section blocks.
 *
 * Calls onChange after every field change; no internal save step.
 */
export default function LabSiteHomepageEditor({
  initialBlocksJson,
  labSlug,
  onChange,
  disabled,
}: LabSiteHomepageEditorProps) {
  // Parse the initial blocks_json. Section blocks go into `sections`, all
  // non-section blocks are kept as `nonSectionBlocks` and appended verbatim
  // on serialize so no data is silently dropped.
  const [sections, setSections] = useState<SectionBlock[]>(() => {
    const all = parseLabSiteBlocks(initialBlocksJson ?? "");
    const found = all.filter((b): b is SectionBlock => isSectionBlockKind(b.kind));
    if (found.length > 0) return found;
    // No section blocks found: start from the filled template.
    return makeHomepageSectionTemplate(labSlug);
  });

  const nonSectionBlocks = useMemo<LabSiteBlock[]>(() => {
    const all = parseLabSiteBlocks(initialBlocksJson ?? "");
    return all.filter((b) => !isSectionBlockKind(b.kind));
  }, [initialBlocksJson]);

  // Which section row is currently expanded (by index). null = all collapsed.
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Serialize and propagate on every sections change.
  const serialize = useCallback(
    (next: SectionBlock[]) => {
      const all: LabSiteBlock[] = [...next, ...nonSectionBlocks];
      const json = serializeLabSiteBlocks(all);
      if (json !== null) onChange(json);
    },
    [nonSectionBlocks, onChange],
  );

  // Initial serialize so the parent has the template JSON on first render.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    serialize(sections);
    // Only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateSection(index: number, updated: SectionBlock) {
    const next = [...sections];
    next[index] = updated;
    setSections(next);
    serialize(next);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...sections];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setSections(next);
    setExpandedIndex((prev) => {
      if (prev === index) return index - 1;
      if (prev === index - 1) return index;
      return prev;
    });
    serialize(next);
  }

  function moveDown(index: number) {
    if (index === sections.length - 1) return;
    const next = [...sections];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setSections(next);
    setExpandedIndex((prev) => {
      if (prev === index) return index + 1;
      if (prev === index + 1) return index;
      return prev;
    });
    serialize(next);
  }

  function removeSection(index: number) {
    const next = sections.filter((_, i) => i !== index);
    setSections(next);
    setExpandedIndex((prev) => {
      if (prev === null) return null;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
    serialize(next);
  }

  function addSection(block: SectionBlock) {
    const next = [...sections, block];
    setSections(next);
    setExpandedIndex(next.length - 1);
    serialize(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Intro note */}
      <p className="text-xs text-muted-foreground">
        Your homepage is built from sections. Add, reorder, and fill each
        section. Changes are saved when you click Save draft or Push live.
      </p>

      {/* Section list */}
      {sections.map((block, i) => (
        <SectionRow
          key={block.id}
          block={block}
          index={i}
          total={sections.length}
          isExpanded={expandedIndex === i}
          onToggle={() => setExpandedIndex((prev) => (prev === i ? null : i))}
          onChange={(updated) => updateSection(i, updated)}
          onMoveUp={() => moveUp(i)}
          onMoveDown={() => moveDown(i)}
          onRemove={() => removeSection(i)}
          disabled={disabled}
        />
      ))}

      {/* Add section */}
      {pickerOpen ? (
        <SectionPicker
          onAdd={addSection}
          onClose={() => setPickerOpen(false)}
          disabled={disabled}
        />
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={disabled}
          className="ros-btn-neutral inline-flex items-center gap-2 rounded-xl border-2 border-dashed px-4 py-3 text-sm text-muted-foreground hover:border-border hover:text-foreground disabled:opacity-50"
        >
          <Icon name="plus" className="h-4 w-4" /> Add section
        </button>
      )}
    </div>
  );
}
