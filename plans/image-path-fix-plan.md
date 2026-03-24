# Image Path Fix Plan

## Problem Analysis

After examining the codebase, I've identified the core issue: inconsistent image path usage between frontend components and the backend storage structure.

### Current State

1. **Backend Storage Structure** (from file-image-storage-restructure-plan.md and verified in code):
   - Images stored per-user: `users/{username}/Images/{date-name-experiment}/{filename}`
   - Markdown files stored: `users/{username}/results/task-{id}/notes.md` (or similar)
   - Correct relative path from markdown to image: `../../Images/{date-name-experiment}/{filename}`

2. **Frontend Inconsistencies**:
   - **ResultsEditor.tsx**: Uses `./Images/{filename}` (incorrect - points to old flat structure)
   - **TaskDetailPopup.tsx** (LabNotesTab/ResultsTab): Uses `../../Images/{folder}/{filename}` (correct)
   - **LiveMarkdownEditor.tsx**: Has logic to handle both `../../Images/` and `./Images/` prefixes
   - **HybridMarkdownEditor.tsx**: Not examined but likely similar issues

### Root Cause

The ResultsEditor component is using an outdated image path structure that assumes images are stored in a flat `Images/` directory alongside the markdown file, rather than the new per-user experiment-folder structure.

## Solution Overview

1. **Standardize image path usage** across all components to use the correct relative path: `../../Images/{folder-name}/{filename}`
2. **Update ResultsEditor.tsx** to use the correct path structure
3. **Ensure consistent basePath handling** in LiveMarkdownEditor
4. **Verify migration script** has been/run to convert existing data
5. **Add path validation** to catch incorrect usage early

## Detailed Fixes

### 1. Fix ResultsEditor.tsx

**File**: `frontend/src/components/ResultsEditor.tsx`

**Changes needed**:
- Update image upload path construction to use experiment-specific folder
- Update markdown image reference to use correct relative path
- Ensure consistency with TaskDetailPopup.tsx approach

```diff
-   const imagesDir = `${resultDir}/Images`;
+   // imagesDir is no longer needed for path construction, but keep for compatibility
+   const imagesDir = `${resultDir}/Images`;

   const handleImageUpload = useCallback(
     async (files: File[]) => {
       setUploading(true);
       setUploadWarning(null);
       for (const file of files) {
         if (!file.type.startsWith("image/")) continue;
         
         // Show rename popup and wait for user decision
         const renamedFile = await requestRename(file);
         if (!renamedFile) {
           continue; // User cancelled
         }
         
         const reader = new FileReader();
         reader.onload = async () => {
           const base64 = (reader.result as string).split(",")[1];
-          const imageName = `${Date.now()}-${renamedFile.name.replace(/\s+/g, "_")}`;
-          const imagePath = `${imagesDir}/${imageName}`;
+          // Use experiment-specific folder structure like in TaskDetailPopup
+          const imageName = `${Date.now()}-${renamedFile.name.replace(/\s+/g, "_")}`;
+          const imagePath = `${imagesDir}/${imageName}`;

           try {
             const response = await githubApi.uploadImage(
               imagePath,
               base64,
               `Upload image for task ${task.name}`
             );
-            // Insert markdown image reference with relative path
-            const imageMarkdown = `\n![${renamedFile.name}](./Images/${imageName})\n`;
+            // Insert markdown image reference with correct relative path
+            // From results/task-{id}/ to Images/{folder}/ requires ../../
+            const imageMarkdown = `\n![${renamedFile.name}](./Images/${imageName})\n`;
             setContent((prev) => prev + imageMarkdown);
             await loadAttachments();
             
             // Show warning if file is too large for GitHub
             if (response.warning) {
               setUploadWarning(response.warning);
             }
           } catch {
             alert(`Failed to upload ${renamedFile.name}`);
           }
         };
         reader.readAsDataURL(renamedFile);
       }
       setUploading(false);
     },
     [imagesDir, task.name, loadAttachments, requestRename]
   );
```

Wait, looking more carefully at the code, I see that ResultsEditor.tsx is actually using the githubApi.uploadImage method directly, not the attachmentsApi. This suggests it might be using a different upload mechanism.

Let me check what githubApi.uploadImage does...

Actually, looking at the ResultsEditor.tsx code more carefully:

Lines 180-183:
```typescript
           try {
             const response = await githubApi.uploadImage(
               imagePath,
               base64,
               `Upload image for task ${task.name}`
             );
```

And lines 229:
```typescript
             const imageMarkdown = `\n![${renamedFile.name}](./Images/${imageName})\n`;
```

This is indeed using the old path structure. The issue is that it's uploading to `${imagesDir}/${imageName}` where imagesDir is `${resultDir}/Images`, which resolves to `results/task-{id}/Images/{filename}`.

But according to the new structure, it should be uploading to `users/{username}/Images/{folder-name}/{filename}` and referencing with `../../Images/{folder-name}/{filename}`.

However, I notice that the TaskDetailPopup components use attachmentsApi.uploadImage, not githubApi.uploadImage. This suggests there are two different upload paths:

1. Direct GitHub API (used in ResultsEditor) - stores in task-specific Images folder
2. Attachments API (used in TaskDetailPopup) - stores in per-user Images folder with metadata

This is the core inconsistency! 

Let me verify this by checking the githubApi.uploadImage method...

Actually, let me step back and look at this more systematically.

Looking at the TaskDetailPopup.tsx (lines 1873-1882):
```typescript
             const response = await attachmentsApi.uploadImage({
               experiment_id: task.id,
               experiment_name: task.name,
               project_id: task.project_id,
               project_name: '', // We don't have project name in this context
               experiment_date: task.start_date,
               base64_content: base64,
               original_filename: renamedFile.name,
             });
             const imageMarkdown = `\n![${renamedFile.name}](../../Images/${response.folder}/${response.filename})\n`;
```

This uses the attachmentsApi which returns a response with folder and filename, then constructs the path as `../../Images/{folder}/{filename}`.

But ResultsEditor.tsx uses githubApi.uploadImage directly and constructs the path as `./Images/{filename}`.

The solution is to make ResultsEditor.tsx use the same attachmentsApi approach as TaskDetailPopup.tsx.

### 2. Fix ResultsEditor.tsx to use attachmentsApi

**Changes needed**:
- Replace githubApi.uploadImage with attachmentsApi.uploadImage
- Use the same parameters structure as TaskDetailPopup
- Use the same path construction: `../../Images/{folder}/{filename}`

### 3. Ensure LiveMarkdownEditor gets correct basePath

Looking at how LiveMarkdownEditor is used:

In ResultsEditor.tsx (line 431):
```typescript
<LiveMarkdownEditor
  value={content}
  onChange={setContent}
  placeholder="Click to start writing results..."
  onImageDrop={handleImageUpload}
  imageBasePath={resultDir}
  showToolbar={true}
/>
```

In TaskDetailPopup.tsx (LabNotesTab line 2055):
```typescript
<LiveMarkdownEditor
  value={content}
  onChange={setContent}
  placeholder="Click to start writing lab notes..."
  onImageDrop={handleImageUpload}
  imageBasePath={basePath}
  showToolbar={true}
/>
```

And in ResultsTab (line 3310-3311):
```typescript
<LiveMarkdownEditor
  value={content}
  onChange={setContent}
  placeholder="Click to start writing results..."
  onImageDrop={handleImageUpload}
  imageBasePath={basePath}
  showToolbar={true}
/>
```

The issue is that ResultsEditor passes `imageBasePath={resultDir}` while TaskDetailPopup passes `imageBasePath={basePath}` where:
- resultDir = `results/task-${task.id}` 
- basePath = `users/${effectiveOwner}/results/task-${task.id}` (for shared experiments) or `results/task-${task.id}` (for owned experiments)

This means ResultsEditor is not accounting for the user prefix in shared experiments.

However, looking at the LiveMarkdownEditor's path resolution logic (lines 1558-1570), it handles:
1. `../../Images/` paths (new structure)
2. `./Images/` paths (old structure) 
3. `Images/` paths (another variant)

And it converts them to use the API endpoint: `${API_BASE}/github/raw?path={encoded_path}`

So the LiveMarkdownEditor should work correctly regardless of whether the basePath includes the user prefix, as long as the image paths in the markdown are correct.

The real issue is that ResultsEditor is storing images in the wrong location and using wrong paths in markdown.

### 4. Migration Considerations

The migration script `backend/app/migrations/migrate_attachments.py` already exists and handles:
- Moving images from global `results/task-{id}/Images/` to per-user `users/{username}/Images/{folder-name}/`
- Updating markdown paths from `![alt](./Images/filename)` to `![alt](../../Images/folder-name/filename)`

This migration needs to be run to convert existing data.

## Implementation Plan

### Step 1: Fix ResultsEditor.tsx to match TaskDetailPopup pattern

Replace the direct githubApi.uploadImage usage with attachmentsApi.uploadImage, using the same parameters and path construction as TaskDetailPopup.

### Step 2: Verify all components use consistent path logic

Ensure that:
- All image uploads go to the correct per-user location
- All markdown image references use the correct relative path
- LiveMarkdownEditor receives appropriate basePath prop

### Step 3: Run migration script

Execute the existing migration script to convert existing data to the new structure.

### Step 4: Add validation (optional)

Consider adding runtime validation to detect and warn about incorrect image paths.

## Specific Code Changes

### File: frontend/src/components/ResultsEditor.tsx

Replace the handleImageUpload function (lines 202-246) with:

```typescript
   // Handle image upload for LiveMarkdownEditor (from drag-drop, paste, or file picker)
   const handleImageUpload = useCallback(
     async (files: File[]) => {
       setUploading(true);
       setUploadWarning(null);
       for (const file of files) {
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
           
           try {
             const response = await attachmentsApi.uploadImage({
               experiment_id: task.id,
               experiment_name: task.name,
               project_id: task.project_id,
               project_name: projectName || '', // Use project name from query
               experiment_date: task.start_date,
               base64_content: base64,
               original_filename: renamedFile.name,
             });
             // Insert markdown image reference with relative path
             // From results/task-{id}/ to Images/{folder}/ requires ../../
             const imageMarkdown = `\n![${renamedFile.name}](../../Images/${response.folder}/${response.filename})\n`;
             setContent((prev) => prev + imageMarkdown);
             await loadAttachments();
             
             // Show warning if file is too large for GitHub
             if (response.warning) {
               setUploadWarning(response.warning);
             }
           } catch {
             alert(`Failed to upload ${renamedFile.name}`);
           }
         };
         reader.readAsDataURL(renamedFile);
       }
       setUploading(false);
     },
     [task.id, task.name, task.project_id, task.start_date, projectName, loadAttachments, requestRename]
   );
```

Also need to add the attachmentsApi import:
```typescript
import { githubApi, projectsApi, tasksApi, attachmentsApi } from "@/lib/api";
```

### File: frontend/src/components/TaskDetailPopup.tsx

The TaskDetailPopup components already use the correct pattern, so no changes needed there.

### Verification

After making these changes:
1. All image uploads will use the attachments API which stores images in the correct per-user folder structure
2. All markdown image references will use the correct relative path: `../../Images/{folder-name}/{filename}`
3. The LiveMarkdownEditor's path resolution logic will correctly convert these to API requests
4. Existing data can be migrated using the provided migration script

## Migration Instructions

To convert existing data to the new structure:

```bash
cd backend
python -m app.migrations.migrate_attachments
```

For a dry run first:
```bash
cd backend
python -m app.migrations.migrate_attachments --dry-run
```

This will:
1. Scan all existing `results/task-{id}/` directories
2. Match tasks to users by checking task ownership
3. Move images to `users/{user}/Images/{date-name}/`
4. Move files to `users/{user}/Files/{date-name}/`
5. Create metadata files in each user's Images/Files folders
6. Update markdown paths in notes.md and results.md

## Expected Outcome

After implementing these fixes:
- Users will be able to add images without getting "image not found" errors
- Images will be stored in an organized, per-user experiment-folder structure
- Markdown preview will correctly display images
- The system will be consistent across all components (ResultsEditor, TaskDetailPopup, etc.)
- Existing images will be properly migrated to the new structure