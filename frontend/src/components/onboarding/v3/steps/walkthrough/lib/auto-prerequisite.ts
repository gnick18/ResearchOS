import { filesApi, methodsApi, projectsApi, tasksApi } from "@/lib/local-api";
import type {
  OnboardingSidecar,
  WizardArtifact,
} from "@/lib/onboarding/sidecar";
import {
  appendArtifact,
  autoSentinel,
  findArtifact,
  wasUserSkipped,
} from "./wizard-artifacts";

/**
 * Lazy auto-prerequisite creators for the W1-W9 walkthrough.
 *
 * L9 contract: if the user clicks Skip-this-step on W1/W2/W3, every
 * downstream step that depends on the skipped artifact must still
 * function. BeakerBot silently fills in a placeholder version using
 * the same public API the step would have invoked, names it with the
 * `[Auto]` prefix so the user can recognize it in the Phase 4 cleanup
 * grid, and writes both:
 *   - a `WizardArtifact` with `cleanup_default: "discard"` (P4 unchecks
 *     it by default per the L9 contract)
 *   - an `auto:<skipped-step>` sentinel in `wizard_resume_state.skipped_steps`
 *     parallel to the user-skip entry already present
 *
 * The auto-creation only fires when:
 *   (a) the user actually skipped the upstream step (the bare id is in
 *       `skipped_steps`), AND
 *   (b) no artifact of that type already exists in `artifacts_created`
 *
 * Condition (b) handles the re-entry case: a user who back-steps from
 * a dependent step and forward again should see the same placeholder,
 * not a duplicate.
 */

const AUTO_PROJECT_NAME = "[Auto] My First Project";
const AUTO_METHOD_NAME = "[Auto] Sample method";
const AUTO_EXPERIMENT_NAME = "[Auto] My First Experiment";

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Sample method body used as the auto-prerequisite for W2. Kept short
 *  on purpose: P4 may offer to delete it and we don't want to lose
 *  meaningful user content if they explicitly chose Skip. */
const AUTO_METHOD_BODY = `# Sample method

This is a placeholder method BeakerBot created so the walkthrough could keep moving. You can edit it, replace it, or delete it from the cleanup grid at the end.

## Steps

1. Mix things.
2. Wait.
3. Observe.
`;

/** Ensure a project artifact exists. Returns the project's numeric id
 *  as a string (matching `WizardArtifact.id`'s string type). When the
 *  user skipped W1 and no project artifact exists yet, creates one
 *  with the `[Auto]` prefix and logs it. When an artifact already
 *  exists, returns it unchanged. When the user did NOT skip W1 but
 *  also has no artifact (an edge case if a dependent step renders
 *  before W1's body persists), returns `null` so the caller can show
 *  a "we need a project first" hint. */
export async function ensureProjectArtifact(
  sidecar: OnboardingSidecar | null,
  patchSidecar: (
    mut: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>,
): Promise<WizardArtifact | null> {
  const existing = findArtifact(sidecar, "project");
  if (existing) return existing;
  if (!wasUserSkipped(sidecar, "W1")) return null;
  const project = await projectsApi.create({ name: AUTO_PROJECT_NAME });
  const artifact: WizardArtifact = {
    type: "project",
    id: String(project.id),
    cleanup_default: "discard",
  };
  await patchSidecar((cur) => appendArtifact(cur, artifact, [autoSentinel("W1")]));
  return artifact;
}

/** Ensure a method artifact exists. Same shape as
 *  {@link ensureProjectArtifact}. Source defaults to "placeholder" for
 *  auto-creations. */
export async function ensureMethodArtifact(
  sidecar: OnboardingSidecar | null,
  patchSidecar: (
    mut: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>,
): Promise<WizardArtifact | null> {
  const existing = findArtifact(sidecar, "method");
  if (existing) return existing;
  if (!wasUserSkipped(sidecar, "W2")) return null;
  const slug = "sample-method-auto";
  const sourcePath = `methods/${slug}/${slug}.md`;
  await filesApi.writeFile(sourcePath, AUTO_METHOD_BODY);
  const method = await methodsApi.create({
    name: AUTO_METHOD_NAME,
    source_path: sourcePath,
    method_type: "markdown",
    folder_path: null,
    is_public: false,
  });
  const artifact: WizardArtifact = {
    type: "method",
    id: `${method.id}:placeholder`,
    cleanup_default: "discard",
  };
  await patchSidecar((cur) => appendArtifact(cur, artifact, [autoSentinel("W2")]));
  return artifact;
}

/** Ensure an experiment artifact exists. The experiment is created
 *  inside the project artifact's id (creating an auto-project first
 *  if needed). Returns null only when neither the user-skip path nor
 *  an existing artifact applies. */
export async function ensureExperimentArtifact(
  sidecar: OnboardingSidecar | null,
  patchSidecar: (
    mut: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>,
): Promise<WizardArtifact | null> {
  const existing = findArtifact(sidecar, "experiment");
  if (existing) return existing;
  if (!wasUserSkipped(sidecar, "W3")) return null;
  // If W1 was also skipped, fill the project first so the experiment
  // has a parent. The recursion is shallow (one level) since W1 has
  // no upstream dependency.
  const projectArtifact = await ensureProjectArtifact(sidecar, patchSidecar);
  const projectId = projectArtifact ? Number(projectArtifact.id) : null;
  const experiment = await tasksApi.create({
    project_id: projectId ?? null,
    name: AUTO_EXPERIMENT_NAME,
    start_date: todayLocal(),
    duration_days: 1,
    task_type: "experiment",
  });
  const artifact: WizardArtifact = {
    type: "experiment",
    id: String(experiment.id),
    cleanup_default: "discard",
  };
  await patchSidecar((cur) => appendArtifact(cur, artifact, [autoSentinel("W3")]));
  return artifact;
}
