import type { ToastState } from '../hooks/useToast';

type Props = {
  toast: ToastState;
  onDismiss: () => void;
};

export function Toast({ toast, onDismiss }: Props) {
  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {toast.undo && (
        <button className="toast-undo" onClick={toast.undo}>
          Undo
        </button>
      )}
      <button className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
