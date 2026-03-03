"use client";

import { useState, useRef } from "react";
import { useAppStore } from "@/lib/store";
import { ANIMATION_METADATA, AnimationType } from "./animations";
import DynamicAnimation from "./DynamicAnimation";

interface AnimationSettingsPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AnimationSettingsPopup({
  isOpen,
  onClose,
}: AnimationSettingsPopupProps) {
  const animationType = useAppStore((s) => s.animationType);
  const setAnimationType = useAppStore((s) => s.setAnimationType);
  const [previewAnimation, setPreviewAnimation] = useState<{ type: AnimationType; x: number; y: number } | null>(null);
  // Use a ref to track if we're currently showing a preview animation
  // This prevents re-triggering while an animation is playing
  const isShowingPreviewRef = useRef(false);

  if (!isOpen) return null;

  const handleSelectAnimation = (type: AnimationType, event: React.MouseEvent<HTMLButtonElement>) => {
    // Don't trigger if already showing a preview animation or if same type
    if (isShowingPreviewRef.current) return;
    if (type === animationType) return;
    
    isShowingPreviewRef.current = true;
    setAnimationType(type);
    // Show a preview animation at the clicked button position
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setPreviewAnimation({ type, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            Animation Settings
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg"
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          Choose an animation style for task completions:
        </p>

        {/* Current selection display */}
        <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-3 mb-4 flex items-center gap-3">
          <span className="text-2xl">{ANIMATION_METADATA[animationType].icon}</span>
          <div>
            <p className="text-sm font-medium text-gray-800">{ANIMATION_METADATA[animationType].name}</p>
            <p className="text-xs text-gray-500">{ANIMATION_METADATA[animationType].description}</p>
          </div>
        </div>

        {/* Animation grid */}
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(ANIMATION_METADATA) as AnimationType[]).map((type) => {
            const meta = ANIMATION_METADATA[type];
            const isSelected = animationType === type;
            
            return (
              <button
                key={type}
                onClick={(e) => handleSelectAnimation(type, e)}
                className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                  isSelected
                    ? "border-purple-400 bg-purple-50 shadow-sm"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <span className="text-xl">{meta.icon}</span>
                <div className="text-left">
                  <p className={`text-sm font-medium ${isSelected ? "text-purple-700" : "text-gray-700"}`}>
                    {meta.name}
                  </p>
                  <p className="text-xs text-gray-400 truncate max-w-[120px]">
                    {meta.description}
                  </p>
                </div>
                {isSelected && (
                  <svg className="w-4 h-4 text-purple-500 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white bg-purple-600 hover:bg-purple-700 rounded-lg"
          >
            Done
          </button>
        </div>
      </div>

      {/* Preview animation when selecting a new type */}
      {previewAnimation && (
        <DynamicAnimation
          type={previewAnimation.type}
          x={previewAnimation.x}
          y={previewAnimation.y}
          onComplete={() => {
            setPreviewAnimation(null);
            isShowingPreviewRef.current = false;
          }}
        />
      )}
    </div>
  );
}
