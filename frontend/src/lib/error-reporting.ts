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

export type FeedbackType = "bug" | "feature" | "feedback";

export interface FeedbackPayload {
  type: FeedbackType;
  title?: string;
  description: string;
  errorInfo?: ErrorInfo | null;
}

const TYPE_LABEL: Record<FeedbackType, string> = {
  bug: "Bug",
  feature: "Feature",
  feedback: "Feedback",
};

const TYPE_FALLBACK_TITLE: Record<FeedbackType, string> = {
  bug: "User Report",
  feature: "User feature request",
  feedback: "User feedback",
};

/**
 * GitHub issue labels by feedback type. The `bug` and `enhancement`
 * labels ship in every GitHub repo by default, so the URL we open is
 * guaranteed to apply them on submission. `feedback` is intentionally
 * unlabeled — the repo doesn't carry a "feedback" label, and passing a
 * non-existent label silently drops on GitHub's side anyway.
 */
const TYPE_LABEL_PARAM: Record<FeedbackType, string | null> = {
  bug: "bug",
  feature: "enhancement",
  feedback: null,
};

export function generateGitHubIssueUrl(
  payload: FeedbackPayload
): string {
  const { type, title: userTitle, description, errorInfo } = payload;
  const labelTag = `[${TYPE_LABEL[type]}]`;

  let titleBody: string;
  if (userTitle && userTitle.trim()) {
    titleBody = userTitle.trim().slice(0, 100);
  } else if (type === "bug" && errorInfo) {
    titleBody = errorInfo.message.slice(0, 100);
  } else {
    titleBody = TYPE_FALLBACK_TITLE[type];
  }
  const title = `${labelTag} ${titleBody}`;

  let body = "";

  if (description) {
    const heading =
      type === "bug"
        ? "What happened:"
        : type === "feature"
        ? "Feature description:"
        : "Feedback:";
    body += `**${heading}**\n${description}\n\n`;
  }

  if (type === "bug" && errorInfo) {
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

  const labelParam = TYPE_LABEL_PARAM[type];
  if (labelParam) {
    params.set("labels", labelParam);
  }

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
