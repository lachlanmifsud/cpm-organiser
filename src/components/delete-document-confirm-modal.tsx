"use client";

import { AlertTriangle, Loader2 } from "lucide-react";

type DeleteDocumentConfirmModalProps = {
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteDocumentConfirmModal({
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteDocumentConfirmModalProps) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => {
        if (!isDeleting) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-document-title"
        className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[#FCECEE] text-[#E2445C]"
          aria-hidden
        >
          <AlertTriangle className="size-6" />
        </div>
        <h2 id="delete-document-title" className="mb-2 text-lg font-bold text-[#323338]">
          Delete this document?
        </h2>
        <p className="mb-6 text-sm text-[#676879]">
          This action cannot be undone. All associated workbench items will be unlinked and returned
          to an Unbilled state.
        </p>
        <div className="flex w-full gap-3">
          <button
            type="button"
            disabled={isDeleting}
            onClick={onCancel}
            className="flex-1 rounded-md border border-[#C3C6D4] bg-white px-4 py-2 font-medium text-[#323338] transition hover:bg-[#F5F6F8] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={onConfirm}
            className="flex-1 rounded-md bg-[#E2445C] px-4 py-2 font-medium text-white transition hover:bg-[#C93B52] disabled:opacity-50"
          >
            {isDeleting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Deleting…
              </span>
            ) : (
              "Delete"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
