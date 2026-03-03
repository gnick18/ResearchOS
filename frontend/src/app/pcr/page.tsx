"use client";

import React, { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/AppShell";
import { pcrApi } from "@/lib/api";
import type { PCRProtocol, PCRGradient, PCRStep, PCRIngredient } from "@/lib/types";
import { InteractiveGradientEditor, getTemperatureColor } from "@/components/InteractiveGradientEditor";

// Default gradient for new protocols
const DEFAULT_GRADIENT: PCRGradient = {
  initial: [
    { name: "Init. Denaturation", temperature: 95, duration: "2 min" }
  ],
  cycles: [{
    repeats: 35,
    steps: [
      { name: "Denaturation", temperature: 95, duration: "20 sec" },
      { name: "Annealing", temperature: 58, duration: "20 sec" },
      { name: "Extension", temperature: 72, duration: "2 min" }
    ]
  }],
  final: [
    { name: "Final Extension", temperature: 72, duration: "3 min" }
  ],
  hold: { name: "Hold", temperature: 12, duration: "Indef." }
};

// Default ingredients for new protocols
const DEFAULT_INGREDIENTS: PCRIngredient[] = [
  { id: "1", name: "Reaction Buffer", concentration: "", amount_per_reaction: "" },
  { id: "2", name: "dNTPs", concentration: "", amount_per_reaction: "" },
  { id: "3", name: "Primer F", concentration: "", amount_per_reaction: "" },
  { id: "4", name: "Primer R", concentration: "", amount_per_reaction: "" },
  { id: "5", name: "Polymerase", concentration: "", amount_per_reaction: "" },
  { id: "6", name: "DNA", concentration: "", amount_per_reaction: "" },
  { id: "7", name: "dH2O", concentration: "", amount_per_reaction: "" },
  { id: "8", name: "Total", concentration: "", amount_per_reaction: "" },
];

export default function PCRPage() {
  const queryClient = useQueryClient();
  const [selectedProtocol, setSelectedProtocol] = useState<PCRProtocol | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: protocols = [] } = useQuery({
    queryKey: ["pcr-protocols"],
    queryFn: pcrApi.list,
  });

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm("Delete this PCR protocol?")) return;
    try {
      await pcrApi.delete(id);
      await queryClient.refetchQueries({ queryKey: ["pcr-protocols"] });
      setSelectedProtocol(null);
    } catch {
      alert("Failed to delete protocol");
    }
  }, [queryClient]);

  // Count total steps for display
  const countSteps = (gradient: PCRGradient): number => {
    let count = gradient.initial.length;
    for (const cycle of gradient.cycles) {
      count += cycle.steps.length;
    }
    count += gradient.final.length;
    if (gradient.hold) count += 1;
    return count;
  };

  // Get all steps flattened for preview
  const getAllSteps = (gradient: PCRGradient): (PCRStep & { inCycle?: boolean })[] => {
    const steps: (PCRStep & { inCycle?: boolean })[] = [];
    steps.push(...gradient.initial);
    for (const cycle of gradient.cycles) {
      steps.push(...cycle.steps.map(s => ({ ...s, inCycle: true })));
    }
    steps.push(...gradient.final);
    if (gradient.hold) steps.push(gradient.hold);
    return steps;
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">PCR Protocols</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              Thermal cycler gradients and reaction recipes
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + New Protocol
          </button>
        </div>

        {/* Protocol List */}
        {protocols.length === 0 && !creating ? (
          <div className="text-center py-16">
            <p className="text-lg text-gray-400 mb-2">No PCR protocols yet</p>
            <p className="text-sm text-gray-300 mb-6">
              Create your first PCR protocol with gradient and recipe
            </p>
            <button
              onClick={() => setCreating(true)}
              className="px-6 py-3 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + New Protocol
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {protocols.map((protocol) => (
              <div
                key={protocol.id}
                onClick={() => setSelectedProtocol(protocol)}
                className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
              >
                <h3 className="text-sm font-medium text-gray-900">{protocol.name}</h3>
                <p className="text-xs text-gray-400 mt-1">
                  {countSteps(protocol.gradient)} steps | {protocol.ingredients.length} ingredients
                  {protocol.gradient.cycles.length > 0 && ` | ${protocol.gradient.cycles.map(c => `${c.repeats}x`).join(', ')} cycle${protocol.gradient.cycles.length > 1 ? 's' : ''}`}
                </p>
                <div className="flex gap-1 mt-2">
                  {getAllSteps(protocol.gradient).slice(0, 5).map((step, i) => (
                    <div
                      key={i}
                      className={`h-6 rounded ${step.inCycle ? 'ring-2 ring-purple-300' : ''}`}
                      style={{
                        width: `${Math.max(20, step.temperature / 3)}px`,
                        backgroundColor: getTemperatureColor(step.temperature),
                      }}
                      title={`${step.name}: ${step.temperature}°C${step.inCycle ? ' (in cycle)' : ''}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Protocol Modal */}
      {creating && (
        <CreatePCRModal
          onClose={() => setCreating(false)}
          onCreated={async () => {
            await queryClient.refetchQueries({ queryKey: ["pcr-protocols"] });
            setCreating(false);
          }}
        />
      )}

      {/* View/Edit Protocol Modal */}
      {selectedProtocol && (
        <ViewPCRModal
          protocol={selectedProtocol}
          onClose={() => setSelectedProtocol(null)}
          onDelete={handleDelete}
          onUpdated={async () => {
            await queryClient.refetchQueries({ queryKey: ["pcr-protocols"] });
          }}
        />
      )}
    </AppShell>
  );
}

// ── Gradient Visualizer Component ───────────────────────────────────────────────

function GradientVisualizer({ gradient }: { gradient: PCRGradient }) {
  const maxTemp = 100;
  const minTemp = 0;
  const tempRange = maxTemp - minTemp;
  const barWidth = 70;
  const height = 220;
  
  // Calculate total width needed
  let totalSteps = gradient.initial.length;
  for (const cycle of gradient.cycles) {
    totalSteps += cycle.steps.length;
  }
  totalSteps += gradient.final.length;
  if (gradient.hold) totalSteps += 1;
  
  const width = totalSteps * barWidth + 60;

  const renderStep = (step: PCRStep, x: number, inCycle: boolean = false) => {
    const y = 20 + ((maxTemp - step.temperature) / tempRange) * (height - 50);
    const barH = Math.max(10, (step.temperature / tempRange) * (height - 50));

    return (
      <g key={x}>
        <rect
          x={x}
          y={y}
          width={barWidth - 10}
          height={barH}
          fill={getTemperatureColor(step.temperature)}
          rx="4"
          opacity={inCycle ? 1 : 0.8}
          stroke={inCycle ? "#8b5cf6" : "none"}
          strokeWidth={inCycle ? 2 : 0}
        />
        <text
          x={x + (barWidth - 10) / 2}
          y={y - 5}
          textAnchor="middle"
          className="text-[10px] fill-gray-700 font-medium"
        >
          {step.temperature}°C
        </text>
        <text
          x={x + (barWidth - 10) / 2}
          y={y + barH + 12}
          textAnchor="middle"
          className="text-[9px] fill-gray-500"
        >
          {step.duration}
        </text>
        <text
          x={x + (barWidth - 10) / 2}
          y={y + barH + 24}
          textAnchor="middle"
          className="text-[8px] fill-gray-400"
        >
          {step.name.length > 10 ? step.name.substring(0, 10) + "..." : step.name}
        </text>
      </g>
    );
  };

  let currentX = 40;

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[${width}px] h-auto">
        {/* Y-axis */}
        <line x1="30" y1="20" x2="30" y2={height - 20} stroke="#e5e7eb" strokeWidth="1" />
        <text x="5" y="25" className="text-[10px] fill-gray-500">{maxTemp}°C</text>
        <text x="5" y={height - 15} className="text-[10px] fill-gray-500">{minTemp}°C</text>

        {/* Initial steps */}
        {gradient.initial.map((step) => {
          const elem = renderStep(step, currentX);
          currentX += barWidth;
          return elem;
        })}

        {/* Cycle steps with bracket */}
        {gradient.cycles.map((cycle, cycleIndex) => (
          <g key={cycleIndex}>
            {/* Bracket for cycle */}
            <rect
              x={currentX - 5}
              y={10}
              width={cycle.steps.length * barWidth + 10}
              height={height - 30}
              fill="none"
              stroke="#8b5cf6"
              strokeWidth="2"
              strokeDasharray="4 2"
              rx="8"
            />
            <text
              x={currentX + (cycle.steps.length * barWidth) / 2 - 5}
              y={height - 5}
              textAnchor="middle"
              className="text-[11px] fill-purple-600 font-bold"
            >
              x{cycle.repeats}
            </text>
            
            {cycle.steps.map((step) => {
              const elem = renderStep(step, currentX, true);
              currentX += barWidth;
              return elem;
            })}
          </g>
        ))}

        {/* Final steps */}
        {gradient.final.map((step) => {
          const elem = renderStep(step, currentX);
          currentX += barWidth;
          return elem;
        })}

        {/* Hold */}
        {gradient.hold && renderStep(gradient.hold, currentX)}
      </svg>
    </div>
  );
}

// ── Gradient Table Component ────────────────────────────────────────────────────

function GradientTable({ gradient }: { gradient: PCRGradient }) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Step</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Temperature</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Duration</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {/* Initial steps */}
          {gradient.initial.map((step, i) => (
            <tr key={`initial-${i}`}>
              <td className="px-3 py-2 text-gray-900">{step.name}</td>
              <td className="px-3 py-2 text-gray-600">{step.temperature}°C</td>
              <td className="px-3 py-2 text-gray-600">{step.duration}</td>
              <td className="px-3 py-2 text-gray-400">-</td>
            </tr>
          ))}
          
          {/* Cycle steps */}
          {gradient.cycles.map((cycle, cycleIndex) => (
            <React.Fragment key={cycleIndex}>
              <tr className="bg-purple-50">
                <td colSpan={4} className="px-3 py-1 text-xs font-medium text-purple-700">
                  Cycle {cycleIndex + 1} (repeat {cycle.repeats}x)
                </td>
              </tr>
              {cycle.steps.map((step, i) => (
                <tr key={`cycle-${cycleIndex}-${i}`} className="bg-purple-50/50">
                  <td className="px-3 py-2 text-gray-900 pl-6">{step.name}</td>
                  <td className="px-3 py-2 text-gray-600">{step.temperature}°C</td>
                  <td className="px-3 py-2 text-gray-600">{step.duration}</td>
                  <td className="px-3 py-2 text-purple-500 text-xs">in cycle</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
          
          {/* Final steps */}
          {gradient.final.map((step, i) => (
            <tr key={`final-${i}`}>
              <td className="px-3 py-2 text-gray-900">{step.name}</td>
              <td className="px-3 py-2 text-gray-600">{step.temperature}°C</td>
              <td className="px-3 py-2 text-gray-600">{step.duration}</td>
              <td className="px-3 py-2 text-gray-400">-</td>
            </tr>
          ))}
          
          {/* Hold */}
          {gradient.hold && (
            <tr>
              <td className="px-3 py-2 text-gray-900">{gradient.hold.name}</td>
              <td className="px-3 py-2 text-gray-600">{gradient.hold.temperature}°C</td>
              <td className="px-3 py-2 text-gray-600">{gradient.hold.duration}</td>
              <td className="px-3 py-2 text-gray-400">-</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Recipe Table Component ──────────────────────────────────────────────────────

function RecipeTable({
  ingredients,
  onChange,
  editable,
}: {
  ingredients: PCRIngredient[];
  onChange?: (ingredients: PCRIngredient[]) => void;
  editable: boolean;
}) {
  const handleChange = (id: string, field: keyof PCRIngredient, value: string) => {
    if (!onChange) return;
    onChange(
      ingredients.map((ing) =>
        ing.id === id ? { ...ing, [field]: value } : ing
      )
    );
  };

  const addRow = () => {
    if (!onChange) return;
    const newId = String(Date.now());
    onChange([
      ...ingredients.slice(0, -1),
      { id: newId, name: "", concentration: "", amount_per_reaction: "" },
      ingredients[ingredients.length - 1],
    ]);
  };

  const removeRow = (id: string) => {
    if (!onChange) return;
    if (ingredients[ingredients.length - 1].id === id) return;
    onChange(ingredients.filter((ing) => ing.id !== id));
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Ingredient</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Concentration</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Amount (uL)</th>
            {editable && <th className="px-3 py-2 w-10"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ingredients.map((ing) => (
            <tr key={ing.id} className={ing.name === "Total" ? "bg-gray-50 font-medium" : ""}>
              <td className="px-3 py-2">
                {editable && ing.name !== "Total" ? (
                  <input
                    type="text"
                    value={ing.name}
                    onChange={(e) => handleChange(ing.id, "name", e.target.value)}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                ) : (
                  <span className="text-gray-900">{ing.name}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {editable && ing.name !== "Total" ? (
                  <input
                    type="text"
                    value={ing.concentration}
                    onChange={(e) => handleChange(ing.id, "concentration", e.target.value)}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="e.g. 10x"
                  />
                ) : (
                  <span className="text-gray-600">{ing.concentration || "-"}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {editable ? (
                  <input
                    type="text"
                    value={ing.amount_per_reaction}
                    onChange={(e) => handleChange(ing.id, "amount_per_reaction", e.target.value)}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="e.g. 2.5"
                  />
                ) : (
                  <span className="text-gray-600">{ing.amount_per_reaction || "-"}</span>
                )}
              </td>
              {editable && ing.name !== "Total" && (
                <td className="px-3 py-2">
                  <button
                    onClick={() => removeRow(ing.id)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    x
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <button
          onClick={addRow}
          className="w-full py-2 text-xs text-blue-600 hover:bg-blue-50 border-t border-gray-200"
        >
          + Add Row
        </button>
      )}
    </div>
  );
}

// ── Create PCR Modal ────────────────────────────────────────────────────────────

function CreatePCRModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [gradient, setGradient] = useState<PCRGradient>(DEFAULT_GRADIENT);
  const [ingredients, setIngredients] = useState<PCRIngredient[]>(DEFAULT_INGREDIENTS);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await pcrApi.create({
        name: name.trim(),
        gradient,
        ingredients,
        notes: notes || null,
      });
      onCreated();
    } catch {
      alert("Failed to create protocol");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">New PCR Protocol</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">
            x
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Protocol Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard Taq PCR"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Thermal Gradient</label>
            <InteractiveGradientEditor gradient={gradient} onChange={setGradient} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Reaction Recipe</label>
            <RecipeTable ingredients={ingredients} onChange={setIngredients} editable />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Any additional notes..."
            />
          </div>
        </div>
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create Protocol"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View PCR Modal ──────────────────────────────────────────────────────────────

function ViewPCRModal({
  protocol,
  onClose,
  onDelete,
  onUpdated,
}: {
  protocol: PCRProtocol;
  onClose: () => void;
  onDelete: (id: number) => void;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(protocol.name);
  const [gradient, setGradient] = useState<PCRGradient>(protocol.gradient);
  const [ingredients, setIngredients] = useState<PCRIngredient[]>(protocol.ingredients);
  const [notes, setNotes] = useState(protocol.notes || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await pcrApi.update(protocol.id, {
        name: name.trim(),
        gradient,
        ingredients,
        notes: notes || null,
      });
      setEditing(false);
      onUpdated();
    } catch {
      alert("Failed to save protocol");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            {editing ? (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-base font-semibold text-gray-900 px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
              <h3 className="text-base font-semibold text-gray-900">{protocol.name}</h3>
            )}
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  onClick={() => setEditing(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onDelete(protocol.id)}
                  className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg"
                >
                  Delete
                </button>
                <button
                  onClick={() => setEditing(true)}
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                >
                  Edit
                </button>
              </>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg ml-2">
              x
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Gradient Visualization */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              Thermal Gradient
            </label>
            {editing ? (
              <InteractiveGradientEditor gradient={gradient} onChange={setGradient} />
            ) : (
              <>
                <GradientVisualizer gradient={protocol.gradient} />
                <div className="mt-4">
                  <GradientTable gradient={protocol.gradient} />
                </div>
              </>
            )}
          </div>

          {/* Recipe Table */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              Reaction Recipe
            </label>
            <RecipeTable
              ingredients={editing ? ingredients : protocol.ingredients}
              onChange={setIngredients}
              editable={editing}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            {editing ? (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
              <p className="text-sm text-gray-600 whitespace-pre-wrap">
                {protocol.notes || "No notes"}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
