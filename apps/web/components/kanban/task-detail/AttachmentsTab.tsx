'use client';
import type { ChangeEvent, RefObject } from 'react';

interface AttachmentsTabProps {
  attachments: any[];
  uploading: boolean;
  uploadError: string;
  fileInputRef: RefObject<HTMLInputElement>;
  onUpload: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function AttachmentsTab({
  attachments,
  uploading,
  uploadError,
  fileInputRef,
  onUpload,
}: AttachmentsTabProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted uppercase tracking-wide">Files</span>
        <div>
          <input ref={fileInputRef} type="file" hidden onChange={onUpload} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-[13px] bg-accent/10 hover:bg-accent/20 border border-accent/20 text-accent px-3 py-1.5 rounded transition-all disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : '+ Upload file'}
          </button>
        </div>
      </div>

      {uploadError && <p className="text-danger text-[12px]">✕ {uploadError}</p>}

      {attachments.length === 0 ? (
        <p className="text-[13px] text-dim py-4 text-center">ยังไม่มีไฟล์แนบ</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {attachments.map((a: any) => (
            <div
              key={a.id}
              className="flex items-center gap-3 p-2.5 bg-canvas border border-border rounded-lg"
            >
              <span className="text-[18px] shrink-0">
                {a.mimeType?.startsWith('image/')
                  ? '🖼️'
                  : a.mimeType === 'application/pdf'
                    ? '📄'
                    : '📎'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text truncate">{a.fileName}</div>
                <div className="text-[11px] text-dim">
                  {a.fileSize ? `${(a.fileSize / 1024).toFixed(1)} KB` : ''}
                  {a.mimeType ? ` · ${a.mimeType.split('/')[1]}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
