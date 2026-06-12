// BeakerBot chat persistence (BeakerAI lane, 2026-06-12).
//
// BeakerBot conversations used to live only in the in-memory Zustand store, so
// a page reload wiped them. This module persists each conversation to the data
// folder (local-first, syncs through the user's own cloud folder, no cloud
// cost) and gives the conversation store the list / reopen / rename / archive /
// delete operations behind the History panel.
//
// On-disk shape. We reuse the generic JsonStore, which writes one file per
// record at users/<currentUser>/beakerbot_chats/<id>.json and draws ids from
// the per-user _counters.json. Each file is a StoredBeakerChat (see below).
//
// Resilience. None of these helpers throw into the UI. When no folder is
// connected (or a read/write fails), they log a warn and return a safe empty
// value, so BeakerBot keeps working in memory even with no place to persist.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { JsonStore } from "@/lib/storage/json-store";
import type { LoopMessage } from "@/lib/ai/agent-loop";
import type { ChatMessage } from "@/lib/ai/conversation-store";

// A single persisted BeakerBot conversation. `messages` is the reactive display
// transcript (user + assistant text turns) that the panel renders. `history` is
// the FULL loop history (system prompt + tool turns) so reopening a chat
// continues the model context exactly where it left off.
export type StoredBeakerChat = {
  id: number;
  title: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO, bumped on every save
  archived: boolean;
  messages: ChatMessage[];
  history: LoopMessage[];
};

// The on-disk entity name. Files land at users/<u>/beakerbot_chats/<id>.json.
const ENTITY = "beakerbot_chats";

const store = new JsonStore<StoredBeakerChat>(ENTITY);

// Derive a chat title from the first user message. Single line, trimmed to a
// readable length so the History panel rows stay tidy. Falls back to a generic
// label when the first message is empty.
const TITLE_MAX = 60;
export function deriveChatTitle(firstUserMessage: string): string {
  const oneLine = firstUserMessage.replace(/\s+/g, " ").trim();
  if (!oneLine) return "New chat";
  if (oneLine.length <= TITLE_MAX) return oneLine;
  return oneLine.slice(0, TITLE_MAX).trimEnd() + "...";
}

// Create a new chat record on disk and return it (with its assigned id). On
// failure (no folder, write error) returns null so the caller can keep going
// in memory.
export async function createChat(input: {
  title: string;
  messages: ChatMessage[];
  history: LoopMessage[];
}): Promise<StoredBeakerChat | null> {
  const now = new Date().toISOString();
  try {
    return await store.create({
      title: input.title,
      createdAt: now,
      updatedAt: now,
      archived: false,
      messages: input.messages,
      history: input.history,
    });
  } catch (err) {
    console.warn("[beaker-chats-store] createChat failed", err);
    return null;
  }
}

// Save the live transcript + history into an existing chat and bump updatedAt.
// Resilient, returns the saved record or null on failure.
export async function saveChat(
  id: number,
  patch: { messages: ChatMessage[]; history: LoopMessage[]; title?: string },
): Promise<StoredBeakerChat | null> {
  try {
    const update: Partial<StoredBeakerChat> = {
      messages: patch.messages,
      history: patch.history,
      updatedAt: new Date().toISOString(),
    };
    if (patch.title !== undefined) update.title = patch.title;
    return await store.update(id, update);
  } catch (err) {
    console.warn("[beaker-chats-store] saveChat failed", err);
    return null;
  }
}

// Read one chat by id. Returns null when missing or unreadable.
export async function getChat(id: number): Promise<StoredBeakerChat | null> {
  try {
    return await store.get(id);
  } catch (err) {
    console.warn("[beaker-chats-store] getChat failed", err);
    return null;
  }
}

// List every chat, newest activity first. The panel splits active vs archived.
// Returns [] on failure (no folder connected, unreadable directory).
export async function listChats(): Promise<StoredBeakerChat[]> {
  try {
    const all = await store.listAll();
    return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch (err) {
    console.warn("[beaker-chats-store] listChats failed", err);
    return [];
  }
}

// Rename a chat. Returns the updated record or null on failure.
export async function renameChat(
  id: number,
  title: string,
): Promise<StoredBeakerChat | null> {
  try {
    return await store.update(id, {
      title: title.trim() || "Untitled chat",
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[beaker-chats-store] renameChat failed", err);
    return null;
  }
}

// Archive or unarchive a chat. Returns the updated record or null on failure.
export async function setChatArchived(
  id: number,
  archived: boolean,
): Promise<StoredBeakerChat | null> {
  try {
    return await store.update(id, {
      archived,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[beaker-chats-store] setChatArchived failed", err);
    return null;
  }
}

// Delete a chat from disk. Returns true on success, false on failure.
export async function deleteChat(id: number): Promise<boolean> {
  try {
    return await store.delete(id);
  } catch (err) {
    console.warn("[beaker-chats-store] deleteChat failed", err);
    return false;
  }
}
