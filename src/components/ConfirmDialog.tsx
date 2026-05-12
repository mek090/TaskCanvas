import { useEffect, useRef } from 'react';
import type { ConfirmRequest } from '../hooks/useConfirm';

type Props = {
  request: ConfirmRequest;
  onResolve: (ok: boolean) => void;
};

export function ConfirmDialog({ request, onResolve }: Props) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onResolve(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onResolve]);
  return (
    <div className="modal-backdrop" onClick={() => onResolve(false)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{request.title}</h2>
        <p>{request.message}</p>
        <div className="modal-actions">
          <button onClick={() => onResolve(false)}>{request.cancelLabel ?? 'Cancel'}</button>
          <button ref={confirmRef} className="danger" onClick={() => onResolve(true)}>
            {request.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
