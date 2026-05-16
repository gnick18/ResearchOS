"use client";

import { useCallback, useRef, useState } from "react";
import {
  methodsApi as rawMethodsApi,
  filesApi,
  pcrApi,
  lcGradientApi,
  plateApi,
  cellCultureApi,
  massSpecApi,
  codingWorkflowApi,
} from "@/lib/local-api";
import { fileService } from "@/lib/file-system/file-service";
import { fileEvents } from "@/lib/attachments/file-events";
import { imageEvents } from "@/lib/attachments/image-events";
import { createNewFileContent } from "@/lib/stamp-utils";
import LiveMarkdownEditor from "@/components/LiveMarkdownEditor";
import { InteractiveGradientEditor } from "@/components/InteractiveGradientEditor";
import { useFileRenamePopup } from "@/components/FileRenamePopup";
import Tooltip from "@/components/Tooltip";
import type {
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
} from "@/lib/types";
import LcGradientEditor from "@/components/LcGradientEditor";
import PlateLayoutEditor, { wellsToRegionLabels } from "@/components/PlateLayoutEditor";
import CellCultureScheduleEditor from "@/components/CellCultureScheduleEditor";
import MassSpecEditor from "@/components/MassSpecEditor";
import CodingWorkflowEditor from "@/components/CodingWorkflowEditor";
import { type MethodTypeId } from "@/lib/methods/method-type-registry";
import { MethodTypeCategoryPicker } from "./MethodTypePicker";
import { CompoundMethodBuilder } from "./CompoundMethodBuilder";

const methodsApi = rawMethodsApi;

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

export function CreateMethodModal({
  existingFolders,
  prefilledFolder,
  initialIsPublic = false,
  onClose,
  onCreated,
}: {
  existingFolders: string[];
  prefilledFolder?: string;
  /** When true, the "Make this method public" checkbox starts checked.
   *  Used by the `public-methods` onboarding tip's `setupAction` deep
   *  link (`/methods?createMethod=public`). */
  initialIsPublic?: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [uploadType, setUploadType] = useState<MethodTypeId>("markdown");
  const [name, setName] = useState("");
  const [folder, setFolder] = useState(prefilledFolder || "");
  const [tags, setTags] = useState("");
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [saving, setSaving] = useState(false);

  // Markdown state
  const [mdContent, setMdContent] = useState("");
  const [, setUploading] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();

  // Track uploaded image paths for cleanup on cancel
  const uploadedImagePathsRef = useRef<string[]>([]);

  // PDF state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // PCR state — standard PCR cycling defaults; user adjusts after Create.
  const [pcrGradient, setPcrGradient] = useState<PCRGradient>({
    initial: [{ name: "Initial denaturation", temperature: 95, duration: "3 min" }],
    cycles: [{
      repeats: 30,
      steps: [
        { name: "Denaturation", temperature: 95, duration: "15 sec" },
        { name: "Annealing", temperature: 60, duration: "30 sec" },
        { name: "Extension", temperature: 72, duration: "30 sec" },
      ],
    }],
    final: [{ name: "Final extension", temperature: 72, duration: "5 min" }],
    hold: { name: "Hold", temperature: 12, duration: "Indef." },
  });
  const [pcrIngredients, setPcrIngredients] = useState<PCRIngredient[]>([
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

  // LC gradient state — sensible reverse-phase HPLC defaults (5%→95%
  // acetonitrile over 25 min, 0.3 mL/min). User can refine after Create.
  const [lcGradientSteps, setLcGradientSteps] = useState<LCGradientStep[]>(
    () => lcGradientApi.getDefaultGradientSteps(),
  );
  const [lcColumn, setLcColumn] = useState<LCGradientColumn>(() =>
    lcGradientApi.getDefaultColumn(),
  );
  const [lcWavelength, setLcWavelength] = useState<number | null>(214);
  const [lcDescription, setLcDescription] = useState<string | null>(null);
  const [lcIngredients, setLcIngredients] = useState<LCIngredient[]>(() =>
    lcGradientApi.getDefaultIngredients(),
  );

  // Plate layout state — defaults to an empty 96-well plate. The editor's
  // brush-paint UX writes per-well annotations; on save we flatten to
  // region_labels (1×1 rectangles) which is the source-template shape on disk.
  const [platePlateSize, setPlatePlateSize] = useState<PlateSize>(() =>
    plateApi.getDefaultPlateSize(),
  );
  const [plateWells, setPlateWells] = useState<Record<string, PlateWellAnnotation>>({});
  const [plateDescription, setPlateDescription] = useState<string | null>(null);

  // Cell culture passaging defaults — HeLa cells, DMEM + 10% FBS, feed M/W/F,
  // split 1:5 weekly. Mirrors the locked design from the Phase 2D chip spec.
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

  // Mass spec defaults — ESI+ Q-Exactive-style starting point (the most
  // common LC-MS workflow). User refines after Create per proposal §4.
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

  // Coding workflow state — Python default per Q-B5 lock (most common
  // scientific scripting language); users switch via the picker.
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

  const slug = name
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");

  const handleImageUpload = useCallback(
    async (files: FileList | File[]) => {
      if (!slug) {
        alert("Enter a method name first");
        return;
      }
      setUploading(true);
      setUploadWarning(null);
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;

        // Show rename popup and wait for user decision
        const renamedFile = await requestRename(file);
        if (!renamedFile) {
          continue; // User cancelled
        }

        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const imageName = `${Date.now()}-${renamedFile.name.replace(/\s+/g, "_")}`;
          const imagePath = `methods/${slug}/Images/${imageName}`;

          try {
            const response = await filesApi.uploadImage(
              imagePath,
              base64,
              `Upload image for method: ${name}`
            );
            // Track uploaded image for potential cleanup on cancel
            uploadedImagePathsRef.current.push(imagePath);
            // Drop = attach to Images/ only; placing the markdown ref
            // inline is the user's explicit drag from the bottom strip.
            if (response.warning) {
              setUploadWarning(response.warning);
            }
            imageEvents.emitAttached({
              basePath: `methods/${slug}`,
              relativePath: `Images/${imageName}`,
            });
          } catch {
            alert(`Failed to upload ${renamedFile.name}`);
          }
        };
        reader.readAsDataURL(renamedFile);
      }
      setUploading(false);
    },
    [slug, name, requestRename]
  );

  const handleFileUpload = useCallback(
    async (files: FileList | File[]) => {
      if (!slug) {
        alert("Enter a method name first");
        return;
      }
      const methodBase = `methods/${slug}`;
      const filesDir = `${methodBase}/Files`;
      setUploading(true);
      setUploadWarning(null);
      for (const file of Array.from(files)) {
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        try {
          const finalName = await pickUniqueImageName(filesDir, renamedFile.name);
          const destPath = `${filesDir}/${finalName}`;
          await fileService.writeFileFromBlob(destPath, renamedFile);
          uploadedImagePathsRef.current.push(destPath);
          fileEvents.emitAttached({ basePath: methodBase, relativePath: `Files/${finalName}` });
        } catch {
          alert(`Failed to upload ${renamedFile.name}`);
        }
      }
      setUploading(false);
    },
    [slug, requestRename]
  );

  // Cleanup function to delete uploaded images when canceling
  const handleCancel = useCallback(async () => {
    const uploadedPaths = uploadedImagePathsRef.current;
    if (uploadedPaths.length > 0) {
      // Delete the entire method folder if we uploaded any images
      const methodDir = `methods/${slug}`;
      try {
        await filesApi.deleteDirectory(methodDir);
      } catch {
        // Non-fatal — directory might not exist or already be deleted
      }
    }
    onClose();
  }, [slug, onClose]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length > 0) handleImageUpload(files);
    },
    [handleImageUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);

    try {
      if (uploadType === "markdown") {
        const sourcePath = `methods/${slug}/${slug}.md`;
        // Auto-stamp new method files the same way notes/results files get
        // stamped on creation. If the user pasted markdown into the modal,
        // prepend the stamp; otherwise the stamp is the only content.
        const stampedScaffold = createNewFileContent(
          name.trim(),
          folder.trim() || "Methods",
          "method"
        );
        const body = mdContent ? `${stampedScaffold}\n${mdContent}` : stampedScaffold;
        await filesApi.writeFile(sourcePath, body, `Create method: ${name}`);
        // Create the method record
        await methodsApi.create({
          name: name.trim(),
          source_path: sourcePath,
          method_type: "markdown",
          folder_path: folder.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          is_public: isPublic,
        });
      } else if (uploadType === "pdf" && pdfFile) {
        // Upload PDF
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(pdfFile);
        });
        const sourcePath = `methods/${slug}/${pdfFile.name}`;
        const response = await filesApi.uploadImage(sourcePath, base64, `Upload PDF: ${name}`);
        if (response.warning) {
          setUploadWarning(response.warning);
        }

        // Create the method record
        await methodsApi.create({
          name: name.trim(),
          source_path: sourcePath,
          method_type: "pdf",
          folder_path: folder.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          is_public: isPublic,
        });
      } else if (uploadType === "pcr") {
        const protocol = await pcrApi.create({
          name: name.trim(),
          gradient: pcrGradient,
          ingredients: pcrIngredients,
          notes: pcrNotes || null,
          folder_path: folder.trim() || null,
          is_public: isPublic,
        });
        await methodsApi.create({
          name: name.trim(),
          source_path: `pcr://protocol/${protocol.id}`,
          method_type: "pcr",
          folder_path: folder.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          is_public: isPublic,
        });
      } else if (uploadType === "lc_gradient") {
        const protocol = await lcGradientApi.create({
          name: name.trim(),
          description: lcDescription,
          gradient_steps: lcGradientSteps,
          column: lcColumn,
          detection_wavelength_nm: lcWavelength,
          ingredients: lcIngredients,
          folder_path: folder.trim() || null,
          is_public: isPublic,
        });
        await methodsApi.create({
          name: name.trim(),
          source_path: `lc_gradient://protocol/${protocol.id}`,
          method_type: "lc_gradient",
          folder_path: folder.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          is_public: isPublic,
        });
      } else if (uploadType === "plate") {
        const protocol = await plateApi.create({
          name: name.trim(),
          description: plateDescription,
          plate_size: platePlateSize,
          region_labels: wellsToRegionLabels(plateWells),
          folder_path: folder.trim() || null,
          is_public: isPublic,
        });
        await methodsApi.create({
          name: name.trim(),
          source_path: `plate://protocol/${protocol.id}`,
          method_type: "plate",
          folder_path: folder.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          is_public: isPublic,
        });
      } else if (uploadType === "cell_culture") {
        const schedule = await cellCultureApi.create({
          name: name.trim(),
          description: ccDescription,
          cell_line: ccCellLine,
          media: ccMedia,
          planned_events: ccPlannedEvents,
          folder_path: folder.trim() || null,
          is_public: isPublic,
        });
        await methodsApi.create({
          name: name.trim(),
          source_path: `cell_culture://protocol/${schedule.id}`,
          method_type: "cell_culture",
          folder_path: folder.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          is_public: isPublic,
        });
      } else if (uploadType === "mass_spec") {
        const protocol = await massSpecApi.create({
          name: name.trim(),
          description: msDescription,
          ionization_mode: msIonizationMode,
          ionization_label: msIonizationLabel,
          instrument: msInstrument,
          source: msSource,
          scan: msScan,
          calibration: msCalibration,
          folder_path: folder.trim() || null,
          is_public: isPublic,
        });
        await methodsApi.create({
          name: name.trim(),
          source_path: `mass_spec://protocol/${protocol.id}`,
          method_type: "mass_spec",
          folder_path: folder.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          is_public: isPublic,
        });
      } else if (uploadType === "coding_workflow") {
        const protocol = await codingWorkflowApi.create({
          name: name.trim(),
          description: cwDescription,
          language: cwLanguage,
          language_label: cwLanguageLabel,
          embedded_code: cwEmbeddedCode,
          external_path: cwExternalPath,
          output_renderer: cwOutputRenderer,
          folder_path: folder.trim() || null,
          is_public: isPublic,
        });
        await methodsApi.create({
          name: name.trim(),
          source_path: `coding_workflow://protocol/${protocol.id}`,
          method_type: "coding_workflow",
          folder_path: folder.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          is_public: isPublic,
        });
      }
      onCreated();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to create method";
      alert(msg);
    } finally {
      setSaving(false);
    }
  }, [name, slug, uploadType, mdContent, pdfFile, folder, tags, isPublic, pcrGradient, pcrIngredients, pcrNotes, lcGradientSteps, lcColumn, lcWavelength, lcDescription, lcIngredients, platePlateSize, plateWells, plateDescription, ccCellLine, ccMedia, ccPlannedEvents, ccDescription, msIonizationMode, msIonizationLabel, msInstrument, msDescription, msSource, msScan, msCalibration, cwLanguage, cwLanguageLabel, cwEmbeddedCode, cwExternalPath, cwDescription, cwOutputRenderer, onCreated]);

  // When the user picks the Compound tile, hand off to the dedicated
  // builder workspace per proposal section 2.4.2 (stage-2 view). The
  // builder owns its own modal chrome, so we render it INSTEAD of the
  // normal dialog body — there's no useful "Name + folder" to collect
  // before the builder opens (the builder asks for them itself).
  if (uploadType === "compound") {
    return (
      <CompoundMethodBuilder
        existingFolders={existingFolders}
        prefilledFolder={prefilledFolder}
        onClose={onClose}
        onSaved={() => onCreated()}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">
            New Method
          </h3>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={handleCancel}
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              ✕
            </button>
          </Tooltip>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {/* Upload type picker — grouped into Standard / Structured.
                Structured types own a per-type protocol record alongside
                the Method row; standard types just point at a file. */}
            <MethodTypeCategoryPicker
              uploadType={uploadType}
              onSelect={setUploadType}
            />

            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Method Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Western Blot Protocol"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>

            {/* Folder + Tags */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Folder (optional)
                </label>
                <input
                  type="text"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="e.g. Molecular Biology"
                  list="existing-folders"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <datalist id="existing-folders">
                  {existingFolders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Tags (comma-separated, optional)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. protein, gel"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Public/Private Toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isPublic"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="isPublic" className="text-sm text-gray-700">
                Make this method public (visible to all lab members)
              </label>
            </div>

            {/* Markdown editor */}
            {uploadType === "markdown" && (
              <div>
                <label className="text-xs font-medium text-gray-500 mb-2 block">
                  Method Content
                </label>
                <div
                  className="border border-gray-200 rounded-lg overflow-hidden"
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                >
                  <LiveMarkdownEditor
                    value={mdContent}
                    onChange={setMdContent}
                    placeholder={`# ${name || "Method Name"}\n\n## Materials\n- Item 1\n- Item 2\n\n## Steps\n1. First step\n2. Second step`}
                    onImageDrop={handleImageUpload}
                    onFileDrop={handleFileUpload}
                    allowAnyFileType={true}
                    imageBasePath={`methods/${slug}`}
                    showToolbar={true}
                  />
                </div>
                {uploadWarning && (
                  <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                    <span className="text-amber-500">⚠️</span>
                    <div className="flex-1">
                      <p className="text-sm text-amber-800">{uploadWarning}</p>
                    </div>
                    <Tooltip label="Dismiss warning" placement="bottom">
                      <button
                        onClick={() => setUploadWarning(null)}
                        className="text-amber-400 hover:text-amber-600"
                      >
                        ✕
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
            )}

            {/* PDF upload */}
            {uploadType === "pdf" && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">
                  Upload PDF
                </label>
                <div
                  onClick={() => pdfInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
                >
                  {pdfFile ? (
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {pdfFile.name}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPdfFile(null);
                        }}
                        className="mt-2 text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-500">
                        Click to select a PDF file
                      </p>
                    </div>
                  )}
                </div>
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) setPdfFile(e.target.files[0]);
                  }}
                />
                <p className="text-xs text-gray-400 mt-2">
                  PDF methods can be viewed but not edited inline. Step
                  deviations will be saved as a separate Markdown file.
                </p>
                {uploadWarning && (
                  <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                    <span className="text-amber-500">⚠️</span>
                    <div className="flex-1">
                      <p className="text-sm text-amber-800">{uploadWarning}</p>
                    </div>
                    <Tooltip label="Dismiss warning" placement="bottom">
                      <button
                        onClick={() => setUploadWarning(null)}
                        className="text-amber-400 hover:text-amber-600"
                      >
                        ✕
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
            )}

            {/* LC Gradient editor */}
            {uploadType === "lc_gradient" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">
                  LC gradient protocols store the solvent gradient (%A/%B over time + flow), column geometry, detection wavelength, and ingredient list.
                </p>
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
              </div>
            )}

            {/* Plate Layout editor */}
            {uploadType === "plate" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">
                  Plate layouts store a well-plate template — plate size plus any pre-labeled regions (blanks, controls, sample wells). Per-task sample identities go on the experiment page snapshot.
                </p>
                <PlateLayoutEditor
                  plateSize={platePlateSize}
                  onPlateSizeChange={setPlatePlateSize}
                  wells={plateWells}
                  onWellsChange={setPlateWells}
                  description={plateDescription}
                  onDescriptionChange={setPlateDescription}
                />
              </div>
            )}

            {/* Cell culture passaging editor */}
            {uploadType === "cell_culture" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">
                  Cell culture passaging schedules store the cell line, media composition, and planned cadence (feed / split / observe / harvest). Mid-execution events are logged on the experiment task.
                </p>
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
              </div>
            )}

            {/* Mass spec editor */}
            {uploadType === "mass_spec" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">
                  Mass spec methods store the ionization mode + source / scan / calibration params. Source-param fields shown vary by ionization mode; toggle &quot;Show all fields&quot; for the full set.
                </p>
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
              </div>
            )}

            {/* Coding workflow editor */}
            {uploadType === "coding_workflow" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">
                  Coding workflows store a reusable script (Python, R, SQL, etc.) or a Jupyter notebook. Embed the code body inline, point at an external path for the open-in-editor handoff, or both.
                </p>
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
              </div>
            )}

            {/* PCR editor */}
            {uploadType === "pcr" && (
              <div className="space-y-4">
                <p className="text-xs text-gray-400">
                  PCR protocols store thermal cycler gradients and reaction recipes.
                </p>

                {/* Interactive Gradient Editor */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">
                    Thermal Gradient
                  </h4>
                  <InteractiveGradientEditor
                    gradient={pcrGradient}
                    onChange={setPcrGradient}
                  />
                </div>

                {/* Reaction Recipe */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">
                    Reaction Recipe
                  </h4>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-600">Ingredient</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-600">Concentration</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-600">Amount/Rx</th>
                          <th className="px-2 py-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pcrIngredients.map((ing, i) => (
                          <tr key={ing.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                            <td className="px-4 py-2">
                              {ing.name === "Total" ? (
                                <span className="font-medium text-gray-700">{ing.name}</span>
                              ) : (
                                <input
                                  type="text"
                                  value={ing.name}
                                  onChange={(e) => {
                                    const newIngredients = [...pcrIngredients];
                                    newIngredients[i] = { ...ing, name: e.target.value };
                                    setPcrIngredients(newIngredients);
                                  }}
                                  className="w-full px-2 py-1 border border-gray-200 rounded text-gray-700"
                                />
                              )}
                            </td>
                            <td className="px-4 py-2">
                              {ing.name === "Total" ? (
                                <span className="text-gray-500">-</span>
                              ) : (
                                <input
                                  type="text"
                                  value={ing.concentration}
                                  onChange={(e) => {
                                    const newIngredients = [...pcrIngredients];
                                    newIngredients[i] = { ...ing, concentration: e.target.value };
                                    setPcrIngredients(newIngredients);
                                  }}
                                  className="w-full px-2 py-1 border border-gray-200 rounded text-gray-500"
                                  placeholder="e.g. 10x"
                                />
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="text"
                                value={ing.amount_per_reaction}
                                onChange={(e) => {
                                  const newIngredients = [...pcrIngredients];
                                  newIngredients[i] = { ...ing, amount_per_reaction: e.target.value };
                                  setPcrIngredients(newIngredients);
                                }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-gray-500"
                                placeholder="e.g. 2.5"
                              />
                            </td>
                            <td className="px-2 py-2">
                              {ing.name !== "Total" && (
                                <Tooltip label="Remove ingredient" placement="left">
                                  <button
                                    onClick={() => {
                                      setPcrIngredients(pcrIngredients.filter((item) => item.id !== ing.id));
                                    }}
                                    className="text-gray-400 hover:text-red-500 text-sm"
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
                        // Insert before Total row if it exists
                        const totalIndex = pcrIngredients.findIndex((ing) => ing.name === "Total");
                        if (totalIndex >= 0) {
                          const newIngredients = [
                            ...pcrIngredients.slice(0, totalIndex),
                            { id: newId, name: "", concentration: "", amount_per_reaction: "" },
                            ...pcrIngredients.slice(totalIndex),
                          ];
                          setPcrIngredients(newIngredients);
                        } else {
                          setPcrIngredients([
                            ...pcrIngredients,
                            { id: newId, name: "", concentration: "", amount_per_reaction: "" },
                          ]);
                        }
                      }}
                      className="w-full py-2 text-xs text-blue-600 hover:bg-blue-50 border-t border-gray-200"
                    >
                      + Add Ingredient
                    </button>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">
                    Notes (optional)
                  </h4>
                  <textarea
                    value={pcrNotes}
                    onChange={(e) => setPcrNotes(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Any additional notes..."
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={
              saving ||
              !name.trim() ||
              (uploadType === "pdf" && !pdfFile) ||
              (uploadType === "markdown" && !mdContent.trim())
            }
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving..." : "Create Method"}
          </button>
        </div>
      </div>
      <FileRenamePopup />
    </div>
  );
}
