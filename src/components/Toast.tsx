import type { ToastState } from '../hooks/useToast';
import { CloseIcon } from './Icon';

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
        <CloseIcon />
      </button>
    </div>
  );
}
