// Dev-only: seed a freshly-connected ephemeral OPFS workspace with a small,
// representative data set so a fresh session is testable immediately (a project,
// one experiment, one list task, one note, and a purchase task with a couple of
// items). Best-effort: a failure on any step is logged and the rest continue, so
// a partial seed never blocks the session.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { projectsApi, tasksApi, notesApi, purchasesApi } from "@/lib/local-api";

/** ISO YYYY-MM-DD for today (local). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function seedEphemeralWorkspace(): Promise<void> {
  const today = todayIso();
  try {
    const project = await projectsApi.create({
      name: "Demo: Engineer FakeYeast",
      color: "#1AA0E6",
      tags: ["demo", "yeast"],
    });

    // One experiment (task_type "experiment") under the project.
    await tasksApi.create({
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
      description: "Sample note seeded into the fresh ephemeral session.",
    });

    // A purchase task plus a couple of purchase items so the Purchases surface
    // has something to render.
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
  } catch (err) {
    console.warn("[seed-ephemeral] partial seed:", err);
  }
}
