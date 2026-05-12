import { useCallback, useEffect, useRef, useState } from 'react';
import { UNDO_TIMEOUT_MS } from '../lib/types';

export type ToastState = { message: string; undo?: () => void };

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback((message: string, undo?: () => void) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast({ message, undo });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, UNDO_TIMEOUT_MS);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  return { toast, showToast, dismissToast };
}
