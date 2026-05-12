import { useCallback, useState } from 'react';

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (ok: boolean) => void;
};

export function useConfirm() {
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const requestConfirm = useCallback(
    (opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> =>
      new Promise((resolve) => setConfirmRequest({ ...opts, resolve })),
    [],
  );

  const handleConfirm = useCallback((ok: boolean) => {
    setConfirmRequest((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  return { confirmRequest, requestConfirm, handleConfirm };
}
