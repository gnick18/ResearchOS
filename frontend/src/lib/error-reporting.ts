const GITHUB_REPO = "gnick18/ResearchOS";

export interface ErrorInfo {
  message: string;
  stack?: string;
  timestamp: string;
  url: string;
  userAgent: string;
}

let lastError: ErrorInfo | null = null;
const errorListeners: Set<(error: ErrorInfo) => void> = new Set();

export function getLastError(): ErrorInfo | null {
  return lastError;
}

export function clearLastError(): void {
  lastError = null;
}

export function subscribeToErrors(callback: (error: ErrorInfo) => void): () => void {
  errorListeners.add(callback);
  return () => errorListeners.delete(callback);
}

function notifyErrorListeners(error: ErrorInfo) {
  errorListeners.forEach(cb => {
    try {
      cb(error);
    } catch {}
  });
}

function createErrorInfo(message: string, stack?: string): ErrorInfo {
  return {
    message,
    stack: stack ? stack.slice(0, 2000) : undefined,
    timestamp: new Date().toISOString(),
    url: window.location.href,
    userAgent: navigator.userAgent,
  };
}

export function captureError(error: Error | string, stack?: string): ErrorInfo {
  const message = typeof error === "string" ? error : error.message;
  const stackTrace = typeof error === "string" ? stack : (error.stack || stack);
  
  const errorInfo = createErrorInfo(message, stackTrace);
  lastError = errorInfo;
  notifyErrorListeners(errorInfo);
  
  return errorInfo;
}

export function initializeErrorHandlers(): () => void {
  const originalOnError = window.onerror;
  const originalOnUnhandledRejection = window.onunhandledrejection;

  window.onerror = (message, source, lineno, colno, error) => {
    const errorInfo = createErrorInfo(
      String(message),
      error?.stack || `at ${source}:${lineno}:${colno}`
    );
    lastError = errorInfo;
    notifyErrorListeners(errorInfo);
    
    if (originalOnError) {
      return originalOnError(message, source, lineno, colno, error);
    }
    return false;
  };

  window.onunhandledrejection = (event) => {
    const error = event.reason;
    let message: string;
    let stack: string | undefined;
    
    if (error instanceof Error) {
      message = error.message;
      stack = error.stack;
    } else if (typeof error === "string") {
      message = error;
    } else {
      message = JSON.stringify(error);
    }
    
    const errorInfo = createErrorInfo(message, stack);
    lastError = errorInfo;
    notifyErrorListeners(errorInfo);
  };

  return () => {
    window.onerror = originalOnError;
    window.onunhandledrejection = originalOnUnhandledRejection;
  };
}

export function generateGitHubIssueUrl(
  description: string,
  errorInfo?: ErrorInfo | null
): string {
  const title = errorInfo 
    ? `[Bug] ${errorInfo.message.slice(0, 100)}`
    : "[Bug] User Report";

  let body = "";
  
  if (description) {
    body += `**What happened:**\n${description}\n\n`;
  }
  
  if (errorInfo) {
    body += `**Error Message:**\n\`\`\`\n${errorInfo.message}\n\`\`\`\n\n`;
    
    if (errorInfo.stack) {
      body += `**Stack Trace:**\n\`\`\`\n${errorInfo.stack}\n\`\`\`\n\n`;
    }
    
    body += `**URL:** ${errorInfo.url}\n\n`;
    body += `**User Agent:** ${errorInfo.userAgent}\n\n`;
    body += `**Time:** ${errorInfo.timestamp}\n`;
  }
  
  const params = new URLSearchParams({
    title,
    body: body.trim(),
  });
  
  return `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
}

export function getBrowserInfo(): string {
  const ua = navigator.userAgent;
  let browser = "Unknown";
  let os = "Unknown";
  
  if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Edg")) browser = "Edge";
  else if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Safari")) browser = "Safari";
  
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  
  return `${browser} on ${os}`;
}
