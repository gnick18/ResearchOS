"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import type { PCRGradient, PCRStep, PCRCycle } from "@/lib/types";

// ── Temperature Color Helper ───────────────────────────────────────────────────

export function getTemperatureColor(temp: number): string {
  if (temp <= 15) return "#3b82f6";
  if (temp <= 30) return "#06b6d4";
  if (temp <= 50) return "#10b981";
  if (temp <= 70) return "#f59e0b";
  if (temp <= 85) return "#f97316";
  return "#ef4444";
}

// ── Types for Block Management ─────────────────────────────────────────────────

export type BlockType = "initial" | "cycle" | "final" | "hold";

export interface GradientBlock {
  id: string;
  type: BlockType;
  step: PCRStep;
  cycleIndex?: number; // For steps inside a cycle (index within that cycle)
  cycleContainerIndex?: number; // Which cycle container this belongs to (0, 1, 2, etc.)
  cycleRepeats?: number; // For cycle container
}

// ── Step Edit Popup Component ──────────────────────────────────────────────────

interface StepEditPopupProps {
  step: PCRStep;
  onSave: (step: PCRStep) => void;
  onClose: () => void;
  isNew?: boolean;
}

export function StepEditPopup({ step, onSave, onClose, isNew = false }: StepEditPopupProps) {
  const [name, setName] = useState(step.name);
  const [temperature, setTemperature] = useState(step.temperature);
  const [duration, setDuration] = useState(step.duration);
  const [isHold, setIsHold] = useState(step.duration === "Indef." || step.duration === "∞");
  const popupRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close without saving
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const handleSave = () => {
    onSave({
      ...step,
      name: name || "Step",
      temperature,
      duration: isHold ? "Indef." : duration || "30 sec",
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20">
      <div
        ref={popupRef}
        className="bg-white rounded-xl shadow-2xl p-6 w-80"
      >
        <h3 className="text-sm font-semibold text-gray-900 mb-4">
          {isNew ? "Add New Step" : "Edit Step"}
        </h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Step Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Denaturation"
              autoFocus
            />
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Temperature (°C)
            </label>
            <input
              type="number"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0"
              max="100"
            />
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Duration
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={isHold ? "Indef." : duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={isHold}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                placeholder="e.g. 30 sec"
              />
              <label className="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={isHold}
                  onChange={(e) => setIsHold(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Hold
              </label>
            </div>
          </div>
        </div>
        
        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cycle Edit Popup Component ─────────────────────────────────────────────────

interface CycleEditPopupProps {
  repeats: number;
  onSave: (repeats: number) => void;
  onClose: () => void;
}

export function CycleEditPopup({ repeats, onSave, onClose }: CycleEditPopupProps) {
  const [newRepeats, setNewRepeats] = useState(repeats);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20">
      <div
        ref={popupRef}
        className="bg-white rounded-xl shadow-2xl p-6 w-64"
      >
        <h3 className="text-sm font-semibold text-gray-900 mb-4">
          Edit Cycle Repeats
        </h3>
        
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Number of Repeats
          </label>
          <input
            type="number"
            value={newRepeats}
            onChange={(e) => setNewRepeats(parseInt(e.target.value) || 1)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            min="1"
            max="100"
            autoFocus
          />
        </div>
        
        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(newRepeats)}
            className="flex-1 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step Block Component ───────────────────────────────────────────────────────

interface StepBlockProps {
  block: GradientBlock;
  isEditing: boolean;
  isErasing: boolean;
  isCycleErasing: boolean;
  isSelected: boolean;
  onErase: (id: string) => void;
  onEdit: (block: GradientBlock) => void;
  onSelect: (id: string) => void;
  onMoveLeft: (id: string) => void;
  onMoveRight: (id: string) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onRemoveFromCycle?: (id: string) => void;
  onAddToCycle?: (id: string, cycleIndex: number) => void;
  cycleContainers: GradientBlock[];
}

function StepBlock({
  block,
  isEditing,
  isErasing,
  isCycleErasing,
  isSelected,
  onErase,
  onEdit,
  onSelect,
  onMoveLeft,
  onMoveRight,
  canMoveLeft,
  canMoveRight,
  onRemoveFromCycle,
  onAddToCycle,
  cycleContainers,
}: StepBlockProps) {
  const [showCycleDropdown, setShowCycleDropdown] = useState(false);

  const handleClick = () => {
    if (isErasing && isEditing) {
      onErase(block.id);
    } else if (isEditing && !isErasing && !isCycleErasing) {
      onSelect(block.id);
    }
  };

  const handleDoubleClick = () => {
    if (isEditing) {
      onEdit(block);
    }
  };

  // Check if this block is inside a cycle
  const isInCycle = block.type === "cycle" && block.cycleIndex !== undefined;

  return (
    <div className="relative flex flex-col items-center">
      {/* Arrow buttons and action buttons - shown when selected */}
      {isSelected && isEditing && !isErasing && !isCycleErasing && (
        <div className="absolute -top-14 flex items-center gap-1 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveLeft(block.id);
            }}
            disabled={!canMoveLeft}
            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              canMoveLeft
                ? "bg-blue-500 text-white hover:bg-blue-600"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
            title="Move left"
          >
            ←
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveRight(block.id);
            }}
            disabled={!canMoveRight}
            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              canMoveRight
                ? "bg-blue-500 text-white hover:bg-blue-600"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
            title="Move right"
          >
            →
          </button>
          
          {/* Remove from Cycle button - only shown for steps inside a cycle */}
          {isInCycle && onRemoveFromCycle && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFromCycle(block.id);
              }}
              className="ml-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors whitespace-nowrap"
              title="Remove from cycle"
            >
              Remove from Cycle
            </button>
          )}
          
          {/* Add to Cycle button - only shown for steps NOT inside a cycle */}
          {!isInCycle && cycleContainers.length > 0 && onAddToCycle && (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCycleDropdown(!showCycleDropdown);
                }}
                className="ml-1 px-2 py-1 text-xs font-medium bg-purple-100 text-purple-600 rounded-lg hover:bg-purple-200 transition-colors whitespace-nowrap"
                title="Add to cycle"
              >
                Add to Cycle
              </button>
              
              {showCycleDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[120px]">
                  {cycleContainers.map((container, idx) => (
                    <button
                      key={container.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToCycle(block.id, idx);
                        setShowCycleDropdown(false);
                      }}
                      className="w-full px-3 py-2 text-xs text-left text-gray-700 hover:bg-purple-50 first:rounded-t-lg last:rounded-b-lg"
                    >
                      Cycle {idx + 1} (x{container.cycleRepeats || 35})
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className={`
          relative select-none group
          ${isEditing ? "cursor-pointer" : "cursor-default"}
          ${isErasing && isEditing ? "cursor-crosshair hover:ring-2 hover:ring-red-400 hover:ring-offset-1" : ""}
        `}
        style={{
          animation: isEditing && !isErasing ? "jiggle 0.5s ease-in-out infinite" : undefined,
        }}
      >
        <div
          className={`
            w-16 h-16 rounded-lg flex flex-col items-center justify-center text-white text-xs shadow-sm
            transition-all duration-150
            ${block.type === "cycle" ? "ring-2 ring-purple-400 ring-offset-1" : ""}
            ${isEditing && !isErasing ? "hover:shadow-md hover:scale-105" : ""}
            ${isSelected ? "ring-2 ring-blue-500 ring-offset-2" : ""}
          `}
          style={{ backgroundColor: getTemperatureColor(block.step.temperature) }}
        >
          <span className="font-semibold">{block.step.temperature}°C</span>
          <span className="text-[10px] opacity-90">{block.step.duration}</span>
        </div>
        
        {/* Step name label */}
        <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[9px] text-gray-500 whitespace-nowrap pointer-events-none">
          {block.step.name.length > 10 ? block.step.name.substring(0, 10) + "..." : block.step.name}
        </div>
        
        {/* Erase indicator */}
        {isErasing && isEditing && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-500/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
            <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Cycle Container Component ──────────────────────────────────────────────────

interface CycleContainerProps {
  block: GradientBlock;
  cycleSteps: GradientBlock[];
  isEditing: boolean;
  isErasing: boolean;
  isCycleErasing: boolean;
  selectedBlockId: string | null;
  onErase: (id: string) => void;
  onEdit: (block: GradientBlock) => void;
  onEditCycleRepeats: (repeats: number) => void;
  onSelect: (id: string) => void;
  onMoveLeft: (id: string) => void;
  onMoveRight: (id: string) => void;
  allBlocks: GradientBlock[];
  onRemoveFromCycle?: (id: string) => void;
  onAddToCycle?: (id: string, cycleIndex: number) => void;
  cycleContainers: GradientBlock[];
}

function CycleContainer({
  block,
  cycleSteps,
  isEditing,
  isErasing,
  isCycleErasing,
  selectedBlockId,
  onErase,
  onEdit,
  onEditCycleRepeats,
  onSelect,
  onMoveLeft,
  onMoveRight,
  allBlocks,
  onRemoveFromCycle,
  onAddToCycle,
  cycleContainers,
}: CycleContainerProps) {
  const handleRepeatsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCycleErasing && isEditing) {
      // In cycle erasing mode, clicking the badge removes the cycle
      onErase(block.id);
    } else if (isEditing) {
      onEditCycleRepeats(block.cycleRepeats || 35);
    }
  };

  // Get the flat index of a block in the allBlocks array for movement calculations
  const getBlockIndex = (blockId: string) => {
    return allBlocks.findIndex(b => b.id === blockId);
  };

  // Check if a block can be moved left/right within a cycle
  // Steps at the edges of a cycle should NOT be able to move further in that direction
  const canMoveBlockLeft = (blockId: string) => {
    const block = allBlocks.find(b => b.id === blockId);
    if (!block) return false;
    
    // If this is a cycle step, check if it's the first step in the cycle
    if (block.type === "cycle" && block.cycleIndex !== undefined) {
      // First step in cycle (cycleIndex === 0) cannot move left
      if (block.cycleIndex === 0) return false;
    }
    
    const idx = getBlockIndex(blockId);
    return idx > 0;
  };

  const canMoveBlockRight = (blockId: string) => {
    const block = allBlocks.find(b => b.id === blockId);
    if (!block) return false;
    
    // If this is a cycle step, check if it's the last step in the cycle
    if (block.type === "cycle" && block.cycleIndex !== undefined && block.cycleContainerIndex !== undefined) {
      // Find all steps in this cycle
      const cycleSteps = allBlocks.filter(
        b => b.type === "cycle" && b.cycleIndex !== undefined && b.cycleContainerIndex === block.cycleContainerIndex
      );
      // Last step in cycle cannot move right
      if (block.cycleIndex === cycleSteps.length - 1) return false;
    }
    
    const idx = getBlockIndex(blockId);
    return idx < allBlocks.length - 1;
  };

  return (
    <div
      data-cycle-container
      className={`
        relative border-2 border-dashed rounded-xl p-3 bg-purple-50/50 min-w-[80px]
        transition-all duration-150
        ${isEditing ? "cursor-default" : ""}
        border-purple-300
      `}
      style={{
        animation: isEditing && !isErasing ? "jiggle 0.5s ease-in-out infinite" : undefined,
      }}
    >
      {/* Repeats badge - clickable to edit cycle repeats or remove cycle in cycle-erasing mode */}
      <div 
        onClick={handleRepeatsClick}
        className={`absolute -top-3 left-1/2 -translate-x-1/2 text-white text-xs font-bold px-2 py-0.5 rounded-full
          ${isCycleErasing && isEditing 
            ? "bg-purple-500 cursor-crosshair hover:bg-purple-600 transition-colors" 
            : isEditing 
              ? "bg-purple-500 cursor-pointer hover:bg-purple-600 transition-colors" 
              : "bg-purple-500"}`}
        title={isCycleErasing && isEditing ? "Click to remove cycle (keeps steps)" : isEditing ? "Click to edit cycle repeats" : undefined}
      >
        x{block.cycleRepeats || 35}
      </div>
      
      {/* Cycle steps */}
      <div className="flex gap-2 flex-wrap mt-1">
        {cycleSteps.map((step) => (
          <StepBlock
            key={step.id}
            block={step}
            isEditing={isEditing}
            isErasing={isErasing}
            isCycleErasing={isCycleErasing}
            isSelected={selectedBlockId === step.id}
            onErase={onErase}
            onEdit={onEdit}
            onSelect={onSelect}
            onMoveLeft={onMoveLeft}
            onMoveRight={onMoveRight}
            canMoveLeft={canMoveBlockLeft(step.id)}
            canMoveRight={canMoveBlockRight(step.id)}
            onRemoveFromCycle={onRemoveFromCycle}
            onAddToCycle={onAddToCycle}
            cycleContainers={cycleContainers}
          />
        ))}
      </div>
    </div>
  );
}

// ── Editing Toolbar Component ──────────────────────────────────────────────────

interface EditingToolbarProps {
  isEditing: boolean;
  isErasing: boolean;
  isCycleErasing: boolean;
  onToggleEdit: () => void;
  onToggleEraser: () => void;
  onToggleCycleEraser: () => void;
  onAddCycle: () => void;
  onAddStep: () => void;
  onClearAll: () => void;
}

export function EditingToolbar({
  isEditing,
  isErasing,
  isCycleErasing,
  onToggleEdit,
  onToggleEraser,
  onToggleCycleEraser,
  onAddCycle,
  onAddStep,
  onClearAll,
}: EditingToolbarProps) {
  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <button
        onClick={onToggleEdit}
        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
          isEditing
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
        }`}
      >
        {isEditing ? "✓ Done Editing" : "Edit Cycle"}
      </button>
      
      {isEditing && (
        <>
          <div className="w-px h-6 bg-gray-200" />
          
          <button
            onClick={onToggleEraser}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
              isErasing
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {isErasing ? "Erasing Gradients..." : "Gradient Eraser"}
          </button>
          
          <button
            onClick={onToggleCycleEraser}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
              isCycleErasing
                ? "bg-purple-500 text-white hover:bg-purple-600"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {isCycleErasing ? "Erasing Cycles..." : "Cycle Eraser"}
          </button>
          
          <button
            onClick={onAddCycle}
            className="px-3 py-1.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors"
          >
            + Add Cycle
          </button>
          
          <button
            onClick={onAddStep}
            className="px-3 py-1.5 text-xs font-medium bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
          >
            + Add Step
          </button>
          
          <button
            onClick={onClearAll}
            className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-red-100 hover:text-red-600 transition-colors"
          >
            Clear All
          </button>
        </>
      )}
    </div>
  );
}

// ── Main Interactive Gradient Editor Component ─────────────────────────────────

interface InteractiveGradientEditorProps {
  gradient: PCRGradient;
  onChange: (gradient: PCRGradient) => void;
}

export function InteractiveGradientEditor({
  gradient,
  onChange,
}: InteractiveGradientEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [isCycleErasing, setIsCycleErasing] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editingBlock, setEditingBlock] = useState<GradientBlock | null>(null);
  const [addingStep, setAddingStep] = useState(false);
  const [addingCycle, setAddingCycle] = useState(false);
  const [editingCycle, setEditingCycle] = useState<{ index: number; repeats: number } | null>(null);

  // Convert gradient to blocks
  const gradientToBlocks = useCallback((g: PCRGradient): GradientBlock[] => {
    const blocks: GradientBlock[] = [];
    
    // Initial steps (with defensive check)
    (g.initial || []).forEach((step, i) => {
      blocks.push({
        id: `initial-${i}`,
        type: "initial",
        step,
      });
    });
    
    // Multiple cycles (with defensive check)
    (g.cycles || []).forEach((cycle, cycleIdx) => {
      blocks.push({
        id: `cycle-container-${cycleIdx}`,
        type: "cycle",
        step: { name: "Cycle", temperature: 0, duration: "" },
        cycleRepeats: cycle.repeats,
        cycleContainerIndex: cycleIdx,
      });
      
      cycle.steps.forEach((step, stepIdx) => {
        blocks.push({
          id: `cycle-${cycleIdx}-step-${stepIdx}`,
          type: "cycle",
          step,
          cycleIndex: stepIdx,
          cycleContainerIndex: cycleIdx,
        });
      });
    });
    
    // Final steps (with defensive check)
    (g.final || []).forEach((step, i) => {
      blocks.push({
        id: `final-${i}`,
        type: "final",
        step,
      });
    });
    
    // Hold
    if (g.hold) {
      blocks.push({
        id: "hold",
        type: "hold",
        step: g.hold,
      });
    }
    
    return blocks;
  }, []);

  // Convert blocks back to gradient
  const blocksToGradient = useCallback((blocks: GradientBlock[]): PCRGradient => {
    const newGradient: PCRGradient = {
      initial: [],
      cycles: [],
      final: [],
      hold: null,
    };
    
    let currentCycle: { repeats: number; steps: PCRStep[] } | null = null;
    
    blocks.forEach((block) => {
      // Check if this is a cycle container
      if (block.id.startsWith("cycle-container-")) {
        // If we were building a cycle, save it first
        if (currentCycle) {
          newGradient.cycles.push(currentCycle);
        }
        // Start a new cycle
        currentCycle = {
          repeats: block.cycleRepeats || 35,
          steps: [],
        };
        return;
      }
      
      // If we're in a cycle, collect cycle steps
      if (currentCycle && block.type === "cycle" && block.cycleIndex !== undefined) {
        currentCycle.steps.push(block.step);
        return;
      }
      
      // If we hit a non-cycle block while in a cycle, close the cycle
      if (currentCycle && (block.type === "final" || block.type === "hold")) {
        newGradient.cycles.push(currentCycle);
        currentCycle = null;
      }
      
      // Process non-cycle blocks
      if (block.type === "initial") {
        newGradient.initial.push(block.step);
      } else if (block.type === "final") {
        newGradient.final.push(block.step);
      } else if (block.type === "hold") {
        newGradient.hold = block.step;
      }
    });
    
    // Don't forget to add the last cycle if we ended with one
    if (currentCycle) {
      newGradient.cycles.push(currentCycle);
    }
    
    return newGradient;
  }, []);

  const blocks = gradientToBlocks(gradient);

  // Helper to check if a block is a cycle container
  const isCycleContainer = (b: GradientBlock) => 
    b.id === "cycle-container" || b.id.startsWith("cycle-container-");

  // Handle erase (gradient eraser - removes individual blocks)
  const handleErase = useCallback((id: string) => {
    if (!isErasing) return;
    
    // Gradient eraser only removes individual blocks, not cycle containers
    // Cycle containers are handled by the cycle eraser
    if (id.startsWith("cycle-container-")) {
      return; // Ignore cycle containers in gradient eraser mode
    }
    
    const newBlocks = blocks.filter((b) => b.id !== id);
    onChange(blocksToGradient(newBlocks));
  }, [isErasing, blocks, onChange, blocksToGradient]);

  // Helper to find the index of the last block in a cycle
  const findCycleEndIndex = useCallback((blocks: GradientBlock[], cycleContainerIndex: number): number => {
    let lastCycleStepIndex = -1;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].type === "cycle" && 
          blocks[i].cycleContainerIndex === cycleContainerIndex) {
        lastCycleStepIndex = i;
      }
    }
    return lastCycleStepIndex;
  }, []);

  // Helper to find the index of the cycle container for a given cycle container index
  const findCycleContainerIndex = useCallback((blocks: GradientBlock[], cycleContainerIndex: number): number => {
    return blocks.findIndex(b => b.id === `cycle-container-${cycleContainerIndex}`);
  }, []);

  // Rebuild blocks after move to fix types and indices
  // IMPORTANT: This function handles both existing cycle steps and new steps being added to cycles
  // A block is a cycle step if:
  // 1. It has cycleIndex defined (existing cycle step), OR
  // 2. It has type "cycle" and cycleContainerIndex defined (being added to a cycle)
  const rebuildBlocksAfterMove = useCallback((blocks: GradientBlock[]): GradientBlock[] => {
    const result: GradientBlock[] = [];
    let cycleContainerCount = 0;
    let hasPassedCycle = false;
    let initialCount = 0;
    let finalCount = 0;
    
    // First pass: identify cycle containers and their indices
    const cycleContainerIndices = new Map<string, number>();
    for (const block of blocks) {
      if (isCycleContainer(block)) {
        cycleContainerIndices.set(block.id, cycleContainerCount);
        cycleContainerCount++;
      }
    }
    
    // Reset for second pass
    cycleContainerCount = 0;
    
    // Track current cycle for assigning step indices
    let currentCycleContainerId: string | null = null;
    let currentCycleStepIndex = 0;
    
    for (const block of blocks) {
      if (isCycleContainer(block)) {
        // Start a new cycle section
        currentCycleContainerId = block.id;
        currentCycleStepIndex = 0;
        const containerIndex = cycleContainerIndices.get(block.id) ?? cycleContainerCount;
        result.push({
          ...block,
          cycleContainerIndex: containerIndex,
        });
        cycleContainerCount++;
        hasPassedCycle = true;
        continue;
      }
      
      // Check if this is a hold block
      if (block.type === "hold" || block.id === "hold") {
        currentCycleContainerId = null;
        result.push({
          ...block,
          type: "hold",
        });
        continue;
      }
      
      // Check if this block is or should be a cycle step
      // Case 1: It was already a cycle step (has cycleIndex defined)
      // Case 2: It's being added to a cycle (type "cycle" with cycleContainerIndex, but no cycleIndex yet)
      const wasCycleStep = block.cycleIndex !== undefined;
      const isBeingAddedToCycle = block.type === "cycle" && block.cycleContainerIndex !== undefined && block.cycleIndex === undefined;
      const isCycleStep = wasCycleStep || isBeingAddedToCycle;
      
      if (isCycleStep && currentCycleContainerId !== null) {
        // This is or should be a cycle step
        const containerIndex = cycleContainerIndices.get(currentCycleContainerId) ?? 0;
        result.push({
          ...block,
          type: "cycle",
          cycleIndex: currentCycleStepIndex,
          cycleContainerIndex: containerIndex,
          id: block.id.startsWith("cycle-") ? block.id : `cycle-${containerIndex}-step-${currentCycleStepIndex}`,
        });
        currentCycleStepIndex++;
      } else {
        // Not a cycle step - determine type based on position
        const blockWithoutCycleIndex = { ...block };
        delete blockWithoutCycleIndex.cycleIndex;
        delete blockWithoutCycleIndex.cycleContainerIndex;
        
        if (block.id === "hold") {
          result.push({ ...blockWithoutCycleIndex, type: "hold" });
          continue;
        }
        
        // Determine type based on whether we've passed a cycle container
        if (!hasPassedCycle) {
          // Before any cycle - treat as initial
          const newId = block.id.startsWith("initial-") ? block.id : `initial-${initialCount}`;
          initialCount++;
          result.push({
            ...blockWithoutCycleIndex,
            type: "initial",
            id: newId,
          });
        } else {
          // After cycle(s) - treat as final
          const newId = block.id.startsWith("final-") ? block.id : `final-${finalCount}`;
          finalCount++;
          result.push({
            ...blockWithoutCycleIndex,
            type: "final",
            id: newId,
          });
        }
      }
    }
    
    return result;
  }, []);

  // Handle cycle erase (removes cycle container but keeps steps as final steps)
  const handleCycleErase = useCallback((id: string) => {
    if (!isCycleErasing) return;
    
    // Only works on cycle containers
    if (!id.startsWith("cycle-container-")) return;
    
    // Find the cycle container
    const container = blocks.find(b => b.id === id);
    const containerIdx = container?.cycleContainerIndex;
    
    if (containerIdx === undefined) return;
    
    // Remove the container but keep the steps (convert them to final steps)
    const newBlocks: GradientBlock[] = [];
    
    for (const block of blocks) {
      if (block.id === id) {
        // Skip the cycle container
        continue;
      }
      
      if (block.type === "cycle" && block.cycleContainerIndex === containerIdx) {
        // Convert cycle step to a regular step (will be classified by rebuildBlocksAfterMove)
        const cleanedBlock: GradientBlock = {
          ...block,
          type: "final", // Will be reclassified by rebuildBlocksAfterMove
        };
        delete cleanedBlock.cycleIndex;
        delete cleanedBlock.cycleContainerIndex;
        newBlocks.push(cleanedBlock);
      } else {
        newBlocks.push(block);
      }
    }
    
    const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
    onChange(blocksToGradient(rebuiltBlocks));
  }, [isCycleErasing, blocks, onChange, blocksToGradient, rebuildBlocksAfterMove]);

  // Handle move left - arrows should NEVER move a step into a cycle
  const handleMoveLeft = useCallback((id: string) => {
    const blockIndex = blocks.findIndex(b => b.id === id);
    if (blockIndex <= 0) return;
    
    const movingBlock = blocks[blockIndex];
    const prevBlock = blocks[blockIndex - 1];
    
    // Hold step can always move left with a normal swap - rebuildBlocksAfterMove will preserve it
    // Check this FIRST before other logic
    if (movingBlock.type === "hold" || movingBlock.id === "hold") {
      const newBlocks = [...blocks];
      [newBlocks[blockIndex - 1], newBlocks[blockIndex]] = [newBlocks[blockIndex], newBlocks[blockIndex - 1]];
      const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
      onChange(blocksToGradient(rebuiltBlocks));
      return;
    }
    
    // If the moving block is already inside a cycle, allow normal movement within the cycle
    // (cycle steps can move within their own cycle)
    if (movingBlock.type === "cycle" && movingBlock.cycleIndex !== undefined) {
      // Check if previous block is also in the same cycle
      if (prevBlock.type === "cycle" && prevBlock.cycleContainerIndex === movingBlock.cycleContainerIndex) {
        // Normal swap within the same cycle
        const newBlocks = [...blocks];
        [newBlocks[blockIndex - 1], newBlocks[blockIndex]] = [newBlocks[blockIndex], newBlocks[blockIndex - 1]];
        const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
        onChange(blocksToGradient(rebuiltBlocks));
        return;
      }
      // If previous block is the cycle container (moving to position 0 in cycle), allow it
      if (prevBlock.id.startsWith("cycle-container-") && prevBlock.cycleContainerIndex === movingBlock.cycleContainerIndex) {
        // This shouldn't happen as container is before steps, but handle gracefully
        return;
      }
    }
    
    // Check if previous block is a cycle step (inside a cycle) - don't enter the cycle
    if (prevBlock.type === "cycle" && prevBlock.cycleIndex !== undefined) {
      // Find the cycle container for this cycle
      const cycleContainerIdx = prevBlock.cycleContainerIndex;
      const containerIndex = findCycleContainerIndex(blocks, cycleContainerIdx!);
      
      if (containerIndex >= 0) {
        // Move the step to before the cycle container (swap with entire cycle)
        const newBlocks = [...blocks];
        const [movingBlk] = newBlocks.splice(blockIndex, 1);
        newBlocks.splice(containerIndex, 0, movingBlk);
        
        const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
        onChange(blocksToGradient(rebuiltBlocks));
        return;
      }
    }
    
    // Check if previous block is a cycle container - don't enter the cycle
    if (prevBlock.id.startsWith("cycle-container-")) {
      // The step is right after a cycle, moving left would put it inside
      // Instead, move it to before the cycle container
      const newBlocks = [...blocks];
      const [movingBlk] = newBlocks.splice(blockIndex, 1);
      newBlocks.splice(blockIndex - 1, 0, movingBlk);
      
      const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
      onChange(blocksToGradient(rebuiltBlocks));
      return;
    }
    
    // Normal swap for non-cycle blocks
    const newBlocks = [...blocks];
    [newBlocks[blockIndex - 1], newBlocks[blockIndex]] = [newBlocks[blockIndex], newBlocks[blockIndex - 1]];
    
    const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
    onChange(blocksToGradient(rebuiltBlocks));
  }, [blocks, onChange, blocksToGradient, rebuildBlocksAfterMove, findCycleContainerIndex]);

  // Handle move right - arrows should NEVER move a step into a cycle
  const handleMoveRight = useCallback((id: string) => {
    const blockIndex = blocks.findIndex(b => b.id === id);
    if (blockIndex < 0 || blockIndex >= blocks.length - 1) return;
    
    const movingBlock = blocks[blockIndex];
    const nextBlock = blocks[blockIndex + 1];
    
    // Hold step can always move right with a normal swap - rebuildBlocksAfterMove will preserve it
    // Check this FIRST before other logic (though hold is typically at the end)
    if (movingBlock.type === "hold" || movingBlock.id === "hold") {
      const newBlocks = [...blocks];
      [newBlocks[blockIndex], newBlocks[blockIndex + 1]] = [newBlocks[blockIndex + 1], newBlocks[blockIndex]];
      const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
      onChange(blocksToGradient(rebuiltBlocks));
      return;
    }
    
    // If the moving block is already inside a cycle, allow normal movement within the cycle
    // (cycle steps can move within their own cycle)
    if (movingBlock.type === "cycle" && movingBlock.cycleIndex !== undefined) {
      // Check if next block is also in the same cycle
      if (nextBlock.type === "cycle" && nextBlock.cycleContainerIndex === movingBlock.cycleContainerIndex) {
        // Normal swap within the same cycle
        const newBlocks = [...blocks];
        [newBlocks[blockIndex], newBlocks[blockIndex + 1]] = [newBlocks[blockIndex + 1], newBlocks[blockIndex]];
        const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
        onChange(blocksToGradient(rebuiltBlocks));
        return;
      }
      // If next block is not in the same cycle, this step would exit the cycle
      // Allow this - it's moving out of the cycle
      if (nextBlock.type !== "cycle" || nextBlock.cycleContainerIndex !== movingBlock.cycleContainerIndex) {
        // Find the end of this cycle and move the step after it
        const cycleEndIndex = findCycleEndIndex(blocks, movingBlock.cycleContainerIndex!);
        if (cycleEndIndex >= 0 && blockIndex < cycleEndIndex) {
          // Moving right within cycle but not at the end yet - normal swap
          const newBlocks = [...blocks];
          [newBlocks[blockIndex], newBlocks[blockIndex + 1]] = [newBlocks[blockIndex + 1], newBlocks[blockIndex]];
          const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
          onChange(blocksToGradient(rebuiltBlocks));
          return;
        }
      }
    }
    
    // Check if next block is a cycle container - don't enter the cycle
    if (nextBlock.id.startsWith("cycle-container-")) {
      // Find the end of this cycle
      const cycleContainerIdx = nextBlock.cycleContainerIndex;
      const cycleEndIndex = findCycleEndIndex(blocks, cycleContainerIdx!);
      
      if (cycleEndIndex >= 0) {
        // Move the step to after the cycle (swap with entire cycle)
        const newBlocks = [...blocks];
        const [movingBlk] = newBlocks.splice(blockIndex, 1);
        newBlocks.splice(cycleEndIndex, 0, movingBlk);
        
        const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
        onChange(blocksToGradient(rebuiltBlocks));
        return;
      } else {
        // Empty cycle - move after the container
        const newBlocks = [...blocks];
        const [movingBlk] = newBlocks.splice(blockIndex, 1);
        newBlocks.splice(blockIndex + 1, 0, movingBlk);
        
        const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
        onChange(blocksToGradient(rebuiltBlocks));
        return;
      }
    }
    
    // Check if next block is a cycle step (inside a cycle) - don't enter the cycle
    if (nextBlock.type === "cycle" && nextBlock.cycleIndex !== undefined) {
      // Find the end of this cycle
      const cycleContainerIdx = nextBlock.cycleContainerIndex;
      const cycleEndIndex = findCycleEndIndex(blocks, cycleContainerIdx!);
      
      if (cycleEndIndex >= 0) {
        // Move the step to after the cycle (swap with entire cycle)
        const newBlocks = [...blocks];
        const [movingBlk] = newBlocks.splice(blockIndex, 1);
        newBlocks.splice(cycleEndIndex + 1, 0, movingBlk);
        
        const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
        onChange(blocksToGradient(rebuiltBlocks));
        return;
      }
    }
    
    // Normal swap for non-cycle blocks
    const newBlocks = [...blocks];
    [newBlocks[blockIndex], newBlocks[blockIndex + 1]] = [newBlocks[blockIndex + 1], newBlocks[blockIndex]];
    
    const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
    onChange(blocksToGradient(rebuiltBlocks));
  }, [blocks, onChange, blocksToGradient, rebuildBlocksAfterMove, findCycleEndIndex]);

  // Handle edit block
  const handleEditBlock = useCallback((block: GradientBlock) => {
    // Check if this is a cycle container
    if (block.id.startsWith("cycle-container-")) {
      setEditingCycle({ index: block.cycleContainerIndex ?? 0, repeats: block.cycleRepeats || 35 });
    } else {
      setEditingBlock(block);
    }
  }, []);

  // Handle save edited block
  const handleSaveBlock = useCallback((step: PCRStep) => {
    if (!editingBlock) return;
    
    const newBlocks = blocks.map((b) =>
      b.id === editingBlock.id ? { ...b, step } : b
    );
    
    onChange(blocksToGradient(newBlocks));
    setEditingBlock(null);
  }, [editingBlock, blocks, onChange, blocksToGradient]);

  // Handle add step - always places new steps at the far right
  const handleAddStep = useCallback((step: PCRStep) => {
    const newBlock: GradientBlock = {
      id: `final-${Date.now()}`,
      type: "final",
      step,
    };
    
    // Always insert at the far right (before hold if present, otherwise at end)
    const holdIndex = blocks.findIndex((b) => b.type === "hold");
    const newBlocks = [...blocks];
    
    if (holdIndex !== -1) {
      // Insert before hold
      newBlocks.splice(holdIndex, 0, newBlock);
    } else {
      // No hold, add at the very end
      newBlocks.push(newBlock);
    }
    
    onChange(blocksToGradient(newBlocks));
    setAddingStep(false);
  }, [blocks, onChange, blocksToGradient]);

  // Handle add cycle
  const handleAddCycle = useCallback(() => {
    // Always create a new empty cycle at the end
    // Find the next cycle container index
    const existingCycleContainers = blocks.filter(b => b.id.startsWith("cycle-container-"));
    const nextCycleIndex = existingCycleContainers.length;
    
    // Insert cycle-container before hold (or at end if no hold)
    const newBlocks = [...blocks];
    const holdIndex = newBlocks.findIndex(b => b.type === "hold");
    
    const newCycleContainer: GradientBlock = {
      id: `cycle-container-${Date.now()}`,
      type: "cycle",
      step: { name: "Cycle", temperature: 0, duration: "" },
      cycleRepeats: 35,
      cycleContainerIndex: nextCycleIndex,
    };
    
    if (holdIndex !== -1) {
      newBlocks.splice(holdIndex, 0, newCycleContainer);
    } else {
      newBlocks.push(newCycleContainer);
    }
    
    onChange(blocksToGradient(newBlocks));
    setAddingCycle(false);
  }, [blocks, onChange, blocksToGradient]);

  // Handle clear all
  const handleClearAll = useCallback(() => {
    if (!confirm("Clear all steps? This will reset the gradient to empty.")) return;
    
    onChange({
      initial: [],
      cycles: [],
      final: [],
      hold: null,
    });
  }, [onChange]);

  // Handle cycle repeats change
  const handleCycleRepeatsChange = useCallback((repeats: number) => {
    if (!editingCycle) return;
    
    // Update only the specific cycle container that was being edited
    const newBlocks = blocks.map((b) =>
      b.id === `cycle-container-${editingCycle.index}` 
        ? { ...b, cycleRepeats: repeats } 
        : b
    );
    
    onChange(blocksToGradient(newBlocks));
    setEditingCycle(null);
  }, [editingCycle, blocks, onChange, blocksToGradient]);

  // Handle remove from cycle - place step immediately after the cycle
  const handleRemoveFromCycle = useCallback((blockId: string) => {
    const blockIndex = blocks.findIndex(b => b.id === blockId);
    if (blockIndex === -1) return;
    
    const blockToRemove = blocks[blockIndex];
    
    // If not in a cycle, do nothing
    if (blockToRemove.type !== "cycle" || blockToRemove.cycleIndex === undefined) {
      return;
    }
    
    // Get the cycle container index this block belongs to
    const cycleContainerIdx = blockToRemove.cycleContainerIndex;
    
    // Find the end of this specific cycle (last step in the same cycle)
    const cycleEndIndex = findCycleEndIndex(blocks, cycleContainerIdx!);
    
    // Remove from current position
    const newBlocks = [...blocks];
    const [movingBlock] = newBlocks.splice(blockIndex, 1);
    
    // Clear cycle-specific properties from the moving block
    const cleanedBlock: GradientBlock = {
      ...movingBlock,
      type: "final", // Will be reclassified by rebuildBlocksAfterMove
    };
    delete cleanedBlock.cycleIndex;
    delete cleanedBlock.cycleContainerIndex;
    
    // Insert right after the cycle ends
    // If cycleEndIndex is -1 (empty cycle), find the container position
    let insertIndex: number;
    if (cycleEndIndex >= 0) {
      // Adjust for the splice that removed the block
      insertIndex = cycleEndIndex > blockIndex ? cycleEndIndex : cycleEndIndex + 1;
    } else {
      // Empty cycle - find container and insert after it
      const containerIdx = newBlocks.findIndex(b => b.id === `cycle-container-${cycleContainerIdx}`);
      insertIndex = containerIdx >= 0 ? containerIdx + 1 : newBlocks.length;
    }
    
    newBlocks.splice(insertIndex, 0, cleanedBlock);
    
    const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
    onChange(blocksToGradient(rebuiltBlocks));
    setSelectedBlockId(null); // Deselect after removing
  }, [blocks, onChange, blocksToGradient, rebuildBlocksAfterMove, findCycleEndIndex]);

  // Handle add to cycle - move a step into a specific cycle
  const handleAddToCycle = useCallback((blockId: string, cycleIndex: number) => {
    const blockIndex = blocks.findIndex(b => b.id === blockId);
    if (blockIndex === -1) return;
    
    const blockToAdd = blocks[blockIndex];
    
    // If already in a cycle, do nothing
    if (blockToAdd.type === "cycle" && blockToAdd.cycleIndex !== undefined) {
      return;
    }
    
    // Find the cycle container for the target cycle
    const cycleContainers = blocks.filter(b => b.id.startsWith("cycle-container-"));
    const targetContainer = cycleContainers[cycleIndex];
    
    if (!targetContainer) return;
    
    // Find the position of the target container in the blocks array
    const targetContainerBlockIndex = blocks.findIndex(b => b.id === targetContainer.id);
    
    // Find all steps currently in this cycle to determine where to insert
    const existingCycleSteps = blocks.filter(
      b => b.type === "cycle" && b.cycleIndex !== undefined && b.cycleContainerIndex === targetContainer.cycleContainerIndex
    );
    
    // Remove from current position
    const newBlocks = [...blocks];
    const [movingBlock] = newBlocks.splice(blockIndex, 1);
    
    // Mark this block as being added to a cycle
    // Use the cycleIndex parameter as the target cycle index (0, 1, 2, etc.)
    const newCycleStep: GradientBlock = {
      ...movingBlock,
      type: "cycle",
      cycleContainerIndex: cycleIndex, // Use the index in the cycleContainers array
    };
    delete (newCycleStep as any).cycleIndex; // Will be set by rebuildBlocksAfterMove
    
    // Calculate insert position: after the container and any existing cycle steps
    // Adjust for the splice that removed the block
    let insertIndex: number;
    if (existingCycleSteps.length > 0) {
      // Find the last step in this cycle
      const lastStepId = existingCycleSteps[existingCycleSteps.length - 1].id;
      const lastStepIndex = newBlocks.findIndex(b => b.id === lastStepId);
      insertIndex = lastStepIndex + 1;
    } else {
      // Empty cycle - insert right after the container
      // Adjust for the splice if the container was after the removed block
      const adjustedContainerIndex = targetContainerBlockIndex > blockIndex 
        ? targetContainerBlockIndex - 1 
        : targetContainerBlockIndex;
      insertIndex = adjustedContainerIndex + 1;
    }
    
    newBlocks.splice(insertIndex, 0, newCycleStep);
    
    const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
    onChange(blocksToGradient(rebuiltBlocks));
    setSelectedBlockId(null); // Deselect after adding
  }, [blocks, onChange, blocksToGradient, rebuildBlocksAfterMove]);

  // Get the flat index of a block for movement calculations
  const getBlockIndex = (blockId: string) => {
    return blocks.findIndex(b => b.id === blockId);
  };

  // Check if a block can be moved left/right
  // Hold step cannot move at all - it's always at the end
  const canMoveBlockLeft = (blockId: string) => {
    const block = blocks.find(b => b.id === blockId);
    // Hold step cannot move left
    if (block?.type === "hold" || block?.id === "hold") return false;
    
    const idx = getBlockIndex(blockId);
    return idx > 0;
  };

  const canMoveBlockRight = (blockId: string) => {
    const block = blocks.find(b => b.id === blockId);
    // Hold step cannot move right
    if (block?.type === "hold" || block?.id === "hold") return false;
    
    const idx = getBlockIndex(blockId);
    return idx < blocks.length - 1;
  };

  // Render blocks with proper layout
  const renderBlocks = () => {
    const result: React.ReactNode[] = [];
    let i = 0;
    
    // Get all cycle containers for the "Add to Cycle" dropdown
    const cycleContainers = blocks.filter(b => b.id.startsWith("cycle-container-"));
    
    while (i < blocks.length) {
      const block = blocks[i];
      
      // Check if this is a cycle container
      if (block.id.startsWith("cycle-container-")) {
        // Get the cycle container index to find its steps
        const containerIdx = block.cycleContainerIndex;
        
        // Get steps that belong to THIS cycle container
        const thisCycleSteps = blocks.filter(
          b => b.type === "cycle" && b.cycleIndex !== undefined && b.cycleContainerIndex === containerIdx
        );
        
        // Render cycle container with its steps
        result.push(
          <CycleContainer
            key={block.id}
            block={block}
            cycleSteps={thisCycleSteps}
            isEditing={isEditing}
            isErasing={isErasing}
            isCycleErasing={isCycleErasing}
            selectedBlockId={selectedBlockId}
            onErase={handleCycleErase}
            onEdit={handleEditBlock}
            onEditCycleRepeats={(repeats) => setEditingCycle({ index: containerIdx || 0, repeats })}
            onSelect={setSelectedBlockId}
            onMoveLeft={handleMoveLeft}
            onMoveRight={handleMoveRight}
            allBlocks={blocks}
            onRemoveFromCycle={handleRemoveFromCycle}
            onAddToCycle={handleAddToCycle}
            cycleContainers={cycleContainers}
          />
        );
        // Skip cycle steps (they're rendered inside the container)
        i += thisCycleSteps.length + 1;
      } else {
        // Render regular step
        result.push(
          <StepBlock
            key={block.id}
            block={block}
            isEditing={isEditing}
            isErasing={isErasing}
            isCycleErasing={isCycleErasing}
            isSelected={selectedBlockId === block.id}
            onErase={handleErase}
            onEdit={handleEditBlock}
            onSelect={setSelectedBlockId}
            onMoveLeft={handleMoveLeft}
            onMoveRight={handleMoveRight}
            canMoveLeft={canMoveBlockLeft(block.id)}
            canMoveRight={canMoveBlockRight(block.id)}
            onRemoveFromCycle={handleRemoveFromCycle}
            onAddToCycle={handleAddToCycle}
            cycleContainers={cycleContainers}
          />
        );
        i++;
      }
    }
    
    return result;
  };

  return (
    <div>
      <EditingToolbar
        isEditing={isEditing}
        isErasing={isErasing}
        isCycleErasing={isCycleErasing}
        onToggleEdit={() => {
          setIsEditing(!isEditing);
          setIsErasing(false);
          setIsCycleErasing(false);
          setSelectedBlockId(null);
        }}
        onToggleEraser={() => {
          setIsErasing(!isErasing);
          if (!isErasing) setIsCycleErasing(false); // Turn off cycle eraser when turning on gradient eraser
          setSelectedBlockId(null);
        }}
        onToggleCycleEraser={() => {
          setIsCycleErasing(!isCycleErasing);
          if (!isCycleErasing) setIsErasing(false); // Turn off gradient eraser when turning on cycle eraser
          setSelectedBlockId(null);
        }}
        onAddCycle={() => setAddingCycle(true)}
        onAddStep={() => setAddingStep(true)}
        onClearAll={handleClearAll}
      />
      
      {/* Instructions when editing */}
      {isEditing && (
        <div className="text-xs text-gray-500 mb-3 flex items-center gap-4 flex-wrap">
          <span>• Click to select, use arrows to move</span>
          <span>• Double-click to edit</span>
          {isErasing && <span className="text-red-500 font-medium">• Gradient Eraser: Click a block to erase it</span>}
          {isCycleErasing && <span className="text-purple-500 font-medium">• Cycle Eraser: Click a cycle badge to remove the cycle (keeps steps)</span>}
          {!isErasing && !isCycleErasing && <span>• Use "Remove from Cycle" to move a step out of a cycle</span>}
        </div>
      )}
      
      {/* Blocks display */}
      <div className="flex items-start gap-3 flex-wrap p-4 pt-6 bg-gray-50 rounded-lg min-h-[140px] pb-12">
        {renderBlocks()}
        
        {blocks.length === 0 && (
          <div className="text-sm text-gray-400 w-full text-center py-8">
            No steps yet. Use "Add Step" to begin.
          </div>
        )}
      </div>
      
      {/* Step edit popup */}
      {editingBlock && (
        <StepEditPopup
          step={editingBlock.step}
          onSave={handleSaveBlock}
          onClose={() => setEditingBlock(null)}
        />
      )}
      
      {/* Add step popup */}
      {addingStep && (
        <StepEditPopup
          step={{ name: "New Step", temperature: 60, duration: "30 sec" }}
          onSave={handleAddStep}
          onClose={() => setAddingStep(false)}
          isNew
        />
      )}
      
      {/* Cycle edit popup */}
      {editingCycle && (
        <CycleEditPopup
          repeats={editingCycle.repeats}
          onSave={handleCycleRepeatsChange}
          onClose={() => setEditingCycle(null)}
        />
      )}
      
      {/* Add cycle confirmation */}
      {addingCycle && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-72">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Add Empty Cycle
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Create a new empty thermal cycle? You can add steps to it by adding new steps and moving them into the cycle.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setAddingCycle(false)}
                className="flex-1 px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCycle}
                className="flex-1 px-4 py-2 text-sm text-white bg-purple-600 hover:bg-purple-700 rounded-lg"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
