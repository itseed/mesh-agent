'use client';
import { createPortal } from 'react-dom';

interface ConfirmModalProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function ConfirmModal({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  danger = false,
}: ConfirmModalProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-surface border border-border-hi rounded-xl p-5 w-full max-w-sm flex flex-col gap-4 shadow-xl">
        <p className="text-[14px] text-text leading-relaxed">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded-lg border border-border text-[13px] text-muted hover:text-text transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={
              'px-4 py-1.5 rounded-lg text-[13px] font-medium text-white transition-colors ' +
              (danger ? 'bg-danger hover:bg-danger/90' : 'bg-accent hover:bg-accent/90')
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
