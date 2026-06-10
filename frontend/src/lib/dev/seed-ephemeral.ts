// Dev-only: seed a freshly-connected ephemeral OPFS workspace with one of each
// thing so a fresh session is testable immediately, a project, one experiment
// (with an image), one list task, one single note, one multi-entry note, and a
// purchase task with a couple of items. Best-effort: a failure on any step is
// logged and the rest continue, so a partial seed never blocks the session.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  projectsApi,
  tasksApi,
  notesApi,
  purchasesApi,
  filesApi,
} from "@/lib/local-api";

/** ISO YYYY-MM-DD for today (local). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A small, visible demo PNG drawn on a canvas, returned as base64 (no data-URI
 *  prefix), so we can seed a real image without embedding a big blob. Null when
 *  no canvas is available. */
function demoImageBase64(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const c = document.createElement("canvas");
    c.width = 280;
    c.height = 180;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#1AA0E6";
    ctx.fillRect(0, 0, 280, 180);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px -apple-system, sans-serif";
    ctx.fillText("DEMO experiment image", 22, 96);
    ctx.font = "13px -apple-system, sans-serif";
    ctx.fillText("seeded into the fresh session", 22, 124);
    return c.toDataURL("image/png").split(",")[1] ?? null;
  } catch {
    return null;
  }
}

export async function seedEphemeralWorkspace(username: string): Promise<void> {
  const today = todayIso();
  try {
    const project = await projectsApi.create({
      name: "Demo: Engineer FakeYeast",
      color: "#1AA0E6",
      tags: ["demo", "yeast"],
    });

    // One experiment (task_type "experiment") under the project. Capture it so
    // we can attach an image to its results.
    const experiment = await tasksApi.create({
      project_id: project.id,
      name: "qPCR -- fakeGFP expression",
      start_date: today,
      duration_days: 2,
      task_type: "experiment",
    });

    // One list task.
    await tasksApi.create({
      project_id: project.id,
      name: "Order Spring resupply",
      start_date: today,
      task_type: "list",
    });

    // One single note.
    await notesApi.create({
      title: "Lab meeting notes",
      description: "Sample single note seeded into the fresh ephemeral session.",
    });

    // One multi-entry note (running log) with a couple of dated entries.
    await notesApi.create({
      title: "fakeGFP cloning -- running log",
      is_running_log: true,
      entries: [
        { title: "Day 1 -- transformation", date: today, content: "Plated transformants on LB+amp. Sample multi-entry note." },
        { title: "Day 2 -- colony pick", date: today, content: "Picked 4 colonies into overnight cultures." },
        { title: "Day 3 -- miniprep", date: today, content: "Miniprepped; sent for sequencing." },
      ],
    });

    // A purchase task plus a couple of purchase items.
    const purchaseTask = await tasksApi.create({
      project_id: project.id,
      name: "Reagent order",
      start_date: today,
      task_type: "purchase",
    });
    await purchasesApi.create({
      task_id: purchaseTask.id,
      item_name: "Taq polymerase",
      quantity: 2,
      price_per_unit: 120,
    });
    await purchasesApi.create({
      task_id: purchaseTask.id,
      item_name: "dNTP mix (10 mM)",
      quantity: 1,
      price_per_unit: 45,
    });

    // Attach an image to the experiment (its own try/catch, the image is the
    // most fragile step and must never block the rest of the seed).
    try {
      const b64 = demoImageBase64();
      if (b64) {
        const base = `users/${username}/results/task-${experiment.id}`;
        await filesApi.uploadImage(`${base}/Images/demo-gel.png`, b64);
        await filesApi.writeFile(
          `${base}/results.md`,
          "# Results\n\nSeeded demo image for the experiment.\n\n![demo gel](Images/demo-gel.png)\n",
        );
      }
    } catch (imgErr) {
      console.warn("[seed-ephemeral] image attach skipped:", imgErr);
    }
  } catch (err) {
    console.warn("[seed-ephemeral] partial seed:", err);
  }
}
