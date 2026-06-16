"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import LivingPopup from "@/components/ui/LivingPopup";
import FileDropzone from "@/components/ui/FileDropzone";
import {
  methodsApi as rawMethodsApi,
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
import { useFileRenamePopup } from "@/components/FileRenamePopup";
import Tooltip from "@/components/Tooltip";
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
import { WHOLE_LAB_SENTINEL } from "@/lib/sharing/unified";
import LcGradientEditor from "@/components/LcGradientEditor";
import PlateLayoutEditor, { wellsToRegionLabels } from "@/components/PlateLayoutEditor";
import CellCultureScheduleEditor from "@/components/CellCultureScheduleEditor";
import MassSpecEditor from "@/components/MassSpecEditor";
import CodingWorkflowEditor from "@/components/CodingWorkflowEditor";
import QpcrAnalysisEditor from "@/components/QpcrAnalysisEditor";
import { type MethodTypeId } from "@/lib/methods/method-type-registry";
import {
  deriveExcerptFromMarkdown,
  excerptForStructuredType,
} from "@/lib/methods/excerpt";
import { MethodTypeCategoryPicker } from "./MethodTypePicker";
import { MethodTemplateLibraryModal } from "./MethodTemplateLibraryModal";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEnabledMethodTypes } from "@/hooks/useEnabledMethodTypes";

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
  initialWholeLab = false,
  onClose,
  onCreated,
  onTemplateUsed,
}: {
  existingFolders: string[];
  prefilledFolder?: string;
  /** When true, the create modal opens with the whole-lab share
   *  pre-selected (used by the `/methods?createMethod=public` deep
   *  link). At save time this maps to
   *  `shared_with: [{ username: "*", level: "read" }]`. */
  initialWholeLab?: boolean;
  onClose: () => void;
  /** Fires after a successful save. When the user clicks "Create & extend
   *  into kit", the just-created method is wrapped into a freshly-created
   *  compound and the compound is passed back so the caller can open the
   *  CompoundMethodBuilder in edit mode. Plain "Create Method" calls back
   *  with no argument (current behavior). */
  onCreated: (extendedCompound?: Method) => void;
  /** Extension Store Phase D (store-detail bot, 2026-05-30): unifies the
   *  use-template post-action. When the in-builder library instantiates a
   *  template, the created method is handed back here so the caller can open it
   *  in the viewer, matching the standalone /methods library. When omitted, the
   *  builder falls back to the legacy behavior (close the flow via onCreated).
   *  This is distinct from `onCreated`'s compound arg, which means "extend into
   *  kit", a different intent. */
  onTemplateUsed?: (created: Method) => void;
}) {
  const [uploadType, setUploadType] = useState<MethodTypeId>("markdown");
  // Extension Store Phase A (store-declutter bot): the builder shows ONLY
  // method types the account has enabled in its library. Passing
  // `enabledMethodTypes` without an `onEnableType` affordance makes the picker
  // filter disabled types out entirely (no more muted "Enable" tiles cluttering
  // the grid). Enabling a type now lives solely in the library, reachable from
  // the quiet "Manage method types" footer link below the picker.
  const { currentUser } = useCurrentUser();
  const { raw: enabledMethodTypes } = useEnabledMethodTypes(currentUser);
  // Opens the method template library (the store) in place so the user can
  // enable / disable types without leaving the create flow.
  const [showLibrary, setShowLibrary] = useState(false);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState(prefilledFolder || "");
  const [tags, setTags] = useState("");
  // Lab Mode retirement R1d (R1d shared_with API manager, 2026-05-23):
  // the modal now models its "share with the whole lab on create" choice
  // as a single boolean that maps to the unified `shared_with` array at
  // save time. The `/methods?createMethod=public` deep link seeds this
  // to true via `initialWholeLab`. The structured-protocol APIs
  // (pcrApi.create, lcGradientApi.create, etc.) still take the legacy
  // `is_public` boolean (their R1d cousin is a separate later phase),
  // so `isWholeLab` is forwarded into them as a boolean and into
  // `methodsApi.create` as a shared_with sentinel.
  const isWholeLab = initialWholeLab;
  const methodSharedWith = useMemo<SharedUser[]>(
    () =>
      isWholeLab
        ? [{ username: WHOLE_LAB_SENTINEL, level: "read" }]
        : [],
    [isWholeLab],
  );
  // Discriminated saving state: "save" = plain create, "extend" = create +
  // wrap-as-compound. Drives the per-button spinner labels and disables
  // both buttons (+ Cancel) while either flow is in flight.
  const [savingMode, setSavingMode] = useState<"save" | "extend" | null>(null);
  const saving = savingMode !== null;

  // Navigation guard for the method name + type. The draft-persistence
  // restore was removed by the methods-create double-fill fix (2026-05-27):
  // restoring a previously-saved `{ name, folder, uploadType }` on modal
  // mount caused the §6.4d BeakerBot demo cursor to APPEND its typed text
  // on top of the restored values ("BeakerBot's Patent-Pending Coffee
  // Brewing ProtocolBeakerBot's Patent-Pending Coffee Brewing Protocol"
  // in the name input, "MethodsMethods" in the Folder input). Grant's
  // call: remove the auto-fill so BeakerBot's typing is the source of
  // text. Real users who accidentally navigate away mid-form still get
  // the browser-level unsaved-changes prompt via `useUnsavedChangesGuard`
  // below.
  const hasMethodContent = name.trim().length > 0;
  useUnsavedChangesGuard(hasMethodContent);

  // Onboarding v4 §6.4 open-picker beat dispatches a custom DOM event the
  // moment the modal mounts so the `methods-open-picker` walkthrough step
  // advances the instant the picker is on screen. The dispatch is
  // unconditional (fires regardless of whether a tour is active) so the
  // tour-only module never has to import this component, and the cost
  // when no tour is running is a single no-op event per modal open. See
  // `watchMethodsPickerOpened` in
  // `components/onboarding/v4/steps/walkthrough/lib/tour-events.ts`.
  //
  // Also clears any stale `researchos:draft:new-method` sessionStorage
  // entry left over from the now-removed `useDraftPersistence` hook
  // (methods-create double-fill fix, 2026-05-27). Users who already
  // hit the doubled-field bug have the offending draft sitting in
  // sessionStorage; this one-line sweep makes the fix retroactive
  // without forcing them to clear browser data manually.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem("researchos:draft:new-method");
    } catch {
      // sessionStorage may be unavailable (private-mode Safari); the
      // stale-draft cleanup is best-effort.
    }
    window.dispatchEvent(new CustomEvent("tour:methods-picker-opened"));
  }, []);

  // Markdown state
  const [mdContent, setMdContent] = useState("");

  // Onboarding v4 §6.4d tour-only body fill (methods-create-inline-typing
  // bot, 2026-06-03). The body editor is now the inline CodeMirror 6
  // surface (no <textarea>), so the old cursor script — which poked a
  // textarea + clicked a hybrid-editor-save button — no longer fills
  // anything. Instead the cursor script dispatches a `tour:fill-method-body`
  // window event carrying the funny markdown; we set `mdContent` directly,
  // which (a) feeds LiveMarkdownEditor's controlled `value` so the text is
  // visible, and (b) satisfies the Create-Method enable condition
  // (`mdContent.trim()`), so no editor-save flush is needed. The listener
  // is inert outside the tour: the event only ever fires from the cursor
  // script, and the cost when no tour runs is one passive listener.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<{ body?: string }>).detail;
      if (typeof detail?.body !== "string") return;
      setMdContent(detail.body);
    };
    window.addEventListener("tour:fill-method-body", handler);
    return () => window.removeEventListener("tour:fill-method-body", handler);
  }, []);
  // Imperative flush handle published by the embedded markdown editor. Calling
  // it commits the in-flight block buffer, fires onChange, and returns the
  // freshest full-document string, so performSave can write the very latest
  // edit even if the user never left the active block.
  const editorSaveRef = useRef<(() => string) | null>(null);
  // Mirrors the editor's in-flight buffer-dirty flag. `mdContent` lags while
  // the user is mid-block, so we OR this into the submit button's enabled
  // state to light it the instant the user starts typing the markdown body.
  const [editorDirty, setEditorDirty] = useState(false);
  const [, setUploading] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();

  // Track uploaded image paths for cleanup on cancel
  const uploadedImagePathsRef = useRef<string[]>([]);

  // PDF state
  const [pdfFile, setPdfFile] = useState<File | null>(null);

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

  // qPCR analysis defaults — SYBR Green chemistry, two-row reference list
  // (one experimental target placeholder + one housekeeping reference) so
  // ΔΔCq is reachable out of the box.
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

  // Escape is owned by LivingPopup now (it routes to onClose -> handleCancel
  // via the popup shell), so the uploaded-image cleanup still runs on Escape.

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

  // Per-type save dispatch. Returns the freshly-created Method so callers can
  // chain follow-up actions (e.g. wrapAsCompound for the "Create & extend"
  // path). Returns null when the active type's required inputs are missing
  // (pdf with no file, etc.) — caller decides whether to bail silently or
  // surface an error.
  const performSave = useCallback(async (): Promise<Method | null> => {
    if (!name.trim()) return null;

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
      // Flush the editor's in-flight block buffer first so the last
      // in-progress edit is written, then fall back to `mdContent`.
      const flushed = editorSaveRef.current?.();
      const md = typeof flushed === "string" ? flushed : mdContent;
      const body = md ? `${stampedScaffold}\n${md}` : stampedScaffold;
      await filesApi.writeFile(sourcePath, body, `Create method: ${name}`);
      // Method Picker FLAG B: stamp the picker-card excerpt from the body we
      // already hold, so the card hero renders without a per-card file read.
      const excerpt = deriveExcerptFromMarkdown(body);
      return await methodsApi.create({
        name: name.trim(),
        source_path: sourcePath,
        method_type: "markdown",
        folder_path: folder.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        shared_with: methodSharedWith,
        ...(excerpt ? { excerpt } : {}),
      });
    }
    if (uploadType === "pdf" && pdfFile) {
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
      return await methodsApi.create({
        name: name.trim(),
        source_path: sourcePath,
        method_type: "pdf",
        folder_path: folder.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        shared_with: methodSharedWith,
      });
    }
    if (uploadType === "pcr") {
      const protocol = await pcrApi.create({
        name: name.trim(),
        gradient: pcrGradient,
        ingredients: pcrIngredients,
        notes: pcrNotes || null,
        folder_path: folder.trim() || null,
        is_public: isWholeLab,
      });
      return await methodsApi.create({
        name: name.trim(),
        source_path: `pcr://protocol/${protocol.id}`,
        method_type: "pcr",
        folder_path: folder.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        shared_with: methodSharedWith,
        excerpt: excerptForStructuredType("pcr"),
      });
    }
    if (uploadType === "lc_gradient") {
      const protocol = await lcGradientApi.create({
        name: name.trim(),
        description: lcDescription,
        gradient_steps: lcGradientSteps,
        column: lcColumn,
        detection_wavelength_nm: lcWavelength,
        ingredients: lcIngredients,
        folder_path: folder.trim() || null,
        is_public: isWholeLab,
      });
      return await methodsApi.create({
        name: name.trim(),
        source_path: `lc_gradient://protocol/${protocol.id}`,
        method_type: "lc_gradient",
        folder_path: folder.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        shared_with: methodSharedWith,
        excerpt: excerptForStructuredType("lc_gradient"),
      });
    }
    if (uploadType === "plate") {
      const protocol = await plateApi.create({
        name: name.trim(),
        description: plateDescription,
        plate_size: platePlateSize,
        region_labels: wellsToRegionLabels(plateWells),
        folder_path: folder.trim() || null,
        is_public: isWholeLab,
      });
      return await methodsApi.create({
        name: name.trim(),
        source_path: `plate://protocol/${protocol.id}`,
        method_type: "plate",
        folder_path: folder.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        shared_with: methodSharedWith,
        excerpt: excerptForStructuredType("plate"),
      });
    }
    if (uploadType === "cell_culture") {
      const schedule = await cellCultureApi.create({
        name: name.trim(),
        description: ccDescription,
        cell_line: ccCellLine,
        media: ccMedia,
        planned_events: ccPlannedEvents,
        folder_path: folder.trim() || null,
        is_public: isWholeLab,
      });
      return await methodsApi.create({
        name: name.trim(),
        source_path: `cell_culture://protocol/${schedule.id}`,
        method_type: "cell_culture",
        folder_path: folder.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        shared_with: methodSharedWith,
        excerpt: excerptForStructuredType("cell_culture"),
      });
    }
    if (uploadType === "mass_spec") {
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
        is_public: isWholeLab,
      });
      return await methodsApi.create({
        name: name.trim(),
        source_path: `mass_spec://protocol/${protocol.id}`,
        method_type: "mass_spec",
        folder_path: folder.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        shared_with: methodSharedWith,
        excerpt: excerptForStructuredType("mass_spec"),
      });
    }
    if (uploadType === "coding_workflow") {
      const protocol = await codingWorkflowApi.create({
        name: name.trim(),
        description: cwDescription,
        language: cwLanguage,
        language_label: cwLanguageLabel,
        embedded_code: cwEmbeddedCode,
        external_path: cwExternalPath,
        output_renderer: cwOutputRenderer,
        folder_path: folder.trim() || null,
        is_public: isWholeLab,
      });
      return await methodsApi.create({
        name: name.trim(),
        source_path: `coding_workflow://protocol/${protocol.id}`,
        method_type: "coding_workflow",
        folder_path: folder.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        shared_with: methodSharedWith,
        excerpt: excerptForStructuredType("coding_workflow"),
      });
    }
    if (uploadType === "qpcr_analysis") {
      const protocol = await qpcrAnalysisApi.create({
        name: name.trim(),
        description: qpcrDescription,
        chemistry: qpcrChemistry,
        chemistry_label: qpcrChemistryLabel,
        references: qpcrReferences,
        standard_curve: qpcrStandardCurve,
        melt_curve: qpcrMeltCurve,
        use_delta_delta_cq: qpcrUseDeltaDeltaCq,
        folder_path: folder.trim() || null,
        is_public: isWholeLab,
      });
      return await methodsApi.create({
        name: name.trim(),
        source_path: `qpcr_analysis://protocol/${protocol.id}`,
        method_type: "qpcr_analysis",
        folder_path: folder.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        shared_with: methodSharedWith,
        excerpt: excerptForStructuredType("qpcr_analysis"),
      });
    }
    return null;
  }, [name, slug, uploadType, mdContent, pdfFile, folder, tags, isWholeLab, methodSharedWith, pcrGradient, pcrIngredients, pcrNotes, lcGradientSteps, lcColumn, lcWavelength, lcDescription, lcIngredients, platePlateSize, plateWells, plateDescription, ccCellLine, ccMedia, ccPlannedEvents, ccDescription, msIonizationMode, msIonizationLabel, msInstrument, msDescription, msSource, msScan, msCalibration, cwLanguage, cwLanguageLabel, cwEmbeddedCode, cwExternalPath, cwDescription, cwOutputRenderer, qpcrChemistry, qpcrChemistryLabel, qpcrDescription, qpcrUseDeltaDeltaCq, qpcrReferences, qpcrStandardCurve, qpcrMeltCurve]);

  const handleSave = useCallback(async () => {
    if (saving || !name.trim()) return;
    setSavingMode("save");
    try {
      const created = await performSave();
      if (created !== null) {
        // Onboarding v4 §6.4d demo step (`methods-create`) advances on
        // this DOM event. Mirrors the `tour:project-created` pattern
        // (see local-api.ts projectsApi.create) so the cursor demo's
        // typed-then-clicked Save resolves the moment the row lands,
        // without leaning on the polling fallback. Dispatched
        // unconditionally (cost when no tour is active: one no-op
        // dispatchEvent call).
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("tour:method-created", {
              detail: { id: created.id, name: created.name },
            }),
          );
        }
        onCreated();
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to create method";
      alert(msg);
    } finally {
      setSavingMode(null);
    }
  }, [performSave, onCreated, saving, name]);

  // Save the method, then wrap it into a freshly-created compound and hand
  // the compound back to the parent so the CompoundMethodBuilder opens with
  // the just-created method as its first child. Phase 0e mirrors the
  // existing-method "+ Add component (extend into kit)" affordance from
  // Phase 0d (see WrapAsCompoundAction.tsx) on the create-flow side.
  //
  // No rollback on wrap failure: if the method was saved but the wrap step
  // errors, the method stays — we surface the failure and tell the user how
  // to retry from the viewer (matches Phase 0c's no-rollback decision).
  const handleSaveAndExtend = useCallback(async () => {
    if (saving || !name.trim()) return;
    setSavingMode("extend");
    let created: Method | null = null;
    try {
      created = await performSave();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to create method";
      alert(msg);
      setSavingMode(null);
      return;
    }
    if (!created) {
      setSavingMode(null);
      return;
    }
    // Mirror the plain-save event dispatch so the §6.4d tour also
    // catches the extend-into-kit completion path. The walkthrough
    // demo never takes this branch (BeakerBot uses plain Save), but
    // any future tour step that wraps an extend can rely on the same
    // signal.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tour:method-created", {
          detail: { id: created.id, name: created.name },
        }),
      );
    }
    try {
      const compound = await methodsApi.wrapAsCompound(created.id);
      onCreated(compound);
    } catch (wrapErr: unknown) {
      const wrapMsg = wrapErr instanceof Error ? wrapErr.message : "Unknown error.";
      alert(
        `Method saved, but couldn't bundle it into a kit. ` +
          `Open the method and click "+ Add component" to retry.\n\n${wrapMsg}`
      );
      onCreated();
    } finally {
      setSavingMode(null);
    }
  }, [performSave, onCreated, saving, name]);

  // CreateMethodModal keeps its PARENT mount-gate ({creating && ...}) because
  // all of its per-type form state is initialized on mount; always-rendering
  // would strand stale state from a previous open. `open` is a constant true
  // and the parent unmount drives the close (LivingPopup unifies the entrance +
  // blur + X; only the zoom-OUT exit is skipped). Escape / scrim / X route
  // through handleCancel so uploaded-image cleanup still runs.
  return (
    <>
    <LivingPopup
      open
      onClose={handleCancel}
      label="New Method"
      widthClassName="max-w-4xl"
      card={false}
    >
      <div
        className="bg-surface-raised rounded-xl ros-popup-card-shadow max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col"
        data-tour-target="methods-create-form"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-title font-semibold text-foreground">
            New Method
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {/* Upload type picker — grouped into Standard / Structured.
                Structured types own a per-type protocol record alongside
                the Method row; standard types just point at a file. */}
            <MethodTypeCategoryPicker
              uploadType={uploadType}
              onSelect={setUploadType}
              enabledTypes={enabledMethodTypes}
            />
            {/* Quiet path back to the store. With disabled types now hidden
                from the picker (Phase A), enabling a type lives in the
                library; this link opens it in place so the affordance stays
                discoverable without cluttering the grid. */}
            <button
              type="button"
              onClick={() => setShowLibrary(true)}
              className="text-meta text-foreground-muted hover:text-foreground-muted underline underline-offset-2"
            >
              Manage method types in your library
            </button>

            {/* Name */}
            <div>
              <label className="block text-meta font-medium text-foreground-muted mb-1">
                Method Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Western Blot Protocol"
                data-tour-target="methods-create-name-input"
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>

            {/* Folder + Tags */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Folder (optional)
                </label>
                <input
                  type="text"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="e.g. Molecular Biology"
                  list="existing-folders"
                  data-tour-target="methods-create-category-input"
                  className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <datalist id="existing-folders">
                  {existingFolders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Tags (comma-separated, optional)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. protein, gel"
                  className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Lab Mode retirement R1d (R1d shared_with API manager,
                2026-05-23): the "Make this method public" checkbox
                stays removed (R1b). Methods are shared via the
                unified ShareDialog after creation. The deep link
                `/methods?createMethod=public` seeds `initialWholeLab`
                so the public namespace stays one-click-reachable;
                the modal maps that boolean to
                `shared_with: [{ username: "*", level: "read" }]` at
                save time. The legacy `is_public` field is still
                written by `methodsApi.create` for one more release
                of receiver-side back-compat. */}

            {/* Markdown editor */}
            {uploadType === "markdown" && (
              <div>
                <label className="text-meta font-medium text-foreground-muted mb-2 block">
                  Method Content
                </label>
                <div
                  className="border border-border rounded-lg overflow-hidden"
                  data-tour-target="methods-create-body-input"
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
                    autoStartEditing
                    // The modal owns its own Create button, so hide the
                    // editor's internal Save. saveRef lets performSave flush
                    // the live buffer; onDirtyChange lights Create while typing.
                    // No onExplicitSave: Cmd+S must not submit a half-filled form.
                    hideSaveButton
                    saveRef={editorSaveRef}
                    onDirtyChange={setEditorDirty}
                  />
                </div>
                {!mdContent.trim() && (
                  <p className="mt-1 text-meta text-foreground-muted">
                    Add method content above to enable Create.
                  </p>
                )}
                {uploadWarning && (
                  <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg flex items-start gap-2">
                    <svg className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-body text-amber-800 dark:text-amber-200">{uploadWarning}</p>
                    </div>
                    <Tooltip label="Dismiss warning" placement="bottom">
                      <button
                        onClick={() => setUploadWarning(null)}
                        aria-label="Dismiss warning"
                        className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-300"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
            )}

            {/* PDF upload */}
            {uploadType === "pdf" && (
              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-2">
                  Upload PDF
                </label>
                {pdfFile ? (
                  <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                    <p className="text-body font-medium text-foreground">
                      {pdfFile.name}
                    </p>
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
                    hint="PDF"
                    icon="file"
                    ariaLabel="Upload PDF"
                    onFiles={(files) => {
                      if (files[0]) setPdfFile(files[0]);
                    }}
                    onReject={setUploadWarning}
                  />
                )}
                <p className="text-meta text-foreground-muted mt-2">
                  PDF methods can be viewed but not edited inline. Step
                  deviations will be saved as a separate Markdown file.
                </p>
                {uploadWarning && (
                  <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg flex items-start gap-2">
                    <svg className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-body text-amber-800 dark:text-amber-200">{uploadWarning}</p>
                    </div>
                    <Tooltip label="Dismiss warning" placement="bottom">
                      <button
                        onClick={() => setUploadWarning(null)}
                        aria-label="Dismiss warning"
                        className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-300"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
            )}

            {/* LC Gradient editor */}
            {uploadType === "lc_gradient" && (
              <div className="space-y-2" data-tour-target="lc-editor-wrapper">
                <p className="text-meta text-foreground-muted">
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
                <p className="text-meta text-foreground-muted">
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

            {/* qPCR analysis editor */}
            {uploadType === "qpcr_analysis" && (
              <div className="space-y-2">
                <p className="text-meta text-foreground-muted">
                  qPCR analysis protocols store the references list (experimental targets + housekeeping), optional standard-curve dilution points, and the melt-curve sweep. Per-task Cq readouts and ΔΔCq fold-change land on the experiment page. Pair with a PCR method via a kit for the full qPCR workflow.
                </p>
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
              </div>
            )}

            {/* Cell culture passaging editor */}
            {uploadType === "cell_culture" && (
              <div className="space-y-2">
                <p className="text-meta text-foreground-muted">
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
                <p className="text-meta text-foreground-muted">
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
                <p className="text-meta text-foreground-muted">
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
              <div className="space-y-4" data-tour-target="pcr-editor-wrapper">
                <p className="text-meta text-foreground-muted">
                  PCR protocols store thermal cycler gradients and reaction recipes.
                </p>

                {/* Interactive Gradient Editor */}
                <div>
                  <h4 className="text-body font-semibold text-foreground mb-3">
                    Thermal Gradient
                  </h4>
                  <InteractiveGradientEditor
                    gradient={pcrGradient}
                    onChange={setPcrGradient}
                  />
                </div>

                {/* Reaction Recipe */}
                <div>
                  <h4 className="text-body font-semibold text-foreground mb-3">
                    Reaction Recipe
                  </h4>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-meta">
                      <thead className="bg-surface-sunken">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-foreground-muted">Ingredient</th>
                          <th className="px-4 py-2 text-left font-medium text-foreground-muted">Concentration</th>
                          <th className="px-4 py-2 text-left font-medium text-foreground-muted">Amount/Rx</th>
                          <th className="px-2 py-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pcrIngredients.map((ing, i) => (
                          <tr key={ing.id} className={i % 2 === 0 ? "bg-surface-raised" : "bg-surface-sunken"}>
                            <td className="px-4 py-2">
                              {ing.name === "Total" ? (
                                <span className="font-medium text-foreground">{ing.name}</span>
                              ) : (
                                <input
                                  type="text"
                                  value={ing.name}
                                  onChange={(e) => {
                                    const newIngredients = [...pcrIngredients];
                                    newIngredients[i] = { ...ing, name: e.target.value };
                                    setPcrIngredients(newIngredients);
                                  }}
                                  className="w-full px-2 py-1 border border-border rounded text-foreground"
                                />
                              )}
                            </td>
                            <td className="px-4 py-2">
                              {ing.name === "Total" ? (
                                <span className="text-foreground-muted">-</span>
                              ) : (
                                <input
                                  type="text"
                                  value={ing.concentration}
                                  onChange={(e) => {
                                    const newIngredients = [...pcrIngredients];
                                    newIngredients[i] = { ...ing, concentration: e.target.value };
                                    setPcrIngredients(newIngredients);
                                  }}
                                  className="w-full px-2 py-1 border border-border rounded text-foreground-muted"
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
                                className="w-full px-2 py-1 border border-border rounded text-foreground-muted"
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
                                    aria-label="Remove ingredient"
                                    className="text-foreground-muted hover:text-red-500"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
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
                      className="w-full py-2 text-meta text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-brand-action/10 border-t border-border"
                    >
                      + Add Ingredient
                    </button>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <h4 className="text-body font-semibold text-foreground mb-2">
                    Notes (optional)
                  </h4>
                  <textarea
                    value={pcrNotes}
                    onChange={(e) => setPcrNotes(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Any additional notes..."
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-border">
          <button
            onClick={handleCancel}
            disabled={saving}
            className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          {/* "Save & extend into kit": create the method, then immediately
              wrap it into a compound and open the compound builder. The
              create-flow analogue of Phase 0d's viewer-side
              WrapAsCompoundAction. Hidden for compound (the compound
              builder is the kit-creation surface; compound is also hidden
              from the picker, but defensively gate here too). */}
          {uploadType !== "compound" && (
            <Tooltip
              label="Create this method and bundle it into a kit, ready for more components."
              placement="top"
            >
              <button
                onClick={handleSaveAndExtend}
                disabled={
                  saving ||
                  !name.trim() ||
                  (uploadType === "pdf" && !pdfFile) ||
                  (uploadType === "markdown" && !(mdContent.trim() || editorDirty))
                }
                className="px-4 py-2 text-body text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-brand-action/10 hover:bg-indigo-100 dark:hover:bg-brand-action/20 border border-indigo-200 rounded-lg disabled:opacity-50"
              >
                {savingMode === "extend" ? "Creating & bundling…" : "Create & extend into kit"}
              </button>
            </Tooltip>
          )}
          <button
            onClick={handleSave}
            disabled={
              saving ||
              !name.trim() ||
              (uploadType === "pdf" && !pdfFile) ||
              (uploadType === "markdown" && !(mdContent.trim() || editorDirty))
            }
            data-tour-target="methods-create-submit"
            className="ros-btn-raise px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
          >
            {savingMode === "save" ? "Saving..." : "Create Method"}
          </button>
        </div>
      </div>
    </LivingPopup>
    {/* FileRenamePopup + the template library are their OWN fixed-inset-0
        overlays. They render as fragment siblings of the builder popup, each
        lifted into a z-[450] wrapper above LivingPopup's z-[400] card so they
        sit on top (and outside the card's transform, which would otherwise clip
        a nested fixed overlay, recipe rule 8). They keep their own bespoke
        overlays + Escape handlers rather than nesting a second LivingPopup (no
        innermost-only Escape guard means a single Escape would close both). */}
    <div className="fixed inset-0 z-[450] pointer-events-none [&>*]:pointer-events-auto">
      <FileRenamePopup />
    </div>
    {/* Method template library (the store), opened from the picker footer
        link. Enabling / disabling types happens here. If the user uses a
        template, a method is created. Phase D unify (store-detail bot): when
        the caller supplies `onTemplateUsed`, hand the created method up so it
        opens in the viewer (matching the standalone /methods library);
        otherwise fall back to the legacy close-and-refetch via onCreated
        (with no arg = plain create, not the extend-into-kit compound path). */}
    {showLibrary && (
      <div className="fixed inset-0 z-[450]">
        <MethodTemplateLibraryModal
          existingFolders={existingFolders}
          onClose={() => setShowLibrary(false)}
          onUsed={(created) => {
            setShowLibrary(false);
            if (onTemplateUsed) onTemplateUsed(created);
            else onCreated();
          }}
        />
      </div>
    )}
    </>
  );
}
