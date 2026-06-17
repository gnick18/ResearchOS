/**
 * useFormErrors — lightweight per-field inline error state for dialog forms.
 *
 * Usage pattern (validate on submit, clear live once fixed):
 *
 *   const { errors, setError, clearError, clearAll, focusFirstError } = useFormErrors();
 *
 *   const handleSubmit = () => {
 *     clearAll();
 *     let ok = true;
 *     if (!title.trim()) { setError("title", "Title is required."); ok = false; }
 *     if (!ok) { focusFirstError(); return; }
 *     // ...proceed
 *   };
 *
 *   // In JSX:
 *   <input id="title" ... onChange={(e) => { setTitle(e.target.value); clearError("title"); }} />
 *   <FieldError message={errors.title} />
 *
 * Dependency-free (no external packages). Fully unit-testable via the pure helpers below.
 */

import { useCallback, useRef, useState } from "react";

/** Map of field-id to error message string (undefined = no error). */
export type FormErrors = Record<string, string | undefined>;

export interface UseFormErrorsReturn {
  /** Current error map. Read in JSX to feed <FieldError>. */
  errors: FormErrors;
  /** Set the error message for a field. Clears it when message is empty/nullish. */
  setError: (field: string, message: string) => void;
  /** Remove the error for a field (call from the field's onChange). */
  clearError: (field: string) => void;
  /** Remove all field errors (call at the start of each submit attempt). */
  clearAll: () => void;
  /**
   * After a blocked submit, focus+scroll the first field that has an error.
   * The element must have an id matching the field key. No-ops gracefully if
   * no errored field is found in the DOM.
   */
  focusFirstError: () => void;
}

export function useFormErrors(): UseFormErrorsReturn {
  const [errors, setErrors] = useState<FormErrors>({});
  // Keep a stable ref to errors so focusFirstError doesn't close over a stale map.
  const errorsRef = useRef<FormErrors>({});

  const setError = useCallback((field: string, message: string) => {
    setErrors((prev) => {
      const next = { ...prev, [field]: message || undefined };
      errorsRef.current = next;
      return next;
    });
  }, []);

  const clearError = useCallback((field: string) => {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      errorsRef.current = next;
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setErrors({});
    errorsRef.current = {};
  }, []);

  const focusFirstError = useCallback(() => {
    const errorFields = Object.keys(errorsRef.current).filter(
      (k) => errorsRef.current[k] !== undefined,
    );
    if (errorFields.length === 0) return;
    const el = document.getElementById(errorFields[0]);
    if (el && typeof (el as HTMLElement).focus === "function") {
      (el as HTMLElement).scrollIntoView({ block: "nearest" });
      (el as HTMLElement).focus();
    }
  }, []);

  return { errors, setError, clearError, clearAll, focusFirstError };
}

// ── Pure helper functions (unit-testable without React) ───────────────────────

/**
 * Returns a new errors map with the given field set or cleared.
 * Useful in reducer-style tests without a React harness.
 */
export function applyError(
  errors: FormErrors,
  field: string,
  message: string | undefined,
): FormErrors {
  if (!message) {
    const next = { ...errors };
    delete next[field];
    return next;
  }
  return { ...errors, [field]: message };
}

/**
 * Returns true when the errors map has at least one non-undefined entry.
 */
export function hasErrors(errors: FormErrors): boolean {
  return Object.values(errors).some((v) => v !== undefined);
}

/**
 * Returns the field keys that currently have errors, in insertion order.
 * Useful for asserting which fields failed in tests.
 */
export function errorFields(errors: FormErrors): string[] {
  return Object.entries(errors)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);
}
