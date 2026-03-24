# Image Path Fix Implementation Plan

## Problem Summary
The ResultsEditor component uses an outdated image upload mechanism that stores images in the wrong location and references them with incorrect paths, causing "image not found" errors.

## Root Cause
- ResultsEditor.tsx uses `githubApi.uploadImage` directly with path `results/task-{id}/Images/{filename}`
- Should use `attachmentsApi.uploadImage` with per-user folder structure `users/{username}/Images/{date-name-experiment}/{filename}`
- Markdown references should be `../../Images/{folder-name}/{filename}` not `./Images/{filename}`

## Solution
Update ResultsEditor.tsx to match the pattern used in TaskDetailPopup components (LabNotesTab and ResultsTab).

## Implementation Steps

### 1. Update ResultsEditor.tsx
- Replace githubApi.uploadImage with attachmentsApi.uploadImage
- Use correct parameters matching TaskDetailPopup pattern
- Update markdown path construction to use `../../Images/{folder}/{filename}`

### 2. Verify Import
- Add attachmentsApi import if not present

### 3. Test the Fix
- Verify images upload correctly to new location
- Verify markdown displays images properly
- Verify existing functionality still works

## Files to Modify
- frontend/src/components/ResultsEditor.tsx

## Expected Outcome
- Consistent image storage across all components
- No more "image not found" errors when adding images
- Proper organization of images per-user per-experiment