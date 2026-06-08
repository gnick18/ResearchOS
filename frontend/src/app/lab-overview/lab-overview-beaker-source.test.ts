// sequence editor master (Lab Overview source sub-bot). Tests for the PURE Lab
// Overview BeakerSearch source builder. These cover the context-card copy
// (members + the inbox snapshot, "all caught up" when zero), the command set
// (ids + groups + author gating), the Suggested ids for nothing-selected vs a
// selected member vs a selected approval vs a selected announcement, the nav
// groups (member tone person, approval tone task), the >4 pending collapse, and
// the recent-actions MRU, all without a DOM or a store, mirroring the posture of
// gantt-beaker-source.test.ts.

import { describe, it, expect } from "vitest";
import type { PaletteSubflow } from "@/components/sequences/editor-commands";
import {
  buildInboxSnapshot,
  buildLabOverviewSource,
  LAB_OVERVIEW_GROUP_APPROVALS,
  LAB_OVERVIEW_GROUP_ANNOUNCEMENTS,
  type LabOverviewAnnouncement,
  type LabOverviewApproval,
  type LabOverviewMember,
  type LabOverviewRecentAction,
  type LabOverviewSourceData,
  type LabOverviewSourceHandlers,
  type LabOverviewTask,
} from "./lab-overview-beaker-source";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeMember(over: Partial<LabOverviewMember> = {}): LabOverviewMember {
  return {
    username: "alex",
    displayName: "alex",
    openTasks: 6,
    overdueTasks: 2,
    archived: false,
    ...over,
  };
}

function makeApproval(over: Partial<LabOverviewApproval> = {}): LabOverviewApproval {
  return {
    id: 1,
    owner: "alex",
    itemName: "Pipette tips x10",
    priceLabel: "$89.00",
    ...over,
  };
}

function makeTask(over: Partial<LabOverviewTask> = {}): LabOverviewTask {
  return {
    id: 1,
    name: "PCR optimization",
    owner: "alex",
    projectName: "Mitochondria QC",
    ...over,
  };
}

function makeAnnouncement(
  over: Partial<LabOverviewAnnouncement> = {},
): LabOverviewAnnouncement {
  return {
    id: "a1",
    author: "pi",
    preview: "Lab meeting Friday",
    pinned: false,
    ...over,
  };
}

const noopHandlers: LabOverviewSourceHandlers = {
  selectMember: () => {},
  selectApproval: () => {},
  selectAnnouncement: () => {},
  approveApproval: () => {},
  declineApproval: () => {},
  approveAllPending: () => {},
  flagApproval: () => {},
  assignTask: () => {},
  flagRecord: () => {},
  openAnnouncementComposer: () => {},
  editAnnouncement: () => {},
  togglePinAnnouncement: () => {},
  deleteAnnouncement: () => {},
  archiveMember: () => {},
  restoreMember: () => {},
  openRoster: () => {},
  openProjectCreate: () => {},
  openApprovalOnPurchases: () => {},
  openPurchasesApprovalQueue: () => {},
  openLabInbox: () => {},
  openLabExperiments: () => {},
  openLabNotes: () => {},
  reopenRecentAction: () => {},
};

function makeData(over: Partial<LabOverviewSourceData> = {}): LabOverviewSourceData {
  return {
    members: [makeMember(), makeMember({ username: "morgan", displayName: "morgan", openTasks: 3, overdueTasks: 0 })],
    pendingApprovals: [
      makeApproval(),
      makeApproval({ id: 2, owner: "morgan", itemName: "Antibody, anti-TRAP1", priceLabel: "$412.00" }),
    ],
    tasks: [
      makeTask(),
      makeTask({ id: 2, name: "Cloning run", owner: "morgan", projectName: undefined }),
    ],
    announcements: [makeAnnouncement()],
    pending: 3,
    flagged: 2,
    mentions: 1,
    currentUser: "pi",
    selected: null,
    hovered: null,
    ...over,
  };
}

// ── Inbox snapshot ───────────────────────────────────────────────────────────

describe("buildInboxSnapshot", () => {
  it("reads all three segments joined with and, ending in await you", () => {
    expect(buildInboxSnapshot(makeData())).toBe(
      "3 approvals, 2 flagged by you and 1 mention await you",
    );
  });

  it("singularizes approval and mention", () => {
    expect(buildInboxSnapshot(makeData({ pending: 1, flagged: 0, mentions: 1 }))).toBe(
      "1 approval and 1 mention await you",
    );
  });

  it("reads all caught up when every count is zero", () => {
    expect(buildInboxSnapshot(makeData({ pending: 0, flagged: 0, mentions: 0 }))).toBe(
      "You are all caught up",
    );
  });
});

// ── Context card ─────────────────────────────────────────────────────────────

describe("buildLabOverviewSource context card", () => {
  it("is the title, the member count, and the inbox snapshot, no selection line", () => {
    const card = buildLabOverviewSource(makeData(), noopHandlers).contextCard!;
    expect(card.title).toBe("Lab Overview");
    expect(card.meta).toBe(
      "2 members, 3 approvals, 2 flagged by you and 1 mention await you",
    );
    expect(card.selection).toBeUndefined();
  });

  it("reads just you so far + all caught up for a one-person, quiet lab", () => {
    const card = buildLabOverviewSource(
      makeData({
        members: [makeMember({ username: "pi", displayName: "pi" })],
        pendingApprovals: [],
        pending: 0,
        flagged: 0,
        mentions: 0,
      }),
      noopHandlers,
    ).contextCard!;
    expect(card.meta).toBe("just you so far, You are all caught up");
  });

  it("adds a member selection line when a member is selected", () => {
    const card = buildLabOverviewSource(
      makeData({ selected: { kind: "member", member: makeMember() } }),
      noopHandlers,
    ).contextCard!;
    expect(card.selection?.text).toBe("Selected member alex, 6 open, 2 overdue");
  });

  it("adds an approval selection line when an approval is selected", () => {
    const card = buildLabOverviewSource(
      makeData({ selected: { kind: "approval", approval: makeApproval() } }),
      noopHandlers,
    ).contextCard!;
    expect(card.selection?.text).toBe('Selected "Pipette tips x10", alex, $89.00');
  });
});

// ── Suggested ────────────────────────────────────────────────────────────────

describe("buildLabOverviewSource suggested ids", () => {
  it("leads with per-item approve/decline + approve-all + review when nothing selected", () => {
    const src = buildLabOverviewSource(makeData(), noopHandlers);
    expect(src.suggestedIds).toEqual([
      "lab-overview-approve-first",
      "lab-overview-decline-first",
      "lab-overview-approve-all",
      "lab-overview-review-on-purchases",
      "lab-overview-assign-task",
      "lab-overview-flag-record",
      "lab-overview-post-announcement",
      "lab-overview-new-project",
      "lab-overview-open-inbox",
    ]);
    expect(src.suggestedHint).toBe("what needs you");
  });

  it("collapses the per-item rows into approve-all when more than four pending", () => {
    const many: LabOverviewApproval[] = Array.from({ length: 5 }, (_, i) =>
      makeApproval({ id: i + 1, itemName: `Item ${i + 1}` }),
    );
    const src = buildLabOverviewSource(
      makeData({ pendingApprovals: many, pending: 5 }),
      noopHandlers,
    );
    expect(src.suggestedIds).not.toContain("lab-overview-approve-first");
    expect(src.suggestedIds).not.toContain("lab-overview-decline-first");
    expect(src.suggestedIds).toContain("lab-overview-approve-all");
    // The collapsed command also names the count.
    const approveAll = src.commands.find((c) => c.id === "lab-overview-approve-all");
    expect(approveAll?.label).toBe("Approve all pending (5)");
  });

  it("drives member actions for a selected member", () => {
    const src = buildLabOverviewSource(
      makeData({ selected: { kind: "member", member: makeMember() } }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "lab-overview-member-open",
      "lab-overview-member-assign",
      "lab-overview-member-archive",
    ]);
    expect(src.suggestedHint).toBe("for the selected member");
  });

  it("offers restore instead of archive for an archived selected member", () => {
    const src = buildLabOverviewSource(
      makeData({ selected: { kind: "member", member: makeMember({ archived: true }) } }),
      noopHandlers,
    );
    expect(src.suggestedIds).toContain("lab-overview-member-restore");
    expect(src.suggestedIds).not.toContain("lab-overview-member-archive");
  });

  it("drives approve/decline/flag/open for a selected approval", () => {
    const src = buildLabOverviewSource(
      makeData({ selected: { kind: "approval", approval: makeApproval() } }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "lab-overview-approval-approve",
      "lab-overview-approval-decline",
      "lab-overview-approval-flag",
      "lab-overview-approval-open",
    ]);
  });

  it("drives edit/pin/delete for a selected announcement", () => {
    const src = buildLabOverviewSource(
      makeData({ selected: { kind: "announcement", announcement: makeAnnouncement() } }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "lab-overview-announcement-edit",
      "lab-overview-announcement-pin",
      "lab-overview-announcement-delete",
    ]);
  });
});

// ── Commands ─────────────────────────────────────────────────────────────────

describe("buildLabOverviewSource commands", () => {
  it("groups approvals, assignment, flag, announcements, members, create, navigate", () => {
    const commands = buildLabOverviewSource(makeData(), noopHandlers).commands;
    const groups = new Set(commands.map((c) => c.group));
    expect(groups.has(LAB_OVERVIEW_GROUP_APPROVALS)).toBe(true);
    expect(groups.has("Task assignment")).toBe(true);
    expect(groups.has("Flag for review")).toBe(true);
    expect(groups.has(LAB_OVERVIEW_GROUP_ANNOUNCEMENTS)).toBe(true);
    expect(groups.has("Members")).toBe(true);
    expect(groups.has("Create")).toBe(true);
    expect(groups.has("Navigate")).toBe(true);
  });

  it("gates the selected-announcement edit/pin/delete on authorship", () => {
    // Own announcement: enabled.
    const own = buildLabOverviewSource(
      makeData({ selected: { kind: "announcement", announcement: makeAnnouncement({ author: "pi" }) } }),
      noopHandlers,
    ).commands;
    expect(own.find((c) => c.id === "lab-overview-announcement-edit")?.enabled).toBe(true);
    // Someone else's announcement: disabled.
    const other = buildLabOverviewSource(
      makeData({ selected: { kind: "announcement", announcement: makeAnnouncement({ author: "alex" }) } }),
      noopHandlers,
    ).commands;
    expect(other.find((c) => c.id === "lab-overview-announcement-edit")?.enabled).toBe(false);
  });

  it("only lists own announcements in the Announcements long tail", () => {
    const commands = buildLabOverviewSource(
      makeData({
        announcements: [
          makeAnnouncement({ id: "mine", author: "pi", preview: "Mine" }),
          makeAnnouncement({ id: "theirs", author: "alex", preview: "Theirs" }),
        ],
      }),
      noopHandlers,
    ).commands;
    expect(commands.some((c) => c.id === "lab-overview-announcement-edit-mine")).toBe(true);
    expect(commands.some((c) => c.id === "lab-overview-announcement-edit-theirs")).toBe(false);
  });

  it("disables archiving yourself", () => {
    const commands = buildLabOverviewSource(
      makeData({
        currentUser: "pi",
        selected: { kind: "member", member: makeMember({ username: "pi", displayName: "pi" }) },
      }),
      noopHandlers,
    ).commands;
    expect(commands.find((c) => c.id === "lab-overview-member-archive")?.enabled).toBe(false);
  });
});

// ── Nav groups ───────────────────────────────────────────────────────────────

describe("buildLabOverviewSource nav groups", () => {
  it("paints members with the person tone and approvals with the task tone", () => {
    const groups = buildLabOverviewSource(makeData(), noopHandlers).navGroups!;
    const memberGroup = groups.find((g) => g.title === "Jump to a member")!;
    expect(memberGroup.items[0].tone).toBe("person");
    expect(memberGroup.items[0].detail).toBe("6 open, 2 overdue");
    const approvalGroup = groups.find((g) => g.title === "Pending approvals")!;
    expect(approvalGroup.items[0].tone).toBe("task");
    expect(approvalGroup.items[0].detail).toBe("alex, $89.00");
  });

  it("reads on track for a member with no overdue tasks", () => {
    const groups = buildLabOverviewSource(makeData(), noopHandlers).navGroups!;
    const memberGroup = groups.find((g) => g.title === "Jump to a member")!;
    const morgan = memberGroup.items.find((i) => i.label === "morgan")!;
    expect(morgan.detail).toBe("3 open, on track");
  });

  it("always includes the Jump to a section route-outs", () => {
    const groups = buildLabOverviewSource(makeData(), noopHandlers).navGroups!;
    expect(groups.some((g) => g.title === "Jump to a section")).toBe(true);
  });

  it("omits the Recent actions group when the MRU is empty, includes it when not", () => {
    const empty = buildLabOverviewSource(makeData(), noopHandlers).navGroups!;
    expect(empty.some((g) => g.title === "Recent actions")).toBe(false);

    const recent: LabOverviewRecentAction[] = [
      { id: "1", label: 'Approved "Falcon tubes"', detail: "morgan", kind: "approve" },
    ];
    const withMru = buildLabOverviewSource(makeData(), noopHandlers, recent).navGroups!;
    const mruGroup = withMru.find((g) => g.title === "Recent actions")!;
    expect(mruGroup.items[0].label).toBe('Approved "Falcon tubes"');
    expect(mruGroup.items[0].tone).toBe("task");
  });

  it("omits the Pending approvals group when there are none", () => {
    const groups = buildLabOverviewSource(
      makeData({ pendingApprovals: [], pending: 0 }),
      noopHandlers,
    ).navGroups!;
    expect(groups.some((g) => g.title === "Pending approvals")).toBe(false);
  });
});

// ── Hovered member (HOVERED, member rows only) ──────────────────────────────

describe("buildLabOverviewSource hovered member", () => {
  it("drives the member Suggested + a Pointing at line when nothing is selected", () => {
    const src = buildLabOverviewSource(
      makeData({
        selected: null,
        hovered: { kind: "member", member: makeMember() },
      }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "lab-overview-member-open",
      "lab-overview-member-assign",
      "lab-overview-member-archive",
    ]);
    expect(src.suggestedHint).toBe("for the member you were pointing at");
    expect(src.contextCard!.selection?.text).toBe(
      "Pointing at alex, 6 open, 2 overdue",
    );
  });

  it("offers restore instead of archive for an archived hovered member", () => {
    const src = buildLabOverviewSource(
      makeData({
        selected: null,
        hovered: { kind: "member", member: makeMember({ archived: true }) },
      }),
      noopHandlers,
    );
    expect(src.suggestedIds).toContain("lab-overview-member-restore");
    expect(src.suggestedIds).not.toContain("lab-overview-member-archive");
    expect(src.contextCard!.selection?.text).toBe(
      "Pointing at alex, 6 open, 2 overdue, archived",
    );
  });

  it("lets a SELECTED member outrank a HOVERED one", () => {
    const src = buildLabOverviewSource(
      makeData({
        selected: { kind: "member", member: makeMember({ username: "morgan", displayName: "morgan", openTasks: 3, overdueTasks: 0 }) },
        hovered: { kind: "member", member: makeMember() },
      }),
      noopHandlers,
    );
    // The selected member drives the line + the selected (not hovered) framing.
    expect(src.contextCard!.selection?.text).toBe("Selected member morgan, 3 open");
    expect(src.suggestedHint).toBe("for the selected member");
  });

  it("lets a SELECTED approval outrank a HOVERED member", () => {
    const src = buildLabOverviewSource(
      makeData({
        selected: { kind: "approval", approval: makeApproval() },
        hovered: { kind: "member", member: makeMember() },
      }),
      noopHandlers,
    );
    expect(src.suggestedIds).toEqual([
      "lab-overview-approval-approve",
      "lab-overview-approval-decline",
      "lab-overview-approval-flag",
      "lab-overview-approval-open",
    ]);
    expect(src.suggestedHint).toBe("for the selected approval");
  });
});

// ── Selection wiring (the in-palette drill) ─────────────────────────────────

describe("buildLabOverviewSource selection wiring", () => {
  it("drills into a member when its nav row runs", () => {
    let picked: LabOverviewMember | null = null;
    const handlers: LabOverviewSourceHandlers = {
      ...noopHandlers,
      selectMember: (m) => {
        picked = m;
      },
    };
    const groups = buildLabOverviewSource(makeData(), handlers).navGroups!;
    const memberGroup = groups.find((g) => g.title === "Jump to a member")!;
    memberGroup.items[0].onRun();
    expect(picked).not.toBeNull();
    expect(picked!.username).toBe("alex");
  });
});

// ── BeakerSearch v2 (sub-flow framework, chunk 2), the two MULTI-STAGE flows ──

describe("buildLabOverviewSource sub-flows", () => {
  it("STACK assign-task, stage 1 lists the lab tasks and chains to stage 2 members", () => {
    const assigned: Array<[number, string, string, string]> = [];
    const handlers: LabOverviewSourceHandlers = {
      ...noopHandlers,
      assignTask: (task, assignee) => {
        assigned.push([task.id, task.owner, task.name, assignee]);
      },
    };
    const cmds = buildLabOverviewSource(makeData(), handlers).commands;
    const assign = cmds.find((c) => c.id === "lab-overview-assign-task")!;
    expect(assign.enabled).toBe(true);
    expect(assign.subflow).toBeDefined();
    const sf = assign.subflow!();
    // Stage 1 is an explicit stack, listing the lab's tasks (name + project echo).
    expect(sf.presentation).toBe("stack");
    expect(sf.items.map((i) => i.label)).toEqual(["PCR optimization", "Cloning run"]);
    expect(sf.items[0].detail).toBe("Mitochondria QC, alex");
    expect(sf.items[1].detail).toBe("morgan");
    expect(sf.items[0].id).toBe("alex:1");
    // Picking a task CHAINS to stage 2 (the lab members, person tone).
    const stage2 = sf.onPick(sf.items[0]);
    expect(stage2 && typeof stage2 === "object").toBe(true);
    const s2 = stage2 as PaletteSubflow;
    expect(s2.items.map((i) => i.id)).toEqual(["alex", "morgan"]);
    expect(s2.items[0].tone).toBe("person");
    // Picking a member completes (returns void) and calls the real assign handler
    // with the picked task's owner + id + name and the assignee username.
    const done = s2.onPick(s2.items[1]);
    expect(done).toBeUndefined();
    expect(assigned).toEqual([[1, "alex", "PCR optimization", "morgan"]]);
  });

  it("disables assign-task when there is no task or no member", () => {
    const noTasks = buildLabOverviewSource(makeData({ tasks: [] }), noopHandlers).commands;
    expect(noTasks.find((c) => c.id === "lab-overview-assign-task")?.enabled).toBe(false);
    const noMembers = buildLabOverviewSource(makeData({ members: [] }), noopHandlers).commands;
    expect(noMembers.find((c) => c.id === "lab-overview-assign-task")?.enabled).toBe(false);
  });

  it("STACK flag-record, stage 1 lists the records and chains to stage 2 reasons", () => {
    const flagged: Array<[number, string, string, string]> = [];
    const handlers: LabOverviewSourceHandlers = {
      ...noopHandlers,
      flagRecord: (record, flag) => {
        flagged.push([record.id, record.owner, record.itemName, flag]);
      },
    };
    const cmds = buildLabOverviewSource(makeData(), handlers).commands;
    const flag = cmds.find((c) => c.id === "lab-overview-flag-record")!;
    expect(flag.enabled).toBe(true);
    expect(flag.subflow).toBeDefined();
    const sf = flag.subflow!();
    // Stage 1 is an explicit stack, listing the flaggable records (name + owner).
    expect(sf.presentation).toBe("stack");
    expect(sf.items.map((i) => i.label)).toEqual(["Pipette tips x10", "Antibody, anti-TRAP1"]);
    expect(sf.items[0].detail).toBe("alex, $89.00");
    expect(sf.items[0].id).toBe("alex:1");
    // Picking a record CHAINS to stage 2 (the fixed reasons).
    const stage2 = sf.onPick(sf.items[0]);
    expect(stage2 && typeof stage2 === "object").toBe(true);
    const s2 = stage2 as PaletteSubflow;
    expect(s2.items.length).toBeGreaterThan(0);
    // Picking a fixed reason completes and calls the real flag handler with the
    // record's owner + id + name and the reason LABEL.
    const done = s2.onPick(s2.items[0]);
    expect(done).toBeUndefined();
    expect(flagged).toEqual([[1, "alex", "Pipette tips x10", s2.items[0].label]]);
  });

  it("flag-record stage 2 free-text submit flags with the raw typed reason", () => {
    const flagged: Array<[number, string]> = [];
    const handlers: LabOverviewSourceHandlers = {
      ...noopHandlers,
      flagRecord: (record, flag) => {
        flagged.push([record.id, flag]);
      },
    };
    const cmds = buildLabOverviewSource(makeData(), handlers).commands;
    const sf = cmds.find((c) => c.id === "lab-overview-flag-record")!.subflow!();
    const s2 = sf.onPick(sf.items[1]) as PaletteSubflow;
    expect(s2.onSubmitRaw).toBeDefined();
    const done = s2.onSubmitRaw!("  please reconfirm vendor  ");
    expect(done).toBeUndefined();
    // Trimmed, owner-routed to the picked record (the morgan item).
    expect(flagged).toEqual([[2, "please reconfirm vendor"]]);
  });

  it("disables flag-record when there is nothing to flag", () => {
    const cmds = buildLabOverviewSource(makeData({ pendingApprovals: [] }), noopHandlers).commands;
    expect(cmds.find((c) => c.id === "lab-overview-flag-record")?.enabled).toBe(false);
  });

  it("selected-member assign is a single-stage task picker that assigns to that member", () => {
    const assigned: Array<[number, string]> = [];
    const handlers: LabOverviewSourceHandlers = {
      ...noopHandlers,
      assignTask: (task, assignee) => {
        assigned.push([task.id, assignee]);
      },
    };
    const cmds = buildLabOverviewSource(
      makeData({ selected: { kind: "member", member: makeMember({ username: "morgan", displayName: "Morgan Lee" }) } }),
      handlers,
    ).commands;
    const memberAssign = cmds.find((c) => c.id === "lab-overview-member-assign")!;
    expect(memberAssign.subflow).toBeDefined();
    const sf = memberAssign.subflow!();
    // Single stage, the member is already known, so picking a task completes.
    expect(sf.items.map((i) => i.label)).toEqual(["PCR optimization", "Cloning run"]);
    const done = sf.onPick(sf.items[0]);
    expect(done).toBeUndefined();
    expect(assigned).toEqual([[1, "morgan"]]);
  });
});
