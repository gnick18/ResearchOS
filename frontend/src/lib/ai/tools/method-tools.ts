// BeakerBot method-library coworker tools (ai method-tools bot, 2026-06-14).
//
// Two gated WRITE tools that let BeakerBot touch the Method library the way a user
// could by hand. Today BeakerBot can only READ methods (read_method, search_my_work);
// it cannot author a protocol or tag / rename / file an existing one. These close
// that gap (the gap BeakerBot itself surfaced: "I'm unable to apply tags, rename
// methods, or create collections because the current toolset does not provide an
// edit-method operation").
//
//   - create_method: author a NEW markdown protocol (title + body), filed under a
//     folder (the library "category"/"collection") with optional tags.
//   - update_method: rename an existing method, set its tags, or move it to another
//     folder (category). Metadata only; it does not rewrite the protocol body.
//
// Both are ACTION tools (action: true, isDestructive false). Neither deletes, so
// neither forces the destructive hard-stop. The user sees a one-line confirm of
// exactly what will change before anything writes (step mode), or it runs once the
// plan is approved (plan mode), through the existing agent-loop gate.
//
// THE LANE RULE. The local-api owns every write. create_method writes the body file
// (filesApi.writeFile) then records it (methodsApi.create); update_method patches
// the record (methodsApi.update). These tools only map the user's words (a title, a
// folder, a tag) onto the real calls, they never invent a field. NO INTERPRETATION:
// create_method writes the user's OWN protocol text; it never invents a protocol.
//
// v1 is OWN methods only (a method the user merely received a share of is skipped),
// mirroring task-tools v1. The markdown method is PRIVATE by default (no shared_with).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { methodsApi, filesApi, fetchAllMethodsIncludingShared } from "@/lib/local-api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { objectDeepLink } from "@/lib/references";
import { slugify } from "@/lib/export/slug";
import { createNewFileContent } from "@/lib/stamp-utils";
import { deriveExcerptFromMarkdown } from "@/lib/methods/excerpt";
import type { Method, MethodCreate, MethodUpdate } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam
// ---------------------------------------------------------------------------

export type MethodToolsDeps = {
  /** The user's methods (own + shared) for resolving a method by name or id and
   *  for choosing a non-colliding source path. */
  listMethods: () => Promise<Method[]>;
  /** Create a method record. Returns the saved Method. */
  createMethod: (data: MethodCreate) => Promise<Method>;
  /** Update a method's fields. `owner` routes the write for a shared method;
   *  omit for own methods. Returns null when the id is not found. */
  updateMethod: (
    id: number,
    data: MethodUpdate,
    owner?: string,
  ) => Promise<Method | null>;
  /** Write the markdown body file for a method (create or content edit). */
  writeFile: (path: string, content: string, message?: string) => Promise<unknown>;
  /** Read a method's current body file (for an append/edit). Returns "" when the
   *  file is missing or unreadable, so an append still produces something. */
  readFile: (path: string) => Promise<string>;
  /** Navigate the user to an internal path after a successful write. */
  navigate: (path: string) => void;
};

export const methodToolsDeps: MethodToolsDeps = {
  listMethods: () => fetchAllMethodsIncludingShared(),
  createMethod: (data) => methodsApi.create(data),
  updateMethod: (id, data, owner) => methodsApi.update(id, data, owner),
  writeFile: (path, content, message) => filesApi.writeFile(path, content, message),
  readFile: async (path) => {
    try {
      return (await filesApi.readFile(path)).content;
    } catch {
      return "";
    }
  },
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Helpers (pure, exported for tests)
// ---------------------------------------------------------------------------

/** Own methods only (v1). A method the user merely RECEIVED a share of carries
 *  is_shared_with_me === true and is excluded, so these tools never write into
 *  another owner's directory. Pure. */
export function ownMethods(methods: Method[]): Method[] {
  return methods.filter((m) => m.is_shared_with_me !== true);
}

/** Resolve a method reference (a numeric id, a numeric-looking string, or a name,
 *  case-insensitive) to one of the user's OWN methods, or null. Pure. */
export function resolveMethod(
  methods: Method[],
  ref: string | number | undefined,
): Method | null {
  if (ref === undefined || ref === null || ref === "") return null;
  const own = ownMethods(methods);
  const asNum =
    typeof ref === "number"
      ? ref
      : /^\d+$/.test(String(ref).trim())
        ? Number(ref)
        : NaN;
  if (Number.isFinite(asNum)) {
    const byId = own.find((m) => m.id === asNum);
    if (byId) return byId;
  }
  const name = String(ref).trim().toLowerCase();
  return own.find((m) => m.name.trim().toLowerCase() === name) ?? null;
}

/** The names of the user's own methods, for an error message when a ref misses. */
export function ownMethodNames(methods: Method[]): string[] {
  return ownMethods(methods).map((m) => m.name);
}

/** Parse a tags argument that may arrive as a real array OR a comma-separated
 *  string, into a clean, de-duplicated, non-empty string[]. Pure. */
export function parseTags(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.map((t) => String(t))
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

/** Choose a method directory slug that does not collide with an existing method's
 *  `methods/<slug>/` directory, by bumping a numeric suffix. Pure given the set of
 *  existing source paths. A fresh title slug wins; "qpcr" -> "qpcr-2" -> "qpcr-3". */
export function uniqueMethodSlug(title: string, methods: Method[]): string {
  const base = slugify(title) || "method";
  const used = new Set(
    methods
      .map((m) => m.source_path)
      .filter((p): p is string => typeof p === "string")
      .map((p) => {
        // methods/<slug>/<file> -> <slug>
        const m = /^methods\/([^/]+)\//.exec(p);
        return m ? m[1].toLowerCase() : "";
      })
      .filter(Boolean),
  );
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// create_method
// ---------------------------------------------------------------------------

export const createMethodTool: AiTool = {
  name: "create_method",
  description:
    "Create a NEW protocol in the user's Method library. Use this when the user asks to write up, add, or save a method / protocol (for example \"save this as a method called Colony PCR\"). Pass a title, and the protocol body as markdown (steps, reagents, notes). Optionally file it under a folder (the library category, for example \"PCR\" or \"Cloning\") and add comma-separated tags. The app shows a one-line preview before anything writes. NO INTERPRETATION: write the user's OWN protocol text, expand or format what they gave you, never invent a protocol or steps they did not provide. After it writes, say in one short sentence what was created and where, then offer to open it. Creates a PRIVATE markdown method the user owns.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "The method title, for example \"Colony PCR\" or \"Gibson Assembly\".",
      },
      body: {
        type: "string",
        description:
          "The protocol body as markdown (steps, reagents, conditions, notes). This is the user's own content; format it cleanly but do not invent steps. Optional; omit to create an empty method the user fills in later.",
      },
      folder: {
        type: "string",
        description:
          "The library folder / category to file the method under (for example \"PCR\"). This is what the user means by a \"collection\". Optional.",
      },
      tags: {
        type: "string",
        description:
          "Comma-separated tags for the method, for example \"qpcr, cloning, fumigatus\". Optional.",
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const title = String(args.title ?? "Untitled method");
    const folder =
      typeof args.folder === "string" && args.folder.trim()
        ? ` in "${args.folder.trim()}"`
        : "";
    const tags = parseTags(args.tags);
    const tagNote = tags.length ? `, tags ${tags.join(", ")}` : "";
    return { summary: `create method "${title}"${folder}${tagNote}` };
  },
  execute: async (args) => {
    const title = String(args.title ?? "").trim();
    if (!title) {
      return { ok: false as const, error: "A method title is required." };
    }
    const folder =
      typeof args.folder === "string" && args.folder.trim()
        ? args.folder.trim()
        : null;
    const tags = parseTags(args.tags);
    const userBody =
      typeof args.body === "string" && args.body.trim() ? args.body.trim() : "";

    // Choose a non-colliding directory slug, then write the body file the same way
    // the New Method modal does: a stamped scaffold header followed by the body.
    const methods = await methodToolsDeps.listMethods();
    const slug = uniqueMethodSlug(title, methods);
    const sourcePath = `methods/${slug}/${slug}.md`;
    const scaffold = createNewFileContent(title, folder ?? "", "method");
    const body = userBody ? `${scaffold}\n${userBody}` : scaffold;

    try {
      await methodToolsDeps.writeFile(sourcePath, body, `Create method: ${title}`);
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not write the method file. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const excerpt = deriveExcerptFromMarkdown(body);
    let method: Method;
    try {
      method = await methodToolsDeps.createMethod({
        name: title,
        source_path: sourcePath,
        method_type: "markdown",
        folder_path: folder,
        tags,
        ...(excerpt ? { excerpt } : {}),
      });
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not save the method. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    methodToolsDeps.navigate(objectDeepLink("method", method.id));

    return {
      ok: true as const,
      id: method.id,
      name: method.name,
      folder: method.folder_path ?? null,
      tags: method.tags ?? [],
    };
  },
};

// ---------------------------------------------------------------------------
// update_method
// ---------------------------------------------------------------------------

export const updateMethodTool: AiTool = {
  name: "update_method",
  description:
    "Update an existing method in the user's library: rename it, set its tags, or move it to another folder (category). Use this when the user asks to rename a protocol, tag it, or file it under a category / collection. Call search_my_work (or read_method) first to find the method, then call this with the method (a name or numeric id) and one or more of: a new title, tags, or a folder. Tags REPLACE the method's existing tags (pass the full set you want). To clear the folder pass an empty string. This changes metadata only, not the protocol body. The app shows a one-line preview before anything writes. After it writes, confirm in one short sentence what changed. Own methods only.",
  parameters: {
    type: "object",
    properties: {
      method: {
        type: "string",
        description:
          "The method to update, by its name (case-insensitive) or numeric id.",
      },
      title: {
        type: "string",
        description: "A new title for the method. Optional.",
      },
      tags: {
        type: "string",
        description:
          "Comma-separated tags that REPLACE the method's current tags, for example \"qpcr, fumigatus\". Pass an empty string to clear all tags. Optional.",
      },
      folder: {
        type: "string",
        description:
          "Move the method to this folder / category (for example \"PCR\"). Pass an empty string to remove it from any folder. Optional.",
      },
    },
    required: ["method"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const ref =
      typeof args.method === "string" || typeof args.method === "number"
        ? String(args.method)
        : "?";
    const changes: string[] = [];
    if (typeof args.title === "string" && args.title.trim()) {
      changes.push(`rename to "${args.title.trim()}"`);
    }
    if (typeof args.tags === "string") {
      const tags = parseTags(args.tags);
      changes.push(tags.length ? `set tags ${tags.join(", ")}` : "clear tags");
    }
    if (typeof args.folder === "string") {
      const f = args.folder.trim();
      changes.push(f ? `file under "${f}"` : "remove from its folder");
    }
    const changeText = changes.length > 0 ? changes.join(", ") : "no change";
    return { summary: `update method "${ref}": ${changeText}` };
  },
  execute: async (args) => {
    const ref =
      typeof args.method === "string" || typeof args.method === "number"
        ? (args.method as string | number)
        : undefined;

    const methods = await methodToolsDeps.listMethods();
    const method = resolveMethod(methods, ref);
    if (!method) {
      const names = ownMethodNames(methods);
      return {
        ok: false as const,
        error: `I could not find one of your methods called "${ref}". Your methods are: ${names.length ? names.map((n) => `"${n}"`).join(", ") : "(none yet)"}. Use one of those exact names or its id (you can only update methods you own).`,
      };
    }

    const data: MethodUpdate = {};
    if (typeof args.title === "string" && args.title.trim()) {
      data.name = args.title.trim();
    }
    // Tags REPLACE the current set. An explicit empty string clears them; any
    // other string is parsed into the new tag list.
    if (typeof args.tags === "string") {
      data.tags = parseTags(args.tags);
    }
    // Folder: an explicit empty string clears it, otherwise set it.
    if (typeof args.folder === "string") {
      const f = args.folder.trim();
      data.folder_path = f ? f : null;
    }

    if (Object.keys(data).length === 0) {
      return {
        ok: false as const,
        error:
          "Nothing to update. Pass a new title, tags, or a folder to file the method under.",
      };
    }

    let updated: Method | null;
    try {
      // A method the user owns routes with no owner; the resolver already excluded
      // shared-with-me methods, so own routing is correct.
      updated = await methodToolsDeps.updateMethod(method.id, data);
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not update the method. ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!updated) {
      return {
        ok: false as const,
        error: `Method ${method.id} disappeared during the update.`,
      };
    }

    methodToolsDeps.navigate(objectDeepLink("method", updated.id));

    return {
      ok: true as const,
      id: updated.id,
      name: updated.name,
      folder: updated.folder_path ?? null,
      tags: updated.tags ?? [],
    };
  },
};

// ---------------------------------------------------------------------------
// edit_method (edit the protocol BODY)
// ---------------------------------------------------------------------------

export const editMethodTool: AiTool = {
  name: "edit_method",
  description:
    "Edit the BODY of an existing markdown method (the protocol text itself, not its title/tags). Use this when the user asks to add a step, add a section, or rewrite a protocol they already have. Two modes: \"append\" adds your markdown to the end (the default, for \"add a wash step\"), \"replace\" rewrites the whole protocol body. Call read_method first so you have the current text, then call this with the method (a name or id), the mode, and the markdown content. The app shows a one-line preview before anything writes. NO INTERPRETATION: write the user's OWN protocol text (expand and format what they tell you), NEVER invent steps, reagents, or conditions they did not give you. Markdown methods only (a PDF or structured method opens in its own editor). After it writes, confirm in one short sentence what changed. Own methods only.",
  parameters: {
    type: "object",
    properties: {
      method: {
        type: "string",
        description: "The method to edit, by its name (case-insensitive) or numeric id.",
      },
      mode: {
        type: "string",
        enum: ["append", "replace"],
        description:
          "\"append\" adds the content to the end of the protocol (default). \"replace\" rewrites the whole protocol body. Use replace only when the user clearly wants the protocol rewritten.",
      },
      content: {
        type: "string",
        description:
          "The markdown to add (append) or the full new protocol body (replace). This is the user's OWN content; format it cleanly but do not invent steps.",
      },
    },
    required: ["method", "content"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const ref =
      typeof args.method === "string" || typeof args.method === "number"
        ? String(args.method)
        : "?";
    const mode = args.mode === "replace" ? "rewrite the body of" : "add to";
    return { summary: `${mode} method "${ref}"` };
  },
  execute: async (args) => {
    const ref =
      typeof args.method === "string" || typeof args.method === "number"
        ? (args.method as string | number)
        : undefined;
    const content =
      typeof args.content === "string" ? args.content.trim() : "";
    if (!content) {
      return { ok: false as const, error: "The content to add is required." };
    }
    const mode = args.mode === "replace" ? "replace" : "append";

    const methods = await methodToolsDeps.listMethods();
    const method = resolveMethod(methods, ref);
    if (!method) {
      const names = ownMethodNames(methods);
      return {
        ok: false as const,
        error: `I could not find one of your methods called "${ref}". Your methods are: ${names.length ? names.map((n) => `"${n}"`).join(", ") : "(none yet)"}.`,
      };
    }
    // Only a markdown method has an editable text body. A structured / PDF method
    // is edited through its own surface, so decline cleanly and say why.
    if (method.method_type !== "markdown" || !method.source_path) {
      return {
        ok: false as const,
        error: `"${method.name}" is a ${method.method_type ?? "non-markdown"} method, so its body cannot be edited as text here. Open it in its own editor to change it.`,
      };
    }

    const sourcePath = method.source_path;
    let nextBody: string;
    if (mode === "append") {
      const current = await methodToolsDeps.readFile(sourcePath);
      nextBody = `${current.trimEnd()}\n\n${content}\n`;
    } else {
      // Replace: rewrite the body but keep a stamped title header so the file
      // stays a valid method document.
      const scaffold = createNewFileContent(
        method.name,
        method.folder_path ?? "",
        "method",
      );
      nextBody = `${scaffold}\n${content}\n`;
    }

    try {
      await methodToolsDeps.writeFile(
        sourcePath,
        nextBody,
        `Edit method: ${method.name}`,
      );
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not write the method body. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Re-stamp the picker excerpt from the new body so the card preview stays current.
    try {
      await methodToolsDeps.updateMethod(method.id, {
        excerpt: deriveExcerptFromMarkdown(nextBody),
      });
    } catch {
      // The body write already landed; a failed excerpt re-stamp is non-fatal.
    }

    methodToolsDeps.navigate(objectDeepLink("method", method.id));

    return { ok: true as const, id: method.id, name: method.name, mode };
  },
};
