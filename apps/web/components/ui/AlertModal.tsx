'use client';
import { createPortal } from 'react-dom';

interface AlertModalProps {
  message: string;
  onClose: () => void;
}

export function AlertModal({ message, onClose }: AlertModalProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-surface border border-border-hi rounded-xl p-5 w-full max-w-sm flex flex-col gap-4 shadow-xl">
        <p className="text-[14px] text-text leading-relaxed">{message}</p>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-accent text-white text-[13px] font-medium hover:bg-accent/90 transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
