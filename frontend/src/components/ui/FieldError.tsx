"use client";

/**
 * FieldError — inline error slot rendered below a form field.
 *
 * Renders nothing when message is empty/undefined, so callers can
 * unconditionally place it after every field without branching in JSX:
 *
 *   <input id="title" ... />
 *   <FieldError message={errors.title} />
 *
 * The role="alert" ensures screen readers announce the error immediately
 * when it appears (live region, assertive).
 */

interface FieldErrorProps {
  message?: string;
  /** Additional class names for layout overrides. */
  className?: string;
}

export default function FieldError({ message, className = "" }: FieldErrorProps) {
  if (!message) return null;
  return (
    <p
      role="alert"
      aria-live="assertive"
      className={`mt-1 text-meta text-red-600 dark:text-red-400 ${className}`}
    >
      {message}
    </p>
  );
}
