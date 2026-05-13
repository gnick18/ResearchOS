"use client";

import { useCallback, useState } from "react";

/**
 * Auto-dismissing toast for surfaces that intercept native OS file drops
 * (so Chrome doesn't open the file) but don't have a Files/ folder to
 * upload into — currently NoteDetailPopup and MethodTabs variation notes.
 *
 * Returns `{ show, toast }`. Call `show()` from the editor's `onFileDrop`
 * to flash the message; render `{toast}` once anywhere in the component.
 */
export function useDropWarning(message: string) {
  const [visible, setVisible] = useState(false);
  const show = useCallback(() => {
    setVisible(true);
    window.setTimeout(() => setVisible(false), 3500);
  }, []);
  const toast = visible ? (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
      {message}
    </div>
  ) : null;
  return { show, toast };
}
