# Resize Image Button Improvements Plan

## Overview
Improve the UX of the "Resize Image" button in `LiveMarkdownEditor.tsx` by making it visually indicate when it can be used and providing helpful feedback when it cannot.

## Current Behavior
- The "Resize Image" button is always clickable
- When clicked, it shows a dropdown with percentage options (25%, 50%, 75%, 100%)
- Only after selecting a percentage does it check if valid text is selected
- If no valid selection, it shows an alert: "Please select an image in the editor first."

## Desired Behavior
1. **Greyed out (disabled appearance)** when no valid image is selected
2. **Blue (active appearance)** when a valid image link/HTML is selected
3. **Popup/tooltip** when clicking the disabled button explaining what to do
4. **Dropdown** works normally when button is enabled

## Implementation Plan

### 1. Add Selection Tracking State
```typescript
const [selectedImageText, setSelectedImageText] = useState<string | null>(null);
const [showDisabledPopup, setShowDisabledPopup] = useState(false);
```

### 2. Create Validation Function
```typescript
/**
 * Check if the selected text is a valid image reference.
 * Valid formats:
 * - Markdown image: ![alt](src)
 * - HTML image: <img src="..." />
 * - Plain URL/path (ending with common image extensions or just a path)
 */
function isValidImageSelection(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  
  // Check for markdown image syntax
  if (MARKDOWN_IMAGE_REGEX.test(trimmed)) return true;
  
  // Check for HTML image syntax
  if (HTML_IMAGE_REGEX.test(trimmed)) return true;
  
  // Check for common image extensions or data repo paths
  const imageExtensions = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i;
  if (imageExtensions.test(trimmed) || trimmed.startsWith('./') || trimmed.startsWith('/')) {
    return true;
  }
  
  return false;
}
```

### 3. Track Selection Changes
Add a `onSelect` event handler to the textarea to track selection changes:
```typescript
const handleSelectionChange = useCallback(() => {
  const textarea = textareaRef.current;
  if (!textarea) {
    setSelectedImageText(null);
    return;
  }
  
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = value.substring(start, end);
  
  if (isValidImageSelection(selectedText)) {
    setSelectedImageText(selectedText);
  } else {
    setSelectedImageText(null);
  }
}, [value]);
```

### 4. Update Button Styling
```tsx
<button
  type="button"
  onClick={() => {
    if (selectedImageText) {
      setShowResizeDropdown(!showResizeDropdown);
    } else {
      setShowDisabledPopup(true);
      setTimeout(() => setShowDisabledPopup(false), 3000);
    }
  }}
  disabled={disabled}
  className={`px-2.5 py-1 text-xs rounded transition-colors ${
    selectedImageText
      ? "bg-blue-100 text-blue-700 font-medium hover:bg-blue-200"
      : "bg-gray-100 text-gray-400 cursor-not-allowed"
  } disabled:opacity-50`}
  title={selectedImageText 
    ? "Choose a size percentage for the selected image" 
    : "Select an image path or markdown image syntax first"
  }
>
  Resize Image
</button>
```

### 5. Add Disabled Popup
```tsx
{showDisabledPopup && (
  <div className="absolute top-full left-0 mt-1 bg-amber-50 border border-amber-200 rounded-md shadow-lg z-10 p-3 max-w-[250px]">
    <p className="text-xs text-amber-800">
      <strong>How to use:</strong> Select all the text of an image link (like <code className="bg-amber-100 px-1 rounded">![alt](path)</code>) or HTML image tag, then click Resize Image.
    </p>
  </div>
)}
```

### 6. Update handleResizeImage
Since we now track valid selections, the function can be simplified:
```typescript
const handleResizeImage = useCallback(
  (percentage: number) => {
    const textarea = textareaRef.current;
    if (!textarea || !selectedImageText) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    // ... rest of the resize logic remains the same
    
    setShowResizeDropdown(false);
    setSelectedImageText(null); // Clear selection state after resize
  },
  [value, onChange, selectedImageText]
);
```

## Files to Modify
- `frontend/src/components/LiveMarkdownEditor.tsx`

## Testing Checklist
- [ ] Button appears greyed out when no text is selected
- [ ] Button appears greyed out when non-image text is selected
- [ ] Button turns blue when markdown image syntax is selected (`![alt](src)`)
- [ ] Button turns blue when HTML image tag is selected
- [ ] Button turns blue when a plain image path is selected
- [ ] Clicking greyed out button shows helpful popup
- [ ] Popup auto-dismisses after 3 seconds
- [ ] Clicking blue button shows dropdown with percentage options
- [ ] Selecting percentage correctly resizes the image
- [ ] Button returns to greyed out after resize (since selection changes)

## Edge Cases to Consider
1. **Partial selection**: User selects only part of an image tag - should this be valid?
   - Decision: No, require full image syntax selection for clarity
   
2. **Multiple images**: User selects text containing multiple images
   - Decision: Only the first matched image will be resized (current behavior)

3. **Preview mode**: What happens when in preview mode?
   - Decision: Button should be disabled in preview mode (already handled by `disabled` prop)

4. **Selection outside textarea**: User has focus elsewhere
   - Decision: Use document-level selection change event or only track textarea focus
