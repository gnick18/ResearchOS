/**
 * Stamp utilities for markdown files.
 * 
 * Stamps are locked regions at the top of lab notes and results files
 * that contain date, time, experiment name, and project folder.
 * 
 * Format:
 * [stamp-start]: # (hidden)
 * 2026-02-15
 * 12:07 PM
 * experiment: Western Blot Analysis
 * project folder: Protein Research
 * [stamp-end]: # (hidden)
 * ___
 * 
 * Reopened tracking:
 * [last-access]: # (2026-02-15T12:07:00Z)
 * ___
 * *Reopened on 2026-02-16 at 2:30 PM*
 * ___
 */

// 12 hours in milliseconds
const REOPEN_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export interface StampData {
  date: string;
  time: string;
  experimentName: string;
  projectFolder: string;
}

export interface ParsedContent {
  stamp: StampData | null;
  lastAccess: string | null;
  reopenedStamps: string[]; // Raw markdown lines for reopened stamps
  content: string; // User content (without stamp and reopened markers)
}

/**
 * Generate a new stamp block with current date/time
 * Uses markdown line breaks (two trailing spaces) for proper rendering
 */
export function generateStamp(experimentName: string, projectFolder: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  return `[stamp-start]: # (hidden)
${dateStr}  
${timeStr}  
experiment: ${experimentName}  
project folder: ${projectFolder}  
[stamp-end]: # (hidden)
___`;
}

/**
 * Generate last access timestamp comment
 */
export function generateLastAccess(): string {
  const now = new Date().toISOString();
  return `[last-access]: # (${now})`;
}

/**
 * Generate a reopened stamp
 */
export function generateReopenedStamp(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-CA');
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  return `___
*Reopened on ${dateStr} at ${timeStr}*
___`;
}

/**
 * Parse stamp data from markdown content
 * Supports [stamp-start]: #, [//]: # (STAMP_START), and <!-- STAMP_START --> formats
 */
export function parseStamp(content: string): StampData | null {
  // Try unique identifier format first, then [//]: # format, then HTML comment format
  const stampMatch = content.match(/\[stamp-start\]: # \([^)]*\)([\s\S]*?)\[stamp-end\]: # \([^)]*\)/) ||
                     content.match(/\[\/\/\]: # \(STAMP_START\)([\s\S]*?)\[\/\/\]: # \(STAMP_END\)/) ||
                     content.match(/<!-- STAMP_START -->([\s\S]*?)<!-- STAMP_END -->/);
  if (!stampMatch) return null;

  const stampContent = stampMatch[1].trim();
  const lines = stampContent.split('\n').map(l => l.trim()).filter(Boolean);

  if (lines.length < 4) return null;

  // Parse experiment and project folder from lines
  let experimentName = '';
  let projectFolder = '';

  for (const line of lines) {
    if (line.startsWith('experiment:')) {
      experimentName = line.replace('experiment:', '').trim();
    } else if (line.startsWith('project folder:')) {
      projectFolder = line.replace('project folder:', '').trim();
    }
  }

  return {
    date: lines[0] || '',
    time: lines[1] || '',
    experimentName,
    projectFolder
  };
}

/**
 * Parse last access timestamp from content
 * Supports [last-access]: #, [//]: # (LAST_ACCESS: ...), and <!-- LAST_ACCESS: ... --> formats
 */
export function parseLastAccess(content: string): string | null {
  // Try unique identifier format first, then [//]: # format, then HTML comment format
  const match = content.match(/\[last-access\]: # \(([^)]+)\)/) ||
                content.match(/\[\/\/\]: # \(LAST_ACCESS: ([^)]+)\)/) ||
                content.match(/<!-- LAST_ACCESS: ([^>]+) -->/);
  return match ? match[1] : null;
}

/**
 * Check if file was reopened after threshold (12 hours)
 */
export function shouldAddReopenedStamp(content: string): boolean {
  const lastAccessStr = parseLastAccess(content);
  if (!lastAccessStr) return false;

  try {
    const lastAccess = new Date(lastAccessStr);
    const now = new Date();
    const diffMs = now.getTime() - lastAccess.getTime();
    return diffMs > REOPEN_THRESHOLD_MS;
  } catch {
    return false;
  }
}

/**
 * Parse full content including stamp, reopened stamps, and user content
 */
export function parseContent(content: string): ParsedContent {
  const stamp = parseStamp(content);
  const lastAccess = parseLastAccess(content);

  // Extract reopened stamps (___\n*Reopened on...*\n___)
  const reopenedRegex = /___\s*\n\*Reopened on[^*]+\*\s*\n___/g;
  const reopenedStamps: string[] = [];
  let match;
  while ((match = reopenedRegex.exec(content)) !== null) {
    reopenedStamps.push(match[0]);
  }

  // Remove stamp block, last access, and reopened stamps to get user content
  // Supports all three formats: [stamp-start]: #, [//]: # (STAMP_START), and <!-- STAMP_START -->
  let userContent = content
    .replace(/\[stamp-start\]: # \([^)]*\)[\s\S]*?\[stamp-end\]: # \([^)]*\)\s*___\s*\n?/g, '')
    .replace(/\[\/\/\]: # \(STAMP_START\)[\s\S]*?\[\/\/\]: # \(STAMP_END\)\s*___\s*\n?/g, '')
    .replace(/<!-- STAMP_START -->[\s\S]*?<!-- STAMP_END -->\s*___\s*\n?/g, '')
    .replace(/\[last-access\]: # \([^)]+\)\s*\n?/g, '')
    .replace(/\[\/\/\]: # \(LAST_ACCESS: [^)]+\)\s*\n?/g, '')
    .replace(/<!-- LAST_ACCESS: [^>]+ -->\s*\n?/g, '')
    .replace(/___\s*\n\*Reopened on[^*]+\*\s*\n___/g, '')
    .trim();

  return {
    stamp,
    lastAccess,
    reopenedStamps,
    content: userContent
  };
}

/**
 * Update stamp with new experiment/project names (keeps date/time)
 * Supports [stamp-start]: #, [//]: # (STAMP_START), and <!-- STAMP_START --> formats
 */
export function updateStampNames(content: string, experimentName: string, projectFolder: string): string {
  // Try unique identifier format first, then [//]: # format, then HTML comment format
  const stampMatch = content.match(/(\[stamp-start\]: # \([^)]*\)[\s\S]*?\[stamp-end\]: # \([^)]*\))/) ||
                     content.match(/(\[\/\/\]: # \(STAMP_START\)[\s\S]*?\[\/\/\]: # \(STAMP_END\))/) ||
                     content.match(/(<!-- STAMP_START -->[\s\S]*?<!-- STAMP_END -->)/);
  if (!stampMatch) return content;

  const stampContent = stampMatch[1];
  const lines = stampContent.split('\n');

  // Update experiment and project folder lines
  const updatedLines = lines.map(line => {
    if (line.trim().startsWith('experiment:')) {
      return `experiment: ${experimentName}`;
    }
    if (line.trim().startsWith('project folder:')) {
      return `project folder: ${projectFolder}`;
    }
    return line;
  });

  const updatedStamp = updatedLines.join('\n');
  return content.replace(stampMatch[1], updatedStamp);
}

/**
 * Update last access timestamp
 * Uses new [last-access]: # format, but supports removing old formats
 */
export function updateLastAccess(content: string): string {
  const now = new Date().toISOString();
  const newLastAccess = `[last-access]: # (${now})`;

  // Remove existing last access (all formats)
  let updated = content
    .replace(/\[last-access\]: # \([^)]+\)\s*\n?/g, '')
    .replace(/\[\/\/\]: # \(LAST_ACCESS: [^)]+\)\s*\n?/g, '')
    .replace(/<!-- LAST_ACCESS: [^>]+ -->\s*\n?/g, '');

  // Add new last access after the stamp (before the first reopened or user content)
  // Try unique identifier format first, then [//]: # format, then HTML comment format
  const stampEndMatch = updated.match(/(\[stamp-end\]: # \([^)]*\)\s*___\s*\n)/) ||
                        updated.match(/(\[\/\/\]: # \(STAMP_END\)\s*___\s*\n)/) ||
                        updated.match(/(<!-- STAMP_END -->\s*___\s*\n)/);
  if (stampEndMatch) {
    updated = updated.replace(stampEndMatch[1], stampEndMatch[1] + newLastAccess + '\n');
  } else {
    // No stamp, add at the beginning
    updated = newLastAccess + '\n' + updated;
  }

  return updated;
}

/**
 * Add reopened stamp to content
 * Supports [stamp-start]: #, [//]: # (STAMP_START), and <!-- STAMP_START --> formats
 */
export function addReopenedStamp(content: string): string {
  const reopenedStamp = generateReopenedStamp();

  // Find where to insert (after last access, before user content)
  // Try unique identifier format first, then [//]: # format, then HTML comment format
  const lastAccessMatch = content.match(/\[last-access\]: # \([^)]+\)\s*\n/) ||
                          content.match(/\[\/\/\]: # \(LAST_ACCESS: [^)]+\)\s*\n/) ||
                          content.match(/<!-- LAST_ACCESS: [^>]+ -->\s*\n/);

  if (lastAccessMatch) {
    // Insert after last access
    return content.replace(lastAccessMatch[0], lastAccessMatch[0] + reopenedStamp + '\n');
  }

  // No last access, insert after stamp
  const stampEndMatch = content.match(/(\[stamp-end\]: # \([^)]*\)\s*___\s*\n)/) ||
                        content.match(/(\[\/\/\]: # \(STAMP_END\)\s*___\s*\n)/) ||
                        content.match(/(<!-- STAMP_END -->\s*___\s*\n)/);
  if (stampEndMatch) {
    return content.replace(stampEndMatch[1], stampEndMatch[1] + reopenedStamp + '\n');
  }

  // No stamp, insert at beginning
  return reopenedStamp + '\n' + content;
}

/**
 * Create new file content with stamp and last access
 */
export function createNewFileContent(experimentName: string, projectFolder: string, type: 'notes' | 'results' = 'notes'): string {
  const stamp = generateStamp(experimentName, projectFolder);
  const lastAccess = generateLastAccess();
  const header = type === 'notes' 
    ? `# Lab Notes: ${experimentName}` 
    : `# Results: ${experimentName}`;

  return `${stamp}
${lastAccess}

${header}
`;
}

/**
 * Render stamp for display (with current experiment/project names)
 * Uses markdown line breaks (two trailing spaces) for proper rendering
 */
export function renderStampDisplay(stamp: StampData, currentExperimentName: string, currentProjectFolder: string, type: 'notes' | 'results' = 'notes'): string {
  const header = type === 'notes' 
    ? `# Lab Notes: ${currentExperimentName}` 
    : `# Results: ${currentExperimentName}`;
  
  return `${stamp.date}  
${stamp.time}  
experiment: ${currentExperimentName}  
project folder: ${currentProjectFolder}  
___
${header}`;
}
