/**
 * Export utilities for experiments.
 * 
 * Supports exporting experiment content (lab notes, method, results) to:
 * - Markdown files (with ZIP if PDF attachments exist)
 * - PDF files (with merged PDF attachments)
 * 
 * Content that only contains default stamps (no user content) is skipped.
 */

import { parseContent } from './stamp-utils';
import type { Task, Method, MethodAttachment } from './types';

// Dynamic imports for PDF libraries (to avoid SSR issues)
let jspdf: typeof import('jspdf') | null = null;
let html2canvas: typeof import('html2canvas') | null = null;
let pdfLib: typeof import('pdf-lib') | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let jszipConstructor: any = null;

async function loadPdfLibraries() {
  if (!jspdf) {
    jspdf = await import('jspdf');
  }
  if (!html2canvas) {
    html2canvas = await import('html2canvas');
  }
  return { jsPDF: jspdf.jsPDF, html2canvas: html2canvas.default };
}

async function loadPdfLib() {
  if (!pdfLib) {
    pdfLib = await import('pdf-lib');
  }
  return pdfLib;
}

async function loadJsZip() {
  if (!jszipConstructor) {
    const module = await import('jszip');
    jszipConstructor = module.default;
  }
  return jszipConstructor;
}

// ---------------------------------------------------------------------------
// Content Analysis
// ---------------------------------------------------------------------------

/**
 * Check if content is empty (only contains stamp/header, no user content)
 */
export function hasUserContent(content: string): boolean {
  if (!content || !content.trim()) return false;
  
  const parsed = parseContent(content);
  
  // Check if there's any user content after removing stamps
  const userContent = parsed.content.trim();
  
  if (!userContent) return false;
  
  // Check if the content is just a header like "# Lab Notes: ..." or "# Results: ..."
  const headerOnlyPattern = /^#\s+(Lab Notes|Results):\s+.+\s*$/i;
  if (headerOnlyPattern.test(userContent.trim())) return false;
  
  return true;
}

/**
 * Extract user content from markdown (removes stamp metadata)
 */
export function extractUserContent(content: string): string {
  if (!content) return '';
  
  const parsed = parseContent(content);
  return parsed.content.trim();
}

// ---------------------------------------------------------------------------
// Export Data Types
// ---------------------------------------------------------------------------

/**
 * PDF attachment data with binary content for export
 */
export interface PdfAttachmentData {
  filename: string;
  originalPath: string;
  data: ArrayBuffer;
  methodId: number;
  methodName: string;
  order: number;
}

export interface ExperimentExportData {
  task: Task;
  projectName: string;
  labNotes: string | null;
  method: Method | null;
  methodContent: string | null;
  results: string | null;
  pdfAttachments: string[]; // Paths to PDF files in NotesPDFs/ResultsPDFs
  methodPdfs?: PdfAttachmentData[]; // PDF method attachments with binary data (optional for backward compatibility)
}

export interface ExportOptions {
  format: 'markdown' | 'pdf';
  includeLabNotes: boolean;
  includeMethod: boolean;
  includeResults: boolean;
  includeAttachments: boolean;
}

// ---------------------------------------------------------------------------
// Markdown Export
// ---------------------------------------------------------------------------

/**
 * Generate markdown for a single experiment
 */
export function generateExperimentMarkdown(data: ExperimentExportData, options: ExportOptions): string {
  const sections: string[] = [];
  
  // Header
  sections.push(`# ${data.task.name}`);
  sections.push('');
  sections.push(`**Project:** ${data.projectName}`);
  sections.push(`**Date Range:** ${data.task.start_date} to ${data.task.end_date}`);
  sections.push(`**Duration:** ${data.task.duration_days} day${data.task.duration_days !== 1 ? 's' : ''}`);
  sections.push(`**Status:** ${data.task.is_complete ? 'Complete' : 'In Progress'}`);
  sections.push('');
  
  // Lab Notes
  if (options.includeLabNotes && data.labNotes && hasUserContent(data.labNotes)) {
    sections.push('---');
    sections.push('');
    sections.push('## Lab Notes');
    sections.push('');
    const userContent = extractUserContent(data.labNotes);
    if (userContent) {
      sections.push(userContent);
      sections.push('');
    }
  }
  
  // Method
  if (options.includeMethod && data.method) {
    sections.push('---');
    sections.push('');
    sections.push(`## Method: ${data.method.name}`);
    sections.push('');
    
    // Method content (markdown)
    if (data.methodContent && hasUserContent(data.methodContent)) {
      sections.push(extractUserContent(data.methodContent));
      sections.push('');
    }
    
    // Method PDFs - add links
    if (data.methodPdfs && data.methodPdfs.length > 0) {
      sections.push('');
      sections.push('### Attached PDF Methods');
      sections.push('');
      // Sort by order
      const sortedPdfs = [...data.methodPdfs].sort((a, b) => a.order - b.order);
      for (const pdf of sortedPdfs) {
        sections.push(`- [${pdf.methodName} (${pdf.filename})](attachments/${pdf.filename})`);
      }
      sections.push('');
    }
  }
  
  // Results
  if (options.includeResults && data.results && hasUserContent(data.results)) {
    sections.push('---');
    sections.push('');
    sections.push('## Results');
    sections.push('');
    const userContent = extractUserContent(data.results);
    if (userContent) {
      sections.push(userContent);
      sections.push('');
    }
  }
  
  // PDF Attachments (from NotesPDFs/ResultsPDFs)
  if (options.includeAttachments && data.pdfAttachments.length > 0) {
    sections.push('---');
    sections.push('');
    sections.push('## Attached Files');
    sections.push('');
    data.pdfAttachments.forEach(path => {
      const filename = path.split('/').pop() || path;
      sections.push(`- [${filename}](${path})`);
    });
    sections.push('');
  }
  
  return sections.join('\n');
}

/**
 * Generate combined markdown for multiple experiments
 */
export function generateCombinedMarkdown(
  experiments: ExperimentExportData[],
  options: ExportOptions
): string {
  const sections: string[] = [];
  
  // Document header
  sections.push('# Exported Experiments');
  sections.push('');
  sections.push(`*Exported on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}*`);
  sections.push('');
  sections.push(`**Total experiments:** ${experiments.length}`);
  sections.push('');
  sections.push('---');
  sections.push('');
  
  // Each experiment
  experiments.forEach((exp, index) => {
    sections.push(generateExperimentMarkdown(exp, options));
    if (index < experiments.length - 1) {
      sections.push('');
      sections.push('---');
      sections.push('');
    }
  });
  
  return sections.join('\n');
}

/**
 * Download a markdown file
 */
export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.md') ? filename : `${filename}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Create and download a ZIP file containing markdown and PDF attachments
 */
export async function downloadMarkdownWithAttachments(
  markdownContent: string,
  filename: string,
  methodPdfs: PdfAttachmentData[]
): Promise<void> {
  const JSZip = await loadJsZip();
  const zip = new JSZip();
  
  // Update markdown to reference local PDF files
  let updatedMarkdown = markdownContent;
  
  // Add PDF files to zip and update links
  const attachmentsFolder = zip.folder('attachments');
  
  // Sort PDFs by order
  const sortedPdfs = [...methodPdfs].sort((a, b) => a.order - b.order);
  
  for (const pdf of sortedPdfs) {
    // Add PDF to attachments folder
    attachmentsFolder?.file(pdf.filename, pdf.data);
    
    // Update any references in markdown to point to local attachments
    // Replace full path references with local attachments path
    const pathPatterns = [
      new RegExp(`\\[${pdf.originalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\([^)]+\\)`, 'g'),
      new RegExp(`\\[${pdf.methodName}[^\\]]*\\]\\([^)]*${pdf.originalPath.split('/').pop()?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^)]*\\)`, 'gi'),
    ];
    
    for (const pattern of pathPatterns) {
      updatedMarkdown = updatedMarkdown.replace(pattern, `[${pdf.methodName} (${pdf.filename})](attachments/${pdf.filename})`);
    }
  }
  
  // Add the updated markdown file
  zip.file(filename.endsWith('.md') ? filename : `${filename}.md`, updatedMarkdown);
  
  // Generate and download the ZIP
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/\.md$/, '.zip');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// PDF Export
// ---------------------------------------------------------------------------

/**
 * Convert markdown HTML to PDF using jspdf + html2canvas
 */
export async function generatePdfFromHtml(
  htmlElement: HTMLElement,
  filename: string
): Promise<Uint8Array> {
  const { jsPDF, html2canvas: h2c } = await loadPdfLibraries();
  
  // Render HTML to canvas
  const canvas = await h2c(htmlElement, {
    scale: 2, // Higher resolution
    useCORS: true, // Handle cross-origin images
    logging: false,
    backgroundColor: '#ffffff',
  });
  
  // Calculate dimensions
  const imgWidth = 210; // A4 width in mm
  const pageHeight = 297; // A4 height in mm
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  
  // Create PDF
  const pdf = new jsPDF({
    orientation: imgHeight > pageHeight ? 'portrait' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  
  let heightLeft = imgHeight;
  let position = 0;
  
  // Add image to PDF (handle multiple pages)
  const imgData = canvas.toDataURL('image/png');
  pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;
  
  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }
  
  // Return PDF as Uint8Array instead of saving directly
  const arrayBuffer = pdf.output('arraybuffer');
  return new Uint8Array(arrayBuffer);
}

/**
 * Merge multiple PDFs together
 */
export async function mergePdfs(
  mainPdfBytes: Uint8Array,
  additionalPdfs: ArrayBuffer[]
): Promise<Uint8Array> {
  const { PDFDocument } = await loadPdfLib();
  
  const mergedPdf = await PDFDocument.load(mainPdfBytes);
  
  for (const pdfData of additionalPdfs) {
    try {
      const pdfToAppend = await PDFDocument.load(pdfData);
      const pages = await mergedPdf.copyPages(pdfToAppend, pdfToAppend.getPageIndices());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pages.forEach((page: any) => mergedPdf.addPage(page));
    } catch (error) {
      console.error('Error merging PDF:', error);
      // Continue with other PDFs if one fails
    }
  }
  
  return mergedPdf.save();
}

/**
 * Create a PDF with internal links to appended PDF pages
 */
export async function createPdfWithLinks(
  mainPdfBytes: Uint8Array,
  methodPdfs: PdfAttachmentData[]
): Promise<Uint8Array> {
  const { PDFDocument } = await loadPdfLib();
  
  const mergedPdf = await PDFDocument.load(mainPdfBytes);
  const mainPageCount = mergedPdf.getPageCount();
  
  // Sort PDFs by order
  const sortedPdfs = [...methodPdfs].sort((a, b) => a.order - b.order);
  
  // Track starting page for each PDF
  const pdfPageStarts: { methodName: string; startPage: number }[] = [];
  let currentPage = mainPageCount + 1;
  
  // Append each PDF and track page numbers
  for (const pdfData of sortedPdfs) {
    pdfPageStarts.push({
      methodName: pdfData.methodName,
      startPage: currentPage,
    });
    
    try {
      const pdfToAppend = await PDFDocument.load(pdfData.data);
      const pages = await mergedPdf.copyPages(pdfToAppend, pdfToAppend.getPageIndices());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pages.forEach((page: any) => mergedPdf.addPage(page));
      currentPage += pages.length;
    } catch (error) {
      console.error(`Error appending PDF ${pdfData.filename}:`, error);
    }
  }
  
  // Note: Adding internal links in pdf-lib is complex and requires knowing exact coordinates
  // For now, we'll add a table of contents at the end of the main content
  // This is a simplified approach - full internal links would require more complex coordinate calculations
  
  return mergedPdf.save();
}

/**
 * Create a hidden HTML element for PDF rendering
 */
export function createPdfRenderElement(content: string, title: string): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = `
    position: absolute;
    left: -9999px;
    top: 0;
    width: 800px;
    padding: 40px;
    background: white;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #333;
  `;
  
  // Add title
  const titleEl = document.createElement('h1');
  titleEl.textContent = title;
  titleEl.style.cssText = `
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 20px;
    color: #111;
  `;
  container.appendChild(titleEl);
  
  // Add content (we'll use ReactMarkdown in the component, so we receive HTML here)
  const contentEl = document.createElement('div');
  contentEl.innerHTML = content;
  contentEl.style.cssText = `
    h1 { font-size: 20px; font-weight: 600; margin: 20px 0 10px; color: #111; }
    h2 { font-size: 18px; font-weight: 600; margin: 18px 0 10px; color: #222; }
    h3 { font-size: 16px; font-weight: 600; margin: 16px 0 8px; color: #333; }
    p { margin: 10px 0; }
    ul, ol { margin: 10px 0; padding-left: 20px; }
    li { margin: 4px 0; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    pre { background: #f4f4f4; padding: 12px; border-radius: 6px; overflow-x: auto; }
    blockquote { border-left: 3px solid #ddd; margin: 10px 0; padding-left: 15px; color: #666; }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f4f4f4; }
    hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
  `;
  container.appendChild(contentEl);
  
  document.body.appendChild(container);
  return container;
}

/**
 * Clean up the hidden PDF render element
 */
export function cleanupPdfRenderElement(element: HTMLElement): void {
  if (element && element.parentNode) {
    element.parentNode.removeChild(element);
  }
}

/**
 * Download a PDF file
 */
export function downloadPdf(pdfBytes: Uint8Array, filename: string): void {
  // Create a new ArrayBuffer from the Uint8Array to ensure compatibility
  const buffer = new ArrayBuffer(pdfBytes.length);
  const view = new Uint8Array(buffer);
  view.set(pdfBytes);
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Combined Export Functions
// ---------------------------------------------------------------------------

/**
 * Export a single experiment
 */
export async function exportSingleExperiment(
  data: ExperimentExportData,
  options: ExportOptions
): Promise<void> {
  const filename = data.task.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  
  if (options.format === 'markdown') {
    const markdown = generateExperimentMarkdown(data, options);
    
    // If there are PDF attachments, create a ZIP file
    if (data.methodPdfs && data.methodPdfs.length > 0) {
      await downloadMarkdownWithAttachments(markdown, filename, data.methodPdfs);
    } else {
      downloadMarkdown(markdown, filename);
    }
  } else {
    // PDF export
    const markdown = generateExperimentMarkdown(data, options);
    const container = createPdfRenderElement(markdown, data.task.name);
    try {
      const mainPdfBytes = await generatePdfFromHtml(container, filename);
      
      // If there are PDF method attachments, merge them
      if (data.methodPdfs && data.methodPdfs.length > 0) {
        const sortedPdfs = [...data.methodPdfs].sort((a, b) => a.order - b.order);
        const mergedPdf = await createPdfWithLinks(mainPdfBytes, sortedPdfs);
        downloadPdf(mergedPdf, filename);
      } else {
        downloadPdf(mainPdfBytes, filename);
      }
    } finally {
      cleanupPdfRenderElement(container);
    }
  }
}

/**
 * Export multiple experiments as a combined document
 */
export async function exportMultipleExperiments(
  experiments: ExperimentExportData[],
  options: ExportOptions
): Promise<void> {
  if (experiments.length === 0) {
    alert('No experiments selected for export');
    return;
  }
  
  const filename = `experiments_export_${new Date().toISOString().split('T')[0]}`;
  
  if (options.format === 'markdown') {
    const markdown = generateCombinedMarkdown(experiments, options);
    
    // Collect all PDF attachments from all experiments
    const allMethodPdfs = experiments.flatMap(exp => exp.methodPdfs || []);
    
    // If there are PDF attachments, create a ZIP file
    if (allMethodPdfs.length > 0) {
      await downloadMarkdownWithAttachments(markdown, filename, allMethodPdfs);
    } else {
      downloadMarkdown(markdown, filename);
    }
  } else {
    // PDF export
    const markdown = generateCombinedMarkdown(experiments, options);
    const title = `Exported Experiments (${experiments.length})`;
    const container = createPdfRenderElement(markdown, title);
    try {
      const mainPdfBytes = await generatePdfFromHtml(container, filename);
      
      // Collect all PDF attachments from all experiments
      const allMethodPdfs = experiments.flatMap(exp => exp.methodPdfs || []);
      
      // If there are PDF attachments, merge them
      if (allMethodPdfs.length > 0) {
        // Sort by experiment order first, then by method order within each experiment
        const sortedPdfs = experiments.flatMap((exp, expIndex) => 
          (exp.methodPdfs || []).map(pdf => ({ ...pdf, expIndex }))
        ).sort((a, b) => {
          if (a.expIndex !== b.expIndex) return a.expIndex - b.expIndex;
          return a.order - b.order;
        });
        const mergedPdf = await createPdfWithLinks(mainPdfBytes, sortedPdfs);
        downloadPdf(mergedPdf, filename);
      } else {
        downloadPdf(mainPdfBytes, filename);
      }
    } finally {
      cleanupPdfRenderElement(container);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper Functions for Fetching PDF Data
// ---------------------------------------------------------------------------

/**
 * Fetch PDF data from the backend
 */
export async function fetchPdfData(path: string): Promise<ArrayBuffer> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
  const response = await fetch(`${apiUrl}/github/raw?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF: ${path}`);
  }
  return response.arrayBuffer();
}

/**
 * Process method attachments and fetch PDF data
 */
export async function processMethodAttachments(
  method: Method,
  methodOrder: number
): Promise<{ content: string | null; pdfs: PdfAttachmentData[] }> {
  let content: string | null = null;
  const pdfs: PdfAttachmentData[] = [];
  
  // Sort attachments by order
  const sortedAttachments = [...method.attachments].sort((a, b) => a.order - b.order);
  
  for (const attachment of sortedAttachments) {
    if (attachment.attachment_type === 'pdf' && attachment.path) {
      try {
        const pdfData = await fetchPdfData(attachment.path);
        const filename = attachment.path.split('/').pop() || 'attachment.pdf';
        
        pdfs.push({
          filename,
          originalPath: attachment.path,
          data: pdfData,
          methodId: method.id,
          methodName: method.name,
          order: methodOrder,
        });
      } catch (error) {
        console.error(`Failed to fetch PDF ${attachment.path}:`, error);
      }
    } else if (attachment.attachment_type === 'markdown' && attachment.path) {
      // For markdown, we'll return the content separately
      // The caller will need to fetch this using githubApi.readFile
    }
  }
  
  return { content, pdfs };
}
