# Hybrid Markdown Editor Cursor Bug Fix Plan

## Problem Statement

The hybrid mode in the Live Markdown Editor has two critical bugs:

1. **Cursor Removal Bug**: Every time the user types in a box, the cursor is removed
2. **New Entry Bug**: When making a new entry in a note, users cannot add anything to the page while in edit mode

## Root Cause Analysis

### Bug 1: Cursor Removal When Typing

**Location**: [`HybridMarkdownEditor.tsx`](../frontend/src/components/HybridMarkdownEditor.tsx) - `renderBlock` function

**Root Cause**: The `key` prop for each block uses `block.id`:

```tsx
<div key={block.id} ...>
```

The block ID is generated using a content hash (see [`generateBlockId`](../frontend/src/lib/markdown-block-parser.ts:70)):

```typescript
function generateBlockId(content: string, startLine: number): string {
  const contentPreview = content.slice(0, 100);
  const contentHash = hashString(contentPreview);
  return `block-${startLine}-${contentHash}`;
}
```

When the user types, the content changes, which changes the hash, which changes the block ID. React sees a new key and unmounts the old textarea, mounting a new one. This causes:
- Loss of focus
- Loss of cursor position
- The cursor removal behavior the user experiences

### Bug 2: Cannot Add Content to New/Empty Notes

**Location**: [`HybridMarkdownEditor.tsx`](../frontend/src/components/HybridMarkdownEditor.tsx) - `handleEditChange` function

**Root Cause**: When editing an empty document:

1. `blocks` array is empty (no blocks to render)
2. User clicks to start editing, setting `editingBlockOffset` to 0
3. `editingBlock` is computed as `null` because no block exists at offset 0
4. In `handleEditChange`:

```typescript
if (editingBlock) {
  const newFullContent = updateBlockContent(value, editingBlock, newContent);
  onChange(newFullContent);
}
```

Since `editingBlock` is `null`, `onChange` is never called, and the content is never saved.

## Solution

### Fix 1: Use Stable Keys for Blocks

Change the `key` prop from `block.id` to `block.startOffset`:

```tsx
// Before
<div key={block.id} ...>

// After
<div key={`block-${block.startOffset}`} ...>
```

The `startOffset` is stable during editing because:
- It represents the character position where the block starts
- It only changes when content is added/removed BEFORE this block
- During editing of a block, its own startOffset remains constant

### Fix 2: Handle Empty Document Editing

When `editingBlock` is null but we're in editing mode, we need to handle the content update differently:

```typescript
const handleEditChange = useCallback(
  (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    // ... existing code for language selector ...
    
    setEditingBlockContent(newContent);
    
    if (editingBlock) {
      // Normal case: update existing block
      const newFullContent = updateBlockContent(value, editingBlock, newContent);
      onChange(newFullContent);
    } else if (editingBlockOffset !== null) {
      // Edge case: editing a non-existent block (empty document or new block)
      // Just use the content directly
      onChange(newContent);
    }
  },
  [value, onChange, editingBlock, editingBlockOffset]
);
```

Additionally, for the empty document case, we need to ensure the placeholder click handler properly initializes the editing state:

```tsx
// When clicking on empty document placeholder
onClick={() => {
  if (!disabled) {
    isEditingRef.current = true;
    setEditingBlockOffset(0);
    setEditingBlockContent("");
    setEditCursorPosition(0);
  }
}}
```

## Implementation Steps

1. **Fix the key stability issue**:
   - In `renderBlock`, change `key={block.id}` to `key={block-startOffset}`
   - This prevents React from remounting the textarea on every keystroke

2. **Fix the empty document editing**:
   - In `handleEditChange`, add a fallback for when `editingBlock` is null
   - When `editingBlockOffset` is set but `editingBlock` is null, call `onChange(newContent)` directly

3. **Test the fixes**:
   - Test typing in existing blocks (cursor should stay in place)
   - Test creating new notes and adding content
   - Test adding new paragraphs to existing notes

## Files to Modify

- [`frontend/src/components/HybridMarkdownEditor.tsx`](../frontend/src/components/HybridMarkdownEditor.tsx)
  - Line ~943: Change key prop in renderBlock
  - Line ~575: Add fallback in handleEditChange for null editingBlock

## Testing Checklist

- [ ] Type in an existing block - cursor should remain in place
- [ ] Create a new note and add content - should work
- [ ] Add a new paragraph to an existing note - should work
- [ ] Test keyboard shortcuts - should still work
- [ ] Test language selector for code blocks - should still work
- [ ] Test clicking outside to exit edit mode - should still work
