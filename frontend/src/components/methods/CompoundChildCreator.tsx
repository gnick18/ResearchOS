"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  methodsApi,
  filesApi,
  pcrApi,
  lcGradientApi,
  plateApi,
  cellCultureApi,
  massSpecApi,
  codingWorkflowApi,
  qpcrAnalysisApi,
} from "@/lib/local-api";
import { fileService } from "@/lib/file-system/file-service";
import { fileEvents } from "@/lib/attachments/file-events";
import { imageEvents } from "@/lib/attachments/image-events";
import { createNewFileContent } from "@/lib/stamp-utils";
import LiveMarkdownEditor from "@/components/LiveMarkdownEditor";
import { InteractiveGradientEditor } from "@/components/InteractiveGradientEditor";
import LcGradientEditor from "@/components/LcGradientEditor";
import PlateLayoutEditor, { wellsToRegionLabels } from "@/components/PlateLayoutEditor";
import CellCultureScheduleEditor from "@/components/CellCultureScheduleEditor";
import MassSpecEditor from "@/components/MassSpecEditor";
import CodingWorkflowEditor from "@/components/CodingWorkflowEditor";
import QpcrAnalysisEditor from "@/components/QpcrAnalysisEditor";
import { useFileRenamePopup } from "@/components/FileRenamePopup";
import FileDropzone from "@/components/ui/FileDropzone";
import Tooltip from "@/components/Tooltip";
import {
  getMethodTypesByCategory,
  type MethodTypeId,
} from "@/lib/methods/method-type-registry";
import type {
  Method,
  PCRGradient,
  PCRIngredient,
  LCGradientColumn,
  LCGradientStep,
  LCIngredient,
  PlateSize,
  PlateWellAnnotation,
  CellCultureCellLine,
  CellCultureMedia,
  CellCulturePlannedEvent,
  IonizationMode,
  MassSpecCalibration,
  MassSpecScanParams,
  MassSpecSourceParams,
  CodingWorkflowLanguage,
  CodingWorkflowOutputRenderer,
  QPCRChemistry,
  QPCRMeltCurveConfig,
  QPCRReference,
  QPCRStandardCurvePoint,
  SharedUser,
} from "@/lib/types";

/**
 * Inline child-method creator. Rendered as the "Create new" tab body inside
 * CompoundMethodBuilder's component picker. Mirrors the per-type create paths
 * from CreateMethodModal but skips the modal chrome (lives inside the picker)
 * and excludes the Compound tile from the type list — per proposal section
 * 2.4.3, inline-create-nested-compound enters via "Pick existing" instead, so
 * we don't recurse into another builder.
 *
 * Two phases:
 *   - "pick-type": tile grid of every non-compound type registered.
 *   - "edit": name + folder + tags + (per-type editor) + Save / Back.
 *
 * On save: creates the method (and its protocol record for structured types)
 * via the same APIs CreateMethodModal uses, then calls onCreated(newMethod).
 * The compound builder cache-merges the new method, refetches the methods
 * query, and adds the method to its `components` list.
 */
export interface CompoundChildCreatorProps {
  existingFolders: string[];
  /** Method-types registered but not yet implementable inline (e.g. types
   *  whose editor a parallel Phase 1 chip hasn't shipped yet). The picker
   *  shows them with a "Coming soon" badge instead of letting the user pick. */
  unsupportedTypes?: MethodTypeId[];
  onCancel: () => void;
  onCreated: (method: Method) => void;
}

type Phase =
  | { kind: "pick-type" }
  | { kind: "edit"; type: MethodTypeId };

// Local copy of the same helper used by CreateMethodModal and methods/page.tsx.
// Resolves a filename collision under `dirPath` by appending `-1`, `-2` etc.
// The shared sibling Phase 0a chip noted this duplication as a scope concession;
// promoting to a shared lib is deferred.
async function pickUniqueImageName(dirPath: string, desired: string): Promise<string> {
  const dot = desired.lastIndexOf(".");
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : "";
  let candidate = desired;
  let n = 1;
  while (await fileService.fileExists(`${dirPath}/${candidate}`)) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

const TYPES_WITH_INLINE_EDITOR: MethodTypeId[] = [
  "markdown",
  "pdf",
  "pcr",
  "lc_gradient",
  "plate",
  "cell_culture",
  "mass_spec",
  "coding_workflow",
  "qpcr_analysis",
];

export function CompoundChildCreator({
  existingFolders,
  unsupportedTypes,
  onCancel,
  onCreated,
}: CompoundChildCreatorProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "pick-type" });
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [tags, setTags] = useState("");
  // Lab Mode retirement R1d (R1d shared_with API manager, 2026-05-23):
  // compound children are never public — they inherit the parent
  // compound's sharing at read time via the unified `canRead` helper.
  // We pass `shared_with: []` (empty) into `methodsApi.create` so the
  // routing always lands in the user's private store. The legacy
  // `is_public: false` is still forwarded into the structured-protocol
  // APIs (pcrApi, lcGradientApi, etc.) because those still take the
  // boolean; their R1d cousin is a separate later phase.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);

  // Drop-attached files land on disk immediately (under the current slug's
  // dir), well before the user clicks "Create + add to compound" — so we
  // track each method-dir we wrote into. If the user backs out via the
  // wrapper's Cancel button, we delete those dirs to avoid leaving orphan
  // images / files behind. A successful create clears the tracking via the
  // unmount path. Matches CreateMethodModal's cancel-cleanup pattern.
  const uploadedMethodDirsRef = useRef<Set<string>>(new Set());
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();

  // Markdown
  const [mdContent, setMdContent] = useState("");
  // Imperative flush handle published by the embedded markdown editor. Calling
  // it commits the in-flight block buffer, fires onChange, and returns the
  // freshest full-document string, so the submit handler can write the very
  // latest edit even if the user never left the active block.
  const editorSaveRef = useRef<(() => string) | null>(null);
  // Mirrors the editor's in-flight buffer-dirty flag. `mdContent` lags while
  // the user is mid-block (the editor only flushes on commit), so we OR this
  // into the submit button's enabled state to light it the instant the user
  // starts typing the markdown body, not only after a block switch.
  const [editorDirty, setEditorDirty] = useState(false);
  // PDF
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  // PCR
  const [pcrGradient, setPcrGradient] = useState<PCRGradient>(() => ({
    initial: [{ name: "Initial denaturation", temperature: 95, duration: "3 min" }],
    cycles: [
      {
        repeats: 30,
        steps: [
          { name: "Denaturation", temperature: 95, duration: "15 sec" },
          { name: "Annealing", temperature: 60, duration: "30 sec" },
          { name: "Extension", temperature: 72, duration: "30 sec" },
        ],
      },
    ],
    final: [{ name: "Final extension", temperature: 72, duration: "5 min" }],
    hold: { name: "Hold", temperature: 12, duration: "Indef." },
  }));
  const [pcrIngredients, setPcrIngredients] = useState<PCRIngredient[]>(() => [
    { id: "i1", name: "Buffer", concentration: "5x", amount_per_reaction: "" },
    { id: "i2", name: "dNTPs", concentration: "10 mM", amount_per_reaction: "" },
    { id: "i3", name: "Forward primer", concentration: "10 µM", amount_per_reaction: "" },
    { id: "i4", name: "Reverse primer", concentration: "10 µM", amount_per_reaction: "" },
    { id: "i5", name: "Polymerase", concentration: "2 U/µL", amount_per_reaction: "" },
    { id: "i6", name: "Template DNA", concentration: "", amount_per_reaction: "" },
    { id: "i7", name: "Nuclease-free H2O", concentration: "—", amount_per_reaction: "" },
    { id: "i8", name: "Total", concentration: "", amount_per_reaction: "" },
  ]);
  const [pcrNotes, setPcrNotes] = useState("");
  // LC gradient
  const [lcGradientSteps, setLcGradientSteps] = useState<LCGradientStep[]>(() =>
    lcGradientApi.getDefaultGradientSteps(),
  );
  const [lcColumn, setLcColumn] = useState<LCGradientColumn>(() =>
    lcGradientApi.getDefaultColumn(),
  );
  const [lcWavelength, setLcWavelength] = useState<number | null>(214);
  const [lcDescription, setLcDescription] = useState<string | null>(null);
  const [lcIngredients, setLcIngredients] = useState<LCIngredient[]>(() =>
    lcGradientApi.getDefaultIngredients(),
  );
  // Plate
  const [platePlateSize, setPlatePlateSize] = useState<PlateSize>(() =>
    plateApi.getDefaultPlateSize(),
  );
  const [plateWells, setPlateWells] = useState<Record<string, PlateWellAnnotation>>({});
  const [plateDescription, setPlateDescription] = useState<string | null>(null);
  // Cell culture
  const [ccCellLine, setCcCellLine] = useState<CellCultureCellLine>(() =>
    cellCultureApi.getDefaultCellLine(),
  );
  const [ccMedia, setCcMedia] = useState<CellCultureMedia>(() =>
    cellCultureApi.getDefaultMedia(),
  );
  const [ccPlannedEvents, setCcPlannedEvents] = useState<CellCulturePlannedEvent[]>(() =>
    cellCultureApi.getDefaultPlannedEvents(),
  );
  const [ccDescription, setCcDescription] = useState<string | null>(null);
  // Mass spec
  const [msIonizationMode, setMsIonizationMode] = useState<IonizationMode>(() =>
    massSpecApi.getDefaultIonizationMode(),
  );
  const [msIonizationLabel, setMsIonizationLabel] = useState<string | null>(null);
  const [msInstrument, setMsInstrument] = useState<string | null>("");
  const [msDescription, setMsDescription] = useState<string | null>(null);
  const [msSource, setMsSource] = useState<MassSpecSourceParams>(() =>
    massSpecApi.getDefaultSource(),
  );
  const [msScan, setMsScan] = useState<MassSpecScanParams>(() =>
    massSpecApi.getDefaultScan(),
  );
  const [msCalibration, setMsCalibration] = useState<MassSpecCalibration>(() =>
    massSpecApi.getDefaultCalibration(),
  );
  const [msShowAllFields, setMsShowAllFields] = useState(false);
  // Coding workflow
  const [cwLanguage, setCwLanguage] = useState<CodingWorkflowLanguage>(() =>
    codingWorkflowApi.getDefaultLanguage(),
  );
  const [cwLanguageLabel, setCwLanguageLabel] = useState<string | null>(null);
  const [cwEmbeddedCode, setCwEmbeddedCode] = useState<string | null>(() =>
    codingWorkflowApi.getDefaultEmbeddedCode(),
  );
  const [cwExternalPath, setCwExternalPath] = useState<string | null>(null);
  const [cwDescription, setCwDescription] = useState<string | null>(null);
  const [cwOutputRenderer, setCwOutputRenderer] = useState<CodingWorkflowOutputRenderer>(
    "syntax-highlight",
  );
  // qPCR analysis
  const [qpcrChemistry, setQpcrChemistry] = useState<QPCRChemistry>("sybr");
  const [qpcrChemistryLabel, setQpcrChemistryLabel] = useState<string | null>(null);
  const [qpcrDescription, setQpcrDescription] = useState<string | null>(null);
  const [qpcrUseDeltaDeltaCq, setQpcrUseDeltaDeltaCq] = useState(true);
  const [qpcrReferences, setQpcrReferences] = useState<QPCRReference[]>(() =>
    qpcrAnalysisApi.getDefaultReferences(),
  );
  const [qpcrStandardCurve, setQpcrStandardCurve] = useState<QPCRStandardCurvePoint[]>(() =>
    qpcrAnalysisApi.getDefaultStandardCurve(),
  );
  const [qpcrMeltCurve, setQpcrMeltCurve] = useState<QPCRMeltCurveConfig | null>(() =>
    qpcrAnalysisApi.getDefaultMeltCurve(),
  );

  const slug = name
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");

  const tagList = tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  // Unmount safety net for the Escape / X cancel paths that close the picker
  // through CompoundMethodBuilder.tsx rather than our own Cancel button. We
  // can't extend rollbackInlineCreatedChildren (per chip scope) — but the
  // ref still holds the dirs we wrote into, so clean them best-effort on
  // unmount. Successful save and Cancel-button both clear the ref before
  // unmount, so this fires as a no-op in those paths.
  useEffect(() => {
    const ref = uploadedMethodDirsRef;
    return () => {
      const dirs = Array.from(ref.current);
      ref.current.clear();
      dirs.forEach((dir) => {
        filesApi.deleteDirectory(dir).catch(() => {});
      });
    };
  }, []);

  const handleImageUpload = useCallback(
    async (files: FileList | File[]) => {
      if (!slug) {
        alert("Enter a method name first so we know where to save the image.");
        return;
      }
      const methodBase = `methods/${slug}`;
      const imagesDir = `${methodBase}/Images`;
      setUploadWarning(null);
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        try {
          const finalName = await pickUniqueImageName(imagesDir, renamedFile.name);
          await fileService.writeFileFromBlob(`${imagesDir}/${finalName}`, renamedFile);
          uploadedMethodDirsRef.current.add(methodBase);
          imageEvents.emitAttached({
            basePath: methodBase,
            relativePath: `Images/${finalName}`,
          });
        } catch {
          alert(`Failed to upload ${renamedFile.name}`);
        }
      }
    },
    [slug, requestRename],
  );

  const handleFileUpload = useCallback(
    async (files: FileList | File[]) => {
      if (!slug) {
        alert("Enter a method name first so we know where to save the file.");
        return;
      }
      const methodBase = `methods/${slug}`;
      const filesDir = `${methodBase}/Files`;
      setUploadWarning(null);
      for (const file of Array.from(files)) {
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        try {
          const finalName = await pickUniqueImageName(filesDir, renamedFile.name);
          await fileService.writeFileFromBlob(`${filesDir}/${finalName}`, renamedFile);
          uploadedMethodDirsRef.current.add(methodBase);
          fileEvents.emitAttached({
            basePath: methodBase,
            relativePath: `Files/${finalName}`,
          });
        } catch {
          alert(`Failed to upload ${renamedFile.name}`);
        }
      }
    },
    [slug, requestRename],
  );

  // Cancel funnel: best-effort cleanup of any method-dirs we wrote into via
  // drop-uploads before forwarding to the parent's onCancel. Save-then-cancel
  // is NOT this path — the successful save claims the dir and clears tracking
  // (handleSave below).
  const handleCancel = useCallback(async () => {
    const dirs = Array.from(uploadedMethodDirsRef.current);
    uploadedMethodDirsRef.current.clear();
    for (const dir of dirs) {
      try {
        await filesApi.deleteDirectory(dir);
      } catch {
        // Non-fatal — directory may not exist or be partially gone already.
      }
    }
    onCancel();
  }, [onCancel]);

  const handleSave = useCallback(async () => {
    if (phase.kind !== "edit") return;
    if (!name.trim()) {
      setSaveError("Name is required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      let created: Method;
      const folderPath = folder.trim() || null;
      // Compound children always land in the private store (R1d): an
      // empty `shared_with` keeps them out of the public namespace.
      // The unified read path (canRead) computes effective visibility
      // for receivers from the parent compound's shared_with at view
      // time.
      const sharedBase = {
        name: name.trim(),
        folder_path: folderPath,
        tags: tagList,
        shared_with: [] as SharedUser[],
      };
      if (phase.type === "markdown") {
        const sourcePath = `methods/${slug}/${slug}.md`;
        const stamped = createNewFileContent(
          name.trim(),
          folder.trim() || "Methods",
          "method",
        );
        // Flush the editor's in-flight block buffer first so the last
        // in-progress edit is written, then fall back to `mdContent`.
        const flushed = editorSaveRef.current?.();
        const md = typeof flushed === "string" ? flushed : mdContent;
        const body = md ? `${stamped}\n${md}` : stamped;
        await filesApi.writeFile(sourcePath, body, `Create method: ${name}`);
        created = await methodsApi.create({
          ...sharedBase,
          source_path: sourcePath,
          method_type: "markdown",
        });
      } else if (phase.type === "pdf") {
        if (!pdfFile) {
          setSaveError("Select a PDF first.");
          setSaving(false);
          return;
        }
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(pdfFile);
        });
        const sourcePath = `methods/${slug}/${pdfFile.name}`;
        await filesApi.uploadImage(sourcePath, base64, `Upload PDF: ${name}`);
        created = await methodsApi.create({
          ...sharedBase,
          source_path: sourcePath,
          method_type: "pdf",
        });
      } else if (phase.type === "pcr") {
        const protocol = await pcrApi.create({
          name: name.trim(),
          gradient: pcrGradient,
          ingredients: pcrIngredients,
          notes: pcrNotes || null,
          folder_path: folderPath,
          is_public: false,
        });
        created = await methodsApi.create({
          ...sharedBase,
          source_path: `pcr://protocol/${protocol.id}`,
          method_type: "pcr",
        });
      } else if (phase.type === "lc_gradient") {
        const protocol = await lcGradientApi.create({
          name: name.trim(),
          description: lcDescription,
          gradient_steps: lcGradientSteps,
          column: lcColumn,
          detection_wavelength_nm: lcWavelength,
          ingredients: lcIngredients,
          folder_path: folderPath,
          is_public: false,
        });
        created = await methodsApi.create({
          ...sharedBase,
          source_path: `lc_gradient://protocol/${protocol.id}`,
          method_type: "lc_gradient",
        });
      } else if (phase.type === "plate") {
        const protocol = await plateApi.create({
          name: name.trim(),
          description: plateDescription,
          plate_size: platePlateSize,
          region_labels: wellsToRegionLabels(plateWells),
          folder_path: folderPath,
          is_public: false,
        });
        created = await methodsApi.create({
          ...sharedBase,
          source_path: `plate://protocol/${protocol.id}`,
          method_type: "plate",
        });
      } else if (phase.type === "cell_culture") {
        const schedule = await cellCultureApi.create({
          name: name.trim(),
          description: ccDescription,
          cell_line: ccCellLine,
          media: ccMedia,
          planned_events: ccPlannedEvents,
          folder_path: folderPath,
          is_public: false,
        });
        created = await methodsApi.create({
          ...sharedBase,
          source_path: `cell_culture://protocol/${schedule.id}`,
          method_type: "cell_culture",
        });
      } else if (phase.type === "mass_spec") {
        const protocol = await massSpecApi.create({
          name: name.trim(),
          description: msDescription,
          ionization_mode: msIonizationMode,
          ionization_label: msIonizationLabel,
          instrument: msInstrument,
          source: msSource,
          scan: msScan,
          calibration: msCalibration,
          folder_path: folderPath,
          is_public: false,
        });
        created = await methodsApi.create({
          ...sharedBase,
          source_path: `mass_spec://protocol/${protocol.id}`,
          method_type: "mass_spec",
        });
      } else if (phase.type === "coding_workflow") {
        const protocol = await codingWorkflowApi.create({
          name: name.trim(),
          description: cwDescription,
          language: cwLanguage,
          language_label: cwLanguageLabel,
          embedded_code: cwEmbeddedCode,
          external_path: cwExternalPath,
          output_renderer: cwOutputRenderer,
          folder_path: folderPath,
          is_public: false,
        });
        created = await methodsApi.create({
          ...sharedBase,
          source_path: `coding_workflow://protocol/${protocol.id}`,
          method_type: "coding_workflow",
        });
      } else if (phase.type === "qpcr_analysis") {
        const protocol = await qpcrAnalysisApi.create({
          name: name.trim(),
          description: qpcrDescription,
          chemistry: qpcrChemistry,
          chemistry_label: qpcrChemistryLabel,
          references: qpcrReferences,
          standard_curve: qpcrStandardCurve,
          melt_curve: qpcrMeltCurve,
          use_delta_delta_cq: qpcrUseDeltaDeltaCq,
          folder_path: folderPath,
          is_public: false,
        });
        created = await methodsApi.create({
          ...sharedBase,
          source_path: `qpcr_analysis://protocol/${protocol.id}`,
          method_type: "qpcr_analysis",
        });
      } else {
        setSaveError(`Inline-create not implemented for type "${phase.type}".`);
        setSaving(false);
        return;
      }
      // Save claimed the method dir — any drop-uploads we tracked are now
      // part of the persisted method, so the cancel-cleanup path should not
      // delete them out from under it.
      uploadedMethodDirsRef.current.clear();
      onCreated(created);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create method.";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [
    phase,
    name,
    folder,
    slug,
    mdContent,
    pdfFile,
    pcrGradient,
    pcrIngredients,
    pcrNotes,
    lcGradientSteps,
    lcColumn,
    lcWavelength,
    lcDescription,
    lcIngredients,
    platePlateSize,
    plateWells,
    plateDescription,
    ccCellLine,
    ccMedia,
    ccPlannedEvents,
    ccDescription,
    msIonizationMode,
    msIonizationLabel,
    msInstrument,
    msDescription,
    msSource,
    msScan,
    msCalibration,
    cwLanguage,
    cwLanguageLabel,
    cwEmbeddedCode,
    cwExternalPath,
    cwDescription,
    cwOutputRenderer,
    qpcrChemistry,
    qpcrChemistryLabel,
    qpcrDescription,
    qpcrUseDeltaDeltaCq,
    qpcrReferences,
    qpcrStandardCurve,
    qpcrMeltCurve,
    tagList,
    onCreated,
  ]);

  const saveDisabled =
    saving ||
    !name.trim() ||
    (phase.kind === "edit" && phase.type === "pdf" && !pdfFile) ||
    // OR in editorDirty so the button lights the instant the user starts
    // typing — `mdContent` lags the editor's in-flight buffer until a commit.
    (phase.kind === "edit" && phase.type === "markdown" && !(mdContent.trim() || editorDirty));

  if (phase.kind === "pick-type") {
    return (
      <TypeTilePicker
        unsupportedTypes={unsupportedTypes ?? []}
        onPick={(type) => setPhase({ kind: "edit", type })}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-1 pb-3 flex items-center gap-2 border-b border-border">
        <Tooltip label="Back to type picker" placement="right">
          <button
            onClick={() => setPhase({ kind: "pick-type" })}
            className="text-meta text-foreground-muted hover:text-foreground px-2 py-1 rounded hover:bg-surface-sunken"
          >
            ← Back
          </button>
        </Tooltip>
        <span className="text-meta text-foreground-muted">
          Inline new method · {labelForType(phase.type)}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto pt-3 pb-1 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Method name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Western blot assay"
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Folder (optional)
            </label>
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="e.g. Assays"
              list="compound-child-folders"
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <datalist id="compound-child-folders">
              {existingFolders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
        </div>
        <div>
          <label className="block text-meta font-medium text-foreground-muted mb-1">
            Tags (comma-separated, optional)
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g. assay, gel"
            className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {/* Lab Mode retirement R1b: child-method "public" checkbox
            removed. Use the unified ShareDialog on the compound method
            after creation; child methods inherit the parent's sharing
            (handled in the methods read paths). */}

        {phase.type === "markdown" && (
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Method content
            </label>
            <div className="border border-border rounded-lg overflow-hidden">
              <LiveMarkdownEditor
                value={mdContent}
                onChange={setMdContent}
                placeholder={`# ${name || "Method name"}\n\n## Materials\n- Item 1\n\n## Steps\n1. First step`}
                imageBasePath={`methods/${slug}`}
                onImageDrop={handleImageUpload}
                onFileDrop={handleFileUpload}
                allowAnyFileType
                showToolbar
                // The form owns its own submit button, so hide the editor's
                // internal Save. saveRef lets the submit handler flush the live
                // buffer; onDirtyChange lights the submit button while typing.
                // No onExplicitSave: Cmd+S must not submit a half-filled form.
                hideSaveButton
                saveRef={editorSaveRef}
                onDirtyChange={setEditorDirty}
              />
            </div>
            <p className="text-meta text-foreground-muted mt-1">
              Image uploads from inside a kit component editor land in
              <code className="px-1">{`methods/${slug || "<slug>"}/Images`}</code>.
            </p>
            {uploadWarning && (
              <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded text-meta text-amber-800 dark:text-amber-200">
                {uploadWarning}
              </div>
            )}
          </div>
        )}

        {phase.type === "pdf" && (
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Upload PDF
            </label>
            {pdfFile ? (
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                <p className="text-body font-medium text-foreground">{pdfFile.name}</p>
                <p className="text-meta text-foreground-muted mt-1">
                  {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
                <button
                  type="button"
                  onClick={() => setPdfFile(null)}
                  className="mt-2 text-meta text-red-500 hover:text-red-700 dark:hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            ) : (
              <FileDropzone
                accept=".pdf"
                icon="file"
                hint="PDF"
                onFiles={(files) => {
                  if (files[0]) setPdfFile(files[0]);
                }}
                onReject={setSaveError}
              />
            )}
          </div>
        )}

        {phase.type === "pcr" && (
          <div className="space-y-3">
            <div>
              <h4 className="text-body font-semibold text-foreground mb-2">Thermal gradient</h4>
              <InteractiveGradientEditor gradient={pcrGradient} onChange={setPcrGradient} />
            </div>
            <div>
              <h4 className="text-body font-semibold text-foreground mb-2">Reaction recipe</h4>
              <PcrIngredientTable
                ingredients={pcrIngredients}
                onChange={setPcrIngredients}
              />
            </div>
            <div>
              <h4 className="text-body font-semibold text-foreground mb-1">Notes (optional)</h4>
              <textarea
                value={pcrNotes}
                onChange={(e) => setPcrNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {phase.type === "lc_gradient" && (
          <LcGradientEditor
            gradientSteps={lcGradientSteps}
            onGradientStepsChange={setLcGradientSteps}
            column={lcColumn}
            onColumnChange={setLcColumn}
            detectionWavelengthNm={lcWavelength}
            onDetectionWavelengthChange={setLcWavelength}
            description={lcDescription}
            onDescriptionChange={setLcDescription}
            ingredients={lcIngredients}
            onIngredientsChange={setLcIngredients}
          />
        )}

        {phase.type === "plate" && (
          <PlateLayoutEditor
            plateSize={platePlateSize}
            onPlateSizeChange={setPlatePlateSize}
            wells={plateWells}
            onWellsChange={setPlateWells}
            description={plateDescription}
            onDescriptionChange={setPlateDescription}
          />
        )}

        {phase.type === "cell_culture" && (
          <CellCultureScheduleEditor
            cellLine={ccCellLine}
            onCellLineChange={setCcCellLine}
            media={ccMedia}
            onMediaChange={setCcMedia}
            plannedEvents={ccPlannedEvents}
            onPlannedEventsChange={setCcPlannedEvents}
            description={ccDescription}
            onDescriptionChange={setCcDescription}
          />
        )}

        {phase.type === "mass_spec" && (
          <MassSpecEditor
            ionizationMode={msIonizationMode}
            onIonizationModeChange={setMsIonizationMode}
            ionizationLabel={msIonizationLabel}
            onIonizationLabelChange={setMsIonizationLabel}
            instrument={msInstrument}
            onInstrumentChange={setMsInstrument}
            description={msDescription}
            onDescriptionChange={setMsDescription}
            source={msSource}
            onSourceChange={setMsSource}
            scan={msScan}
            onScanChange={setMsScan}
            calibration={msCalibration}
            onCalibrationChange={setMsCalibration}
            showAllFields={msShowAllFields}
            onShowAllFieldsChange={setMsShowAllFields}
          />
        )}

        {phase.type === "coding_workflow" && (
          <CodingWorkflowEditor
            language={cwLanguage}
            onLanguageChange={setCwLanguage}
            languageLabel={cwLanguageLabel}
            onLanguageLabelChange={setCwLanguageLabel}
            embeddedCode={cwEmbeddedCode}
            onEmbeddedCodeChange={setCwEmbeddedCode}
            externalPath={cwExternalPath}
            onExternalPathChange={setCwExternalPath}
            description={cwDescription}
            onDescriptionChange={setCwDescription}
            outputRenderer={cwOutputRenderer}
            onOutputRendererChange={setCwOutputRenderer}
          />
        )}

        {phase.type === "qpcr_analysis" && (
          <QpcrAnalysisEditor
            chemistry={qpcrChemistry}
            onChemistryChange={setQpcrChemistry}
            chemistryLabel={qpcrChemistryLabel}
            onChemistryLabelChange={setQpcrChemistryLabel}
            description={qpcrDescription}
            onDescriptionChange={setQpcrDescription}
            useDeltaDeltaCq={qpcrUseDeltaDeltaCq}
            onUseDeltaDeltaCqChange={setQpcrUseDeltaDeltaCq}
            references={qpcrReferences}
            onReferencesChange={setQpcrReferences}
            standardCurve={qpcrStandardCurve}
            onStandardCurveChange={setQpcrStandardCurve}
            meltCurve={qpcrMeltCurve}
            onMeltCurveChange={setQpcrMeltCurve}
          />
        )}

        {saveError && (
          <div className="border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 rounded p-3 text-body text-red-900">
            {saveError}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-3 pt-3 border-t border-border">
        <button
          onClick={handleCancel}
          className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saveDisabled}
          className="px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create + add to kit"}
        </button>
      </div>
      <FileRenamePopup />
    </div>
  );
}

function labelForType(type: MethodTypeId): string {
  const all = [
    ...getMethodTypesByCategory("standard"),
    ...getMethodTypesByCategory("structured"),
  ];
  return all.find((m) => m.id === type)?.label ?? type;
}

interface TypeTilePickerProps {
  unsupportedTypes: MethodTypeId[];
  onPick: (type: MethodTypeId) => void;
  onCancel: () => void;
}

function TypeTilePicker({ unsupportedTypes, onPick, onCancel }: TypeTilePickerProps) {
  const standard = getMethodTypesByCategory("standard");
  const structured = getMethodTypesByCategory("structured").filter(
    (m) => m.id !== "compound",
  );

  function renderSection(
    heading: string,
    types: ReturnType<typeof getMethodTypesByCategory>,
  ) {
    return (
      <div>
        <label className="block text-meta font-medium text-foreground-muted mb-2">
          {heading}
        </label>
        <div className="flex flex-wrap gap-2">
          {types.map((meta) => {
            const Icon = meta.icon;
            const inlineSupported = TYPES_WITH_INLINE_EDITOR.includes(meta.id);
            const flaggedUnsupported = unsupportedTypes.includes(meta.id);
            const disabled = !inlineSupported || flaggedUnsupported;
            return (
              <button
                key={meta.id}
                type="button"
                onClick={() => !disabled && onPick(meta.id)}
                disabled={disabled}
                className={`flex-1 min-w-[180px] text-left px-3 py-2.5 rounded-lg border transition-colors ${
                  disabled
                    ? "border-border bg-surface-sunken text-foreground-muted cursor-not-allowed"
                    : "border-border text-foreground-muted hover:bg-surface-sunken"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  <span className="text-body">{meta.label}</span>
                  {disabled && (
                    <span className="text-meta text-foreground-muted italic ml-auto">
                      coming soon
                    </span>
                  )}
                </div>
                {meta.description && (
                  <p className="mt-1 text-meta text-foreground-muted">
                    {meta.description}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto pt-1 space-y-4">
        <p className="text-meta text-foreground-muted">
          Pick a method type. The new method will be created in your methods
          library AND added to this kit&apos;s component list when you save.
          A kit nested in a kit isn&apos;t available here, build the
          child kit separately first, then attach via &ldquo;Pick existing&rdquo;.
        </p>
        {renderSection("Standard methods", standard)}
        {structured.length > 0 && renderSection("Structured methods", structured)}
      </div>
      <div className="flex justify-end gap-3 pt-3 border-t border-border">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

interface PcrIngredientTableProps {
  ingredients: PCRIngredient[];
  onChange: (next: PCRIngredient[]) => void;
}

function PcrIngredientTable({ ingredients, onChange }: PcrIngredientTableProps) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-meta">
        <thead className="bg-surface-sunken">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-foreground-muted">Ingredient</th>
            <th className="px-3 py-2 text-left font-medium text-foreground-muted">Concentration</th>
            <th className="px-3 py-2 text-left font-medium text-foreground-muted">Amount/Rx</th>
            <th className="px-2 py-2 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {ingredients.map((ing, i) => (
            <tr key={ing.id} className={i % 2 === 0 ? "bg-surface-raised" : "bg-surface-sunken"}>
              <td className="px-3 py-2">
                {ing.name === "Total" ? (
                  <span className="font-medium text-foreground">{ing.name}</span>
                ) : (
                  <input
                    type="text"
                    value={ing.name}
                    onChange={(e) => {
                      const next = [...ingredients];
                      next[i] = { ...ing, name: e.target.value };
                      onChange(next);
                    }}
                    className="w-full px-2 py-1 border border-border rounded text-foreground"
                  />
                )}
              </td>
              <td className="px-3 py-2">
                {ing.name === "Total" ? (
                  <span className="text-foreground-muted">-</span>
                ) : (
                  <input
                    type="text"
                    value={ing.concentration}
                    onChange={(e) => {
                      const next = [...ingredients];
                      next[i] = { ...ing, concentration: e.target.value };
                      onChange(next);
                    }}
                    className="w-full px-2 py-1 border border-border rounded text-foreground-muted"
                    placeholder="e.g. 10x"
                  />
                )}
              </td>
              <td className="px-3 py-2">
                <input
                  type="text"
                  value={ing.amount_per_reaction}
                  onChange={(e) => {
                    const next = [...ingredients];
                    next[i] = { ...ing, amount_per_reaction: e.target.value };
                    onChange(next);
                  }}
                  className="w-full px-2 py-1 border border-border rounded text-foreground-muted"
                  placeholder="e.g. 2.5"
                />
              </td>
              <td className="px-2 py-2">
                {ing.name !== "Total" && (
                  <Tooltip label="Remove ingredient" placement="left">
                    <button
                      onClick={() => onChange(ingredients.filter((it) => it.id !== ing.id))}
                      className="text-foreground-muted hover:text-red-500 text-body"
                    >
                      ✕
                    </button>
                  </Tooltip>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={() => {
          const newId = String(Date.now());
          const totalIndex = ingredients.findIndex((it) => it.name === "Total");
          const insertion = { id: newId, name: "", concentration: "", amount_per_reaction: "" };
          if (totalIndex >= 0) {
            onChange([
              ...ingredients.slice(0, totalIndex),
              insertion,
              ...ingredients.slice(totalIndex),
            ]);
          } else {
            onChange([...ingredients, insertion]);
          }
        }}
        className="w-full py-2 text-meta text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-brand-action/10 border-t border-border"
      >
        + Add ingredient
      </button>
    </div>
  );
}
