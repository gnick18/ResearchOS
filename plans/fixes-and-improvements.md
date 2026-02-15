# Fixes and Improvements Plan

## 1. Dependency System Fixes

### 409 Error on Drag-and-Drop
- The `handleCreateDependency` in GanttChart.tsx is trying to create a dependency that already exists
- Fix: Check if dependency exists before creating, or use a PUT/upsert approach
- Also need to handle the case where the backend returns 409 gracefully

### Dependency Chain Auto-Reorder Logic
- When a task in a chain A→B→C is moved, all related dependencies should update
- If C is moved before B: auto-restructure to A→C→B
- If C overlaps with B: make A the parent of both B and C (parallel)
- This requires backend logic changes in `shift.py` and frontend handling

## 2. Gantt Chart Improvements

### Empty Week Whitespace
- Add minimum height to weeks with no tasks so users can double-click to create
- Change from conditional rendering to always showing a clickable area

## 3. Markdown Rendering Fixes

### Issues
- Headings (#, ##) not rendering
- Numbered lists (1.) not rendering correctly
- Line spacing too tight

### Fixes
- The LiveMarkdownEditor renders each line independently, which breaks multi-line markdown constructs
- Need to render blocks of related lines together (headings, lists, paragraphs)
- Add `leading-relaxed` (1.625) or custom `line-height: 1.2` to prose styles
- Consider using a block-based approach instead of line-by-line

## 4. Image Clipboard Paste Support

### All Markdown Editors Need
- `onPaste` event handler that checks for image data in clipboard
- Convert clipboard image to base64
- Upload to data repo via `githubApi.uploadImage`
- Insert `![image](./Images/filename)` at cursor position
- Applies to: LiveMarkdownEditor, method editor, results editor, lab notes editor

## 5. Method Page Improvements

### Category Change After Creation
- Add folder_path editing to the method viewer/editor modal
- Allow updating via API

### Remove Emojis
- Remove 📝, 📄, 📁 emojis from method cards and headers

### Drag-and-Drop Category Reassignment
- Make method cards draggable
- Make category headers droppable
- On drop, update the method's folder_path

### Linked Experiments Sidebar
- When viewing a method, show a sidebar listing all tasks where method_id matches
- Query tasks store filtered by method_id
- Add new backend endpoint: `GET /tasks/by-method/{method_id}`
