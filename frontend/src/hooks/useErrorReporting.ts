"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  subscribeToErrors, 
  getLastError, 
  clearLastError,
  type ErrorInfo 
} from "@/lib/error-reporting";

export function useErrorReporting() {
  const [showBugReport, setShowBugReport] = useState(false);
  const [currentError, setCurrentError] = useState<ErrorInfo | null>(null);
  const [showErrorToast, setShowErrorToast] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToErrors((error) => {
      setCurrentError(error);
      setShowErrorToast(true);
    });

    return unsubscribe;
  }, []);

  const reportCurrentError = useCallback(() => {
    const error = getLastError();
    setCurrentError(error);
    setShowBugReport(true);
    setShowErrorToast(false);
  }, []);

  const openBugReport = useCallback(() => {
    setCurrentError(getLastError());
    setShowBugReport(true);
    setShowErrorToast(false);
  }, []);

  const closeBugReport = useCallback(() => {
    setShowBugReport(false);
    clearLastError();
    setCurrentError(null);
  }, []);

  const dismissErrorToast = useCallback(() => {
    setShowErrorToast(false);
  }, []);

  return {
    showBugReport,
    currentError,
    showErrorToast,
    reportCurrentError,
    openBugReport,
    closeBugReport,
    dismissErrorToast,
  };
}
