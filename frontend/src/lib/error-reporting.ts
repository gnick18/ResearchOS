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
  /**
   * Whether the user attached screenshots in the feedback modal. The app
   * is local-first with no server, and a GitHub new-issue URL is text-only
   * (you cannot pre-attach an image), so images can never auto-flow into
   * the issue. When this is true we instead append a `## Screenshots`
   * section to the issue body that invites the user to paste the images
   * they copied from our modal. (feedback-screenshots bot)
   */
  hasScreenshots?: boolean;
}

// The trailing free-text textarea on each issue form. We drop the
// `## Screenshots` prompt here so it lands in a natural "anything else"
// slot rather than colliding with a required field. Each id matches the
// last `type: textarea` in the corresponding template under
// .github/ISSUE_TEMPLATE.
const SCREENSHOT_FIELD: Record<FeedbackType, string> = {
  bug: "additional-context",
  feature: "alternatives",
  feedback: "additional-context",
};

// The markdown block appended to the issue body when screenshots are
// attached. GitHub uploads images on paste into a textarea, so the hint
// invites exactly that. Kept as an exported const so the test can assert
// the body contains the section without hard-coding the copy twice.
export const SCREENSHOTS_SECTION =
  "## Screenshots\n\nPaste your screenshot(s) below.";

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

// Each type maps to its own dedicated issue form. `blank_issues_enabled: false`
// in config.yml means there's no untemplated fallback, so every type needs a form.
const TEMPLATE_FILE: Record<FeedbackType, string> = {
  bug: "bug.yml",
  feature: "feature.yml",
  feedback: "feedback.yml",
};

/**
 * GitHub issue labels by feedback type. The `bug` and `enhancement`
 * labels ship in every GitHub repo by default, so the URL we open is
 * guaranteed to apply them on submission. Feedback type now has its
 * own `feedback` label (added with feedback.yml). The template's
 * `labels:` array also applies these, so this parameter is a fallback
 * for non-template URLs.
 */
const TYPE_LABEL_PARAM: Record<FeedbackType, string | null> = {
  bug: "bug",
  feature: "enhancement",
  feedback: "feedback",
};

export function generateGitHubIssueUrl(
  payload: FeedbackPayload
): string {
  const { type, title: userTitle, description, errorInfo, hasScreenshots } = payload;
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

  // Issue forms ignore `body=`; each form field is prefilled via its `id`.
  const fields: Record<string, string> = {};

  if (type === "bug") {
    if (description) fields["what-happened"] = description;

    if (errorInfo) {
      const envLines = [
        `Browser: ${getBrowserInfo()}`,
        `URL when error happened: ${errorInfo.url}`,
        `Time: ${errorInfo.timestamp}`,
        `User agent: ${errorInfo.userAgent}`,
      ];
      fields.environment = envLines.join("\n");

      const errorLogParts = [errorInfo.message];
      if (errorInfo.stack) errorLogParts.push("", errorInfo.stack);
      fields["error-log"] = errorLogParts.join("\n");
    } else if (typeof navigator !== "undefined") {
      fields.environment = `Browser: ${getBrowserInfo()}`;
    }
  } else if (type === "feature") {
    if (description) fields.feature = description;
  } else {
    // feedback.yml uses `feedback` as its main field id.
    if (description) fields.feedback = description;
  }

  // When screenshots are attached, prompt the user to paste them in the
  // trailing free-text field. Append (rather than overwrite) so any
  // existing content in that field is preserved.
  if (hasScreenshots) {
    const fieldId = SCREENSHOT_FIELD[type];
    const existing = fields[fieldId];
    fields[fieldId] = existing
      ? `${existing}\n\n${SCREENSHOTS_SECTION}`
      : SCREENSHOTS_SECTION;
  }

  const params = new URLSearchParams({
    template: TEMPLATE_FILE[type],
    title,
    ...fields,
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
