"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAllInventoryItemsIncludingShared,
  fetchAllMethodsIncludingShared,
  notesApi,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { seedWords, setCustomWordPersister } from "@/lib/spellcheck/spellchecker";
import { readCustomDictionary, addCustomWord } from "@/lib/spellcheck/custom-dictionary";
import { readUserSettings } from "@/lib/settings/user-settings";
import { INVENTORY_ENABLED } from "@/lib/inventory/config";

/**
 * Auto-seed the spell-checker with the user's OWN vocabulary so it is tuned to
 * each lab without anyone hand-curating. A lab's real terms (the reagents it
 * stocks, the methods it runs, what it names its notes) beat any generic list,
 * and seeding them means the checker never flags a term this lab always writes.
 *
 * Reads the same react-query caches the global search index already populates
 * (so this triggers no extra fetches, just subscribes to warm data) and feeds
 * the alphabetic word tokens to seedWords. seedWords is cheap and no-ops when
 * the checker is not loaded (spell-check off), so this is inert until the user
 * turns spell-check on, then their vocabulary is already known.
 *
 * Mounted once in providers for every signed-in route. House style: no
 * em-dashes, no emojis, no mid-sentence colons.
 */

// Lowercased alphabetic word tokens of >= 3 letters (the same shape the checker
// checks). Digits/symbols break the run, so catalog numbers and gene names with
// digits are skipped, and short acronyms fall below the length floor.
function wordsOf(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.toLowerCase().match(/[a-z][a-z'’]{2,}/g) ?? [];
}

export default function SpellcheckAutoSeed() {
  const { currentUser } = useCurrentUser();
  const user = currentUser ?? "";

  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["inventory-items", user],
    queryFn: fetchAllInventoryItemsIncludingShared,
    enabled: INVENTORY_ENABLED && !!user,
  });
  const { data: methods = [] } = useQuery({
    queryKey: ["methods", user],
    queryFn: fetchAllMethodsIncludingShared,
    enabled: !!user,
  });
  const { data: notes = [] } = useQuery({
    queryKey: ["notes"],
    queryFn: () => notesApi.list(),
    enabled: !!user,
  });

  // Account settings, for the lab_id signal that scopes the custom dictionary
  // (lab-wide vs per-user). Shares the cache the Settings page uses.
  const { data: settings } = useQuery({
    queryKey: ["user-settings", user],
    queryFn: () => readUserSettings(user),
    enabled: !!user,
  });
  const labId = settings?.lab_id ?? null;

  // Latest user + labId in refs so the persister (registered once) always writes
  // to the right scoped path without re-registering on every settings change.
  const userRef = useRef(user);
  userRef.current = user;
  const labIdRef = useRef(labId);
  labIdRef.current = labId;

  // Register the durable "Add to dictionary" persister. Routes added words to the
  // account-scoped folder file (lab-wide for labs, per-user for solo) instead of
  // localStorage. Cleared on unmount so the lib falls back to localStorage when
  // no signed-in surface is mounted.
  useEffect(() => {
    setCustomWordPersister((word) => {
      if (userRef.current) void addCustomWord(userRef.current, labIdRef.current, word);
    });
    return () => setCustomWordPersister(null);
  }, []);

  // Load the persisted custom dictionary (the manually-added words) and seed the
  // checker with them. Re-runs if the account or its lab scope changes.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void readCustomDictionary(user, labId).then((words) => {
      if (!cancelled && words.length > 0) void seedWords(words);
    });
    return () => {
      cancelled = true;
    };
  }, [user, labId]);

  useEffect(() => {
    const words = new Set<string>();
    for (const item of inventoryItems) {
      for (const w of wordsOf(item.name)) words.add(w);
      for (const w of wordsOf(item.vendor)) words.add(w);
    }
    for (const method of methods) {
      for (const w of wordsOf(method.name)) words.add(w);
      for (const w of wordsOf(method.folder_path)) words.add(w);
    }
    for (const note of notes) {
      for (const w of wordsOf(note.title)) words.add(w);
    }
    if (words.size > 0) void seedWords(words);
  }, [inventoryItems, methods, notes]);

  return null;
}
