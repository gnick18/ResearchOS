import { useEffect, useState } from "react";
import { filesApi, methodsApi } from "@/lib/local-api";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import RadioCard from "../setup/RadioCard";
import SpeechBubble from "./lib/SpeechBubble";
import {
  appendArtifact,
  encodeMethodId,
  findArtifact,
} from "./lib/wizard-artifacts";

/**
 * W2: Create your first method (universal walkthrough).
 *
 * L16 voice (Voice A) verbatim: "Let's add your first method! Want me
 * to drop in placeholder text so we can keep moving, or do you have a
 * real method document handy?"
 *
 * Two paths (L15):
 *   - placeholder → BeakerBot writes a sample markdown method via the
 *     same `methodsApi.create` flow CreateMethodModal uses
 *   - user-file → inline `<input type="file">` accepts .md / .markdown;
 *     contents are read, written to disk, and registered as a method
 *
 * Source is encoded into the artifact id (`"<id>:placeholder"` /
 * `"<id>:user-file"`) since the v4 sidecar's WizardArtifact doesn't
 * carry a free-form `source` field. Phase 4 cleanup parses the id
 * back out via `decodeMethodSource`.
 *
 * Next is gated until a method artifact exists.
 */

interface W2Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

type MethodChoice = "placeholder" | "user-file";

const PLACEHOLDER_METHOD_NAME = "Sample method";
const PLACEHOLDER_METHOD_BODY = `# Sample method

A short illustrative method BeakerBot dropped in so the walkthrough could keep moving. Edit, replace, or toss it from the cleanup grid at the end.

## Steps

1. Prep your reagents.
2. Run the protocol.
3. Record what you saw.
`;

export default function W2CreateMethodStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: W2Props) {
  const existing = findArtifact(sidecar, "method");
  const [choice, setChoice] = useState<MethodChoice | null>(null);
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNextDisabled(existing === null);
  }, [existing, setNextDisabled]);

  const writeMethodArtifact = async (
    methodId: number,
    source: MethodChoice,
  ) => {
    await patchSidecar((cur) =>
      appendArtifact(cur, {
        type: "method",
        id: encodeMethodId(methodId, source),
        cleanup_default: "keep",
      }),
    );
  };

  const handlePlaceholder = async () => {
    if (busy || existing) return;
    setBusy(true);
    setError(null);
    try {
      const slug = "sample-method";
      const sourcePath = `methods/${slug}/${slug}.md`;
      await filesApi.writeFile(sourcePath, PLACEHOLDER_METHOD_BODY);
      const method = await methodsApi.create({
        name: PLACEHOLDER_METHOD_NAME,
        source_path: sourcePath,
        method_type: "markdown",
        folder_path: null,
        is_public: false,
      });
      await writeMethodArtifact(method.id, "placeholder");
    } catch (err) {
      console.error("[onboarding-v3] W2 placeholder method failed", err);
      setError("Couldn't create the sample method. Try again or skip.");
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    if (busy || existing) return;
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      const baseName = file.name.replace(/\.(md|markdown)$/i, "").trim();
      const safeName = baseName.length > 0 ? baseName : "Imported method";
      const slug = safeName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "imported-method";
      const sourcePath = `methods/${slug}/${slug}.md`;
      await filesApi.writeFile(sourcePath, text);
      const method = await methodsApi.create({
        name: safeName,
        source_path: sourcePath,
        method_type: "markdown",
        folder_path: null,
        is_public: false,
      });
      await writeMethodArtifact(method.id, "user-file");
    } catch (err) {
      console.error("[onboarding-v3] W2 file method failed", err);
      setError("Couldn't import that file. Try a .md file, or use placeholder.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-step-id="W2" className="space-y-4">
      <SpeechBubble>
        Let&apos;s add your first method! Want me to drop in placeholder text
        so we can keep moving, or do you have a real method document handy?
      </SpeechBubble>

      {existing ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Method added. Onward.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-2">
            <RadioCard
              name="w2-method-choice"
              value="placeholder"
              selected={choice === "placeholder"}
              onChange={(v) => setChoice(v)}
              label="Drop in placeholder text"
              description="A short sample markdown method so we can keep the tour moving."
            />
            <RadioCard
              name="w2-method-choice"
              value="user-file"
              selected={choice === "user-file"}
              onChange={(v) => setChoice(v)}
              label="I have a real method document"
              description="Pick a .md file from disk and I'll import it as a method."
            />
          </div>

          {choice === "placeholder" && (
            <button
              type="button"
              onClick={() => void handlePlaceholder()}
              disabled={busy}
              className="w-full px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
            >
              {busy ? "Adding..." : "Add the sample method"}
            </button>
          )}

          {choice === "user-file" && (
            <div className="space-y-2">
              <label
                htmlFor="w2-file-input"
                className="block px-4 py-3 border border-dashed border-gray-300 rounded-lg text-sm text-center text-gray-600 cursor-pointer hover:border-sky-400 hover:bg-sky-50"
              >
                {pickedFileName ?? "Click to pick a .md / .markdown file"}
              </label>
              <input
                id="w2-file-input"
                type="file"
                accept=".md,.markdown,text/markdown"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setPickedFileName(f.name);
                  void handleFile(f);
                }}
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
